import { useSyncExternalStore } from 'react';
import type { Doc } from '../model/types';

type Listener = () => void;

/** Minimal observable value store with a React hook. */
export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(l: Listener): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (p: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      listeners.forEach((l) => l());
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useStore<T, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}

/* ------------------------------------------------------------------ */
/* Document store with undo/redo                                       */
/* ------------------------------------------------------------------ */

interface Entry {
  doc: Doc;
  label: string;
}

const MAX_HISTORY = 300;
const MERGE_WINDOW_MS = 1200;

class DocStore {
  private doc: Doc | null = null;
  private past: Entry[] = [];
  private future: Entry[] = [];
  private gestureBase: Doc | null = null;
  private gestureLabel = '';
  private lastMerge: { key: string; time: number } | null = null;
  private listeners = new Set<Listener>();
  /** Bumped on every change; handy for memo keys. */
  version = 0;

  get(): Doc {
    if (!this.doc) throw new Error('Document not loaded');
    return this.doc;
  }

  isLoaded(): boolean {
    return this.doc !== null;
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Replace the whole document and clear history (used when opening a project). */
  load(doc: Doc) {
    this.doc = doc;
    this.past = [];
    this.future = [];
    this.gestureBase = null;
    this.lastMerge = null;
    this.emit();
  }

  /**
   * Apply a change as one undo step.
   * `merge`: consecutive commits with the same key within a short window
   * collapse into one step (e.g. repeated arrow-key nudges).
   */
  commit(label: string, fn: (d: Doc) => Doc, merge?: string) {
    const cur = this.get();
    const next = fn(cur);
    if (next === cur) return;
    if (this.gestureBase) {
      this.doc = next;
      this.emit();
      return;
    }
    const now = Date.now();
    const mergeable = merge && this.lastMerge && this.lastMerge.key === merge && now - this.lastMerge.time < MERGE_WINDOW_MS;
    if (!mergeable) {
      this.past.push({ doc: cur, label });
      if (this.past.length > MAX_HISTORY) this.past.shift();
    }
    this.lastMerge = merge ? { key: merge, time: now } : null;
    this.future = [];
    this.doc = next;
    this.emit();
  }

  /** Start a continuous gesture (drag, slider). All commits until `end` become one undo step. */
  begin(label: string) {
    if (!this.gestureBase) this.gestureBase = this.get();
    this.gestureLabel = label;
  }

  end(label?: string) {
    const base = this.gestureBase;
    if (!base) return;
    this.gestureBase = null;
    if (base !== this.doc) {
      this.past.push({ doc: base, label: label ?? this.gestureLabel });
      if (this.past.length > MAX_HISTORY) this.past.shift();
      this.future = [];
      this.lastMerge = null;
      this.emit();
    }
  }

  cancel() {
    const base = this.gestureBase;
    if (!base) return;
    this.gestureBase = null;
    this.doc = base;
    this.emit();
  }

  inGesture() {
    return this.gestureBase !== null;
  }

  undo(): string | null {
    if (this.gestureBase) this.end();
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ doc: this.get(), label: entry.label });
    this.doc = entry.doc;
    this.lastMerge = null;
    this.emit();
    return entry.label;
  }

  redo(): string | null {
    if (this.gestureBase) this.end();
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ doc: this.get(), label: entry.label });
    this.doc = entry.doc;
    this.lastMerge = null;
    this.emit();
    return entry.label;
  }

  undoLabel(): string | null {
    return this.past.length ? this.past[this.past.length - 1].label : null;
  }

  redoLabel(): string | null {
    return this.future.length ? this.future[this.future.length - 1].label : null;
  }
}

export const docStore = new DocStore();

export function useDoc<S>(selector: (d: Doc) => S): S {
  return useSyncExternalStore(
    docStore.subscribe,
    () => selector(docStore.get()),
    () => selector(docStore.get()),
  );
}

export function useHistoryLabels(): { undo: string | null; redo: string | null } {
  const undo = useSyncExternalStore(docStore.subscribe, () => docStore.undoLabel());
  const redo = useSyncExternalStore(docStore.subscribe, () => docStore.redoLabel());
  return { undo, redo };
}
