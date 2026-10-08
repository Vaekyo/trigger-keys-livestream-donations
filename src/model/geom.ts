import type { Align, Instance, Part, Project } from './types';

/** 2D affine matrix in canvas order: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

export function rotate(rad: number): Mat {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

export function scaleMat(sx: number, sy: number): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export const DEG = Math.PI / 180;

export function effectiveAlign(part: Part, poseId: string | undefined): Align {
  return (poseId && part.poseAlign?.[poseId]) || part.align;
}

/** Base alignment used by shapes (speech bubbles, stickers): canvas center. */
export function shapeBaseAlign(project: Project): Align {
  return { x: project.width / 2, y: project.height / 2, scale: 1, rotation: 0 };
}

/** Frame size (image pixels) of an instance. */
export function instanceSize(inst: Instance, part: Part | undefined): { w: number; h: number } {
  if (inst.shape) return { w: inst.shape.w, h: inst.shape.h };
  return { w: part?.w ?? 1, h: part?.h ?? 1 };
}

/** Matrix mapping image pixel coordinates of an align + frame into canvas coordinates. */
export function alignMatrix(align: Align, w: number, h: number, extra?: Partial<Instance>): Mat {
  const dx = extra?.dx ?? 0;
  const dy = extra?.dy ?? 0;
  const s = align.scale * (extra?.scale ?? 1);
  const rot = (align.rotation + (extra?.rotation ?? 0)) * DEG;
  const sx = s * (extra?.flipX ? -1 : 1);
  const sy = s * (extra?.flipY ? -1 : 1);
  let m = translate(align.x + dx, align.y + dy);
  m = mul(m, rotate(rot));
  m = mul(m, scaleMat(sx, sy));
  m = mul(m, translate(-w / 2, -h / 2));
  return m;
}

export function instanceMatrix(
  project: Project,
  inst: Instance,
  part: Part | undefined,
  poseId: string | undefined,
): Mat {
  const { w, h } = instanceSize(inst, part);
  const base = inst.shape || !part ? shapeBaseAlign(project) : effectiveAlign(part, poseId);
  return alignMatrix(base, w, h, inst);
}

/** Center of an instance in canvas coordinates. */
export function instanceCenter(project: Project, inst: Instance, part: Part | undefined, poseId?: string): [number, number] {
  const base = inst.shape || !part ? shapeBaseAlign(project) : effectiveAlign(part, poseId);
  return [base.x + inst.dx, base.y + inst.dy];
}

export function corners(m: Mat, w: number, h: number): [number, number][] {
  return [apply(m, 0, 0), apply(m, w, 0), apply(m, w, h), apply(m, 0, h)];
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
