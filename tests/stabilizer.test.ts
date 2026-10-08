import { describe, expect, it } from 'vitest';
import { stabilize, Stabilizer, type Pt } from '../src/features/trace/stabilizer';

function jitteryLine(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 200; i++) pts.push({ x: i * 2, y: 100 + (i % 2 ? 4 : -4), p: 1 });
  return pts;
}

describe('stabilizer', () => {
  it('keeps the start and end points', () => {
    const raw = jitteryLine();
    const out = stabilize(raw, 60);
    expect(out[0].x).toBeCloseTo(raw[0].x, 5);
    expect(out[0].y).toBeCloseTo(raw[0].y, 5);
    const last = out[out.length - 1];
    expect(last.x).toBeCloseTo(raw[raw.length - 1].x, 1);
    expect(last.y).toBeCloseTo(raw[raw.length - 1].y, 1);
  });

  it('removes jitter', () => {
    const out = stabilize(jitteryLine(), 60);
    const middle = out.slice(50, out.length - 50);
    const maxDev = Math.max(...middle.map((p) => Math.abs(p.y - 100)));
    expect(maxDev).toBeLessThan(1);
  });

  it('strength 0 follows the input', () => {
    const raw = jitteryLine();
    const out = stabilize(raw, 0);
    const maxDev = Math.max(...out.map((p) => Math.abs(p.y - 100)));
    expect(maxDev).toBeGreaterThan(3);
  });

  it('emits points incrementally that match the batch result', () => {
    const raw = jitteryLine();
    const s = new Stabilizer(40);
    const live: Pt[] = [];
    for (const p of raw) live.push(...s.push(p));
    live.push(...s.finish());
    const batch = stabilize(raw, 40);
    expect(live.length).toBe(batch.length);
    expect(live[120].y).toBeCloseTo(batch[120].y, 6);
  });
});
