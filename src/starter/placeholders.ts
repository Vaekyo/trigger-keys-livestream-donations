// Generated starter content: simple geometric "placeholder-*" parts so every
// feature can be tried right away. All of them are tagged "placeholder" and
// can be removed in one click from the library menu.

import type { Character, Doc, ID, Part, Project } from '../model/types';
import { newCharacter, newInstance, PRESET_PALETTES, tintColor } from '../model/defaults';
import { anchors, type Anchors } from '../render/guides';
import { ctx2d, makeCanvas } from '../db/assets';
import { canvasSpaceAlign, prepareLayers, storePart, type LayerSources } from '../io/partFactory';

type Ctx = CanvasRenderingContext2D;
interface Layers {
  fill: Ctx;
  line: Ctx;
  flat: Ctx;
}

interface Spec {
  name: string;
  cat: string;
  tags: string[];
  layers: ('fill' | 'line' | 'flat')[];
  poses?: 'both' | 'front' | '34';
  /** Horizontal shift (in template units) for the bust-34 pose alignment. */
  shift34?: number;
  favorite?: boolean;
  draw: (L: Layers, a: Anchors, W: number, H: number) => void;
}

const LINE = '#1e1a26';
const BASE = '#f2f2f2';
const SHADE = '#c4c4c4';

function stroke(x: Ctx, p: Path2D, w: number, color = LINE) {
  x.save();
  x.lineWidth = w;
  x.lineJoin = 'round';
  x.lineCap = 'round';
  x.strokeStyle = color;
  x.stroke(p);
  x.restore();
}

function fill(x: Ctx, p: Path2D, color: string | CanvasGradient = BASE) {
  x.save();
  x.fillStyle = color;
  x.fill(p);
  x.restore();
}

function clipped(x: Ctx, p: Path2D, draw: () => void) {
  x.save();
  x.clip(p);
  draw();
  x.restore();
}

function ell(cx: number, cy: number, rx: number, ry: number, rot = 0): Path2D {
  const p = new Path2D();
  p.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  return p;
}

/* ---------------- shapes shared by several parts ---------------- */

function facePath(a: Anchors, turn: number): Path2D {
  const { cx, u, headCy, headRx: rx, headRy: ry, eyeY, chinY } = a;
  const top = headCy - ry * 0.95;
  const chinX = cx + 55 * u * turn;
  const rr = rx - 28 * u * turn; // far side narrower when turned
  const p = new Path2D();
  p.moveTo(cx + 10 * u * turn, top);
  p.bezierCurveTo(cx + rr * 0.75, top, cx + rr, headCy - ry * 0.55, cx + rr, headCy - 10 * u);
  p.bezierCurveTo(cx + rr, eyeY + 90 * u, chinX + rr * 0.45, chinY - 50 * u, chinX, chinY);
  p.bezierCurveTo(chinX - rx * 0.6, chinY - 40 * u, cx - rx, eyeY + 90 * u, cx - rx, headCy - 10 * u);
  p.bezierCurveTo(cx - rx, headCy - ry * 0.55, cx - rx * 0.75, top, cx + 10 * u * turn, top);
  p.closePath();
  return p;
}

function bodyPath(a: Anchors, H: number): Path2D {
  const { cx, u, neckTop, neckBottom, neckHalf: nh, shoulderY, shoulderHalf: sh } = a;
  const p = new Path2D();
  p.moveTo(cx - nh, neckTop);
  p.lineTo(cx - nh - 4 * u, neckBottom - 30 * u);
  p.bezierCurveTo(cx - nh - 30 * u, neckBottom + 20 * u, cx - sh * 0.7, shoulderY - 10 * u, cx - sh, shoulderY + 90 * u);
  p.bezierCurveTo(cx - sh - 40 * u, shoulderY + 200 * u, cx - sh - 45 * u, H - 200 * u, cx - sh - 40 * u, H + 10);
  p.lineTo(cx + sh + 40 * u, H + 10);
  p.bezierCurveTo(cx + sh + 45 * u, H - 200 * u, cx + sh + 40 * u, shoulderY + 200 * u, cx + sh, shoulderY + 90 * u);
  p.bezierCurveTo(cx + sh * 0.7, shoulderY - 10 * u, cx + nh + 30 * u, neckBottom + 20 * u, cx + nh + 4 * u, neckBottom - 30 * u);
  p.lineTo(cx + nh, neckTop);
  p.closePath();
  return p;
}

function topPath(a: Anchors, H: number, neckDepth = 60): Path2D {
  const { cx, u, neckBottom, shoulderY, shoulderHalf: sh } = a;
  const p = new Path2D();
  p.moveTo(cx - 72 * u, neckBottom - 12 * u);
  p.quadraticCurveTo(cx, neckBottom + neckDepth * u, cx + 72 * u, neckBottom - 12 * u);
  p.bezierCurveTo(cx + sh * 0.5, neckBottom + 6 * u, cx + sh * 0.85, shoulderY + 6 * u, cx + sh + 12 * u, shoulderY + 96 * u);
  p.bezierCurveTo(cx + sh + 55 * u, shoulderY + 220 * u, cx + sh + 60 * u, H - 200 * u, cx + sh + 55 * u, H + 10);
  p.lineTo(cx - sh - 55 * u, H + 10);
  p.bezierCurveTo(cx - sh - 60 * u, H - 200 * u, cx - sh - 55 * u, shoulderY + 220 * u, cx - sh - 12 * u, shoulderY + 96 * u);
  p.bezierCurveTo(cx - sh * 0.85, shoulderY + 6 * u, cx - sh * 0.5, neckBottom + 6 * u, cx - 72 * u, neckBottom - 12 * u);
  p.closePath();
  return p;
}

/** Hair silhouette that falls to `bottom` with pointed strand tips. */
function hairBackPath(a: Anchors, bottom: number, spread: number, tips: number): Path2D {
  const { cx, u, headCy, headRx: rx, hairTop } = a;
  const side = rx + spread * u;
  const p = new Path2D();
  p.moveTo(cx, hairTop + 6 * u);
  p.bezierCurveTo(cx + side * 0.8, hairTop, cx + side + 30 * u, headCy - 80 * u, cx + side, headCy + 120 * u);
  p.bezierCurveTo(cx + side - 10 * u, (headCy + bottom) / 2, cx + side + 30 * u, bottom - 80 * u, cx + side + 20 * u, bottom);
  const span = (side + 20 * u) * 2;
  for (let i = 1; i <= tips; i++) {
    const t = i / tips;
    const x = cx + side + 20 * u - span * t;
    const xm = x + span / tips / 2;
    p.quadraticCurveTo(xm, bottom - 70 * u, x, bottom - (i % 2 ? 18 : 0) * u);
  }
  p.bezierCurveTo(cx - side - 30 * u, bottom - 80 * u, cx - side + 10 * u, (headCy + bottom) / 2, cx - side, headCy + 120 * u);
  p.bezierCurveTo(cx - side - 30 * u, headCy - 80 * u, cx - side * 0.8, hairTop, cx, hairTop + 6 * u);
  p.closePath();
  return p;
}

