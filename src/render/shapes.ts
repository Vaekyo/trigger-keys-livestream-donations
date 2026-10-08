// Vector "shape" elements: speech bubbles, text and simple effect stickers.
// They are drawn directly (not cached) so they stay crisp at any zoom/export scale.

import type { ShapeKind, ShapeSpec } from '../model/types';

export const SHAPE_FONT = `'Comic Neue', 'Comic Sans MS', 'Hiragino Maru Gothic ProN', 'Yu Gothic UI', 'Segoe UI', system-ui, sans-serif`;

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  bubble: 'Speech bubble',
  shout: 'Shout bubble',
  thought: 'Thought bubble',
  text: 'Text',
  sparkle: 'Sparkles',
  sweat: 'Sweat drop',
  anger: 'Anger mark',
  heart: 'Heart',
  star: 'Star',
  note: 'Music note',
  lines: 'Surprise lines',
};

export function defaultShape(kind: ShapeKind, category: string): ShapeSpec {
  const base: ShapeSpec = {
    kind,
    category,
    text: '',
    fontSize: 44,
    fill: '#ffffff',
    stroke: '#2b2140',
    textColor: '#2b2140',
    tail: 120,
    w: 160,
    h: 160,
  };
  switch (kind) {
    case 'bubble':
      return { ...base, text: 'Hello!', w: 420, h: 260 };
    case 'shout':
      return { ...base, text: 'WHAT?!', w: 440, h: 300, fill: '#fff6a8' };
    case 'thought':
      return { ...base, text: 'Hmm…', w: 400, h: 260 };
    case 'text':
      return { ...base, text: 'Text', w: 360, h: 120, fontSize: 64, fill: '#ffffff', stroke: '#2b2140', textColor: '#ff6fa8' };
    case 'sparkle':
      return { ...base, fill: '#fff3a0', stroke: '#e0a800' };
    case 'sweat':
      return { ...base, w: 90, h: 130, fill: '#9fd8ff', stroke: '#3a7fc0' };
    case 'anger':
      return { ...base, w: 130, h: 130, fill: '#ff4d6d', stroke: '#ff4d6d' };
    case 'heart':
      return { ...base, fill: '#ff7eb6', stroke: '#c2185b' };
    case 'star':
      return { ...base, fill: '#ffd54f', stroke: '#e0a800' };
    case 'note':
      return { ...base, w: 110, h: 150, fill: '#2b2140', stroke: '#2b2140' };
    case 'lines':
      return { ...base, w: 180, h: 140, fill: '#2b2140', stroke: '#2b2140' };
  }
}

export function shapeHasText(kind: ShapeKind): boolean {
  return kind === 'bubble' || kind === 'shout' || kind === 'thought' || kind === 'text';
}

function wrapText(x: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (x.measureText(test).width > maxW && cur.trim()) {
        out.push(cur.trim());
        cur = w.trimStart();
      } else cur = test;
    }
    out.push(cur.trim());
  }
  return out;
}

