// Shared pipeline that turns layer canvases into a stored Part:
// trim to visible area → cap resolution → save layer blobs → make thumbnail.

import type { Align, ID, Part, PartImages, Rect, TraceSource } from '../model/types';
import { uid } from '../model/ids';
import { canvasToBlob, ctx2d, makeCanvas, saveAsset, type DrawSource } from '../db/assets';
import { alphaBounds, cropScale, sourceToCanvas, unionRect } from '../render/trim';

export type LayerKey = keyof PartImages;
export type LayerSources = Partial<Record<LayerKey, DrawSource>>;
export type LayerCanvases = Partial<Record<LayerKey, HTMLCanvasElement>>;

export interface PreparedLayers {
  layers: LayerCanvases;
  /** Visible area in source pixels. */
  bbox: Rect;
  /** Stored pixels per source pixel (≤ 1 when downscaled). */
  k: number;
  srcW: number;
  srcH: number;
  w: number;
  h: number;
}

const LAYER_KEYS: LayerKey[] = ['fill', 'flat', 'line'];

/**
 * Trim layers to their combined visible area. `maxW/maxH` cap the stored size
 * (we keep up to 2× the canvas so 2× exports stay sharp).
 */
export function prepareLayers(sources: LayerSources, maxW: number, maxH: number): PreparedLayers | null {
  let bbox: Rect | null = null;
  let srcW = 0;
  let srcH = 0;
  const canvases: LayerCanvases = {};
  for (const key of LAYER_KEYS) {
    const src = sources[key];
    if (!src) continue;
    const c = sourceToCanvas(src);
    canvases[key] = c;
    srcW = Math.max(srcW, c.width);
    srcH = Math.max(srcH, c.height);
    bbox = unionRect(bbox, alphaBounds(c));
  }
  if (!bbox) return null;
  const k = Math.min(1, maxW / bbox.w, maxH / bbox.h);
  const layers: LayerCanvases = {};
  for (const key of LAYER_KEYS) {
    const c = canvases[key];
    if (c) layers[key] = cropScale(c, bbox, k);
  }
  const any = layers.fill ?? layers.flat ?? layers.line!;
  return { layers, bbox, k, srcW, srcH, w: any.width, h: any.height };
}

export function compositeLayers(layers: LayerCanvases, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const x = ctx2d(c);
  for (const key of LAYER_KEYS) {
    const l = layers[key];
    if (l) x.drawImage(l, 0, 0, w, h);
  }
  return c;
}

export const THUMB_SIZE = 160;

export async function makeThumbBlob(src: HTMLCanvasElement, size = THUMB_SIZE): Promise<Blob> {
  const k = Math.min(1, size / Math.max(src.width, src.height));
  const c = makeCanvas(src.width * k, src.height * k);
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return canvasToBlob(c);
}

export interface NewPartInput {
  name: string;
  categoryId: ID;
  poseIds: ID[];
  tags: string[];
  prepared: PreparedLayers;
  align: Align;
  favorite?: boolean;
  placeholder?: boolean;
  trace?: TraceSource;
  id?: ID;
}

/** Save the layer images and return the Part (not yet added to the document). */
export async function storePart(input: NewPartInput): Promise<Part> {
  const { prepared } = input;
  const images: PartImages = {};
  for (const key of LAYER_KEYS) {
    const c = prepared.layers[key];
    if (!c) continue;
    const blob = await canvasToBlob(c);
    images[key] = await saveAsset(blob, c.width, c.height, c);
  }
  const composite = compositeLayers(prepared.layers, prepared.w, prepared.h);
  const thumbBlob = await makeThumbBlob(composite);
  const thumb = await saveAsset(thumbBlob, 0, 0);
  return {
    id: input.id ?? uid(),
    name: input.name,
    categoryId: input.categoryId,
    poseIds: input.poseIds,
    tags: input.tags,
    favorite: input.favorite ?? false,
    w: prepared.w,
    h: prepared.h,
    images,
    thumb,
    align: input.align,
    trace: input.trace,
    placeholder: input.placeholder,
    createdAt: Date.now(),
  };
}

/** Alignment for layers that were drawn on a full canvas (same coordinate space). */
export function canvasSpaceAlign(prepared: PreparedLayers, canvasW: number): Align {
  const s = canvasW / prepared.srcW;
  return {
    x: (prepared.bbox.x + prepared.bbox.w / 2) * s,
    y: (prepared.bbox.y + prepared.bbox.h / 2) * s,
    scale: s / prepared.k,
    rotation: 0,
  };
}
