// Whole-project backup: one .zip with project.json + every image.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { AssetRecord, Character, Doc, ID, Part, Project } from '../model/types';
import { uid } from '../model/ids';
import { getAssetRecord, listProjects, putMany, saveDocFull } from '../db/idb';
import { docStore } from '../state/store';
import { flush } from '../state/persist';
import { openProject, referencedAssets, repairDoc } from '../state/projects';
import { setUI, toast } from '../state/ui';
import { confirmDialog } from '../ui/overlays';
import { downloadBlob, safeFileName } from './download';

const FORMAT = 'picrew-maker-project';

interface Manifest {
  format: typeof FORMAT;
  version: 1;
  exportedAt: string;
  project: Project;
  parts: Part[];
  characters: Character[];
  assets: { id: ID; w: number; h: number; file: string; type: string }[];
}

function extFor(type: string): string {
  if (type.includes('webp')) return 'webp';
  if (type.includes('jpeg')) return 'jpg';
  return 'png';
}

export async function buildProjectZip(doc: Doc): Promise<Uint8Array> {
  const pid = doc.project.id;
  const files: Zippable = {};
  const assets: Manifest['assets'] = [];
  for (const id of referencedAssets(doc)) {
    const rec = await getAssetRecord(pid, id);
    if (!rec) continue;
    const file = `assets/${id}.${extFor(rec.blob.type)}`;
    files[file] = [new Uint8Array(await rec.blob.arrayBuffer()), { level: 0 }];
    assets.push({ id, w: rec.w, h: rec.h, file, type: rec.blob.type || 'image/png' });
  }
  const manifest: Manifest = {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    project: doc.project,
    parts: Object.values(doc.parts),
    characters: Object.values(doc.characters),
    assets,
  };
  files['project.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
  return zipSync(files);
}

export async function exportProjectZip() {
  await flush();
  const doc = docStore.get();
  toast('Packing project…');
  const data = await buildProjectZip(doc);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([data as BlobPart], { type: 'application/zip' }), `${safeFileName(doc.project.name)}-${stamp}.picrew.zip`);
  toast(`Exported “${doc.project.name}” (${(data.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

export function readProjectZip(data: Uint8Array): { manifest: Manifest; files: Record<string, Uint8Array> } {
  const files = unzipSync(data);
  const json = files['project.json'];
  if (!json) throw new Error('This .zip has no project.json — is it a project backup from this app?');
  const manifest = JSON.parse(strFromU8(json)) as Manifest;
  if (manifest.format !== FORMAT) throw new Error('This .zip is not a project backup from this app.');
  return { manifest, files };
}

export async function importProjectZip(file: File) {
  try {
    setUI({ saving: true });
    const { manifest, files } = readProjectZip(new Uint8Array(await file.arrayBuffer()));
    const existing = (await listProjects()).find((p) => p.id === manifest.project.id && !p.deletedAt);
    let project = manifest.project;
    if (existing) {
      const replace = await confirmDialog({
        title: `“${existing.name}” already exists`,
        message: 'Replace it with the backup, or import the backup as a separate copy? (Replacing overwrites parts and characters with the same id.)',
        confirmLabel: 'Replace existing',
        danger: true,
        extra: (
          <p className="muted small">
            Press Cancel to import as a copy instead.
          </p>
        ),
      });
      if (!replace) project = { ...project, id: uid(), name: `${project.name} (imported)` };
    }
    await flush();
    const records: AssetRecord[] = [];
    for (const a of manifest.assets) {
      const bytes = files[a.file];
      if (!bytes) continue;
      records.push({ projectId: project.id, id: a.id, w: a.w, h: a.h, blob: new Blob([bytes as BlobPart], { type: a.type }) });
    }
    await putMany('assets', records);
    const doc: Doc = repairDoc({
      project: { ...project, deletedAt: undefined, updatedAt: Date.now() },
      parts: Object.fromEntries(manifest.parts.map((p) => [p.id, p])),
      characters: Object.fromEntries(manifest.characters.map((c) => [c.id, c])),
    });
    await saveDocFull(doc);
    await openProject(doc.project.id);
    toast(`Imported “${doc.project.name}”: ${manifest.parts.length} parts, ${manifest.characters.length} characters`);
  } catch (err) {
    console.error(err);
    toast(`Import failed: ${(err as Error).message}`, { ms: 8000 });
  } finally {
    setUI({ saving: false });
  }
}
