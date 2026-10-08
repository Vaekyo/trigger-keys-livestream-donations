import { describe, expect, it } from 'vitest';
import { docStore } from '../src/state/store';
import { makeDoc, part } from './fixtures';

describe('undo / redo store', () => {
  it('undoes and redoes commits with labels', () => {
    docStore.load(makeDoc([part('a', 'face')]));
    docStore.commit('Rename', (d) => ({ ...d, parts: { ...d.parts, a: { ...d.parts.a, name: 'b' } } }));
    expect(docStore.get().parts.a.name).toBe('b');
    expect(docStore.undo()).toBe('Rename');
    expect(docStore.get().parts.a.name).toBe('a');
    expect(docStore.redo()).toBe('Rename');
    expect(docStore.get().parts.a.name).toBe('b');
  });

  it('a gesture becomes one undo step', () => {
    docStore.load(makeDoc([part('a', 'face')]));
    docStore.begin('Drag');
    for (let i = 1; i <= 20; i++) docStore.commit('Move', (d) => ({ ...d, parts: { ...d.parts, a: { ...d.parts.a, w: i } } }));
    docStore.end();
    expect(docStore.get().parts.a.w).toBe(20);
    expect(docStore.undo()).toBe('Drag');
    expect(docStore.get().parts.a.w).toBe(10);
    expect(docStore.undo()).toBeNull();
  });

  it('cancelling a gesture restores the start', () => {
    docStore.load(makeDoc([part('a', 'face')]));
    docStore.begin('Drag');
    docStore.commit('Move', (d) => ({ ...d, parts: { ...d.parts, a: { ...d.parts.a, w: 99 } } }));
    docStore.cancel();
    expect(docStore.get().parts.a.w).toBe(10);
    expect(docStore.undoLabel()).toBeNull();
  });

  it('merge keys collapse repeated nudges', () => {
    docStore.load(makeDoc([part('a', 'face')]));
    for (let i = 0; i < 5; i++) docStore.commit('Nudge', (d) => ({ ...d, parts: { ...d.parts, a: { ...d.parts.a, w: d.parts.a.w + 1 } } }), 'nudge:a');
    expect(docStore.get().parts.a.w).toBe(15);
    docStore.undo();
    expect(docStore.get().parts.a.w).toBe(10);
  });

  it('no-op commits do not create history', () => {
    docStore.load(makeDoc([part('a', 'face')]));
    docStore.commit('Nothing', (d) => d);
    expect(docStore.undoLabel()).toBeNull();
  });
});
