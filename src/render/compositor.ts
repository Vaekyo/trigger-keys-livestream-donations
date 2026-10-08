// Draws a character into any 2D context (screen view, thumbnails, export).

import type { Character, ColorSpec, Doc, ID, Instance, Part, Project } from '../model/types';
import { instanceMatrix } from '../model/geom';
import { stackOf } from '../model/layering';
import { partSource } from './partRender';
import { drawShape } from './shapes';
import { drawBackground } from './background';
import { ctx2d, isImageLoaded, loadImage, makeCanvas } from '../db/assets';
import { hexToRgb } from './color';

export interface CompositeOptions {
  /** Draw the background spec and background-category parts. */
  background: boolean;
  /** Instances to leave out. */
  skip?: Set<ID>;
  /** Only draw instances of these categories. */
  onlyCategories?: Set<ID>;
  /** Draw these instances instead of the character's (expression sheets). */
  items?: Instance[];
  groupColors?: Record<ID, ColorSpec>;
  /** Device pixels per canvas unit; used to size drop shadows. */
  deviceScale?: number;
  /** Skip the drop shadow (e.g. ghost previews). */
  noShadow?: boolean;
}

export function isPartVisibleInPose(part: Part | undefined, poseId: ID): boolean {
  return !!part && !part.deletedAt && part.poseIds.includes(poseId);
}

export function resolveColor(project: Project, char: Character, inst: Instance, groupColors?: Record<ID, ColorSpec>): ColorSpec {
  const gid = inst.colorGroupId;
  if (gid && project.colorGroups.some((g) => g.id === gid)) {
    const gc = (groupColors ?? char.groupColors)[gid];
    if (gc) return gc;
  }
  return inst.color;
}

/** Instances that will actually be drawn for this character, bottom → top. */
export function visibleStack(doc: Doc, char: Character, items?: Instance[]): Instance[] {
  const c = items ? { ...char, items } : char;
  return stackOf(doc.project, doc.parts, c).filter((inst) => {
    if (inst.hidden) return false;
    if (inst.shape) return true;
    return isPartVisibleInPose(doc.parts[inst.partId], char.poseId);
  });
}

function isBackgroundInst(doc: Doc, inst: Instance): boolean {
  const catId = inst.shape ? inst.shape.category : doc.parts[inst.partId]?.categoryId;
  return !!doc.project.categories.find((c) => c.id === catId)?.isBackground;
}

function categoryOf(doc: Doc, inst: Instance): ID {
  return inst.shape ? inst.shape.category : (doc.parts[inst.partId]?.categoryId ?? '');
}

function drawInstance(x: CanvasRenderingContext2D, doc: Doc, char: Character, inst: Instance, groupColors?: Record<ID, ColorSpec>): boolean {
  const part = inst.shape ? undefined : doc.parts[inst.partId];
  const m = instanceMatrix(doc.project, inst, part, char.poseId);
  x.save();
  x.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  x.globalAlpha *= inst.opacity;
  let ok = true;
  if (inst.shape) {
    drawShape(x, inst.shape);
  } else if (part) {
    const src = partSource(part, resolveColor(doc.project, char, inst, groupColors));
    if (src) x.drawImage(src, 0, 0, part.w, part.h);
    else ok = false;
  }
  x.restore();
  return ok;
}

/**
 * Draws the character in canvas coordinates (0..W, 0..H) using the context's
 * current transform. Returns false if some images were still loading.
 */
export function drawCharacter(x: CanvasRenderingContext2D, doc: Doc, char: Character, opts: CompositeOptions): boolean {
  const { project } = doc;
  const W = project.width;
  const H = project.height;
  let complete = true;
  const stack = visibleStack(doc, char, opts.items).filter(
    (i) => !opts.skip?.has(i.id) && (!opts.onlyCategories || opts.onlyCategories.has(categoryOf(doc, i))),
  );
  const bgItems = stack.filter((i) => isBackgroundInst(doc, i));
  const fgItems = stack.filter((i) => !isBackgroundInst(doc, i));

  if (opts.background) {
    if (!drawBackground(x, char.background, W, H)) complete = false;
    for (const inst of bgItems) if (!drawInstance(x, doc, char, inst, opts.groupColors)) complete = false;
  }

  const sh = char.shadow;
  if (sh.on && !opts.noShadow && fgItems.length) {
    const s = Math.min(2, Math.max(0.25, opts.deviceScale ?? 1));
    const layer = makeCanvas(W * s, H * s);
    const lx = ctx2d(layer);
    lx.scale(layer.width / W, layer.height / H);
    for (const inst of fgItems) if (!drawInstance(lx, doc, char, inst, opts.groupColors)) complete = false;
    const ds = opts.deviceScale ?? 1;
    const [r, g, b] = hexToRgb(sh.color);
    x.save();
    x.shadowColor = `rgba(${r},${g},${b},${sh.opacity})`;
    x.shadowBlur = sh.blur * ds;
    x.shadowOffsetX = sh.x * ds;
    x.shadowOffsetY = sh.y * ds;
    x.drawImage(layer, 0, 0, W, H);
    x.restore();
  } else {
    for (const inst of fgItems) if (!drawInstance(x, doc, char, inst, opts.groupColors)) complete = false;
  }
  return complete;
}

/** Wait until every image a character needs is decoded (for export/thumbnails). */
export async function preloadCharacter(doc: Doc, char: Character, items?: Instance[]): Promise<void> {
  const ids: ID[] = [];
  for (const inst of items ?? char.items) {
    const part = doc.parts[inst.partId];
    if (!part) continue;
    const { flat, fill, line } = part.images;
    for (const id of [flat, fill, line]) if (id && !isImageLoaded(id)) ids.push(id);
  }
  if (char.background.type === 'image' && char.background.image) ids.push(char.background.image);
  await Promise.all(ids.map((id) => loadImage(id)));
}

/** Render a character to a new canvas. `crop` is in canvas pixels. */
export async function renderCharacter(
  doc: Doc,
  char: Character,
  opts: { scale: number; background: boolean; crop?: { x: number; y: number; w: number; h: number }; items?: Instance[]; groupColors?: Record<ID, ColorSpec> },
): Promise<HTMLCanvasElement> {
  await preloadCharacter(doc, char, opts.items);
  const crop = opts.crop ?? { x: 0, y: 0, w: doc.project.width, h: doc.project.height };
  const c = makeCanvas(crop.w * opts.scale, crop.h * opts.scale);
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.scale(opts.scale, opts.scale);
  x.translate(-crop.x, -crop.y);
  drawCharacter(x, doc, char, {
    background: opts.background,
    items: opts.items,
    groupColors: opts.groupColors,
    deviceScale: opts.scale,
  });
  return c;
}
