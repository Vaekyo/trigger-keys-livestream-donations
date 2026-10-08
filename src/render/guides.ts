// Template guides (generated bust/full-body proportions), grid and symmetry line.

import type { GuideStyle } from '../model/types';
import { peekImage } from '../db/assets';

/** Key landmarks of the generated bust template, in canvas pixels. */
export interface Anchors {
  u: number;
  cx: number;
  headCy: number;
  headRx: number;
  headRy: number;
  hairTop: number;
  browY: number;
  eyeY: number;
  eyeDx: number;
  noseY: number;
  mouthY: number;
  chinY: number;
  earY: number;
  neckTop: number;
  neckBottom: number;
  neckHalf: number;
  shoulderY: number;
  shoulderHalf: number;
}

export function anchors(W: number, H: number): Anchors {
  const u = Math.min(W, H / 1.6) / 1000;
  const cx = W / 2;
  const headCy = H * 0.325;
  return {
    u,
    cx,
    headCy,
    headRx: 190 * u,
    headRy: 240 * u,
    hairTop: headCy - 285 * u,
    browY: headCy - 45 * u,
    eyeY: headCy + 35 * u,
    eyeDx: 85 * u,
    noseY: headCy + 115 * u,
    mouthY: headCy + 165 * u,
    chinY: headCy + 240 * u,
    earY: headCy + 70 * u,
    neckTop: headCy + 180 * u,
    neckBottom: headCy + 400 * u,
    neckHalf: 55 * u,
    shoulderY: headCy + 440 * u,
    shoulderHalf: 400 * u,
  };
}

/** Where a newly imported, un-aligned image of a category should land (center point). */
export function categoryAnchor(categoryId: string, W: number, H: number): [number, number] {
  const a = anchors(W, H);
  switch (categoryId) {
    case 'hair-back':
      return [a.cx, a.headCy + 60 * a.u];
    case 'body':
      return [a.cx, (a.neckTop + H) / 2];
    case 'outfit':
      return [a.cx, (a.shoulderY + H) / 2];
    case 'neck-accessory':
      return [a.cx, a.neckBottom - 20 * a.u];
    case 'face':
      return [a.cx, a.headCy];
    case 'blush':
      return [a.cx, a.eyeY + 70 * a.u];
    case 'eyes':
    case 'glasses':
      return [a.cx, a.eyeY];
    case 'brows':
      return [a.cx, a.browY];
    case 'mouth':
      return [a.cx, a.mouthY];
    case 'hair-front':
      return [a.cx, a.headCy - 100 * a.u];
    case 'earrings':
      return [a.cx, a.earY + 60 * a.u];
    case 'head-accessory':
      return [a.cx + 120 * a.u, a.hairTop + 60 * a.u];
    default:
      return [W / 2, H / 2];
  }
}

function ellipse(x: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rot = 0) {
  x.beginPath();
  x.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  x.stroke();
}

function line(x: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  x.beginPath();
  x.moveTo(x1, y1);
  x.lineTo(x2, y2);
  x.stroke();
}