function drawText(x: CanvasRenderingContext2D, s: ShapeSpec, cx: number, cy: number, maxW: number, outline: boolean) {
  if (!s.text) return;
  x.font = `700 ${s.fontSize}px ${SHAPE_FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const lines = wrapText(x, s.text, maxW);
  const lh = s.fontSize * 1.15;
  const y0 = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) => {
    if (outline) {
      x.lineJoin = 'round';
      x.lineWidth = Math.max(4, s.fontSize * 0.18);
      x.strokeStyle = s.stroke;
      x.strokeText(ln, cx, y0 + i * lh);
    }
    x.fillStyle = s.textColor;
    x.fillText(ln, cx, y0 + i * lh);
  });
}

function starPath(x: CanvasRenderingContext2D, cx: number, cy: number, n: number, r1: number, r2: number, rot = -Math.PI / 2) {
  x.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = rot + (i * Math.PI) / n;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) x.moveTo(px, py);
    else x.lineTo(px, py);
  }
  x.closePath();
}

function sparklePath(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.beginPath();
  x.moveTo(cx, cy - r);
  x.quadraticCurveTo(cx, cy, cx + r, cy);
  x.quadraticCurveTo(cx, cy, cx, cy + r);
  x.quadraticCurveTo(cx, cy, cx - r, cy);
  x.quadraticCurveTo(cx, cy, cx, cy - r);
  x.closePath();
}

function heartPath(x: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  const top = cy - h * 0.3;
  x.beginPath();
  x.moveTo(cx, cy + h * 0.45);
  x.bezierCurveTo(cx - w * 0.6, cy + h * 0.05, cx - w * 0.5, top - h * 0.35, cx, top);
  x.bezierCurveTo(cx + w * 0.5, top - h * 0.35, cx + w * 0.6, cy + h * 0.05, cx, cy + h * 0.45);
  x.closePath();
}

/** Draw a shape into its own frame (0,0)–(w,h). */
export function drawShape(x: CanvasRenderingContext2D, s: ShapeSpec) {
  const { w, h } = s;
  const cx = w / 2;
  const cy = h / 2;
  const lw = Math.max(3, Math.min(w, h) * 0.025);
  x.save();
  x.lineJoin = 'round';
  x.lineCap = 'round';
  x.lineWidth = lw;
  x.fillStyle = s.fill;
  x.strokeStyle = s.stroke;
  const tailRad = (s.tail * Math.PI) / 180;
  switch (s.kind) {
    case 'bubble': {
      const rx = w * 0.44;
      const ry = h * 0.38;
      const d = 0.22;
      const tip: [number, number] = [cx + Math.cos(tailRad) * rx * 1.25, cy + Math.sin(tailRad) * ry * 1.4];
      x.beginPath();
      x.ellipse(cx, cy, rx, ry, 0, tailRad + d, tailRad - d + Math.PI * 2);
      x.lineTo(...tip);
      x.closePath();
      x.fill();
      x.stroke();
      drawText(x, s, cx, cy, rx * 1.5, false);
      break;
    }
    case 'shout': {
      const n = 16;
      x.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = (i * Math.PI) / n;
        let k = i % 2 === 0 ? 0.5 : 0.38;
        const diff = Math.abs(((a - tailRad + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (i % 2 === 0 && diff < 0.2) k = 0.62;
        const px = cx + Math.cos(a) * w * k * 0.96;
        const py = cy + Math.sin(a) * h * k * 0.96;
        if (i === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.closePath();
      x.fill();
      x.stroke();
      drawText(x, s, cx, cy, w * 0.6, false);
      break;
    }
    case 'thought': {
      const rx = w * 0.4;
      const ry = h * 0.33;
      const bumps = 11;
      x.beginPath();
      for (let i = 0; i < bumps; i++) {
        const a = (i / bumps) * Math.PI * 2;
        const bx = cx + Math.cos(a) * rx;
        const by = cy + Math.sin(a) * ry;
        x.moveTo(bx + Math.min(rx, ry) * 0.42, by);
        x.arc(bx, by, Math.min(rx, ry) * 0.42, 0, Math.PI * 2);
      }
      x.stroke();
      x.fill();
      x.beginPath();
      x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      x.fill();
      for (let i = 1; i <= 2; i++) {
        const r = Math.min(w, h) * (0.06 - i * 0.015);
        const bx = cx + Math.cos(tailRad) * (rx + ry * (0.45 + i * 0.3));
        const by = cy + Math.sin(tailRad) * (ry + ry * (0.45 + i * 0.3));
        x.beginPath();
        x.arc(bx, by, r, 0, Math.PI * 2);
        x.fill();
        x.stroke();
      }
      drawText(x, s, cx, cy, rx * 1.5, false);
      break;
    }
    case 'text':
      drawText(x, s, cx, cy, w * 0.95, true);
      break;
    case 'sparkle':
      sparklePath(x, w * 0.4, h * 0.42, Math.min(w, h) * 0.36);
      x.fill();
      x.stroke();
      sparklePath(x, w * 0.8, h * 0.78, Math.min(w, h) * 0.16);
      x.fill();
      x.stroke();
      sparklePath(x, w * 0.82, h * 0.2, Math.min(w, h) * 0.1);
      x.fill();
      x.stroke();
      break;
    case 'sweat': {
      x.beginPath();
      x.moveTo(cx, h * 0.06);
      x.bezierCurveTo(cx + w * 0.1, h * 0.35, cx + w * 0.42, h * 0.55, cx + w * 0.4, h * 0.72);
      x.arc(cx, h * 0.72, w * 0.4, 0, Math.PI);
      x.bezierCurveTo(cx - w * 0.42, h * 0.55, cx - w * 0.1, h * 0.35, cx, h * 0.06);
      x.closePath();
      x.fill();
      x.stroke();
      x.beginPath();
      x.fillStyle = 'rgba(255,255,255,0.85)';
      x.ellipse(cx - w * 0.15, h * 0.7, w * 0.08, h * 0.1, 0.4, 0, Math.PI * 2);
      x.fill();
      break;
    }
    case 'anger': {
      x.lineWidth = Math.min(w, h) * 0.11;
      x.strokeStyle = s.fill;
      const r = Math.min(w, h) * 0.32;
      const g = Math.min(w, h) * 0.09;
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        x.beginPath();
        const ox = cx + sx * g;
        const oy = cy + sy * g;
        x.moveTo(ox + sx * r, oy + sy * r * 0.18);
        x.quadraticCurveTo(ox + sx * r * 0.2, oy + sy * r * 0.2, ox + sx * r * 0.18, oy + sy * r);
        x.stroke();
      }
      break;
    }
    case 'heart':
      heartPath(x, cx, cy, w * 0.95, h * 0.95);
      x.fill();
      x.stroke();
      break;
    case 'star':
      starPath(x, cx, cy * 1.05, 5, Math.min(w, h) * 0.46, Math.min(w, h) * 0.2);
      x.fill();
      x.stroke();
      break;
    case 'note': {
      x.fillStyle = s.fill;
      x.beginPath();
      x.ellipse(w * 0.3, h * 0.8, w * 0.2, h * 0.11, -0.4, 0, Math.PI * 2);
      x.fill();
      x.lineWidth = w * 0.08;
      x.strokeStyle = s.fill;
      x.beginPath();
      x.moveTo(w * 0.47, h * 0.78);
      x.lineTo(w * 0.47, h * 0.1);
      x.quadraticCurveTo(w * 0.6, h * 0.3, w * 0.9, h * 0.35);
      x.stroke();
      break;
    }
    case 'lines': {
      x.strokeStyle = s.fill;
      x.lineWidth = Math.min(w, h) * 0.07;
      const segs: [number, number, number, number][] = [
        [0.5, 0.1, 0.5, 0.42],
        [0.15, 0.3, 0.32, 0.55],
        [0.85, 0.3, 0.68, 0.55],
      ];
      for (const [a, b, c, d] of segs) {
        x.beginPath();
        x.moveTo(a * w, b * h);
        x.lineTo(c * w, d * h);
        x.stroke();
      }
      break;
    }
  }
  x.restore();
}
