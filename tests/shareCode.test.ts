import { describe, expect, it } from 'vitest';
import { decodeShareCode, encodeShareCode, encodeShareJson } from '../src/io/shareCode';
import { charWith, makeDoc, part } from './fixtures';
import { tintColor } from '../src/model/defaults';

describe('share codes', () => {
  const doc = makeDoc([part('eyesA', 'eyes'), part('faceA', 'face')]);
  const c = charWith([['eyesA', ''], ['faceA', '']]);
  c.items[0] = { ...c.items[0], dx: 12, flipX: true, colorGroupId: 'eyes' };
  c.groupColors = { eyes: tintColor('#123456', '#222222') };

  it('round-trips a character', () => {
    const code = encodeShareCode(doc, c);
    expect(code.startsWith('PCM1.')).toBe(true);
    const { character, missing } = decodeShareCode(doc, code);
    expect(missing).toEqual([]);
    expect(character.items.map((i) => i.partId)).toEqual(['eyesA', 'faceA']);
    expect(character.items[0].dx).toBe(12);
    expect(character.items[0].flipX).toBe(true);
    expect(character.groupColors.eyes.fill).toBe('#123456');
  });

  it('accepts readable JSON too', () => {
    const { character } = decodeShareCode(doc, encodeShareJson(doc, c));
    expect(character.items.length).toBe(2);
  });

  it('falls back to part names and reports missing parts', () => {
    const other = makeDoc([{ ...part('different-id', 'eyes'), name: 'eyesA' }]);
    const { character, missing } = decodeShareCode(other, encodeShareCode(doc, c));
    expect(character.items.map((i) => i.partId)).toEqual(['different-id']);
    expect(missing).toEqual(['faceA']);
  });

  it('rejects garbage', () => {
    expect(() => decodeShareCode(doc, 'hello')).toThrow();
  });
});
