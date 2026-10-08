import type { Character, CropPreset, Doc, Rect } from '../model/types';
import { renderCharacter } from '../render/compositor';
import { canvasToBlob, ctx2d, makeCanvas } from '../db/assets';
import { itemsWithExpression } from '../state/actions';
import { SHAPE_FONT } from '../render/shapes';

export function cropRect(doc: Doc, crop: CropPreset | undefined): Rect {
  const W = doc.project.width;
  const H = doc.project.height;
  if (!crop) return { x: 0, y: 0, w: W, h: H };
  const r = crop.rect;
  return { x: Math.round(r.x * W), y: Math.round(r.y * H), w: Math.max(1, Math.round(r.w * W)), h: Math.max(1, Math.round(r.h * H)) };
}

export interface PngOptions {
  scale: number;
  transparent: boolean;
  cropId: string;
}

export async function renderPng(doc: Doc, char: Character, opts: PngOptions): Promise<HTMLCanvasElement> {
  const crop = cropRect(doc, doc.project.crops.find((c) => c.id === opts.cropId));
  return renderCharacter(doc, char, { scale: opts.scale, background: !opts.transparent, crop });
}

export interface SheetOptions {
  columns: number;
  cropId: string;
  scale: number;
  transparent: boolean;
  labels: boolean;
  padding: number;
  sheetColor: string;
  labelColor: string;
  includeCurrent: boolean;
}

export async function renderExpressionSheet(doc: Doc, char: Character, o: SheetOptions): Promise<HTMLCanvasElement> {
  const crop = cropRect(doc, doc.project.crops.find((c) => c.id === o.cropId));
  const cells: { name: string; items: Character['items'] }[] = [];
  if (o.includeCurrent || !char.expressions.length) cells.push({ name: char.expressions.length ? 'current' : char.name, items: char.items });
  for (const e of char.expressions) cells.push({ name: e.name, items: itemsWithExpression(doc, char, e) });
  const cols = Math.max(1, Math.min(o.columns, cells.length));
  const rows = Math.ceil(cells.length / cols);
  const cw = Math.round(crop.w * o.scale);
  const ch = Math.round(crop.h * o.scale);
  const pad = Math.round(o.padding * o.scale);
  const fontPx = Math.max(14, Math.round(Math.min(cw, ch) * 0.075));
  const labelH = o.labels ? Math.round(fontPx * 1.8) : 0;
  const out = makeCanvas(cols * cw + (cols + 1) * pad, rows * (ch + labelH) + (rows + 1) * pad);
  const x = ctx2d(out);
  if (!o.transparent) {
    x.fillStyle = o.sheetColor;
    x.fillRect(0, 0, out.width, out.height);
  }
  for (let i = 0; i < cells.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = pad + col * (cw + pad);
    const cy = pad + row * (ch + labelH + pad);
    const img = await renderCharacter(doc, char, { scale: o.scale, background: !o.transparent, crop, items: cells[i].items });
    x.drawImage(img, cx, cy);
    if (o.labels) {
      x.fillStyle = o.labelColor;
      x.font = `700 ${fontPx}px ${SHAPE_FONT}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(cells[i].name, cx + cw / 2, cy + ch + labelH / 2, cw);
    }
  }
  return out;
}

export async function copyCanvasToClipboard(c: HTMLCanvasElement): Promise<boolean> {
  try {
    if (!('ClipboardItem' in window) || !navigator.clipboard?.write) return false;
    const blob = await canvasToBlob(c);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