function bangsPath(a: Anchors, sweep: number): Path2D {
  const { cx, u, headCy, headRx: rx, hairTop, browY, eyeY } = a;
  const p = new Path2D();
  const L = cx - rx - 38 * u;
  const R = cx + rx + 38 * u;
  p.moveTo(L, eyeY + 70 * u);
  p.bezierCurveTo(L - 22 * u, headCy - 170 * u, cx - rx * 0.6, hairTop - 14 * u, cx, hairTop - 8 * u);
  p.bezierCurveTo(cx + rx * 0.6, hairTop - 14 * u, R + 22 * u, headCy - 170 * u, R, eyeY + 70 * u);
  // right side lock inner edge
  p.quadraticCurveTo(R - 18 * u, headCy - 10 * u, cx + rx - 30 * u, browY - 30 * u);
  // fringe strands from right to left
  const strands = 6;
  const x0 = cx + rx - 30 * u;
  const x1 = cx - rx + 30 * u;
  for (let i = 0; i < strands; i++) {
    const t0 = i / strands;
    const t1 = (i + 1) / strands;
    const xa = x0 + (x1 - x0) * t0;
    const xb = x0 + (x1 - x0) * t1;
    const tipX = (xa + xb) / 2 + sweep * u;
    const tipY = browY + (i % 2 ? 26 : 48) * u + Math.abs(sweep) * 0.2 * u * (i / strands);
    p.quadraticCurveTo(xa - 4 * u, (browY + tipY) / 2, tipX, tipY);
    p.quadraticCurveTo(xb + 6 * u, browY - 10 * u, xb, browY - 34 * u);
  }
  p.quadraticCurveTo(L + 18 * u, headCy - 10 * u, L, eyeY + 70 * u);
  p.closePath();
  return p;
}

function hairShading(x: Ctx, p: Path2D, a: Anchors, top: number, bottom: number) {
  clipped(x, p, () => {
    const g = x.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, BASE);
    g.addColorStop(0.55, BASE);
    g.addColorStop(1, SHADE);
    x.fillStyle = g;
    x.fillRect(0, top - 10, a.cx * 4, bottom - top + 20);
    // "angel ring" highlight band
    x.strokeStyle = '#ffffff';
    x.lineWidth = 26 * a.u;
    x.beginPath();
    x.ellipse(a.cx, a.headCy - 30 * a.u, a.headRx * 0.85, a.headRy * 0.72, 0, Math.PI * 1.12, Math.PI * 1.88);
    x.stroke();
  });
}

/* ---------------- eyes ---------------- */

interface EyeStyle {
  ew: number;
  eh: number;
  irx: number;
  iry: number;
  star?: boolean;
}

function eyePath(ex: number, ey: number, s: number, st: EyeStyle, u: number): Path2D {
  const ew = st.ew * u;
  const eh = st.eh * u;
  const p = new Path2D();
  p.moveTo(ex - s * ew, ey + 6 * u);
  p.bezierCurveTo(ex - s * ew * 0.6, ey - eh * 1.25, ex + s * ew * 0.55, ey - eh * 1.3, ex + s * ew, ey - 6 * u);
  p.bezierCurveTo(ex + s * ew * 0.6, ey + eh * 0.95, ex - s * ew * 0.5, ey + eh * 1.0, ex - s * ew, ey + 6 * u);
  p.closePath();
  return p;
}

function drawEyes(L: Layers, a: Anchors, st: EyeStyle) {
  const { u } = a;
  for (const s of [-1, 1]) {
    const ex = a.cx + s * a.eyeDx;
    const ey = a.eyeY;
    const eye = eyePath(ex, ey, s, st, u);
    const iris = ell(ex, ey + 2 * u, st.irx * u, st.iry * u);
    // iris (fill layer): grayscale so smart tint colors it, darker at the top
    clipped(L.fill, eye, () => {
      const g = L.fill.createLinearGradient(0, ey - st.iry * u, 0, ey + st.iry * u);
      g.addColorStop(0, '#6e6e6e');
      g.addColorStop(0.55, '#d8d8d8');
      g.addColorStop(1, '#ffffff');
      fill(L.fill, iris, g);
      stroke(L.fill, iris, 3 * u, '#5a5a5a');
    });
    // sclera with the iris cut out (line layer, white stays white when recolored)
    clipped(L.line, eye, () => {
      fill(L.line, eye, '#ffffff');
      L.line.save();
      L.line.globalCompositeOperation = 'destination-out';
      L.line.fill(iris);
      L.line.restore();
      fill(L.line, ell(ex, ey + 5 * u, st.irx * 0.42 * u, st.iry * 0.45 * u), LINE);
      if (st.star) {
        const p = new Path2D();
        const r = 11 * u;
        const hx = ex - s * 6 * u;
        const hy = ey - 9 * u;
        p.moveTo(hx, hy - r);
        p.quadraticCurveTo(hx, hy, hx + r, hy);
        p.quadraticCurveTo(hx, hy, hx, hy + r);
        p.quadraticCurveTo(hx, hy, hx - r, hy);
        p.quadraticCurveTo(hx, hy, hx, hy - r);
        fill(L.line, p, '#ffffff');
      } else {
        fill(L.line, ell(ex - s * 8 * u, ey - 10 * u, 7 * u, 7 * u), '#ffffff');
      }
      fill(L.line, ell(ex + s * 9 * u, ey + 13 * u, 3.5 * u, 3.5 * u), '#ffffff');
    });
    // lashes: thick upper lid + flick, thin lower lid
    const ew = st.ew * u;
    const eh = st.eh * u;
    const lid = new Path2D();
    lid.moveTo(ex - s * ew * 1.02, ey + 8 * u);
    lid.bezierCurveTo(ex - s * ew * 0.6, ey - eh * 1.25, ex + s * ew * 0.55, ey - eh * 1.3, ex + s * ew * 1.08, ey - 8 * u);
    lid.lineTo(ex + s * (ew + 16 * u), ey - 16 * u);
    stroke(L.line, lid, 7 * u);
    const lower = new Path2D();
    lower.moveTo(ex + s * ew * 0.75, ey + eh * 0.55);
    lower.quadraticCurveTo(ex, ey + eh * 1.05, ex - s * ew * 0.55, ey + eh * 0.62);
    stroke(L.line, lower, 2.5 * u);
  }
}