function drawBust(x: CanvasRenderingContext2D, W: number, H: number, threeQuarter: boolean, px: number) {
  const a = anchors(W, H);
  const turn = threeQuarter ? 1 : 0;
  const shift = turn * 22 * a.u;
  x.lineWidth = 2 * px;
  // head
  ellipse(x, a.cx + shift, a.headCy, a.headRx - turn * 10 * a.u, a.headRy);
  // hair volume
  x.setLineDash([10 * px, 8 * px]);
  ellipse(x, a.cx + shift * 0.5, a.headCy - 30 * a.u, a.headRx + 50 * a.u, a.headRy + 30 * a.u);
  x.setLineDash([]);
  // face center line (curves for 3/4)
  x.beginPath();
  if (threeQuarter) {
    const ox = a.cx + 70 * a.u;
    x.moveTo(ox - 10 * a.u, a.headCy - a.headRy);
    x.quadraticCurveTo(ox + 40 * a.u, a.headCy, ox - 5 * a.u, a.chinY);
  } else {
    x.moveTo(a.cx, a.headCy - a.headRy - 20 * a.u);
    x.lineTo(a.cx, a.chinY + 10 * a.u);
  }
  x.stroke();
  // horizontal landmarks
  x.setLineDash([4 * px, 6 * px]);
  for (const y of [a.browY, a.eyeY, a.noseY, a.mouthY]) line(x, a.cx - a.headRx - 30 * a.u, y, a.cx + a.headRx + 30 * a.u, y);
  x.setLineDash([]);
  // eyes
  const eyeShift = threeQuarter ? 45 * a.u : 0;
  ellipse(x, a.cx - a.eyeDx + eyeShift, a.eyeY, (threeQuarter ? 40 : 48) * a.u, 30 * a.u);
  ellipse(x, a.cx + a.eyeDx + eyeShift, a.eyeY, 48 * a.u, 30 * a.u);
  // ears
  if (!threeQuarter) ellipse(x, a.cx + a.headRx - 4 * a.u, a.earY, 18 * a.u, 40 * a.u);
  ellipse(x, a.cx - a.headRx + (threeQuarter ? 40 * a.u : 4 * a.u), a.earY, 18 * a.u, 40 * a.u);
  // neck
  line(x, a.cx - a.neckHalf + shift, a.neckTop, a.cx - a.neckHalf, a.neckBottom);
  line(x, a.cx + a.neckHalf + shift, a.neckTop, a.cx + a.neckHalf, a.neckBottom);
  // shoulders / torso
  x.beginPath();
  x.moveTo(a.cx - a.neckHalf, a.neckBottom);
  x.quadraticCurveTo(a.cx - a.shoulderHalf * 0.6, a.shoulderY - 20 * a.u, a.cx - a.shoulderHalf, a.shoulderY + 120 * a.u);
  x.lineTo(a.cx - a.shoulderHalf - 30 * a.u, H);
  x.moveTo(a.cx + a.neckHalf, a.neckBottom);
  x.quadraticCurveTo(a.cx + a.shoulderHalf * 0.6, a.shoulderY - 20 * a.u, a.cx + a.shoulderHalf, a.shoulderY + 120 * a.u);
  x.lineTo(a.cx + a.shoulderHalf + 30 * a.u, H);
  x.stroke();
  // chest line
  x.setLineDash([4 * px, 6 * px]);
  line(x, a.cx - 160 * a.u, a.shoulderY + 260 * a.u, a.cx + 160 * a.u, a.shoulderY + 260 * a.u);
  x.setLineDash([]);
}

function drawFullBody(x: CanvasRenderingContext2D, W: number, H: number, px: number) {
  const head = H / 8.5;
  const cx = W / 2;
  const top = head * 0.3;
  x.lineWidth = 2 * px;
  ellipse(x, cx, top + head / 2, head * 0.4, head / 2);
  x.setLineDash([4 * px, 6 * px]);
  for (let i = 1; i <= 8; i++) line(x, cx - head * 1.6, top + i * head, cx + head * 1.6, top + i * head);
  x.setLineDash([]);
  line(x, cx, top, cx, top + 8 * head);
  const sh = top + head * 1.4;
  line(x, cx - head * 0.9, sh, cx + head * 0.9, sh);
  line(x, cx - head * 0.9, sh, cx - head * 1.1, top + head * 4);
  line(x, cx + head * 0.9, sh, cx + head * 1.1, top + head * 4);
  const hip = top + head * 3.6;
  line(x, cx - head * 0.6, hip, cx + head * 0.6, hip);
  line(x, cx - head * 0.4, hip, cx - head * 0.5, top + head * 8);
  line(x, cx + head * 0.4, hip, cx + head * 0.5, top + head * 8);
}

/**
 * Draws the template guide for a pose into canvas space.
 * `px` = size of one screen pixel in canvas units (keeps lines thin at any zoom).
 */
export function drawTemplate(
  x: CanvasRenderingContext2D,
  W: number,
  H: number,
  style: GuideStyle,
  guideImage: string | undefined,
  px: number,
  color = 'rgba(80,170,255,0.9)',
) {
  x.save();
  if (guideImage) {
    const img = peekImage(guideImage);
    if (img) x.drawImage(img, 0, 0, W, H);
    x.restore();
    return;
  }
  x.strokeStyle = color;
  x.fillStyle = 'transparent';
  if (style === 'front') drawBust(x, W, H, false, px);
  else if (style === 'three-quarter') drawBust(x, W, H, true, px);
  else if (style === 'full-body') drawFullBody(x, W, H, px);
  x.restore();
}

export function drawGrid(x: CanvasRenderingContext2D, W: number, H: number, size: number, px: number) {
  x.save();
  x.lineWidth = px;
  x.strokeStyle = 'rgba(127,127,160,0.35)';
  x.beginPath();
  for (let gx = size; gx < W; gx += size) {
    x.moveTo(gx, 0);
    x.lineTo(gx, H);
  }
  for (let gy = size; gy < H; gy += size) {
    x.moveTo(0, gy);
    x.lineTo(W, gy);
  }
  x.stroke();
  x.restore();
}

export function drawSymmetry(x: CanvasRenderingContext2D, sx: number, H: number, px: number) {
  x.save();
  x.lineWidth = 1.5 * px;
  x.strokeStyle = 'rgba(255,90,170,0.9)';
  x.setLineDash([8 * px, 6 * px]);
  line(x, sx, 0, sx, H);
  x.restore();
}
