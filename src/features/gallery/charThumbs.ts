// Character thumbnails for the gallery, cached in IndexedDB and in memory.

import { useEffect } from 'react';
import type { Character, ID } from '../../model/types';
import { createStore, docStore, useStore } from '../../state/store';
import { getOne, putOne } from '../../db/idb';
import { canvasToBlob } from '../../db/assets';
import { renderCharacter } from '../../render/compositor';

interface ThumbRec {
  projectId: ID;
  id: ID;
  blob: Blob;
  at: number;
}

const urls = new Map<ID, { url: string; at: number }>();
const inflight = new Set<ID>();
const version = createStore(0);
const THUMB_W = 260;

async function ensure(char: Character) {
  if (inflight.has(char.id)) return;
  inflight.add(char.id);
  try {
    const doc = docStore.get();
    const pid = doc.project.id;
    let blob: Blob | null = null;
    const rec = await getOne<ThumbRec>('thumbs', [pid, char.id]);
    if (rec && rec.at >= char.updatedAt) blob = rec.blob;
    else {
      const c = await renderCharacter(doc, char, { scale: THUMB_W / doc.project.width, background: true });
      blob = await canvasToBlob(c);
      await putOne('thumbs', { projectId: pid, id: char.id, blob, at: char.updatedAt } satisfies ThumbRec);
    }
    const old = urls.get(char.id);
    if (old) URL.revokeObjectURL(old.url);
    urls.set(char.id, { url: URL.createObjectURL(blob), at: char.updatedAt });
    version.set((v) => v + 1);
  } catch (err) {
    console.warn('thumbnail failed', err);
  } finally {
    inflight.delete(char.id);
  }
}

export function useCharThumb(char: Character): string | undefined {
  useStore(version, (v) => v);
  const e = urls.get(char.id);
  useEffect(() => {
    if (!e || e.at < char.updatedAt) void ensure(char);
  }, [char, e]);
  return e?.url;
}