function browPath(a: Anchors, s: number, tilt: number): Path2D {
  const { u } = a;
  const bx = a.cx + s * a.eyeDx;
  const by = a.browY;
  const inner = bx - s * 42 * u;
  const outer = bx + s * 48 * u;
  const p = new Path2D();
  p.moveTo(inner, by + tilt * u + 4 * u);
  p.quadraticCurveTo(bx, by - 16 * u, outer, by - tilt * u + 6 * u);
  p.quadraticCurveTo(bx, by - 4 * u, inner, by + tilt * u + 12 * u);
  p.closePath();
  return p;
}

function star(x: Ctx, cx: number, cy: number, r: number, color: string, border?: string) {
  const p = new Path2D();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  }
  p.closePath();
  if (border) stroke(x, p, r * 0.25, border);
  fill(x, p, color);
}

function sparkle(x: Ctx, cx: number, cy: number, r: number, color: string) {
  const p = new Path2D();
  p.moveTo(cx, cy - r);
  p.quadraticCurveTo(cx, cy, cx + r, cy);
  p.quadraticCurveTo(cx, cy, cx, cy + r);
  p.quadraticCurveTo(cx, cy, cx - r, cy);
  p.quadraticCurveTo(cx, cy, cx, cy - r);
  fill(x, p, color);
}

function heart(x: Ctx, cx: number, cy: number, s: number, color: string, border?: string) {
  const p = new Path2D();
  p.moveTo(cx, cy + s * 0.45);
  p.bezierCurveTo(cx - s * 0.6, cy + s * 0.05, cx - s * 0.5, cy - s * 0.65, cx, cy - s * 0.3);
  p.bezierCurveTo(cx + s * 0.5, cy - s * 0.65, cx + s * 0.6, cy + s * 0.05, cx, cy + s * 0.45);
  p.closePath();
  if (border) stroke(x, p, s * 0.14, border);
  fill(x, p, color);
}

function bow(x: Ctx, cx: number, cy: number, s: number, color: string, line?: Ctx) {
  const p = new Path2D();
  p.moveTo(cx, cy);
  p.bezierCurveTo(cx - s * 0.4, cy - s * 0.55, cx - s, cy - s * 0.45, cx - s * 0.9, cy);
  p.bezierCurveTo(cx - s, cy + s * 0.45, cx - s * 0.4, cy + s * 0.5, cx, cy);
  p.bezierCurveTo(cx + s * 0.4, cy - s * 0.55, cx + s, cy - s * 0.45, cx + s * 0.9, cy);
  p.bezierCurveTo(cx + s, cy + s * 0.45, cx + s * 0.4, cy + s * 0.5, cx, cy);
  const tails = new Path2D();
  tails.moveTo(cx - s * 0.1, cy);
  tails.lineTo(cx - s * 0.45, cy + s * 0.9);
  tails.lineTo(cx - s * 0.2, cy + s * 0.8);
  tails.lineTo(cx, cy);
  tails.lineTo(cx + s * 0.2, cy + s * 0.8);
  tails.lineTo(cx + s * 0.45, cy + s * 0.9);
  tails.lineTo(cx + s * 0.1, cy);
  fill(x, tails, color);
  fill(x, p, color);
  const knot = ell(cx, cy, s * 0.16, s * 0.2);
  fill(x, knot, color);
  if (line) {
    stroke(line, tails, s * 0.05);
    stroke(line, p, s * 0.06);
    stroke(line, knot, s * 0.05);
  }
}

/* ---------------- the catalogue ---------------- */

