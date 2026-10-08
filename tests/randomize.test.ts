import { describe, expect, it } from 'vitest';
import { randomizeCharacter } from '../src/features/randomize/randomize';
import { charWith, makeDoc, part } from './fixtures';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const parts = [
  part('eyesA', 'eyes'),
  part('eyesB', 'eyes', { favorite: true }),
  part('faceA', 'face'),
  part('pin1', 'head-accessory'),
  part('pin2', 'head-accessory'),
  part('pin3', 'head-accessory'),
  part('mouthA', 'mouth'),
];

describe('randomize', () => {
  it('keeps single-choice categories to at most one part and fills required ones', () => {
    const doc = makeDoc(parts);
    for (let s = 1; s < 30; s++) {
      const c = randomizeCharacter(doc, charWith([['eyesA', '']]), { mode: 'parts', rng: seeded(s) });
      const eyes = c.items.filter((i) => doc.parts[i.partId].categoryId === 'eyes');
      const face = c.items.filter((i) => doc.parts[i.partId].categoryId === 'face');
      expect(eyes.length).toBe(1); // eyes do not allow none
      expect(face.length).toBe(1);
      const pins = c.items.filter((i) => doc.parts[i.partId].categoryId === 'head-accessory');
      expect(new Set(pins.map((p) => p.partId)).size).toBe(pins.length);
    }
  });

  it('leaves locked categories alone', () => {
    const doc = makeDoc(parts);
    const before = charWith([['eyesA', '']]);
    for (let s = 1; s < 20; s++) {
      const c = randomizeCharacter(doc, before, { mode: 'parts', locked: new Set(['eyes']), rng: seeded(s) });
      expect(c.items.find((i) => doc.parts[i.partId].categoryId === 'eyes')!.partId).toBe('eyesA');
    }
  });

  it('surprise me only uses favorites', () => {
    const doc = makeDoc(parts);
    for (let s = 1; s < 20; s++) {
      const c = randomizeCharacter(doc, charWith([['eyesA', '']]), { mode: 'parts', favoritesOnly: true, rng: seeded(s) });
      expect(c.items.find((i) => doc.parts[i.partId].categoryId === 'eyes')!.partId).toBe('eyesB');
    }
  });

  it('colors-only keeps the parts', () => {
    const doc = makeDoc(parts);
    const before = charWith([['eyesA', ''], ['faceA', '']]);
    const c = randomizeCharacter(doc, before, { mode: 'colors', rng: seeded(3) });
    expect(c.items.map((i) => i.partId)).toEqual(['eyesA', 'faceA']);
    expect(Object.keys(c.groupColors).length).toBeGreaterThan(0);
  });
});
