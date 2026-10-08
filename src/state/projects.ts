// Opening, creating and deleting projects, and first-run bootstrapping.

import type { Character, Doc, ID, Project } from '../model/types';
import { newCharacter, newProject } from '../model/defaults';
import { deleteMany, deleteProjectData, getAllKeysByProject, listAssetIds, listProjects, loadDoc, putOne, saveDocFull } from '../db/idb';
import { setAssetProject } from '../db/assets';
import { clearRenderCache } from '../render/partRender';
import { docStore } from './store';
import { flush, markSaved, startAutosave } from './persist';
import { prefsStore, setPrefs, setUI, toast } from './ui';
import { seedRequired } from './actions';

/** Fix anything a hand-edited or older document could be missing. */
export function repairDoc(doc: Doc): Doc {
  const p = { ...doc.project };
  if (!p.poses?.length) p.poses = [{ id: 'bust-front', name: 'bust-front', guide: 'front' }];
  p.swatches ??= [];
  p.colorGroups ??= [];
  p.crops ??= [];
  p.expressionCategoryIds ??= [];
  const poseIds = new Set(p.poses.map((x) => x.id));
  const characters: Record<ID, Character> = {};
  for (const c of Object.values(doc.characters)) {
    characters[c.id] = {
      ...c,
      poseId: poseIds.has(c.poseId) ? c.poseId : p.poses[0].id,
      expressions: c.expressions ?? [],
      groupColors: c.groupColors ?? {},
    };
  }
  return { project: p, parts: doc.parts, characters };
}

export function referencedAssets(doc: Doc): Set<ID> {
  const s = new Set<ID>();
  const add = (id?: ID) => id && s.add(id);
  for (const part of Object.values(doc.parts)) {
    add(part.images.flat);
    add(part.images.fill);
    add(part.images.line);
    add(part.thumb);
    if (part.trace) {
      add(part.trace.line);
      add(part.trace.fill);
      add(part.trace.shade);
      add(part.trace.reference);
    }
  }
  for (const pose of doc.project.poses) add(pose.guideImage);
  for (const c of Object.values(doc.characters)) add(c.background.image);
  return s;
}

/** Remove image blobs nothing refers to anymore (runs once when a project opens). */
async function collectGarbage(doc: Doc) {
  try {
    const used = referencedAssets(doc);
    const all = await listAssetIds(doc.project.id);
    const orphans = all.filter((id) => !used.has(id));
    if (orphans.length) await deleteMany('assets', orphans.map((id) => [doc.project.id, id]));
    const thumbKeys = await getAllKeysByProject('thumbs', doc.project.id);
    const staleThumbs = thumbKeys.filter((k) => !doc.characters[(k as [ID, ID])[1]]);
    if (staleThumbs.length) await deleteMany('thumbs', staleThumbs);
  } catch (err) {
    console.warn('Asset cleanup skipped', err);
  }
}

export async function openProject(pid: ID) {
  await flush();
  setUI({ ready: false, loadingMessage: 'Opening project…' });
  setAssetProject(pid);
  clearRenderCache();
  const loaded = await loadDoc(pid);
  if (!loaded) throw new Error('Project not found');
  let doc = repairDoc(loaded);
  let needsSave = doc !== loaded;
  const live = Object.values(doc.characters)
    .filter((c) => !c.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  let charId = prefsStore.get().lastCharacter[pid];
  if (!charId || !live.some((c) => c.id === charId)) charId = live[0]?.id;
  if (!charId) {
    const c = seedRequired(doc, newCharacter('Character 1', doc.project.poses[0].id));
    doc = { ...doc, characters: { ...doc.characters, [c.id]: c } };
    charId = c.id;
    needsSave = true;
  }
  docStore.load(doc);
  markSaved(needsSave ? null : doc);
  if (needsSave) await flush();
  const firstCat = doc.project.categories.find((c) => Object.values(doc.parts).some((p) => p.categoryId === c.id && !p.deletedAt));
  setUI((s) => ({
    ready: true,
    projectId: pid,
    characterId: charId!,
    selection: [],
    activeCategoryId: firstCat?.id ?? doc.project.categories[0]?.id ?? null,
    libSelected: [],
    libSelectMode: false,
    showTrash: false,
    tagFilter: null,
    libraryQuery: '',
    fitRequest: s.fitRequest + 1,
    mode: 'mixer',
  }));
  setPrefs((p) => ({ lastProjectId: pid, lastCharacter: { ...p.lastCharacter, [pid]: charId! } }));
  void collectGarbage(doc);
}

export async function allProjects(): Promise<Project[]> {
  return (await listProjects()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProject(name: string, width?: number, height?: number, withPlaceholders = false): Promise<ID> {
  await flush();
  const project = newProject(name, width, height);
  if (withPlaceholders) return createStarterProject(project);
  await saveDocFull({ project, parts: {}, characters: {} });
  await openProject(project.id);
  return project.id;
}

export async function createStarterProject(project: Project = newProject('Starter project')): Promise<ID> {
  setUI({ ready: false, loadingMessage: 'Creating starter parts…' });
  await putOne('projects', project);
  setAssetProject(project.id);
  const { generatePlaceholders, starterCharacter } = await import('../starter/placeholders');
  const parts = await generatePlaceholders(project, (msg) => setUI({ loadingMessage: msg }));
  let doc: Doc = { project, parts, characters: {} };
  const char = starterCharacter(doc);
  doc = { ...doc, characters: { [char.id]: char } };
  await saveDocFull(doc);
  setPrefs((p) => ({ lastCharacter: { ...p.lastCharacter, [project.id]: char.id } }));
  await openProject(project.id);
  return project.id;
}

/** Soft-delete: the project goes to "Recently deleted" in the project list. */
export async function trashProject(pid: ID) {
  await flush();
  const projects = await listProjects();
  const p = projects.find((x) => x.id === pid);
  if (!p) return;
  await putOne('projects', { ...p, deletedAt: Date.now() });
  if (docStore.isLoaded() && docStore.get().project.id === pid) {
    docStore.load({ ...docStore.get(), project: { ...docStore.get().project, deletedAt: Date.now() } });
    markSaved(docStore.get());
    const next = projects.filter((x) => x.id !== pid && !x.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (next) await openProject(next.id);
    else await createProject('My project');
  }
  toast(`Moved project “${p.name}” to Recently deleted`);
}

export async function restoreProject(pid: ID) {
  const p = (await listProjects()).find((x) => x.id === pid);
  if (!p) return;
  const { deletedAt: _d, ...rest } = p;
  await putOne('projects', rest);
}

export async function purgeProject(pid: ID) {
  await deleteProjectData(pid);
}

export async function bootstrap() {
  try {
    const projects = (await listProjects()).filter((p) => !p.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
    const last = prefsStore.get().lastProjectId;
    let pid = projects.find((p) => p.id === last)?.id ?? projects[0]?.id;
    if (!pid) pid = await createStarterProject();
    else await openProject(pid);
    startAutosave();
  } catch (err) {
    console.error(err);
    setUI({ ready: false, loadingMessage: `Could not open browser storage: ${(err as Error)?.message ?? err}` });
  }
}
