// State of one drawing session in the trace studio: three full-canvas layers
// (line, fill, shade), a reference image with its transform, and a pixel-level
// undo history that stores only the changed rectangles.

import type { Rect } from '../../model/types';
import { ctx2d, makeCanvas, type DrawSource } from '../../db/assets';
import { alphaBounds } from '../../render/trim';

export type LayerName = 'line' | 'fill' | 'shade';

export interface RefTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  visible: boolean;
}

type Entry =
  | { kind: 'pixels'; layer: LayerName; x: number; y: number; before: ImageData; after: ImageData }
  | { kind: 'ref'; before: RefTransform; after: RefTransform }
  | { kind: 'refImage'; before: RefImage | null; after: RefImage | null; beforeT: RefTransform; afterT: RefTransform };

export interface RefImage {
  src: DrawSource;
  blob: Blob;
}

const MAX_HISTORY = 80;

export function clampRect(r: Rect, W: number, H: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const x2 = Math.min(W, Math.ceil(r.x + r.w));
  const y2 = Math.min(H, Math.ceil(r.y + r.h));
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

export class TraceDoc {
  readonly W: number;
  readonly H: number;
  readonly layers: Record<LayerName, HTMLCanvasElement>;
  readonly versions: Record<LayerName, number> = { line: 0, fill: 0, shade: 0 };
  private backup: HTMLCanvasElement;
  ref: RefImage | null = null;
  refT: RefTransform;
  private past: Entry[] = [];
  private future: Entry[] = [];
  private listeners = new Set<() => void>();
  version = 0;
  /** Changed since the last save/draft load. */
  dirty = false;

  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.layers = { line: makeCanvas(W, H), fill: makeCanvas(W, H), shade: makeCanvas(W, H) };
    this.backup = makeCanvas(W, H);
    this.refT = { x: W / 2, y: H / 2, scale: 1, rotation: 0, opacity: 0.45, visible: true };
  }

  ctx(layer: LayerName): CanvasRenderingContext2D {
    return ctx2d(this.layers[layer], true);
  }

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  changed(layer?: LayerName, markDirty = true) {
    if (layer) this.versions[layer]++;
    this.version++;
    if (markDirty) this.dirty = true;
    this.listeners.forEach((l) => l());
  }

  private push(e: Entry) {
    this.past.push(e);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
  }

  canUndo() {
    return this.past.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }

  /* ---------------- strokes ---------------- */

  beginStroke(layer: LayerName) {
    const b = ctx2d(this.backup, true);
    b.clearRect(0, 0, this.W, this.H);
    b.drawImage(this.layers[layer], 0, 0);
  }

  /** Put the pre-stroke pixels back inside a rect (used before re-drawing a finished stroke). */
  restoreFromBackup(layer: LayerName, r: Rect) {
    const c = clampRect(r, this.W, this.H);
    if (!c) return;
    const x = this.ctx(layer);
    x.save();
    x.globalCompositeOperation = 'copy';
    x.drawImage(this.backup, c.x, c.y, c.w, c.h, c.x, c.y, c.w, c.h);
    x.restore();
  }

  cancelStroke(layer: LayerName) {
    this.restoreFromBackup(layer, { x: 0, y: 0, w: this.W, h: this.H });
    this.changed(layer, false);
  }

  endStroke(layer: LayerName, r: Rect) {
    const c = clampRect(r, this.W, this.H);
    if (!c) return;
    const before = ctx2d(this.backup, true).getImageData(c.x, c.y, c.w, c.h);
    const after = this.ctx(layer).getImageData(c.x, c.y, c.w, c.h);
    this.push({ kind: 'pixels', layer, x: c.x, y: c.y, before, after });
    this.changed(layer);
  }

  /** Apply a pixel edit computed elsewhere (e.g. flood fill) as one undo step. */
  editRect(layer: LayerName, r: Rect, edit: (data: ImageData) => void) {
    const c = clampRect(r, this.W, this.H);
    if (!c) return;
    const x = this.ctx(layer);
    const before = x.getImageData(c.x, c.y, c.w, c.h);
    const after = x.getImageData(c.x, c.y, c.w, c.h);
    edit(after);
    x.putImageData(after, c.x, c.y);
    this.push({ kind: 'pixels', layer, x: c.x, y: c.y, before, after });
    this.changed(layer);
  }

  clearLayer(layer: LayerName) {
    this.editRect(layer, { x: 0, y: 0, w: this.W, h: this.H }, (d) => d.data.fill(0));
  }

  /* ---------------- reference ---------------- */

  setRefTransform(t: RefTransform, record: RefTransform | null) {
    this.refT = t;
    if (record) this.push({ kind: 'ref', before: record, after: t });
    this.changed(undefined, !!record);
  }

  setRefImage(img: RefImage | null, t?: RefTransform) {
    const beforeT = this.refT;
    const afterT = t ?? this.refT;
    this.push({ kind: 'refImage', before: this.ref, after: img, beforeT, afterT });
    this.ref = img;
    this.refT = afterT;
    this.changed();
  }

  /** Set without history (initial load). */
  loadRef(img: RefImage | null, t: RefTransform) {
    this.ref = img;
    this.refT = t;
    this.changed(undefined, false);
  }

  fitRef() {
    if (!this.ref) return this.refT;
    const k = Math.min(this.W / this.ref.src.width, this.H / this.ref.src.height);
    return { ...this.refT, x: this.W / 2, y: this.H / 2, scale: k, rotation: 0 };
  }

  /* ---------------- history ---------------- */

  private apply(e: Entry, dir: 'undo' | 'redo') {
    if (e.kind === 'pixels') {
      this.ctx(e.layer).putImageData(dir === 'undo' ? e.before : e.after, e.x, e.y);
      this.changed(e.layer);
    } else if (e.kind === 'ref') {
      this.refT = dir === 'undo' ? e.before : e.after;
      this.changed();
    } else {
      this.ref = dir === 'undo' ? e.before : e.after;
      this.refT = dir === 'undo' ? e.beforeT : e.afterT;
      this.changed();
    }
  }

  undo(): boolean {
    const e = this.past.pop();
    if (!e) return false;
    this.apply(e, 'undo');
    this.future.push(e);
    return true;
  }

  redo(): boolean {
    const e = this.future.pop();
    if (!e) return false;
    this.apply(e, 'redo');
    this.past.push(e);
    return true;
  }

  /* ---------------- output ---------------- */

  isLayerEmpty(layer: LayerName): boolean {
    return alphaBounds(this.layers[layer]) === null;
  }

  isEmpty(): boolean {
    return this.isLayerEmpty('line') && this.isLayerEmpty('fill');
  }

  /** Fill with the gray shading multiplied in, clipped to the fill. */
  mergedFill(): HTMLCanvasElement {
    const c = makeCanvas(this.W, this.H);
    const x = ctx2d(c);
    x.drawImage(this.layers.fill, 0, 0);
    x.globalCompositeOperation = 'multiply';
    x.drawImage(this.layers.shade, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(this.layers.fill, 0, 0);
    return c;
  }

  loadLayer(layer: LayerName, src: DrawSource) {
    const x = this.ctx(layer);
    x.clearRect(0, 0, this.W, this.H);
    x.drawImage(src, 0, 0, this.W, this.H);
    this.changed(layer, false);
  }
}