const SPECS: Spec[] = [
  /* background */
  {
    name: 'placeholder-bg-sky',
    cat: 'background',
    tags: ['sky', 'soft'],
    layers: ['flat'],
    favorite: true,
    draw: (L, a, W, H) => {
      const g = L.flat.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#a9d8ff');
      g.addColorStop(1, '#fff0f8');
      L.flat.fillStyle = g;
      L.flat.fillRect(0, 0, W, H);
      L.flat.fillStyle = 'rgba(255,255,255,0.8)';
      for (const [x, y, r] of [
        [0.15, 0.12, 70],
        [0.25, 0.1, 50],
        [0.8, 0.22, 80],
        [0.9, 0.2, 50],
        [0.7, 0.24, 55],
      ]) {
        L.flat.beginPath();
        L.flat.arc(x * W, y * H, r * a.u, 0, Math.PI * 2);
        L.flat.fill();
      }
    },
  },
  {
    name: 'placeholder-bg-dots',
    cat: 'background',
    tags: ['pattern', 'pink'],
    layers: ['flat'],
    draw: (L, a, W, H) => {
      L.flat.fillStyle = '#ffd6e7';
      L.flat.fillRect(0, 0, W, H);
      L.flat.fillStyle = '#ffffff';
      const s = 80 * a.u;
      for (let row = 0, y = s / 2; y < H + s; y += s, row++)
        for (let x = row % 2 ? s : s / 2; x < W + s; x += s) {
          L.flat.beginPath();
          L.flat.arc(x, y, s * 0.16, 0, Math.PI * 2);
          L.flat.fill();
        }
    },
  },
  {
    name: 'placeholder-bg-stripes',
    cat: 'background',
    tags: ['pattern', 'mint'],
    layers: ['flat'],
    draw: (L, a, W, H) => {
      L.flat.fillStyle = '#d7f7ee';
      L.flat.fillRect(0, 0, W, H);
      L.flat.strokeStyle = '#b4ecdc';
      L.flat.lineWidth = 40 * a.u;
      for (let o = -H; o < W + H; o += 100 * a.u) {
        L.flat.beginPath();
        L.flat.moveTo(o, 0);
        L.flat.lineTo(o + H, H);
        L.flat.stroke();
      }
    },
  },

  /* hair-back */
  {
    name: 'placeholder-hair-back-long',
    cat: 'hair-back',
    tags: ['long', 'line+fill'],
    layers: ['fill', 'line'],
    favorite: true,
    draw: (L, a) => {
      const bottom = a.headCy + 600 * a.u;
      const p = hairBackPath(a, bottom, 70, 8);
      fill(L.fill, p);
      clipped(L.fill, p, () => fill(L.fill, ell(a.cx, a.headCy + 200 * a.u, a.headRx + 30 * a.u, 330 * a.u), SHADE));
      stroke(L.line, p, 6 * a.u);
    },
  },
  {
    name: 'placeholder-hair-back-bob',
    cat: 'hair-back',
    tags: ['short', 'line+fill'],
    layers: ['fill', 'line'],
    draw: (L, a) => {
      const p = hairBackPath(a, a.chinY + 60 * a.u, 55, 6);
      fill(L.fill, p);
      clipped(L.fill, p, () => fill(L.fill, ell(a.cx, a.chinY, a.headRx + 10 * a.u, 120 * a.u), SHADE));
      stroke(L.line, p, 6 * a.u);
    },
  },
  {
    name: 'placeholder-hair-back-twintails',
    cat: 'hair-back',
    tags: ['twintails', 'line+fill'],
    layers: ['fill', 'line'],
    poses: 'front',
    draw: (L, a) => {
      const { u } = a;
      const head = hairBackPath(a, a.chinY - 40 * u, 45, 6);
      for (const s of [-1, 1]) {
        const x0 = a.cx + s * (a.headRx + 30 * u);
        const tail = new Path2D();
        tail.moveTo(x0, a.headCy - 160 * u);
        tail.bezierCurveTo(x0 + s * 200 * u, a.headCy - 120 * u, x0 + s * 170 * u, a.headCy + 400 * u, x0 + s * 120 * u, a.headCy + 760 * u);
        tail.quadraticCurveTo(x0 + s * 40 * u, a.headCy + 500 * u, x0 + s * 10 * u, a.headCy + 100 * u);
        tail.closePath();
        fill(L.fill, tail);
        clipped(L.fill, tail, () => fill(L.fill, ell(x0 + s * 60 * u, a.headCy + 500 * u, 90 * u, 260 * u), SHADE));
        stroke(L.line, tail, 6 * u);
        const tie = ell(x0 + s * 20 * u, a.headCy - 150 * u, 22 * u, 22 * u);
        fill(L.line, tie, '#ff6f91');
        stroke(L.line, tie, 4 * u);
      }
      fill(L.fill, head);
      stroke(L.line, head, 6 * u);
    },
  },

  /* body */
  {
    name: 'placeholder-body',
    cat: 'body',
    tags: ['line+fill', 'skin'],
    layers: ['fill', 'line'],
    favorite: true,
    draw: (L, a, _W, H) => {
      const p = bodyPath(a, H);
      fill(L.fill, p, '#ffffff');
      clipped(L.fill, p, () => fill(L.fill, ell(a.cx, a.neckTop + 30 * a.u, a.neckHalf + 20 * a.u, 70 * a.u), SHADE));
      stroke(L.line, p, 5 * a.u);
      const cb = new Path2D();
      cb.moveTo(a.cx - 30 * a.u, a.neckBottom + 30 * a.u);
      cb.quadraticCurveTo(a.cx - 90 * a.u, a.neckBottom + 20 * a.u, a.cx - 140 * a.u, a.neckBottom + 40 * a.u);
      cb.moveTo(a.cx + 30 * a.u, a.neckBottom + 30 * a.u);
      cb.quadraticCurveTo(a.cx + 90 * a.u, a.neckBottom + 20 * a.u, a.cx + 140 * a.u, a.neckBottom + 40 * a.u);
      stroke(L.line, cb, 3 * a.u, '#7a6a72');
    },
  },

  /* outfit */
  {
    name: 'placeholder-outfit-tee',
    cat: 'outfit',
    tags: ['casual', 'line+fill'],
    layers: ['fill', 'line'],
    favorite: true,
    draw: (L, a, _W, H) => {
      const p = topPath(a, H);
      fill(L.fill, p, '#ffffff');
      clipped(L.fill, p, () => {
        // soft shade along the arms and under the collar
        for (const s of [-1, 1]) fill(L.fill, ell(a.cx + s * (a.shoulderHalf + 30 * a.u), a.shoulderY + 380 * a.u, 70 * a.u, 330 * a.u), '#d4d4d4');
        fill(L.fill, ell(a.cx, a.neckBottom + 30 * a.u, 110 * a.u, 40 * a.u), '#dedede');
      });
      stroke(L.line, p, 5 * a.u);
      const seams = new Path2D();
      for (const s of [-1, 1]) {
        seams.moveTo(a.cx + s * (a.shoulderHalf - 70 * a.u), a.shoulderY + 30 * a.u);
        seams.quadraticCurveTo(a.cx + s * (a.shoulderHalf - 110 * a.u), a.shoulderY + 200 * a.u, a.cx + s * (a.shoulderHalf - 100 * a.u), H);
      }
      stroke(L.line, seams, 3 * a.u);
    },
  },
  {
    name: 'placeholder-outfit-sailor',
    cat: 'outfit',
    tags: ['school', 'full color'],
    layers: ['flat'],
    draw: (L, a, _W, H) => {
      const { u } = a;
      const p = topPath(a, H, 120);
      fill(L.flat, p, '#fafafa');
      stroke(L.flat, p, 5 * u);
      const collar = new Path2D();
      collar.moveTo(a.cx - 72 * u, a.neckBottom - 12 * u);
      collar.lineTo(a.cx, a.neckBottom + 190 * u);
      collar.lineTo(a.cx + 72 * u, a.neckBottom - 12 * u);
      collar.lineTo(a.cx + 260 * u, a.neckBottom + 40 * u);
      collar.lineTo(a.cx + 150 * u, a.neckBottom + 200 * u);
      collar.lineTo(a.cx, a.neckBottom + 280 * u);
      collar.lineTo(a.cx - 150 * u, a.neckBottom + 200 * u);
      collar.lineTo(a.cx - 260 * u, a.neckBottom + 40 * u);
      collar.closePath();
      fill(L.flat, collar, '#2d3b6b');
      stroke(L.flat, collar, 5 * u);
      const stripe = new Path2D();
      stripe.moveTo(a.cx - 230 * u, a.neckBottom + 55 * u);
      stripe.lineTo(a.cx - 135 * u, a.neckBottom + 185 * u);
      stripe.moveTo(a.cx + 230 * u, a.neckBottom + 55 * u);
      stripe.lineTo(a.cx + 135 * u, a.neckBottom + 185 * u);
      stroke(L.flat, stripe, 6 * u, '#ffffff');
      bow(L.flat, a.cx, a.neckBottom + 230 * u, 70 * u, '#e04a5f', L.flat);
    },
  },
  {
    name: 'placeholder-outfit-hoodie',
    cat: 'outfit',
    tags: ['casual', 'line+fill'],
    layers: ['fill', 'line'],
    draw: (L, a, _W, H) => {
      const { u } = a;
      const hood = new Path2D();
      hood.ellipse(a.cx, a.neckBottom + 10 * u, 170 * u, 80 * u, 0, 0, Math.PI * 2);
      const p = topPath(a, H, 30);
      fill(L.fill, p, '#ffffff');
      fill(L.fill, hood, '#e0e0e0');
      stroke(L.line, p, 5 * u);
      stroke(L.line, hood, 5 * u);
      const strings = new Path2D();
      strings.moveTo(a.cx - 40 * u, a.neckBottom + 60 * u);
      strings.lineTo(a.cx - 46 * u, a.neckBottom + 240 * u);
      strings.moveTo(a.cx + 40 * u, a.neckBottom + 60 * u);
      strings.lineTo(a.cx + 46 * u, a.neckBottom + 240 * u);
      stroke(L.line, strings, 5 * u);
      const pocket = new Path2D();
      pocket.moveTo(a.cx - 180 * u, H - 60 * u);
      pocket.lineTo(a.cx - 130 * u, H - 230 * u);
      pocket.lineTo(a.cx + 130 * u, H - 230 * u);
      pocket.lineTo(a.cx + 180 * u, H - 60 * u);
      stroke(L.line, pocket, 4 * u);
    },
  },

  /* neck-accessory */
  {
    name: 'placeholder-choker',
    cat: 'neck-accessory',
    tags: ['dark', 'cute'],
    layers: ['flat'],
    draw: (L, a) => {
      const { u } = a;
      const y = a.neckTop + 120 * u;
      const band = new Path2D();
      band.moveTo(a.cx - a.neckHalf - 6 * u, y - 12 * u);
      band.quadraticCurveTo(a.cx, y + 14 * u, a.cx + a.neckHalf + 6 * u, y - 12 * u);
      band.lineTo(a.cx + a.neckHalf + 6 * u, y + 12 * u);
      band.quadraticCurveTo(a.cx, y + 38 * u, a.cx - a.neckHalf - 6 * u, y + 12 * u);
      band.closePath();
      fill(L.flat, band, '#26222e');
      heart(L.flat, a.cx, y + 48 * u, 30 * u, '#ff6f91', LINE);
    },
  },
  {
    name: 'placeholder-neck-ribbon',
    cat: 'neck-accessory',
    tags: ['bow', 'red'],
    layers: ['flat'],
    draw: (L, a) => bow(L.flat, a.cx, a.neckBottom - 10 * a.u, 70 * a.u, '#e04a5f', L.flat),
  },

  /* face */
  {
    name: 'placeholder-face-oval',
    cat: 'face',
    tags: ['line+fill', 'skin'],
    layers: ['fill', 'line'],
    poses: 'front',
    favorite: true,
    draw: (L, a) => {
      const { u } = a;
      for (const s of [-1, 1]) {
        const ear = ell(a.cx + s * (a.headRx - 2 * u), a.earY, 24 * u, 44 * u);
        fill(L.fill, ear, '#ffffff');
        clipped(L.fill, ear, () => fill(L.fill, ell(a.cx + s * (a.headRx + 4 * u), a.earY, 10 * u, 26 * u), SHADE));
        stroke(L.line, ear, 5 * u);
      }
      const p = facePath(a, 0);
      fill(L.fill, p, '#ffffff');
      stroke(L.line, p, 5 * u);
      const nose = new Path2D();
      nose.moveTo(a.cx + 4 * u, a.noseY - 8 * u);
      nose.lineTo(a.cx - 3 * u, a.noseY + 6 * u);
      stroke(L.line, nose, 4 * u, '#8a6a72');
    },
  },
  {
    name: 'placeholder-face-34',
    cat: 'face',
    tags: ['line+fill', 'skin', 'three-quarter'],
    layers: ['fill', 'line'],
    poses: '34',
    draw: (L, a) => {
      const { u } = a;
      const ear = ell(a.cx - a.headRx + 40 * u, a.earY, 24 * u, 44 * u);
      fill(L.fill, ear, '#ffffff');
      stroke(L.line, ear, 5 * u);
      const p = facePath(a, 1);
      fill(L.fill, p, '#ffffff');
      stroke(L.line, p, 5 * u);
      const nose = new Path2D();
      nose.moveTo(a.cx + 80 * u, a.noseY - 10 * u);
      nose.lineTo(a.cx + 92 * u, a.noseY + 6 * u);
      nose.lineTo(a.cx + 80 * u, a.noseY + 8 * u);
      stroke(L.line, nose, 4 * u, '#8a6a72');
    },
  },

  /* blush */
  {
    name: 'placeholder-blush-soft',
    cat: 'blush',
    tags: ['soft', 'pink'],
    layers: ['flat'],
    shift34: 40,
    draw: (L, a) => {
      for (const s of [-1, 1]) {
        const cx = a.cx + s * (a.eyeDx + 25 * a.u);
        const cy = a.eyeY + 78 * a.u;
        const g = L.flat.createRadialGradient(cx, cy, 0, cx, cy, 46 * a.u);
        g.addColorStop(0, 'rgba(255,110,150,0.55)');
        g.addColorStop(1, 'rgba(255,110,150,0)');
        L.flat.fillStyle = g;
        L.flat.beginPath();
        L.flat.ellipse(cx, cy, 46 * a.u, 24 * a.u, 0, 0, Math.PI * 2);
        L.flat.fill();
      }
    },
  },
  {
    name: 'placeholder-blush-lines',
    cat: 'blush',
    tags: ['flustered'],
    layers: ['flat'],
    shift34: 40,
    draw: (L, a) => {
      const p = new Path2D();
      for (const s of [-1, 1]) {
        const cx = a.cx + s * (a.eyeDx + 25 * a.u);
        const cy = a.eyeY + 78 * a.u;
        for (let i = -1; i <= 1; i++) {
          p.moveTo(cx + i * 16 * a.u + 8 * a.u, cy - 12 * a.u);
          p.lineTo(cx + i * 16 * a.u - 6 * a.u, cy + 12 * a.u);
        }
      }
      stroke(L.flat, p, 4 * a.u, '#ff5c8a');
    },
  },

  /* eyes */
  {
    name: 'placeholder-eyes-round',
    cat: 'eyes',
    tags: ['cute', 'line+fill'],
    layers: ['fill', 'line'],
    shift34: 40,
    favorite: true,
    draw: (L, a) => drawEyes(L, a, { ew: 46, eh: 34, irx: 25, iry: 31 }),
  },
  {
    name: 'placeholder-eyes-sharp',
    cat: 'eyes',
    tags: ['cool', 'line+fill'],
    layers: ['fill', 'line'],
    shift34: 40,
    draw: (L, a) => drawEyes(L, a, { ew: 52, eh: 24, irx: 21, iry: 25 }),
  },
  {
    name: 'placeholder-eyes-sparkle',
    cat: 'eyes',
    tags: ['cute', 'line+fill', 'happy'],
    layers: ['fill', 'line'],
    shift34: 40,
    draw: (L, a) => drawEyes(L, a, { ew: 48, eh: 40, irx: 29, iry: 36, star: true }),
  },
  {
    name: 'placeholder-eyes-closed',
    cat: 'eyes',
    tags: ['happy', 'sleepy'],
    layers: ['flat'],
    shift34: 40,
    draw: (L, a) => {
      const p = new Path2D();
      for (const s of [-1, 1]) {
        const ex = a.cx + s * a.eyeDx;
        p.moveTo(ex - 44 * a.u, a.eyeY + 6 * a.u);
        p.quadraticCurveTo(ex, a.eyeY - 34 * a.u, ex + 44 * a.u, a.eyeY + 6 * a.u);
      }
      stroke(L.flat, p, 7 * a.u);
    },
  },

  /* brows (light gray so the hair color tints them) */
  {
    name: 'placeholder-brows-soft',
    cat: 'brows',
    tags: ['neutral'],
    layers: ['flat'],
    shift34: 40,
    favorite: true,
    draw: (L, a) => {
      for (const s of [-1, 1]) fill(L.flat, browPath(a, s, 0), '#cfcfcf');
    },
  },
  {
    name: 'placeholder-brows-angry',
    cat: 'brows',
    tags: ['angry'],
    layers: ['flat'],
    shift34: 40,
    draw: (L, a) => {
      for (const s of [-1, 1]) fill(L.flat, browPath(a, s, 14), '#cfcfcf');
    },
  },
  {
    name: 'placeholder-brows-worried',
    cat: 'brows',
    tags: ['worried', 'flustered'],
    layers: ['flat'],
    shift34: 40,
    draw: (L, a) => {
      for (const s of [-1, 1]) fill(L.flat, browPath(a, s, -14), '#cfcfcf');
    },
  },

  /* mouth */
  {
    name: 'placeholder-mouth-smile',
    cat: 'mouth',
    tags: ['happy'],
    layers: ['flat'],
    shift34: 50,
    favorite: true,
    draw: (L, a) => {
      const p = new Path2D();
      p.moveTo(a.cx - 30 * a.u, a.mouthY - 6 * a.u);
      p.quadraticCurveTo(a.cx, a.mouthY + 18 * a.u, a.cx + 30 * a.u, a.mouthY - 6 * a.u);
      stroke(L.flat, p, 5 * a.u, '#5a2a3a');
    },
  },
  {
    name: 'placeholder-mouth-open',
    cat: 'mouth',
    tags: ['happy', 'surprised'],
    layers: ['flat'],
    shift34: 50,
    draw: (L, a) => {
      const p = new Path2D();
      p.moveTo(a.cx - 34 * a.u, a.mouthY - 8 * a.u);
      p.quadraticCurveTo(a.cx, a.mouthY - 2 * a.u, a.cx + 34 * a.u, a.mouthY - 8 * a.u);
      p.quadraticCurveTo(a.cx + 26 * a.u, a.mouthY + 46 * a.u, a.cx, a.mouthY + 44 * a.u);
      p.quadraticCurveTo(a.cx - 26 * a.u, a.mouthY + 46 * a.u, a.cx - 34 * a.u, a.mouthY - 8 * a.u);
      fill(L.flat, p, '#7a2234');
      clipped(L.flat, p, () => fill(L.flat, ell(a.cx, a.mouthY + 42 * a.u, 24 * a.u, 16 * a.u), '#e86a7c'));
      stroke(L.flat, p, 4 * a.u, '#4a1a28');
    },
  },
  {
    name: 'placeholder-mouth-cat',
    cat: 'mouth',
    tags: ['cute', 'smug'],
    layers: ['flat'],
    shift34: 50,
    draw: (L, a) => {
      const p = new Path2D();
      p.moveTo(a.cx - 32 * a.u, a.mouthY - 4 * a.u);
      p.quadraticCurveTo(a.cx - 16 * a.u, a.mouthY + 16 * a.u, a.cx, a.mouthY - 2 * a.u);
      p.quadraticCurveTo(a.cx + 16 * a.u, a.mouthY + 16 * a.u, a.cx + 32 * a.u, a.mouthY - 4 * a.u);
      stroke(L.flat, p, 5 * a.u, '#5a2a3a');
    },
  },
  {
    name: 'placeholder-mouth-frown',
    cat: 'mouth',
    tags: ['angry', 'sad'],
    layers: ['flat'],
    shift34: 50,
    draw: (L, a) => {
      const p = new Path2D();
      p.moveTo(a.cx - 26 * a.u, a.mouthY + 8 * a.u);
      p.quadraticCurveTo(a.cx, a.mouthY - 10 * a.u, a.cx + 26 * a.u, a.mouthY + 8 * a.u);
      stroke(L.flat, p, 5 * a.u, '#5a2a3a');
    },
  },

  /* hair-front */
  {
    name: 'placeholder-hair-front-bangs',
    cat: 'hair-front',
    tags: ['bangs', 'line+fill'],
    layers: ['fill', 'line'],
    shift34: 25,
    favorite: true,
    draw: (L, a) => {
      const p = bangsPath(a, 0);
      fill(L.fill, p);
      hairShading(L.fill, p, a, a.hairTop, a.eyeY);
      stroke(L.line, p, 6 * a.u);
    },
  },
  {
    name: 'placeholder-hair-front-swept',
    cat: 'hair-front',
    tags: ['side-swept', 'line+fill'],
    layers: ['fill', 'line'],
    shift34: 25,
    draw: (L, a) => {
      const p = bangsPath(a, -26);
      fill(L.fill, p);
      hairShading(L.fill, p, a, a.hairTop, a.eyeY);
      stroke(L.line, p, 6 * a.u);
    },
  },
  {
    name: 'placeholder-hair-front-ahoge',
    cat: 'hair-front',
    tags: ['bangs', 'ahoge', 'line+fill'],
    layers: ['fill', 'line'],
    shift34: 25,
    draw: (L, a) => {
      const { u } = a;
      const p = bangsPath(a, 14);
      const strand = new Path2D();
      strand.moveTo(a.cx - 10 * u, a.hairTop);
      strand.bezierCurveTo(a.cx - 30 * u, a.hairTop - 90 * u, a.cx + 60 * u, a.hairTop - 120 * u, a.cx + 70 * u, a.hairTop - 60 * u);
      strand.bezierCurveTo(a.cx + 30 * u, a.hairTop - 90 * u, a.cx + 10 * u, a.hairTop - 50 * u, a.cx + 20 * u, a.hairTop + 4 * u);
      strand.closePath();
      fill(L.fill, strand);
      stroke(L.line, strand, 5 * u);
      fill(L.fill, p);
      hairShading(L.fill, p, a, a.hairTop, a.eyeY);
      stroke(L.line, p, 6 * u);
    },
  },

  /* glasses */
  {
    name: 'placeholder-glasses-round',
    cat: 'glasses',
    tags: ['round'],
    layers: ['flat'],
    shift34: 40,
    draw: (L, a) => {
      const p = new Path2D();
      for (const s of [-1, 1]) {
        const lens = ell(a.cx + s * a.eyeDx, a.eyeY, 56 * a.u, 52 * a.u);
        fill(L.flat, lens, 'rgba(190,225,255,0.22)');
        p.addPath(lens);
      }
      p.moveTo(a.cx - a.eyeDx + 56 * a.u, a.eyeY - 6 * a.u);
      p.quadraticCurveTo(a.cx, a.eyeY - 22 * a.u, a.cx + a.eyeDx - 56 * a.u, a.eyeY - 6 * a.u);
      stroke(L.flat, p, 6 * a.u, '#3a3340');
    },
  },
  {
    name: 'placeholder-glasses-square',
    cat: 'glasses',
    tags: ['square'],
    layers: ['flat'],
    shift34: 40,
    draw: (L, a) => {
      const p = new Path2D();
      for (const s of [-1, 1]) {
        const lens = new Path2D();
        lens.roundRect(a.cx + s * a.eyeDx - 62 * a.u, a.eyeY - 40 * a.u, 124 * a.u, 80 * a.u, 14 * a.u);
        fill(L.flat, lens, 'rgba(190,225,255,0.22)');
        p.addPath(lens);
      }
      p.moveTo(a.cx - a.eyeDx + 62 * a.u, a.eyeY - 10 * a.u);
      p.lineTo(a.cx + a.eyeDx - 62 * a.u, a.eyeY - 10 * a.u);
      stroke(L.flat, p, 7 * a.u, '#5b3a2a');
    },
  },

  /* earrings */
  {
    name: 'placeholder-earrings-gem',
    cat: 'earrings',
    tags: ['gem', 'line+fill'],
    layers: ['fill', 'line'],
    poses: 'front',
    draw: (L, a) => {
      const { u } = a;
      for (const s of [-1, 1]) {
        const x = a.cx + s * (a.headRx - 4 * u);
        const y = a.earY + 40 * u;
        const chain = new Path2D();
        chain.moveTo(x, y);
        chain.lineTo(x, y + 30 * u);
        stroke(L.line, chain, 3 * u, '#c9a227');
        const gem = new Path2D();
        gem.moveTo(x, y + 30 * u);
        gem.lineTo(x + 16 * u, y + 52 * u);
        gem.lineTo(x, y + 84 * u);
        gem.lineTo(x - 16 * u, y + 52 * u);
        gem.closePath();
        const g = L.fill.createLinearGradient(x - 16 * u, y + 30 * u, x + 16 * u, y + 84 * u);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#9a9a9a');
        fill(L.fill, gem, g);
        stroke(L.line, gem, 3 * u);
      }
    },
  },
  {
    name: 'placeholder-earrings-hoops',
    cat: 'earrings',
    tags: ['gold'],
    layers: ['flat'],
    poses: 'front',
    draw: (L, a) => {
      for (const s of [-1, 1]) stroke(L.flat, ell(a.cx + s * (a.headRx - 2 * a.u), a.earY + 70 * a.u, 22 * a.u, 30 * a.u), 6 * a.u, '#e0b040');
    },
  },

  /* head-accessory */
  {
    name: 'placeholder-hairpin',
    cat: 'head-accessory',
    tags: ['pin', 'cute'],
    layers: ['flat'],
    shift34: 25,
    draw: (L, a) => {
      const { u } = a;
      const x = L.flat;
      x.save();
      x.translate(a.cx + 120 * u, a.browY - 70 * u);
      x.rotate(-0.5);
      const pin = new Path2D();
      pin.roundRect(-55 * u, -10 * u, 110 * u, 20 * u, 10 * u);
      fill(x, pin, '#ffb3d1');
      stroke(x, pin, 3 * u);
      star(x, 30 * u, 0, 22 * u, '#ffe066', LINE);
      x.restore();
    },
  },
  {
    name: 'placeholder-head-bow',
    cat: 'head-accessory',
    tags: ['bow', 'line+fill'],
    layers: ['fill', 'line'],
    shift34: 25,
    draw: (L, a) => bow(L.fill, a.cx + 150 * a.u, a.hairTop + 70 * a.u, 90 * a.u, '#ffffff', L.line),
  },
  {
    name: 'placeholder-cat-ears',
    cat: 'head-accessory',
    tags: ['animal', 'line+fill'],
    layers: ['fill', 'line'],
    shift34: 15,
    draw: (L, a) => {
      const { u } = a;
      for (const s of [-1, 1]) {
        const x0 = a.cx + s * 140 * u;
        const ear = new Path2D();
        ear.moveTo(x0 - s * 80 * u, a.hairTop + 70 * u);
        ear.lineTo(x0 + s * 20 * u, a.hairTop - 110 * u);
        ear.lineTo(x0 + s * 90 * u, a.hairTop + 90 * u);
        ear.closePath();
        fill(L.fill, ear);
        const inner = new Path2D();
        inner.moveTo(x0 - s * 40 * u, a.hairTop + 60 * u);
        inner.lineTo(x0 + s * 18 * u, a.hairTop - 60 * u);
        inner.lineTo(x0 + s * 58 * u, a.hairTop + 70 * u);
        inner.closePath();
        fill(L.line, inner, '#ffc2d6');
        stroke(L.line, ear, 6 * u);
      }
    },
  },

  /* effects */
  {
    name: 'placeholder-fx-sparkles',
    cat: 'effects',
    tags: ['sparkle', 'happy'],
    layers: ['flat'],
    draw: (L, a) => {
      const { u } = a;
      for (const [dx, dy, r] of [
        [-300, -260, 42],
        [-340, -150, 22],
        [300, -300, 34],
        [340, -190, 52],
        [270, 60, 24],
      ]) {
        sparkle(L.flat, a.cx + dx * u, a.headCy + dy * u, r * u, '#ffd84d');
        sparkle(L.flat, a.cx + dx * u, a.headCy + dy * u, r * 0.45 * u, '#ffffff');
      }
    },
  },
  {
    name: 'placeholder-fx-hearts',
    cat: 'effects',
    tags: ['love', 'happy'],
    layers: ['flat'],
    draw: (L, a) => {
      const { u } = a;
      for (const [dx, dy, s] of [
        [290, -240, 70],
        [360, -120, 44],
        [-330, -200, 50],
      ])
        heart(L.flat, a.cx + dx * u, a.headCy + dy * u, s * u, '#ff7eb6', '#ffffff');
    },
  },
  {
    name: 'placeholder-fx-sweat',
    cat: 'effects',
    tags: ['flustered', 'nervous'],
    layers: ['flat'],
    shift34: 20,
    draw: (L, a) => {
      const { u } = a;
      const x = a.cx + a.headRx - 10 * u;
      const y = a.headCy - 90 * u;
      const p = new Path2D();
      p.moveTo(x, y - 50 * u);
      p.bezierCurveTo(x + 6 * u, y - 20 * u, x + 30 * u, y + 2 * u, x + 28 * u, y + 20 * u);
      p.arc(x, y + 20 * u, 28 * u, 0, Math.PI);
      p.bezierCurveTo(x - 30 * u, y + 2 * u, x - 6 * u, y - 20 * u, x, y - 50 * u);
      fill(L.flat, p, '#a8dcff');
      stroke(L.flat, p, 4 * u, '#3a7fc0');
    },
  },

  /* stickers */
  {
    name: 'placeholder-sticker-star',
    cat: 'stickers',
    tags: ['star'],
    layers: ['flat'],
    draw: (L, a, W, H) => star(L.flat, W * 0.82, H * 0.86, 90 * a.u, '#ffd54f', '#ffffff'),
  },
  {
    name: 'placeholder-sticker-heart',
    cat: 'stickers',
    tags: ['heart'],
    layers: ['flat'],
    draw: (L, a, W, H) => heart(L.flat, W * 0.18, H * 0.86, 150 * a.u, '#ff7eb6', '#ffffff'),
  },
];

