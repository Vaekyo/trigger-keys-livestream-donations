// Stroke stabilizer.
//
// Raw pointer samples are resampled to an even 1px spacing, then smoothed with
// a centered Gaussian window. The window shrinks near both ends, so the stroke
// still starts and ends exactly where the pen touched down and lifted. Because
// the window is centered (not trailing), corners are not dragged behind the
// cursor — shaky lines just become clean.

export interface Pt {
  x: number;
  y: number;
  p: number;
}

export class Stabilizer {
  private raw: Pt[] = [];
  private emitted = 0;
  private readonly half: number;
  private readonly weights: number[];

  /**
   * strength 0..100. `zoom` = screen px per canvas px: hand shake happens on
   * screen, so the smoothing window is measured in screen pixels.
   */
  constructor(strength: number, zoom = 1) {
    const screenHalf = (Math.max(0, Math.min(100, strength)) / 100) * 40;
    this.half = Math.min(400, Math.round(screenHalf / Math.max(0.05, zoom)));
    const sigma = Math.max(1, this.half / 2);
    this.weights = [];
    for (let k = 0; k <= this.half; k++) this.weights.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  }

  private resampleTo(p: Pt) {
    const last = this.raw[this.raw.length - 1];
    if (!last) {
      this.raw.push({ ...p });
      return;
    }
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    if (d < 1) {
      // keep pressure responsive even when not moving far
      last.p = (last.p + p.p) / 2;
      return;
    }
    const steps = Math.floor(d);
    for (let i = 1; i <= steps; i++) {
      const t = i / d;
      this.raw.push({ x: last.x + (p.x - last.x) * t, y: last.y + (p.y - last.y) * t, p: last.p + (p.p - last.p) * t });
    }
    this.tail = { ...p };
  }

  /** The exact last pointer position (may fall between 1px samples). */
  private tail: Pt | null = null;

  private smooth(i: number): Pt {
    const n = this.raw.length;
    const k = Math.min(this.half, i, n - 1 - i);
    if (k <= 0) return { ...this.raw[i] };
    let sx = 0,
      sy = 0,
      sp = 0,
      sw = 0;
    for (let j = -k; j <= k; j++) {
      const w = this.weights[Math.abs(j)];
      const q = this.raw[i + j];
      sx += q.x * w;
      sy += q.y * w;
      sp += q.p * w;
      sw += w;
    }
    return { x: sx / sw, y: sy / sw, p: sp / sw };
  }

  /** Add a raw sample; returns smoothed points that are now final. */
  push(p: Pt): Pt[] {
    this.resampleTo(p);
    const out: Pt[] = [];
    // a point is final once a full half-window of samples exists after it
    while (this.emitted + this.half <= this.raw.length - 1) {
      out.push(this.smooth(this.emitted));
      this.emitted++;
    }
    return out;
  }

  /** Stroke finished: flush the remaining points (converging on the last sample). */
  finish(): Pt[] {
    const out: Pt[] = [];
    const last = this.raw[this.raw.length - 1];
    if (this.tail && last && Math.hypot(this.tail.x - last.x, this.tail.y - last.y) > 0.01) this.raw.push(this.tail);
    this.tail = null;
    while (this.emitted < this.raw.length) {
      out.push(this.smooth(this.emitted));
      this.emitted++;
    }
    return out;
  }

  get count() {
    return this.raw.length;
  }
}

/** Convenience: smooth a whole list of points at once. */
export function stabilize(points: Pt[], strength: number, zoom = 1): Pt[] {
  const s = new Stabilizer(strength, zoom);
  const out: Pt[] = [];
  for (const p of points) out.push(...s.push(p));
  out.push(...s.finish());
  return out;
}
