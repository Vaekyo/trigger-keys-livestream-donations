import type { BackgroundSpec } from '../model/types';
import { peekImage } from '../db/assets';
import { makeGradient } from './partRender';

function heart(x: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  x.beginPath();
  x.moveTo(cx, cy + s * 0.45);
  x.bezierCurveTo(cx - s * 0.6, cy + s * 0.05, cx - s * 0.5, cy - s * 0.65, cx, cy - s * 0.3);
  x.bezierCurveTo(cx + s * 0.5, cy - s * 0.65, cx + s * 0.6, cy + s * 0.05, cx, cy + s * 0.45);
  x.fill();
}

function star(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) x.moveTo(px, py);
    else x.lineTo(px, py);
  }
  x.closePath();
  x.fill();
}

/** Returns false if an image background is still loading. */
export function drawBackground(x: CanvasRenderingContext2D, bg: BackgroundSpec, W: number, H: number): boolean {
  if (bg.type === 'none') return true;
  x.save();
  let complete = true;
  if (bg.type === 'solid') {
    x.fillStyle = bg.color;
    x.fillRect(0, 0, W, H);
  } else if (bg.type === 'gradient') {
    x.fillStyle = makeGradient(x, W, H, bg.color, { color2: bg.color2, angle: bg.angle, start: 0, end: 1 });
    x.fillRect(0, 0, W, H);
  } else if (bg.type === 'image') {
    x.fillStyle = bg.color;
    x.fillRect(0, 0, W, H);
    const img = bg.image ? peekImage(bg.image) : undefined;
    if (bg.image && !img) complete = false;
    if (img) {
      const k = Math.max(W / img.width, H / img.height);
      const iw = img.width * k;
      const ih = img.height * k;
      x.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);
    }
  } else if (bg.type === 'pattern') {
    x.fillStyle = bg.color;
    x.fillRect(0, 0, W, H);
    x.fillStyle = bg.color2;
    x.strokeStyle = bg.color2;
    const s = 60 * Math.max(0.25, bg.patternScale) * (Math.min(W, H) / 1000);
    switch (bg.pattern) {
      case 'dots':
        for (let row = 0, y = s / 2; y < H + s; y += s, row++)
          for (let px = row % 2 ? s : s / 2; px < W + s; px += s) {
            x.beginPath();
            x.arc(px, y, s * 0.16, 0, Math.PI * 2);
            x.fill();
          }
        break;
      case 'stripes':
        x.lineWidth = s * 0.35;
        x.beginPath();
        for (let o = -H; o < W + H; o += s) {
          x.moveTo(o, 0);
          x.lineTo(o + H, H);
        }
        x.stroke();
        break;
      case 'checks':
        x.globalAlpha = 0.5;
        for (let y = 0; y < H; y += s * 2) x.fillRect(0, y, W, s);
        for (let px = 0; px < W; px += s * 2) x.fillRect(px, 0, s, H);
        break;
      case 'grid':
        x.lineWidth = Math.max(1, s * 0.05);
        x.beginPath();
        for (let px = 0; px <= W; px += s) {
          x.moveTo(px, 0);
          x.lineTo(px, H);
        }
        for (let y = 0; y <= H; y += s) {
          x.moveTo(0, y);
          x.lineTo(W, y);
        }
        x.stroke();
        break;
      case 'hearts':
        for (let row = 0, y = s; y < H + s; y += s * 1.4, row++)
          for (let px = row % 2 ? s * 1.4 : s * 0.7; px < W + s; px += s * 1.4) heart(x, px, y, s * 0.5);
        break;
      case 'stars':
        for (let row = 0, y = s; y < H + s; y += s * 1.4, row++)
          for (let px = row % 2 ? s * 1.4 : s * 0.7; px < W + s; px += s * 1.4) star(x, px, y, s * 0.32);
        break;
      case 'sunburst': {
        const rays = 24;
        const cx = W / 2;
        const cy = H * 0.35;
        const R = Math.hypot(W, H);
        for (let i = 0; i < rays; i += 2) {
          const a1 = (i / rays) * Math.PI * 2;
          const a2 = ((i + 1) / rays) * Math.PI * 2;
          x.beginPath();
          x.moveTo(cx, cy);
          x.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
          x.lineTo(cx + Math.cos(a2) * R, cy + Math.sin(a2) * R);
          x.closePath();
          x.fill();
        }
        break;
      }
    }
  }
  x.restore();
  return complete;
}