export async function generatePlaceholders(project: Project, progress?: (msg: string) => void): Promise<Record<ID, Part>> {
  const W = project.width;
  const H = project.height;
  const a = anchors(W, H);
  const front = project.poses[0]?.id;
  const tq = project.poses[1]?.id;
  const parts: Record<ID, Part> = {};
  let n = 0;
  for (const spec of SPECS) {
    n++;
    if (n % 4 === 0) progress?.(`Creating starter parts… ${n}/${SPECS.length}`);
    if (!project.categories.some((c) => c.id === spec.cat)) continue;
    const canvases: Partial<Record<'fill' | 'line' | 'flat', HTMLCanvasElement>> = {};
    const L = {} as Layers;
    for (const key of ['fill', 'line', 'flat'] as const) {
      const c = makeCanvas(W, H);
      canvases[key] = c;
      L[key] = ctx2d(c);
    }
    spec.draw(L, a, W, H);
    const sources: LayerSources = {};
    for (const key of spec.layers) sources[key] = canvases[key];
    const prepared = prepareLayers(sources, W * 2, H * 2);
    if (!prepared) continue;
    const align = canvasSpaceAlign(prepared, W);
    let poseIds: ID[] = [];
    if (spec.poses === 'front') poseIds = front ? [front] : [];
    else if (spec.poses === '34') poseIds = tq ? [tq] : [];
    else poseIds = [front, tq].filter(Boolean) as ID[];
    const part = await storePart({
      name: spec.name,
      categoryId: spec.cat,
      poseIds,
      tags: ['placeholder', ...spec.tags],
      prepared,
      align,
      favorite: spec.favorite,
      placeholder: true,
    });
    if (spec.shift34 && tq && poseIds.includes(tq)) {
      part.poseAlign = { [tq]: { ...align, x: align.x + spec.shift34 * a.u } };
    }
    parts[part.id] = part;
    // yield so the loading screen can update
    await new Promise((r) => setTimeout(r, 0));
  }
  return parts;
}

