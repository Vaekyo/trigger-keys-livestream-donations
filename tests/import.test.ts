import { describe, expect, it } from 'vitest';
import { groupFiles, roleOf } from '../src/io/importFiles';
import { guessCategory } from '../src/features/library/filter';
import { defaultCategories } from '../src/model/defaults';

const f = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' });

describe('import helpers', () => {
  it('detects line/fill roles', () => {
    expect(roleOf('hair_line')).toEqual({ role: 'line', base: 'hair' });
    expect(roleOf('hair-front-fill')).toEqual({ role: 'fill', base: 'hair-front' });
    expect(roleOf('eyes round').role).toBe('flat');
  });

  it('pairs line + fill files into one part', () => {
    const groups = groupFiles([f('bangs_line.png'), f('eyes.png'), f('bangs_fill.png'), f('lonely_line.png')]);
    const pair = groups.find((g) => g.name === 'bangs')!;
    expect(pair.files.line?.name).toBe('bangs_line.png');
    expect(pair.files.fill?.name).toBe('bangs_fill.png');
    expect(groups.find((g) => g.name === 'lonely_line')!.files.flat).toBeDefined();
    expect(groups.length).toBe(3);
  });

  it('guesses categories from file names', () => {
    const cats = defaultCategories();
    expect(guessCategory('eyes_round.png', cats)).toBe('eyes');
    expect(guessCategory('eyebrows-angry.png', cats)).toBe('brows');
    expect(guessCategory('hair_front_bangs.png', cats)).toBe('hair-front');
    expect(guessCategory('back-hair-long.png', cats)).toBe('hair-back');
    expect(guessCategory('bg_sky.png', cats)).toBe('background');
    expect(guessCategory('xyz.png', cats)).toBeNull();
  });
});
