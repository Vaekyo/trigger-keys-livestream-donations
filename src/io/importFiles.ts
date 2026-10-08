import type { Align, ID, Project } from '../model/types';
import { decodeBlob, type DrawSource } from '../db/assets';
import { categoryAnchor } from '../render/guides';
import { canvasSpaceAlign, compositeLayers, prepareLayers, type LayerSources, type PreparedLayers } from './partFactory';
import { guessCategory } from '../features/library/filter';
import { slugify } from '../model/ids';
import { cropScale } from '../render/trim';

export type FileRole = 'flat' | 'line' | 'fill';

export interface ImportItem {
  key: string;
  name: string;
  categoryId: ID;
  poseIds: ID[];
  tags: string[];
  files: Partial<Record<FileRole, File>>;
  prepared: PreparedLayers | null;
  preview: HTMLCanvasElement | null;
  previewUrl: string;
  align: Align;
  preAligned: boolean;
  /** True once the user touched the alignment (category changes no longer move it). */
  aligned: boolean;
  error?: string;
}

const LINE_RE = /^(.*?)[\s_.-]*(line|lines|lineart|ink|inks|outline|outlines|lin)$/i;
const FILL_RE = /^(.*?)[\s_.-]*(fill|fills|flat|flats|color|colour|base|col)$/i;

export function baseName(f: File): string {
  return f.name.replace(/\.[a-z0-9]+$/i, '');
}

/** Split file names into a role and a pairing key ("hair_line" + "hair_fill" → one part). */
export function roleOf(name: string): { role: FileRole; base: string } {
  let m = name.match(LINE_RE);
  if (m && m[1]) return { role: 'line', base: m[1] };
  m = name.match(FILL_RE);
  if (m && m[1]) return { role: 'fill', base: m[1] };
  return { role: 'flat', base: name };
}

export function groupFiles(files: File[]): { name: string; files: Partial<Record<FileRole, File>> }[] {
  const groups = new Map<string, Partial<Record<FileRole, File>>>();
  const order: string[] = [];
  const singles: { name: string; files: Partial<Record<FileRole, File>> }[] = [];
  for (const f of files) {
    const { role, base } = roleOf(baseName(f));
    if (role === 'flat') {
      singles.push({ name: base, files: { flat: f } });
      continue;
    }
    const key = base.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {});
      order.push(key);
    }
    const g = groups.get(key)!;
    if (g[role]) singles.push({ name: baseName(f), files: { flat: f } });
    else g[role] = f;
  }
  const out: { name: string; files: Partial<Record<FileRole, File>> }[] = [];
  for (const key of order) {
    const g = groups.get(key)!;
    const any = (g.line ?? g.fill)!;
    const base = roleOf(baseName(any)).base;
    if (g.line && g.fill) out.push({ name: base, files: g });
    else out.push({ name: baseName(any), files: { flat: any } });
  }
  return [...out, ...singles];
}

const decodeCache = new WeakMap<File, Promise<DrawSource>>();
function decodeFile(f: File): Promise<DrawSource> {
  let p = decodeCache.get(f);
  if (!p) {
    p = decodeBlob(f);
    decodeCache.set(f, p);
  }
  return p;
}

export function defaultAlign(prepared: PreparedLayers, project: Project, categoryId: ID): { align: Align; preAligned: boolean } {
  const W = project.width;
  const H = project.height;
  const ratioMatch = Math.abs(prepared.srcW / prepared.srcH - W / H) < 0.01 && prepared.srcW >= W * 0.5;
  if (ratioMatch) return { align: canvasSpaceAlign(prepared, W), preAligned: true };
  const [x, y] = categoryAnchor(categoryId, W, H);
  const bw = prepared.bbox.w;
  const bh = prepared.bbox.h;
  const isBg = project.categories.find((c) => c.id === categoryId)?.isBackground;
  const s = isBg ? Math.max(W / bw, H / bh) : Math.min(1, (W * 0.9) / bw, (H * 0.9) / bh);
  return { align: { x: isBg ? W / 2 : x, y: isBg ? H / 2 : y, scale: s / prepared.k, rotation: 0 }, preAligned: false };
}

export async function buildItem(
  name: string,
  files: Partial<Record<FileRole, File>>,
  project: Project,
  categoryHint: ID | undefined,
  forceHint: boolean,
  poseIds: ID[],
): Promise<ImportItem> {
  const guessed = guessCategory(name, project.categories);
  const categoryId = (forceHint ? categoryHint : (guessed ?? categoryHint)) ?? project.categories[0]?.id ?? '';
  const item: ImportItem = {
    key: Math.random().toString(36).slice(2),
    name: slugify(name),
    categoryId,
    poseIds,
    tags: [],
    files,
    prepared: null,
    preview: null,
    previewUrl: '',
    align: { x: project.width / 2, y: project.height / 2, scale: 1, rotation: 0 },
    preAligned: false,
    aligned: false,
  };
  return prepareItem(item, project);
}

export async function prepareItem(item: ImportItem, project: Project): Promise<ImportItem> {
  try {
    const sources: LayerSources = {};
    for (const role of ['flat', 'line', 'fill'] as const) {
      const f = item.files[role];
      if (f) sources[role] = await decodeFile(f);
    }
    const prepared = prepareLayers(sources, project.width * 2, project.height * 2);
    if (!prepared) return { ...item, error: 'This image is completely transparent.' };
    const preview = compositeLayers(prepared.layers, prepared.w, prepared.h);
    const { align, preAligned } = defaultAlign(prepared, project, item.categoryId);
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    // small preview image for the list (the full-size canvas is kept for aligning)
    const k = Math.min(1, 192 / Math.max(preview.width, preview.height));
    const small = cropScale(preview, { x: 0, y: 0, w: preview.width, h: preview.height }, k);
    const blob = await new Promise<Blob | null>((r) => small.toBlob(r));
    return {
      ...item,
      prepared,
      preview,
      previewUrl: blob ? URL.createObjectURL(blob) : '',
      align: item.aligned ? item.align : align,
      preAligned,
      error: undefined,
    };
  } catch (err) {
    console.warn(err);
    return { ...item, error: 'Could not read this file. Use PNG or WebP images.' };
  }
}

export const ACCEPTED = /^image\/(png|webp|jpeg|gif|avif)$/;