const STARTER_LOOK: Record<string, string> = {
  background: 'placeholder-bg-sky',
  'hair-back': 'placeholder-hair-back-long',
  body: 'placeholder-body',
  outfit: 'placeholder-outfit-tee',
  face: 'placeholder-face-oval',
  blush: 'placeholder-blush-soft',
  eyes: 'placeholder-eyes-round',
  brows: 'placeholder-brows-soft',
  mouth: 'placeholder-mouth-smile',
  'hair-front': 'placeholder-hair-front-bangs',
};

export function starterCharacter(doc: Doc): Character {
  const pose = doc.project.poses[0]?.id ?? '';
  const c = newCharacter('My first character', pose);
  const byName = new Map(Object.values(doc.parts).map((p) => [p.name, p]));
  for (const cat of doc.project.categories) {
    const name = STARTER_LOOK[cat.id];
    const part = name ? byName.get(name) : undefined;
    if (part) c.items.push(newInstance(part.id, cat.colorGroupId, 0));
  }
  const pal = PRESET_PALETTES[1];
  for (const g of doc.project.colorGroups) {
    const hex = g.role === 'hair' ? pal.hair : g.role === 'skin' ? pal.skin : g.role === 'eyes' ? pal.eyes : g.role === 'outfit' ? pal.outfit : pal.accent;
    c.groupColors[g.id] = tintColor(hex, pal.line);
  }
  return c;
}
