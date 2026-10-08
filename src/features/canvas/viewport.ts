// Zoom / pan state for a canvas view, plus pointer handling that splits
// gestures between the active tool, panning and two-finger pinch zoom.

import { createStore, type Store } from '../../state/store';

export interface View {
  zoom: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

export class Viewport {
  store: Store<View>;
  /** Size of the element in CSS px. */
  w = 0;
  h = 0;
  /** True once the user zoomed or panned (then resizes no longer re-fit). */
  touched = false;

  constructor(initial: View = { zoom: 0.4, x: 0, y: 0 }) {
    this.store = createStore(initial);
  }

  get view() {
    return this.store.get();
  }

  set(v: View) {
    this.store.set(v);
  }

  toCanvas(sx: number, sy: number): [number, number] {
    const v = this.view;
    return [(sx - v.x) / v.zoom, (sy - v.y) / v.zoom];
  }

  toScreen(cx: number, cy: number): [number, number] {
    const v = this.view;
    return [cx * v.zoom + v.x, cy * v.zoom + v.y];
  }

  fit(contentW: number, contentH: number, pad = 32) {
    if (!this.w || !this.h) return;
    this.touched = false;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((this.w - pad * 2) / contentW, (this.h - pad * 2) / contentH)));
    this.set({ zoom, x: (this.w - contentW * zoom) / 2, y: (this.h - contentH * zoom) / 2 });
  }

  zoomAt(factor: number, sx: number, sy: number) {
    this.touched = true;
    const v = this.view;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor));
    const k = zoom / v.zoom;
    this.set({ zoom, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k });
  }

  zoomCenter(factor: number) {
    this.zoomAt(factor, this.w / 2, this.h / 2);
  }

  setZoom(zoom: number) {
    this.zoomCenter(zoom / this.view.zoom);
  }

  panBy(dx: number, dy: number) {
    this.touched = true;
    const v = this.view;
    this.set({ ...v, x: v.x + dx, y: v.y + dy });
  }
}

/** Global "space is held" flag for temporary hand tool. */
export const keyState = { space: false };

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !(e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) keyState.space = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') keyState.space = false;
  });
  window.addEventListener('blur', () => (keyState.space = false));
}

export interface ToolPointer {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  pressure: number;
  e: PointerEvent;
}

export interface ToolHandlers {
  /** Return true to take the gesture; false lets the view pan instead. */
  down: (p: ToolPointer) => boolean;
  move?: (p: ToolPointer) => void;
  up?: (p: ToolPointer) => void;
  /** Gesture interrupted (e.g. a second finger started a pinch). */
  cancel?: () => void;
  /** Hover without buttons (cursor previews). */
  hover?: (p: ToolPointer | null) => void;
}

interface Options {
  /** Ignore touch for tools once a pen has been seen (palm rejection). */
  penOnlyAfterPen?: boolean;
  /** Fraction-style wheel zoom speed. */
  wheelSpeed?: number;
}

/**
 * Wire pointer + wheel events on an element. Returns a cleanup function.
 */
export function attachViewport(el: HTMLElement, vp: Viewport, getTool: () => ToolHandlers, opts: Options = {}): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'none' | 'tool' | 'pan' | 'pinch' = 'none';
  let pinchStart: { dist: number; mid: [number, number]; view: View } | null = null;
  let penSeen = false;
  let toolPointerId: number | null = null;

  const local = (e: PointerEvent | WheelEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const tp = (e: PointerEvent): ToolPointer => {
    const [sx, sy] = local(e);
    const [cx, cy] = vp.toCanvas(sx, sy);
    let pressure = e.pressure;
    if (e.pointerType !== 'pen') pressure = 1;
    else if (!pressure) pressure = 0.5;
    return { sx, sy, cx, cy, pressure, e };
  };

  const startPinch = () => {
    const pts = [...pointers.values()];
    const [a, b] = pts;
    const r = el.getBoundingClientRect();
    pinchStart = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top],
      view: vp.view,
    };
    mode = 'pinch';
  };

  const down = (e: PointerEvent) => {
    // transform handles and other overlay controls handle their own pointers
    if ((e.target as HTMLElement)?.closest?.('[data-no-viewport]')) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (e.button !== 0 && e.button !== 1 && e.pointerType === 'mouse') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (pointers.size === 2 && e.pointerType === 'touch') {
      if (mode === 'tool') getTool().cancel?.();
      toolPointerId = null;
      startPinch();
      return;
    }
    if (pointers.size > 1) return;
    const touchBlocked = opts.penOnlyAfterPen && penSeen && e.pointerType === 'touch';
    if (e.button === 1 || keyState.space || touchBlocked) {
      mode = 'pan';
      return;
    }
    e.preventDefault();
    if (getTool().down(tp(e))) {
      mode = 'tool';
      toolPointerId = e.pointerId;
    } else mode = 'pan';
  };

  const move = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType !== 'touch') getTool().hover?.(tp(e));
      return;
    }
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (mode === 'pinch' && pinchStart && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const r = el.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid: [number, number] = [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
      const v0 = pinchStart.view;
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v0.zoom * (dist / pinchStart.dist)));
      const k = zoom / v0.zoom;
      vp.touched = true;
      vp.set({
        zoom,
        x: mid[0] - (pinchStart.mid[0] - v0.x) * k,
        y: mid[1] - (pinchStart.mid[1] - v0.y) * k,
      });
    } else if (mode === 'pan') {
      vp.panBy(cur.x - prev.x, cur.y - prev.y);
    } else if (mode === 'tool' && e.pointerId === toolPointerId) {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const tool = getTool();
      if (events.length > 1) for (const ce of events) tool.move?.(tp(ce));
      else tool.move?.(tp(e));
    }
  };

  const up = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (mode === 'tool' && e.pointerId === toolPointerId) {
      if (e.type === 'pointercancel') getTool().cancel?.();
      else getTool().up?.(tp(e));
      toolPointerId = null;
    }
    if (pointers.size === 0) {
      mode = 'none';
      pinchStart = null;
    } else if (mode === 'pinch' && pointers.size < 2) {
      // remaining finger pans until lifted
      mode = 'pan';
    }
  };

  const leave = () => getTool().hover?.(null);

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const [sx, sy] = local(e);
    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      const speed = opts.wheelSpeed ?? 0.0015;
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      vp.zoomAt(Math.exp(-delta * (e.ctrlKey ? speed * 4 : speed)), sx, sy);
    } else {
      vp.panBy(-e.deltaY, -e.deltaX);
    }
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('wheel', wheel, { passive: false });
  const noMenu = (e: Event) => e.preventDefault();
  el.addEventListener('contextmenu', noMenu);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('contextmenu', noMenu);
  };
}

/** The mixer's main view (shared with the top bar zoom controls). */
export const mainViewport = new Viewport();
