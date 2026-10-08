// Minimal promise wrapper around IndexedDB.
//
// Stores:
//   projects    key: id                        value: Project
//   parts       key: [projectId, id]           value: { projectId, id, data: Part }
//   characters  key: [projectId, id]           value: { projectId, id, data: Character }
//   assets      key: [projectId, id]           value: AssetRecord (image blobs)
//   thumbs      key: [projectId, id]           value: { projectId, id, blob } (character thumbnails)
//   settings    key: key                       value: { key, value }

import type { AssetRecord, Character, Doc, ID, Part, Project } from '../model/types';

const DB_NAME = 'picrew-maker';
const DB_VERSION = 1;

export type StoreName = 'projects' | 'parts' | 'characters' | 'assets' | 'thumbs' | 'settings';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      for (const name of ['parts', 'characters', 'assets', 'thumbs'] as const) {
        if (!db.objectStoreNames.contains(name)) {
          const s = db.createObjectStore(name, { keyPath: ['projectId', 'id'] });
          s.createIndex('projectId', 'projectId', { unique: false });
        }
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is blocked by another tab. Close other tabs of this app and reload.'));
  });
  return dbPromise;
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export async function getOne<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function getAllByProject<T>(store: StoreName, projectId: ID): Promise<T[]> {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).index('projectId').getAll(projectId)) as Promise<T[]>;
}

export async function getAllKeysByProject(store: StoreName, projectId: ID): Promise<IDBValidKey[]> {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).index('projectId').getAllKeys(projectId));
}

export async function putOne(store: StoreName, value: unknown): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return txDone(tx);
}

export async function putMany(store: StoreName, values: unknown[]): Promise<void> {
  if (!values.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const v of values) s.put(v);
  return txDone(tx);
}

export async function deleteMany(store: StoreName, keys: IDBValidKey[]): Promise<void> {
  if (!keys.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const k of keys) s.delete(k);
  return txDone(tx);
}

export async function listProjects(): Promise<Project[]> {
  const db = await openDB();
  return reqP(db.transaction('projects').objectStore('projects').getAll()) as Promise<Project[]>;
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const rec = await getOne<{ key: string; value: T }>('settings', key);
  return rec?.value;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  return putOne('settings', { key, value });
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

interface Wrapped<T> {
  projectId: ID;
  id: ID;
  data: T;
}

export async function loadDoc(projectId: ID): Promise<Doc | null> {
  const project = await getOne<Project>('projects', projectId);
  if (!project) return null;
  const [parts, chars] = await Promise.all([
    getAllByProject<Wrapped<Part>>('parts', projectId),
    getAllByProject<Wrapped<Character>>('characters', projectId),
  ]);
  const doc: Doc = { project, parts: {}, characters: {} };
  for (const p of parts) doc.parts[p.id] = p.data;
  for (const c of chars) doc.characters[c.id] = c.data;
  return doc;
}

/** Write only what changed between two documents, in one transaction. */
export async function saveDocDiff(prev: Doc | null, next: Doc): Promise<void> {
  const pid = next.project.id;
  const db = await openDB();
  const tx = db.transaction(['projects', 'parts', 'characters'], 'readwrite');
  if (!prev || prev.project !== next.project) tx.objectStore('projects').put(next.project);
  const diff = <T>(store: 'parts' | 'characters', a: Record<ID, T> | undefined, b: Record<ID, T>) => {
    if (a === b) return;
    const s = tx.objectStore(store);
    for (const id in b) if (!a || a[id] !== b[id]) s.put({ projectId: pid, id, data: b[id] });
    if (a) for (const id in a) if (!(id in b)) s.delete([pid, id]);
  };
  diff('parts', prev?.parts, next.parts);
  diff('characters', prev?.characters, next.characters);
  return txDone(tx);
}

/** Write a full document (used for new/imported projects). */
export async function saveDocFull(doc: Doc): Promise<void> {
  return saveDocDiff(null, doc);
}

export async function deleteProjectData(projectId: ID): Promise<void> {
  const db = await openDB();
  const stores: StoreName[] = ['parts', 'characters', 'assets', 'thumbs'];
  for (const store of stores) {
    const keys = await getAllKeysByProject(store, projectId);
    await deleteMany(store, keys);
  }
  const tx = db.transaction('projects', 'readwrite');
  tx.objectStore('projects').delete(projectId);
  await txDone(tx);
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export async function putAssetRecord(rec: AssetRecord): Promise<void> {
  return putOne('assets', rec);
}

export async function getAssetRecord(projectId: ID, id: ID): Promise<AssetRecord | undefined> {
  return getOne<AssetRecord>('assets', [projectId, id]);
}

export async function listAssetIds(projectId: ID): Promise<ID[]> {
  const keys = await getAllKeysByProject('assets', projectId);
  return keys.map((k) => (k as [ID, ID])[1]);
}
