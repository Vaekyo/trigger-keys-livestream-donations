// Color math helpers (no DOM).

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function isHex(s: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
}

export function normalizeHex(s: string): string {
  const [r, g, b] = hexToRgb(s);
  return rgbToHex(r, g, b);
}

/** h: 0..360, s,v: 0..1 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function hexToHsv(hex: string): [number, number, number] {
  return rgbToHsv(...hexToRgb(hex));
}

export function hsvToHex(h: number, s: number, v: number): string {
  return rgbToHex(...hsvToRgb(h, s, v));
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/** Relative luminance-ish (0..1) used to pick readable text colors. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Hue/saturation/brightness shift applied in place to RGBA pixels.
 * h: degrees -180..180, s and b: -100..100 (percent).
 */
export function shiftPixels(data: Uint8ClampedArray, h: number, s: number, b: number): void {
  const sf = 1 + s / 100;
  const bf = b / 100;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let [hh, ss, vv] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    hh += h;
    ss = Math.max(0, Math.min(1, ss * sf));
    vv = bf >= 0 ? vv + (1 - vv) * bf : vv * (1 + bf);
    const [r, g, bb] = hsvToRgb(hh, ss, vv);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = bb;
  }
}

/** Multiply tint: white → color, grays → shaded color. Alpha untouched. */
export function tintPixels(data: Uint8ClampedArray, color: RGB): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (data[i] * color[0]) / 255;
    data[i + 1] = (data[i + 1] * color[1]) / 255;
    data[i + 2] = (data[i + 2] * color[2]) / 255;
  }
}

/** Screen recolor for line art: black → color, white stays white. */
export function linePixels(data: Uint8ClampedArray, color: RGB): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0] + ((255 - color[0]) * data[i]) / 255;
    data[i + 1] = color[1] + ((255 - color[1]) * data[i + 1]) / 255;
    data[i + 2] = color[2] + ((255 - color[2]) * data[i + 2]) / 255;
  }
}
