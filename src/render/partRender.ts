// Turns a part + color settings into a drawable image, cached so that
// redraws (pan, zoom, dragging other parts) never recolor or decode again.

import type { ColorSpec, Gradient, Part } from '../model/types';
import { ctx2d, makeCanvas, peekImage, type DrawSource } from '../db/assets';
import { shiftPixels } from './color';

interface Cached {
  c: HTMLCanvasElement;
  px: number;
}

const BUDGET_PX = 90_000_000;
const cache = new Map<string, Cached>();
let cachedPx = 0;

function cacheGet(key: string): HTMLCanvasElement | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  // refresh LRU position
  cache.delete(key);
  cache.set(key, e);
  return e.c;
}

function cacheSet(key: string, c: HTMLCanvasElement) {
  const px = c.width * c.height;
  cache.set(key, { c, px });
  cachedPx += px;
  if (cachedPx > BUDGET_PX) {
    for (const [k, e] of cache) {
      if (cachedPx <= BUDGET_PX * 0.75) break;
      cache.delete(k);
      cachedPx -= e.px;
    }
  }
}

export function clearRenderCache() {
  cache.clear();
  cachedPx = 0;
}

export function colorKey(spec: ColorSpec | null | undefined): string {
  if (!spec) return '-';
  let k = spec.mode;
  if (spec.mode === 'shift') k += `${spec.h},${spec.s},${spec.b}`;
  if (spec.mode === 'tint') {
    k += spec.fill;
    if (spec.gradient) {
      const g = spec.gradient;
      k += `g${g.color2}${g.angle},${g.start},${g.end}`;
    }
  }
  if (spec.line) k += `l${spec.line}`;
  return k;
}

export function hasRecolor(spec: ColorSpec | null | undefined): boolean {
  return !!spec && (spec.mode !== 'none' || !!spec.line);
}

export function makeGradient(
  x: CanvasRenderingContext2D,
  w: number,
  h: number,
  c1: string,
  g: Pick<Gradient, 'color2' | 'angle' | 'start' | 'end'>,
): CanvasGradient {
  const rad = (g.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = w / 2;
  const cy = h / 2;
  const grad = x.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2);
  const a = Math.max(0, Math.min(1, Math.min(g.start, g.end)));
  const b = Math.max(0, Math.min(1, Math.max(g.start, g.end)));
  grad.addColorStop(a, c1);
  grad.addColorStop(b === a ? Math.min(1, a + 0.001) : b, g.color2);
  return grad;
}

/** Multiply a grayscale layer by a color/gradient, keeping its alpha. */
function tintLayer(src: DrawSource, w: number, h: number, spec: ColorSpec): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const x = ctx2d(c);
  x.drawImage(src, 0, 0, w, h);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = spec.gradient ? makeGradient(x, w, h, spec.fill, spec.gradient) : spec.fill;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(src, 0, 0, w, h);
  return c;
}

/** Screen a color onto line art: black lines become the color, white stays white. */
function lineLayer(src: DrawSource, w: number, h: number, color: string): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const x = ctx2d(c);
  x.drawImage(src, 0, 0, w, h);
  x.globalCompositeOperation = 'screen';
  x.fillStyle = color;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(src, 0, 0, w, h);
  return c;
}

function shiftLayer(src: DrawSource, w: number, h: number, spec: ColorSpec): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const x = ctx2d(c, true);
  x.drawImage(src, 0, 0, w, h);
  const data = x.getImageData(0, 0, c.width, c.height);
  shiftPixels(data.data, spec.h, spec.s, spec.b);
  x.putImageData(data, 0, 0);
  return c;
}

function colorBody(src: DrawSource, w: number, h: number, spec: ColorSpec | null): DrawSource {
  if (!spec) return src;
  if (spec.mode === 'tint') return tintLayer(src, w, h, spec);
  if (spec.mode === 'shift' && (spec.h || spec.s || spec.b)) return shiftLayer(src, w, h, spec);
  return src;
}

/**
 * Drawable image for a part with the given colors, or null while its images
 * are still loading (a redraw is triggered automatically when they arrive).
 */
export function partSource(part: Part, spec: ColorSpec | null): DrawSource | null {
  const { flat, fill, line } = part.images;
  const flatImg = flat ? peekImage(flat) : undefined;
  const fillImg = fill ? peekImage(fill) : undefined;
  const lineImg = line ? peekImage(line) : undefined;
  if ((flat && !flatImg) || (fill && !fillImg) || (line && !lineImg)) return null;

  const recolor = hasRecolor(spec);
  const layerCount = (flat ? 1 : 0) + (fill ? 1 : 0) + (line ? 1 : 0);
  if (layerCount === 1 && !recolor) return (flatImg ?? fillImg ?? lineImg)!;

  const key = `${part.id}|${flat ?? ''}|${fill ?? ''}|${line ?? ''}|${colorKey(spec)}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const { w, h } = part;
  const out = makeCanvas(w, h);
  const x = ctx2d(out);
  if (fillImg) x.drawImage(colorBody(fillImg, w, h, recolor ? spec : null), 0, 0, w, h);
  if (flatImg) x.drawImage(colorBody(flatImg, w, h, recolor ? spec : null), 0, 0, w, h);
  if (lineImg) x.drawImage(spec?.line ? lineLayer(lineImg, w, h, spec.line) : lineImg, 0, 0, w, h);
  cacheSet(key, out);
  return out;
}

/** Uncolored composite of all layers (thumbnails, hit testing). */
export function partPlainSource(part: Part): DrawSource | null {
  return partSource(part, null);
}

/* ------------------------------------------------------------------ */
/* Alpha masks for pixel-accurate picking                              */
/* ------------------------------------------------------------------ */

interface Mask {
  data: Uint8Array;
  w: number;
  h: number;
  sx: number;
  sy: number;
}

const masks = new Map<string, Mask>();
const MASK_MAX = 384;

export function partMask(part: Part): Mask | null {
  const key = `${part.id}|${part.images.flat ?? ''}|${part.images.fill ?? ''}|${part.images.line ?? ''}`;
  const m = masks.get(key);
  if (m) return m;
  const src = partPlainSource(part);
  if (!src) return null;
  const k = Math.min(1, MASK_MAX / Math.max(part.w, part.h));
  const mw = Math.max(1, Math.round(part.w * k));
  const mh = Math.max(1, Math.round(part.h * k));
  const c = makeCanvas(mw, mh);
  const x = ctx2d(c, true);
  x.drawImage(src, 0, 0, mw, mh);
  const id = x.getImageData(0, 0, mw, mh).data;
  const data = new Uint8Array(mw * mh);
  for (let i = 0; i < data.length; i++) data[i] = id[i * 4 + 3];
  const mask = { data, w: mw, h: mh, sx: mw / part.w, sy: mh / part.h };
  if (masks.size > 600) masks.clear();
  masks.set(key, mask);
  return mask;
}

export function maskHit(mask: Mask, px: number, py: number, threshold = 24): boolean {
  const x = Math.floor(px * mask.sx);
  const y = Math.floor(py * mask.sy);
  if (x < 0 || y < 0 || x >= mask.w || y >= mask.h) return false;
  return mask.data[y * mask.w + x] > threshold;
}
