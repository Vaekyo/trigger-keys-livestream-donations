// Autosave: writes only the records that changed since the last save.

import type { Doc } from '../model/types';
import { saveDocDiff } from '../db/idb';
import { docStore } from './store';
import { setUI, toast, uiStore } from './ui';

let lastSaved: Doc | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();
let started = false;

export function markSaved(d: Doc | null) {
  lastSaved = d;
}

function schedule() {
  if (!docStore.isLoaded()) return;
  if (docStore.get() === lastSaved) return;
  if (!uiStore.get().saving) setUI({ saving: true });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 350);
}

export function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!docStore.isLoaded()) return chain;
  const d = docStore.get();
  if (d === lastSaved) return chain;
  const prev = lastSaved && lastSaved.project.id === d.project.id ? lastSaved : null;
  lastSaved = d;
  chain = chain
    .then(() => saveDocDiff(prev, d))
    .then(() => {
      if (docStore.get() === d) setUI({ saving: false, savedAt: Date.now() });
    })
    .catch((err) => {
      console.error(err);
      lastSaved = null; // force a full save next time
      setUI({ saving: false });
      toast(`Saving failed: ${err?.message ?? err}. Your browser storage may be full.`, { ms: 8000 });
    });
  return chain;
}

export function startAutosave() {
  if (started) return;
  started = true;
  docStore.subscribe(schedule);
  const now = () => void flush();
  window.addEventListener('pagehide', now);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') now();
  });
}
