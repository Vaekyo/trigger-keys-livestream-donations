import { useEffect } from 'react';
import { docStore } from '../../state/store';
import { closeDialog, openDialog, select, setPrefs, startEyedropper, stopEyedropper, toast, uiStore } from '../../state/ui';
import {
  activeCharacter,
  duplicateInstances,
  flipInstances,
  instanceColor,
  nudge,
  redo,
  removeInstances,
  resetInstances,
  setInstanceColor,
  stepLayer,
  undo,
} from '../../state/actions';
import { mainViewport } from '../canvas/viewport';
import { randomizeActive } from '../randomize/randomize';
import { flush } from '../../state/persist';
import { stackOf } from '../../model/layering';

export interface Shortcut {
  keys: string;
  label: string;
  group: string;
}

export const SHORTCUTS: Shortcut[] = [
  { group: 'General', keys: 'Ctrl+Z', label: 'Undo' },
  { group: 'General', keys: 'Ctrl+Shift+Z / Ctrl+Y', label: 'Redo' },
  { group: 'General', keys: 'Ctrl+S', label: 'Save now (it also saves automatically)' },
  { group: 'General', keys: 'Ctrl+E', label: 'Export PNG' },
  { group: 'General', keys: 'Ctrl+G', label: 'Open the gallery' },
  { group: 'General', keys: '?', label: 'Show this shortcut sheet' },
  { group: 'General', keys: 'Esc', label: 'Close dialog · cancel eyedropper · deselect' },
  { group: 'Selected part', keys: '← ↑ → ↓', label: 'Nudge 1px (Shift = 10px)' },
  { group: 'Selected part', keys: 'Delete / Backspace', label: 'Remove from character' },
  { group: 'Selected part', keys: 'Ctrl+D', label: 'Duplicate' },
  { group: 'Selected part', keys: 'H / V', label: 'Flip horizontally / vertically' },
  { group: 'Selected part', keys: 'R', label: 'Reset to default alignment' },
  { group: 'Selected part', keys: '[ / ]', label: 'Move layer down / up' },
  { group: 'Selected part', keys: 'I', label: 'Eyedropper: pick a tint color from the canvas' },
  { group: 'Selected part', keys: 'Tab / Shift+Tab', label: 'Select the next / previous layer' },
  { group: 'Selected part', keys: 'Ctrl+A', label: 'Select all parts' },
  { group: 'Canvas', keys: 'Space + drag', label: 'Pan (or drag an empty area)' },
  { group: 'Canvas', keys: 'Scroll / pinch', label: 'Zoom' },
  { group: 'Canvas', keys: '0', label: 'Fit to screen' },
  { group: 'Canvas', keys: '1', label: 'Zoom 100%' },
  { group: 'Canvas', keys: '+ / -', label: 'Zoom in / out' },
  { group: 'Canvas', keys: 'Alt + click', label: 'Select the part underneath' },
  { group: 'Canvas', keys: 'Alt + drag', label: 'Move without snapping' },
  { group: 'Canvas', keys: 'Shift + drag', label: 'Move along one axis' },
  { group: 'Canvas', keys: 'T / M / G', label: 'Toggle template guides / symmetry line / grid' },
  { group: 'Mix', keys: 'Shift+R', label: 'Randomize (locked categories stay)' },
  { group: 'Mix', keys: 'Shift+F', label: 'Surprise me (favorites only)' },
  { group: 'Trace studio', keys: 'B / E / F / W / S', label: 'Pen / eraser / make fill / fill brush / shade' },
  { group: 'Trace studio', keys: 'V / H', label: 'Move reference / pan' },
  { group: 'Trace studio', keys: '[ / ]', label: 'Smaller / bigger brush' },
  { group: 'Trace studio', keys: 'X', label: 'Toggle mirror drawing' },
  { group: 'Trace studio', keys: 'Ctrl+V', label: 'Paste an image as the reference' },
  { group: 'Trace studio', keys: 'Ctrl+S', label: 'Save as part' },
];

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button'].includes(type);
  }
  return false;
}

