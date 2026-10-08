import type { Rect } from '../model/types';
import { ctx2d, makeCanvas, type DrawSource } from '../db/assets';

/** Bounding box of pixels with alpha above the threshold, or null if empty. */
export function alphaBoundsOf(data: Uint8ClampedArray, w: number, h: number, threshold = 0): Rect | null {
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let rowHas = false;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        rowHas = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (rowHas) {
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function sourceToCanvas(src: DrawSource): HTMLCanvasElement {
  if (src instanceof HTMLCanvasElement) return src;
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function alphaBounds(c: HTMLCanvasElement): Rect | null {
  const x = ctx2d(c, true);
  const d = x.getImageData(0, 0, c.width, c.height);
  return alphaBoundsOf(d.data, c.width, c.height);
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Copy a region of a source into a new canvas of size (rect × k). */
export function cropScale(src: DrawSource, r: Rect, k: number): HTMLCanvasElement {
  const c = makeCanvas(Math.max(1, Math.round(r.w * k)), Math.max(1, Math.round(r.h * k)));
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c;
}

/** Fit a rect of size w×h into a box, returns the scale factor. */
export function fitScale(w: number, h: number, boxW: number, boxH: number): number {
  return Math.min(boxW / w, boxH / h);
}
