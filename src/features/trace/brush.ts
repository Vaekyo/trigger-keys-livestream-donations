// Variable-width stroke rendering (pressure + tapered ends).
// Each point becomes a circle, consecutive circles are joined by their
// tangent hull, and everything is filled as one path so anti-aliased edges
// never double up.

import type { Pt } from './stabilizer';

export interface BrushOptions {
  size: number;
  pressure: boolean;
  /** Width at zero pressure as a fraction of size. */
  minPressure: number;
  taperStart: boolean;
  taperEnd: boolean;
  /** Taper length in canvas px. */
  taper: number;
}

export function widthsFor(pts: Pt[], o: BrushOptions, totalLength?: number): number[] {
  const out: number[] = [];
  let s = 0;
  const lengths: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    lengths.push(s);
  }
  const total = totalLength ?? s;
  const taper = Math.max(0.001, Math.min(o.taper, total / 2.2));
  for (let i = 0; i < pts.length; i++) {
    let w = o.size;
    if (o.pressure) w *= o.minPressure + (1 - o.minPressure) * Math.max(0, Math.min(1, pts[i].p));
    let t = 1;
    if (o.taperStart && o.taper > 0) t = Math.min(t, lengths[i] / taper);
    if (o.taperEnd && o.taper > 0 && totalLength !== undefined) t = Math.min(t, (total - lengths[i]) / taper);
    t = Math.max(0, Math.min(1, t));
    w *= 0.15 + 0.85 * Math.sqrt(t);
    out.push(Math.max(0.35, w));
  }
  return out;
}

function addCapsule(path: Path2D, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d <= Math.abs(r0 - r1) || d < 0.01) return;
  const th = Math.atan2(dy, dx);
  const a = Math.acos((r0 - r1) / d);
  const p = [
    [x0 + r0 * Math.cos(th + a), y0 + r0 * Math.sin(th + a)],
    [x1 + r1 * Math.cos(th + a), y1 + r1 * Math.sin(th + a)],
    [x1 + r1 * Math.cos(th - a), y1 + r1 * Math.sin(th - a)],
    [x0 + r0 * Math.cos(th - a), y0 + r0 * Math.sin(th - a)],
  ];
  // keep every sub-path wound the same way as arc() so "nonzero" unions them
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = p[i];
    const [bx, by] = p[(i + 1) % 4];
    area += ax * by - bx * ay;
  }
  if (area < 0) p.reverse();
  path.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < 4; i++) path.lineTo(p[i][0], p[i][1]);
  path.closePath();
}

/** Build the outline of a stroke (optionally only from point `from`). */
export function strokePath(pts: Pt[], widths: number[], from = 0, mirrorX?: number): Path2D {
  const path = new Path2D();
  const add = (mx: (x: number) => number) => {
    let lastI = -1;
    for (let i = Math.max(0, from); i < pts.length; i++) {
      const r = widths[i] / 2;
      // skip points that are much closer than the radius (keeps paths small)
      if (lastI >= 0 && i < pts.length - 1) {
        const q = pts[lastI];
        if (Math.hypot(pts[i].x - q.x, pts[i].y - q.y) < Math.max(0.6, r * 0.35)) continue;
      }
      const x = mx(pts[i].x);
      path.moveTo(x + r, pts[i].y);
      path.arc(x, pts[i].y, r, 0, Math.PI * 2);
      const prev = lastI >= 0 ? lastI : i > 0 ? i - 1 : -1;
      if (prev >= 0) addCapsule(path, mx(pts[prev].x), pts[prev].y, widths[prev] / 2, x, pts[i].y, r);
      lastI = i;
    }
  };
  add((x) => x);
  if (mirrorX !== undefined) add((x) => 2 * mirrorX - x);
  return path;
}

export function strokeBounds(pts: Pt[], widths: number[], mirrorX?: number): { x: number; y: number; w: number; h: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const r = widths[i] / 2 + 2;
    const xs = mirrorX === undefined ? [pts[i].x] : [pts[i].x, 2 * mirrorX - pts[i].x];
    for (const x of xs) {
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
    }
    minY = Math.min(minY, pts[i].y - r);
    maxY = Math.max(maxY, pts[i].y + r);
  }
  return { x: Math.floor(minX), y: Math.floor(minY), w: Math.ceil(maxX - minX) + 1, h: Math.ceil(maxY - minY) + 1 };
}
