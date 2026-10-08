import { describe, expect, it } from 'vitest';
import { computeFill } from '../src/features/trace/floodFill';

const W = 60;
const H = 60;

function square(gapSize: number): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let i = 10; i <= 50; i++) {
    for (const [x, y] of [
      [i, 10],
      [i, 50],
      [10, i],
      [50, i],
    ]) {
      // leave a gap on the top edge
      if (y === 10 && x >= 30 && x < 30 + gapSize) continue;
      a[y * W + x] = 255;
    }
  }
  return a;
}

describe('make fill', () => {
  it('fills a closed shape without leaking', () => {
    const r = computeFill(square(0), W, H, 30, 30, 0)!;
    expect(r.touchesEdge).toBe(false);
    expect(r.mask[30 * W + 30]).toBe(1);
    expect(r.mask[5 * W + 5]).toBe(0);
  });

  it('leaks through a gap when gap close is off', () => {
    const r = computeFill(square(3), W, H, 30, 30, 0)!;
    expect(r.touchesEdge).toBe(true);
  });

  it('closes small gaps with the tolerance', () => {
    const r = computeFill(square(3), W, H, 30, 30, 3)!;
    expect(r.touchesEdge).toBe(false);
    expect(r.mask[30 * W + 30]).toBe(1);
    expect(r.mask[5 * W + 30]).toBe(0);
    // grown back so the fill reaches the line
    expect(r.mask[11 * W + 20]).toBe(1);
  });

  it('clicking on a line still finds the inside', () => {
    const r = computeFill(square(0), W, H, 11, 30, 0);
    expect(r).not.toBeNull();
  });
});