function toggleOverlay(key: 'template' | 'symmetry' | 'grid') {
  setPrefs((p) => ({ overlays: { ...p.overlays, [key]: !p.overlays[key] } }));
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = uiStore.get();
      if (!ui.ready) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      const typing = isTyping(e.target);

      // Undo / redo work everywhere except while typing in a text field
      if (mod && !typing && (k === 'z' || k === 'Z')) {
        if (ui.mode === 'trace') return; // trace studio has its own history
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && !typing && (k === 'y' || k === 'Y')) {
        if (ui.mode === 'trace') return;
        e.preventDefault();
        redo();
        return;
      }
      if (mod && (k === 's' || k === 'S')) {
        if (ui.mode === 'trace') return; // trace studio: Ctrl+S = save as part
        e.preventDefault();
        void flush().then(() => toast('Saved'));
        return;
      }
      if (k === 'Escape') {
        if (ui.tool === 'eyedropper') {
          stopEyedropper();
          return;
        }
        if (ui.dialog) {
          closeDialog();
          return;
        }
        if (!typing && ui.mode === 'mixer') select([]);
        return;
      }
      if (typing || ui.dialog || ui.mode !== 'mixer' || ui.tourStep !== null) return;

      const sel = ui.selection;
      const has = sel.length > 0;
      if (mod) {
        if (k === 'd' || k === 'D') {
          e.preventDefault();
          if (has) duplicateInstances(sel);
        } else if (k === 'e' || k === 'E') {
          e.preventDefault();
          openDialog({ kind: 'export' });
        } else if (k === 'g' || k === 'G') {
          e.preventDefault();
          openDialog({ kind: 'gallery' });
        } else if (k === 'a' || k === 'A') {
          e.preventDefault();
          const c = activeCharacter();
          if (c) select(c.items.filter((i) => !i.hidden).map((i) => i.id));
        }
        return;
      }
      if (e.altKey) return;
      switch (k) {
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!has) return;
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
          const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
          nudge(sel, dx, dy);
          return;
        }
        case 'Delete':
        case 'Backspace':
          if (has) {
            e.preventDefault();
            removeInstances(sel);
          }
          return;
        case 'Tab': {
          const c = activeCharacter();
          if (!c) return;
          e.preventDefault();
          const d = docStore.get();
          const stack = stackOf(d.project, d.parts, c).reverse();
          if (!stack.length) return;
          const idx = stack.findIndex((i) => i.id === sel[0]);
          const next = e.shiftKey ? (idx <= 0 ? stack.length - 1 : idx - 1) : (idx + 1) % stack.length;
          select([stack[next].id]);
          return;
        }
        case '?':
          openDialog({ kind: 'shortcuts' });
          return;
        case '0':
          mainViewport.fit(docStore.get().project.width, docStore.get().project.height);
          return;
        case '1':
          mainViewport.setZoom(1);
          return;
        case '+':
        case '=':
          mainViewport.zoomCenter(1.25);
          return;
        case '-':
        case '_':
          mainViewport.zoomCenter(0.8);
          return;
      }
      const lower = k.toLowerCase();
      if (e.shiftKey && lower === 'r') return randomizeActive();
      if (e.shiftKey && lower === 'f') return randomizeActive({ favoritesOnly: true });
      if (e.shiftKey) return;
      switch (lower) {
        case 'h':
          if (has) flipInstances(sel, 'x');
          return;
        case 'v':
          if (has) flipInstances(sel, 'y');
          return;
        case 'r':
          if (has) resetInstances(sel);
          return;
        case '[':
          if (has) stepLayer(sel[0], -1);
          return;
        case ']':
          if (has) stepLayer(sel[0], 1);
          return;
        case 't':
          return toggleOverlay('template');
        case 'm':
          return toggleOverlay('symmetry');
        case 'g':
          return toggleOverlay('grid');
        case 'i': {
          const c = activeCharacter();
          const inst = c?.items.find((i) => i.id === sel[0]);
          if (!inst || inst.shape) {
            toast('Select a part first, then press I to pick its tint color from the canvas.');
            return;
          }
          startEyedropper((hex) => {
            const spec = instanceColor(inst);
            setInstanceColor(inst.id, { ...spec, mode: 'tint', fill: hex }, 'Pick color');
          });
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

