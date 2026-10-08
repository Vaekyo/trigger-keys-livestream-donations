import { createStore, useStore } from './store';
import type { ID } from '../model/types';

export type RandomMode = 'both' | 'parts' | 'colors';
export type MobileTab = 'library' | 'part' | 'layers' | 'character';

export interface Prefs {
  overlays: { template: boolean; symmetry: boolean; grid: boolean };
  gridSize: number;
  templateOpacity: number;
  /** Symmetry line x as a fraction of the canvas width. */
  symmetryX: number;
  randomMode: RandomMode;
  /** Per project: locked category ids for randomize. */
  randomLocks: Record<ID, ID[]>;
  lastProjectId: ID | null;
  /** Per project: last open character. */
  lastCharacter: Record<ID, ID>;
  tourDone: boolean;
  snapping: boolean;
  theme: 'system' | 'dark' | 'light';
  exportScale: number;
  exportTransparent: boolean;
  exportCrop: string;
}

const PREFS_KEY = 'picrew-maker.prefs.v1';

const DEFAULT_PREFS: Prefs = {
  overlays: { template: false, symmetry: false, grid: false },
  gridSize: 50,
  templateOpacity: 0.5,
  symmetryX: 0.5,
  randomMode: 'both',
  randomLocks: {},
  lastProjectId: null,
  lastCharacter: {},
  tourDone: false,
  snapping: true,
  theme: 'system',
  exportScale: 1,
  exportTransparent: false,
  exportCrop: 'full',
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* private mode or blocked storage: fall back to defaults */
  }
  return { ...DEFAULT_PREFS };
}

export const prefsStore = createStore<Prefs>(typeof localStorage === 'undefined' ? { ...DEFAULT_PREFS } : loadPrefs());

prefsStore.subscribe(() => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefsStore.get()));
  } catch {
    /* ignore */
  }
});

export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  prefsStore.set((p) => ({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) }));
}

export function usePrefs<S>(sel: (p: Prefs) => S): S {
  return useStore(prefsStore, sel);
}

/* ------------------------------------------------------------------ */

export type DialogState =
  | null
  | { kind: 'import'; files: File[]; categoryId?: ID; force?: boolean }
  | { kind: 'align'; partId: ID }
  | { kind: 'categories' }
  | { kind: 'project-settings'; tab?: string }
  | { kind: 'gallery' }
  | { kind: 'export'; tab?: string }
  | { kind: 'projects' }
  | { kind: 'shortcuts' }
  | { kind: 'part-details'; partIds: ID[] }
  | { kind: 'share' };

export interface Toast {
  id: number;
  message: string;
  undo?: boolean;
  action?: { label: string; run: () => void };
}

export interface UIState {
  ready: boolean;
  loadingMessage: string;
  projectId: ID | null;
  characterId: ID | null;
  /** Selected instance ids on the active character (first = primary). */
  selection: ID[];
  activeCategoryId: ID | null;
  /** Bumped to ask the canvas to fit itself to the screen. */
  fitRequest: number;
  tool: 'select' | 'eyedropper';
  eyedropperTarget: ((hex: string) => void) | null;
  dialog: DialogState;
  libraryQuery: string;
  favoritesOnly: boolean;
  tagFilter: string | null;
  showAllPoses: boolean;
  libSelectMode: boolean;
  libSelected: ID[];
  showTrash: boolean;
  mode: 'mixer' | 'trace';
  traceEditPartId: ID | null;
  mobileTab: MobileTab;
  rightTab: Exclude<MobileTab, 'library'>;
  sheetCollapsed: boolean;
  tourStep: number | null;
  toasts: Toast[];
  savedAt: number;
  saving: boolean;
}

export const uiStore = createStore<UIState>({
  ready: false,
  loadingMessage: 'Loading…',
  projectId: null,
  characterId: null,
  selection: [],
  activeCategoryId: null,
  fitRequest: 0,
  tool: 'select',
  eyedropperTarget: null,
  dialog: null,
  libraryQuery: '',
  favoritesOnly: false,
  tagFilter: null,
  showAllPoses: false,
  libSelectMode: false,
  libSelected: [],
  showTrash: false,
  mode: 'mixer',
  traceEditPartId: null,
  mobileTab: 'library',
  rightTab: 'part',
  sheetCollapsed: false,
  tourStep: null,
  toasts: [],
  savedAt: 0,
  saving: false,
});

export function setUI(patch: Partial<UIState> | ((s: UIState) => Partial<UIState>)) {
  uiStore.set((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
}

export function useUI<S>(sel: (s: UIState) => S): S {
  return useStore(uiStore, sel);
}

export function openDialog(d: DialogState) {
  setUI({ dialog: d });
}

export function closeDialog() {
  setUI({ dialog: null });
}

let toastSeq = 1;

export function toast(message: string, opts: { undo?: boolean; action?: Toast['action']; ms?: number } = {}) {
  const id = toastSeq++;
  setUI((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, undo: opts.undo, action: opts.action }] }));
  setTimeout(() => dismissToast(id), opts.ms ?? (opts.undo || opts.action ? 6000 : 3000));
}

export function dismissToast(id: number) {
  setUI((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function currentSelection(): ID[] {
  return uiStore.get().selection;
}

export function select(ids: ID[]) {
  setUI({ selection: ids });
}

export function startEyedropper(onPick: (hex: string) => void) {
  setUI({ tool: 'eyedropper', eyedropperTarget: onPick });
}

export function stopEyedropper() {
  setUI({ tool: 'select', eyedropperTarget: null });
}
