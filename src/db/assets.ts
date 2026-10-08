// Image assets: blobs persisted in IndexedDB plus an in-memory cache of
// decoded images so redraws never decode again.

import type { ID } from '../model/types';
import { uid } from '../model/ids';
import { getAssetRecord, putAssetRecord } from './idb';

export type DrawSource = ImageBitmap | HTMLCanvasElement;

interface CacheEntry {
  img: DrawSource;
  px: number;
  used: number;
}

const BUDGET_PX = 160_000_000; // ~640 MB of decoded pixels before evicting

let projectId: ID | null = null;
const decoded = new Map<ID, CacheEntry>();
const pending = new Map<ID, Promise<DrawSource | null>>();
const failed = new Set<ID>();
const urls = new Map<ID, string>();
const urlPending = new Map<ID, Promise<string | null>>();
const listeners = new Set<() => void>();
let totalPx = 0;
let clock = 0;
let notifyScheduled = false;

export function setAssetProject(pid: ID | null) {
  if (pid === projectId) return;
  projectId = pid;
  for (const e of decoded.values()) if ('close' in e.img) (e.img as ImageBitmap).close();
  decoded.clear();
  pending.clear();
  failed.clear();
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  urlPending.clear();
  totalPx = 0;
}

export function currentAssetProject(): ID | null {
  return projectId;
}

/** Subscribe to "some image finished loading" (batched per frame). */
export function onAssetLoaded(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  const run = () => {
    notifyScheduled = false;
    listeners.forEach((l) => l());
  };
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function remember(id: ID, img: DrawSource) {
  const px = img.width * img.height;
  const old = decoded.get(id);
  if (old) totalPx -= old.px;
  decoded.set(id, { img, px, used: ++clock });
  totalPx += px;
  if (totalPx > BUDGET_PX) evict();
}

function evict() {
  const entries = [...decoded.entries()].sort((a, b) => a[1].used - b[1].used);
  for (const [id, e] of entries) {
    if (totalPx <= BUDGET_PX * 0.8) break;
    decoded.delete(id);
    totalPx -= e.px;
    if ('close' in e.img) (e.img as ImageBitmap).close();
  }
}

export async function decodeBlob(blob: Blob): Promise<DrawSource> {
  if (typeof createImageBitmap !== 'undefined') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Returns the decoded image if ready; otherwise starts loading and returns undefined. */
export function peekImage(id: ID | undefined): DrawSource | undefined {
  if (!id) return undefined;
  const e = decoded.get(id);
  if (e) {
    e.used = ++clock;
    return e.img;
  }
  if (!failed.has(id)) void loadImage(id);
  return undefined;
}

export function loadImage(id: ID): Promise<DrawSource | null> {
  const e = decoded.get(id);
  if (e) return Promise.resolve(e.img);
  let p = pending.get(id);
  if (p) return p;
  const pid = projectId;
  p = (async () => {
    if (!pid) return null;
    try {
      const rec = await getAssetRecord(pid, id);
      if (!rec) {
        failed.add(id);
        return null;
      }
      const img = await decodeBlob(rec.blob);
      if (pid !== projectId) return null;
      remember(id, img);
      notify();
      return img;
    } catch (err) {
      console.warn('Could not load image', id, err);
      failed.add(id);
      return null;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, p);
  return p;
}

export function isImageLoaded(id: ID | undefined): boolean {
  return !id || decoded.has(id) || failed.has(id);
}

/** Store a new image blob. Optionally prime the decode cache with an already drawn canvas. */
export async function saveAsset(blob: Blob, w: number, h: number, primed?: DrawSource, id: ID = uid()): Promise<ID> {
  if (!projectId) throw new Error('No project open');
  await putAssetRecord({ projectId, id, blob, w, h });
  if (primed) remember(id, primed);
  return id;
}

export async function getAssetBlob(id: ID): Promise<Blob | null> {
  if (!projectId) return null;
  const rec = await getAssetRecord(projectId, id);
  return rec?.blob ?? null;
}

/** Object URL for an asset (thumbnails); cached for the session. */
export function assetUrl(id: ID): Promise<string | null> {
  const u = urls.get(id);
  if (u) return Promise.resolve(u);
  let p = urlPending.get(id);
  if (p) return p;
  p = getAssetBlob(id).then((blob) => {
    urlPending.delete(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  });
  urlPending.set(id, p);
  return p;
}

export function peekAssetUrl(id: ID | undefined): string | undefined {
  return id ? urls.get(id) : undefined;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality);
  });
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement, willRead = false): CanvasRenderingContext2D {
  return c.getContext('2d', willRead ? { willReadFrequently: true } : undefined)!;
}
