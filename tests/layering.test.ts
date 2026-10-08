import { describe, expect, it } from 'vitest';
import { moveInStack, resortByCategory, stackOf } from '../src/model/layering';
import { charWith, makeDoc, part } from './fixtures';

const parts = [part('hairB', 'hair-back'), part('face', 'face'), part('ear', 'earrings'), part('hairF', 'hair-front'), part('pin', 'head-accessory')];

describe('layer stack', () => {
  it('stacks by category order by default', () => {
    const doc = makeDoc(parts);
    const c = charWith([['pin', ''], ['face', ''], ['hairF', ''], ['hairB', ''], ['ear', '']]);
    expect(stackOf(doc.project, doc.parts, c).map((i) => i.partId)).toEqual(['hairB', 'face', 'hairF', 'ear', 'pin']);
  });

  it('moving one instance overrides only that instance', () => {
    const doc = makeDoc(parts);
    const c = charWith([['hairB', ''], ['face', ''], ['hairF', ''], ['ear', '']]);
    // put the hair-front strand behind the earrings? (it already is) → move it above earrings
    const stack = stackOf(doc.project, doc.parts, c);
    const hairF = stack.find((i) => i.partId === 'hairF')!;
    const moved = moveInStack(doc.project, doc.parts, c, hairF.id, 3);
    expect(stackOf(doc.project, doc.parts, moved).map((i) => i.partId)).toEqual(['hairB', 'face', 'ear', 'hairF']);
    // and below the face
    const back = moveInStack(doc.project, doc.parts, c, hairF.id, 1);
    expect(stackOf(doc.project, doc.parts, back).map((i) => i.partId)).toEqual(['hairB', 'hairF', 'face', 'ear']);
    expect(back.items.find((i) => i.partId === 'hairF')!.slot).toBeDefined();
  });

  it('overrides survive category reordering', () => {
    const doc = makeDoc(parts);
    const c = charWith([['hairB', ''], ['face', ''], ['hairF', ''], ['ear', '']]);
    const hairF = c.items.find((i) => i.partId === 'hairF')!;
    const moved = moveInStack(doc.project, doc.parts, c, hairF.id, 3); // above earrings (slot = earrings)
    // move the earrings category to the very back
    const cats = doc.project.categories.filter((x) => x.id !== 'earrings');
    const project = { ...doc.project, categories: [doc.project.categories.find((x) => x.id === 'earrings')!, ...cats] };
    const order = stackOf(project, doc.parts, moved).map((i) => i.partId);
    // hair-front follows the earrings slot it was moved into
    expect(order.indexOf('hairF')).toBe(order.indexOf('ear') + 1);
  });

  it('re-sort clears overrides', () => {
    const doc = makeDoc(parts);
    const c = charWith([['hairB', ''], ['face', ''], ['hairF', '']]);
    const moved = moveInStack(doc.project, doc.parts, c, c.items[2].id, 0);
    const resorted = resortByCategory(doc.project, doc.parts, moved);
    expect(stackOf(doc.project, doc.parts, resorted).map((i) => i.partId)).toEqual(['hairB', 'face', 'hairF']);
    expect(resorted.items.every((i) => i.slot === undefined)).toBe(true);
  });
});
