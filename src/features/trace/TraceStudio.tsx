import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ID, Part, TraceSource } from '../../model/types';
import { docStore, useDoc, useStore } from '../../state/store';
import { prefsStore, setUI, stopEyedropper, toast, uiStore, useUI } from '../../state/ui';
import { activeCharacter, addParts, choosePart, updatePart } from '../../state/actions';
import { canvasToBlob, ctx2d, decodeBlob, getAssetBlob, loadImage, makeCanvas, onAssetLoaded, saveAsset } from '../../db/assets';
import { getSetting, setSetting } from '../../db/idb';
import { alignMatrix, apply, corners, effectiveAlign, invert } from '../../model/geom';
import { drawCharacter } from '../../render/compositor';
import { drawSymmetry, drawTemplate } from '../../render/guides';
import { partPlainSource } from '../../render/partRender';
import { rgbToHex } from '../../render/color';
import { canvasSpaceAlign, prepareLayers, storePart } from '../../io/partFactory';
import { slugify } from '../../model/ids';
import { attachViewport, keyState, Viewport, type ToolHandlers, type ToolPointer } from '../canvas/viewport';
import { TransformHandles } from '../canvas/TransformHandles';
import { Btn, Section, Select, Slider, Toggle } from '../../ui/controls';
import { ColorButton } from '../../ui/ColorPicker';
import { Dialog, confirmDialog } from '../../ui/overlays';
import { Icon, type IconName } from '../../ui/Icon';
import { PoseChips, TagInput } from '../import/ImportDialog';
import { exitTrace, traceLaunchStore } from './traceApi';
import { TraceDoc, type LayerName, type RefTransform } from './traceDoc';
import { Stabilizer, type Pt } from './stabilizer';
import { strokeBounds, strokePath, widthsFor, type BrushOptions } from './brush';
import { computeFill, type FillResult } from './floodFill';

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

type Tool = 'reference' | 'pen' | 'eraser' | 'fill' | 'fillbrush' | 'shade' | 'hand';

interface TraceSettings {
  penSize: number;
  eraserSize: number;
  fillSize: number;
  shadeSize: number;
  stabilizer: number;
  taper: number;
  taperStart: boolean;
  taperEnd: boolean;
  pressure: boolean;
  minPressure: number;
  lineColor: string;
  shadeTone: number;
  gap: number;
  template: boolean;
  ghost: boolean;
  ghostOpacity: number;
  previewTint: string;
  usePreviewTint: boolean;
  mirror: boolean;
  fingerDraw: boolean;
}

const SETTINGS_KEY = 'picrew-maker.trace.v1';
const DEFAULTS: TraceSettings = {
  penSize: 5,
  eraserSize: 24,
  fillSize: 30,
  shadeSize: 40,
  stabilizer: 45,
  taper: 30,
  taperStart: true,
  taperEnd: true,
  pressure: true,
  minPressure: 0.25,
  lineColor: '#1e1a26',
  shadeTone: 75,
  gap: 4,
  template: true,
  ghost: false,
  ghostOpacity: 30,
  previewTint: '#ffc9da',
  usePreviewTint: true,
  mirror: false,
  fingerDraw: true,
};

function useTraceSettings(): [TraceSettings, (p: Partial<TraceSettings>) => void] {
  const [s, setS] = useState<TraceSettings>(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
    } catch {
      return DEFAULTS;
    }
  });
  const set = useCallback((p: Partial<TraceSettings>) => {
    setS((prev) => {
      const next = { ...prev, ...p };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [s, set];
}

const TOOLS: { id: Tool; icon: IconName; label: string; key: string; tip: string }[] = [
  { id: 'reference', icon: 'image', label: 'Reference', key: 'V', tip: 'Move, scale and rotate the reference image (V)' },
  { id: 'pen', icon: 'pen', label: 'Pen', key: 'B', tip: 'Trace line art with the stabilized pen (B)' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E', tip: 'Erase on the chosen layer (E)' },
  { id: 'fill', icon: 'bucket', label: 'Make fill', key: 'F', tip: 'Click inside closed line art to fill it behind the lines (F)' },
  { id: 'fillbrush', icon: 'brush', label: 'Fill brush', key: 'W', tip: 'Paint the fill by hand to touch it up (W)' },
  { id: 'shade', icon: 'sun', label: 'Shade', key: 'S', tip: 'Paint gray shading — stays inside the fill and works with smart tint (S)' },
  { id: 'hand', icon: 'hand', label: 'Pan', key: 'H', tip: 'Pan the view (H, or hold Space)' },
];

const BRUSH_TOOLS: Tool[] = ['pen', 'eraser', 'fillbrush', 'shade'];

function grayHex(tone: number): string {
  const v = Math.round((tone / 100) * 255);
  return rgbToHex(v, v, v);
}

/* ------------------------------------------------------------------ */
/* Drafts: unsaved drawings survive refreshes                           */
/* ------------------------------------------------------------------ */

interface Draft {
  line: Blob | null;
  fill: Blob | null;
  shade: Blob | null;
  ref: Blob | null;
  refT: RefTransform;
  editPartId?: ID;
  savedAt: number;
}

const draftKey = () => `traceDraft:${docStore.get().project.id}`;

async function saveDraft(doc: TraceDoc, editPartId?: ID) {
  const blob = async (l: LayerName) => (doc.isLayerEmpty(l) ? null : await canvasToBlob(doc.layers[l]));
  const d: Draft = {
    line: await blob('line'),
    fill: await blob('fill'),
    shade: await blob('shade'),
    ref: doc.ref?.blob ?? null,
    refT: doc.refT,
    editPartId,
    savedAt: Date.now(),
  };
  await setSetting(draftKey(), d);
}

async function clearDraft() {
  await setSetting(draftKey(), null);
}

/* ------------------------------------------------------------------ */

interface StrokeState {
  layer: LayerName;
  stab: Stabilizer;
  pts: Pt[];
  drawn: number;
  opts: BrushOptions;
  color: string;
  erase: boolean;
  taperFinal: boolean;
  mirror?: number;
}

export default function TraceStudio() {
  const launch = useStore(traceLaunchStore, (s) => s) ?? {};
  const project = useDoc((d) => d.project);
  const W = project.width;
  const H = project.height;
  const doc = useMemo(() => new TraceDoc(W, H), [W, H]);
  const vp = useMemo(() => new Viewport(), []);
  const [s, set] = useTraceSettings();
  const [tool, setTool] = useState<Tool>('pen');
  const [eraserTarget, setEraserTarget] = useState<LayerName>('line');
  const [vis, setVis] = useState<Record<LayerName, boolean>>({ line: true, fill: true, shade: true });
  const [mirrorX, setMirrorX] = useState(() => prefsStore.get().symmetryX * W);
  const [saveOpen, setSaveOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const uiTool = useUI((u) => u.tool);
  const editing = useDoc((d) => (launch.editPartId ? d.parts[launch.editPartId] : undefined));

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const raf = useRef(0);
  const hover = useRef<[number, number] | null>(null);
  const stroke = useRef<StrokeState | null>(null);
  const refDrag = useRef<{ cx: number; cy: number; t0: RefTransform } | null>(null);
  const refStart = useRef<RefTransform | null>(null);
  const comp = useRef<{ key: string; c: HTMLCanvasElement } | null>(null);
  const latest = useRef({ s, tool, eraserTarget, vis, mirrorX });
  latest.current = { s, tool, eraserTarget, vis, mirrorX };

  /* ---------------- drawing the view ---------------- */

  const fillComposite = () => {
    const { s: st, vis: v } = latest.current;
    const key = `${doc.versions.fill}|${doc.versions.shade}|${v.shade}|${st.usePreviewTint ? st.previewTint : ''}`;
    if (comp.current?.key === key) return comp.current.c;
    const c = comp.current?.c ?? makeCanvas(W, H);
    const x = ctx2d(c);
    x.save();
    x.clearRect(0, 0, W, H);
    x.drawImage(doc.layers.fill, 0, 0);
    if (v.shade) {
      x.globalCompositeOperation = 'multiply';
      x.drawImage(doc.layers.shade, 0, 0);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(doc.layers.fill, 0, 0);
    }
    if (st.usePreviewTint) {
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = st.previewTint;
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(doc.layers.fill, 0, 0);
    }
    x.restore();
    comp.current = { key, c };
    return c;
  };

  const draw = () => {
    raf.current = 0;
    const c = canvasRef.current;
    if (!c) return;
    const { s: st, vis: v, tool: t, mirrorX: mx } = latest.current;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(vp.w * dpr);
    const bh = Math.round(vp.h * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    const x = c.getContext('2d')!;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, c.width, c.height);
    const view = vp.view;
    x.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
    const px = 1 / view.zoom;
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.3)';
    x.shadowBlur = 20 * dpr;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, W, H);
    x.restore();
    x.save();
    x.beginPath();
    x.rect(0, 0, W, H);
    x.clip();
    if (doc.ref && doc.refT.visible) {
      const m = alignMatrix(doc.refT, doc.ref.src.width, doc.ref.src.height);
      x.save();
      x.globalAlpha = doc.refT.opacity;
      x.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      x.drawImage(doc.ref.src, 0, 0);
      x.restore();
    }
    if (st.ghost) {
      const d = docStore.get();
      const char = activeCharacter();
      if (char) {
        x.save();
        x.globalAlpha = st.ghostOpacity / 100;
        const skip = new Set(char.items.filter((i) => i.partId === launch.editPartId).map((i) => i.id));
        drawCharacter(x, d, char, { background: false, noShadow: true, skip });
        x.restore();
      }
    }
    if (v.fill) x.drawImage(fillComposite(), 0, 0);
    if (v.line) x.drawImage(doc.layers.line, 0, 0);
    x.restore();
    if (st.template) {
      const pose = project.poses.find((p) => p.id === (activeCharacter()?.poseId ?? project.poses[0]?.id));
      x.save();
      x.globalAlpha = 0.55;
      drawTemplate(x, W, H, pose?.guide ?? 'front', pose?.guideImage, px);
      x.restore();
    }
    if (st.mirror) drawSymmetry(x, mx, H, px);
    x.strokeStyle = 'rgba(0,0,0,0.25)';
    x.lineWidth = px;
    x.strokeRect(0, 0, W, H);
    // brush cursor
    const h = hover.current;
    if (h && BRUSH_TOOLS.includes(t) && !stroke.current) {
      const size = t === 'pen' ? st.penSize : t === 'eraser' ? st.eraserSize : t === 'fillbrush' ? st.fillSize : st.shadeSize;
      x.save();
      x.lineWidth = px * 1.5;
      x.strokeStyle = t === 'eraser' ? '#ff5d6c' : '#8c7bff';
      for (const cx of st.mirror ? [h[0], 2 * mx - h[0]] : [h[0]]) {
        x.beginPath();
        x.arc(cx, h[1], Math.max(size / 2, 2 * px), 0, Math.PI * 2);
        x.stroke();
      }
      x.restore();
    }
  };

  const requestDraw = () => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  };

  useEffect(requestDraw);
  useEffect(() => {
    const subs = [
      doc.subscribe(() => {
        requestDraw();
        rerender();
      }),
      vp.store.subscribe(requestDraw),
      onAssetLoaded(requestDraw),
    ];
    return () => {
      subs.forEach((u) => u());
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      vp.w = r.width;
      vp.h = r.height;
      if (!vp.touched && r.width > 0) vp.fit(W, H, 24);
      requestDraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H]);

  /* ---------------- loading (edit / trace-over / draft) ---------------- */

  useEffect(() => {
    let alive = true;
    void (async () => {
      const d = docStore.get();
      const loadTrace = async (t: TraceSource) => {
        for (const l of ['line', 'fill', 'shade'] as const) {
          const id = t[l];
          if (!id) continue;
          const img = await loadImage(id);
          if (img && alive) doc.loadLayer(l, img);
        }
        if (t.reference) {
          const blob = await getAssetBlob(t.reference);
          if (blob && alive) doc.loadRef({ src: await decodeBlob(blob), blob }, { ...doc.refT, ...(t.refTransform ?? {}), visible: true });
        }
      };
      const draft = await getSetting<Draft | null>(draftKey());
      const draftMatches = draft && (draft.editPartId ?? undefined) === (launch.editPartId ?? undefined);
      if (draft && draftMatches && !launch.referencePartId) {
        const ok = await confirmDialog({
          title: 'Continue your unsaved drawing?',
          message: `You have a drawing from ${new Date(draft.savedAt).toLocaleString()} that was not saved as a part yet.`,
          confirmLabel: 'Continue drawing',
        });
        if (ok && alive) {
          for (const l of ['line', 'fill', 'shade'] as const) {
            const b = draft[l];
            if (b) doc.loadLayer(l, await decodeBlob(b));
          }
          if (draft.ref) doc.loadRef({ src: await decodeBlob(draft.ref), blob: draft.ref }, draft.refT);
          doc.dirty = true;
          return;
        }
        if (!ok) await clearDraft();
      }
      if (launch.editPartId) {
        const p = d.parts[launch.editPartId];
        if (p?.trace) await loadTrace(p.trace);
      } else if (launch.referencePartId) {
        const p = d.parts[launch.referencePartId];
        if (!p) return;
        await Promise.all([p.images.flat, p.images.fill, p.images.line].filter(Boolean).map((id) => loadImage(id!)));
        const src = partPlainSource(p);
        if (!src || !alive) return;
        const c = makeCanvas(p.w, p.h);
        ctx2d(c).drawImage(src, 0, 0);
        const blob = await canvasToBlob(c);
        const a = effectiveAlign(p, activeCharacter()?.poseId);
        doc.loadRef({ src: c, blob }, { ...doc.refT, x: a.x, y: a.y, scale: a.scale, rotation: a.rotation, opacity: 0.5, visible: true });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // autosave a draft a moment after each change
  useEffect(() => {
    if (!doc.dirty) return;
    const t = setTimeout(() => void saveDraft(doc, launch.editPartId), 2500);
    return () => clearTimeout(t);
  }, [doc, doc.version, launch.editPartId]);

  /* ---------------- reference image ---------------- */

  const loadReferenceFile = async (f: File | Blob) => {
    try {
      const src = await decodeBlob(f);
      const k = Math.min(W / src.width, H / src.height);
      doc.setRefImage({ src, blob: f }, { x: W / 2, y: H / 2, scale: k, rotation: 0, opacity: doc.refT.opacity || 0.45, visible: true });
      setTool('reference');
      toast('Reference loaded — drag/scale it into place, then pick the pen (B).');
    } catch {
      toast('That file could not be read as an image.');
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) {
        e.preventDefault();
        void loadReferenceFile(f);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  /* ---------------- tools ---------------- */

  const runFill = (cx: number, cy: number) => {
    const { s: st, mirrorX: mx } = latest.current;
    const data = doc.ctx('line').getImageData(0, 0, W, H).data;
    const alpha = new Uint8Array(W * H);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    const seeds: [number, number][] = [[cx, cy]];
    if (st.mirror && Math.abs(2 * mx - cx - cx) > 4) seeds.push([2 * mx - cx, cy]);
    const results: FillResult[] = [];
    for (const [x, y] of seeds) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const r = computeFill(alpha, W, H, x, y, st.gap);
      if (!r) {
        toast('Click inside an area surrounded by lines.');
        continue;
      }
      if (r.touchesEdge) {
        toast('That area is not closed — the fill would leak to the edge. Close the gap with the pen or raise “Gap close”.', { ms: 6000 });
        continue;
      }
      results.push(r);
    }
    if (!results.length) return;
    const minX = Math.min(...results.map((r) => r.minX));
    const minY = Math.min(...results.map((r) => r.minY));
    const maxX = Math.max(...results.map((r) => r.maxX));
    const maxY = Math.max(...results.map((r) => r.maxY));
    doc.editRect('fill', { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, (img) => {
      const d = img.data;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const gi = (minY + y) * W + (minX + x);
          if (!results.some((r) => r.mask[gi])) continue;
          const i = (y * img.width + x) * 4;
          d[i] = 255;
          d[i + 1] = 255;
          d[i + 2] = 255;
          d[i + 3] = 255;
        }
    });
  };

  const strokeSegment = (st: StrokeState, from: number, final: boolean) => {
    let widths: number[];
    if (final && st.taperFinal && st.pts.length > 2) {
      let len = 0;
      for (let i = 1; i < st.pts.length; i++) len += Math.hypot(st.pts[i].x - st.pts[i - 1].x, st.pts[i].y - st.pts[i - 1].y);
      widths = widthsFor(st.pts, st.opts, len);
    } else widths = widthsFor(st.pts, { ...st.opts, taperStart: st.opts.taperStart && st.pts.length > 2 });
    const path = strokePath(st.pts, widths, from, st.mirror);
    const x = doc.ctx(st.layer);
    x.save();
    x.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
    x.fillStyle = st.erase ? '#000' : st.color;
    x.fill(path, 'nonzero');
    x.restore();
    doc.versions[st.layer]++;
  };

  const brushFor = (t: Tool): Omit<StrokeState, 'stab' | 'pts' | 'drawn'> | null => {
    const { s: st, eraserTarget: et, mirrorX: mx } = latest.current;
    const base = { pressure: st.pressure, minPressure: st.minPressure, taper: st.taper };
    const mirror = st.mirror ? mx : undefined;
    switch (t) {
      case 'pen':
        return { layer: 'line', color: st.lineColor, erase: false, taperFinal: st.taperEnd, mirror, opts: { ...base, size: st.penSize, taperStart: st.taperStart, taperEnd: st.taperEnd } };
      case 'eraser':
        return { layer: et, color: '#000', erase: true, taperFinal: false, mirror, opts: { ...base, size: st.eraserSize, taperStart: false, taperEnd: false } };
      case 'fillbrush':
        return { layer: 'fill', color: '#ffffff', erase: false, taperFinal: false, mirror, opts: { ...base, size: st.fillSize, taperStart: false, taperEnd: false } };
      case 'shade':
        return { layer: 'shade', color: grayHex(st.shadeTone), erase: false, taperFinal: false, mirror, opts: { ...base, size: st.shadeSize, taperStart: false, taperEnd: false } };
      default:
        return null;
    }
  };

  const pointInRef = (cx: number, cy: number) => {
    if (!doc.ref) return false;
    const m = alignMatrix(doc.refT, doc.ref.src.width, doc.ref.src.height);
    const [ix, iy] = apply(invert(m), cx, cy);
    return ix >= 0 && iy >= 0 && ix <= doc.ref.src.width && iy <= doc.ref.src.height;
  };

  useEffect(() => {
    const el = wrapRef.current!;
    const handlers: ToolHandlers = {
      down: (p: ToolPointer) => {
        const { tool: t, s: st } = latest.current;
        if (uiStore.get().tool === 'eyedropper') {
          const c = canvasRef.current!;
          const dpr = window.devicePixelRatio || 1;
          const d = c.getContext('2d')!.getImageData(Math.round(p.sx * dpr), Math.round(p.sy * dpr), 1, 1).data;
          const target = uiStore.get().eyedropperTarget;
          stopEyedropper();
          target?.(rgbToHex(d[0], d[1], d[2]));
          return true;
        }
        if (t === 'hand') return false;
        if (t === 'reference') {
          if (!pointInRef(p.cx, p.cy)) return false;
          refDrag.current = { cx: p.cx, cy: p.cy, t0: doc.refT };
          return true;
        }
        if (t === 'fill') {
          runFill(Math.floor(p.cx), Math.floor(p.cy));
          return true;
        }
        const b = brushFor(t);
        if (!b) return false;
        if (b.layer === 'line' && !latest.current.vis.line) setVis((v) => ({ ...v, line: true }));
        doc.beginStroke(b.layer);
        const strength = t === 'pen' ? st.stabilizer : t === 'eraser' ? Math.min(st.stabilizer, 10) : Math.min(st.stabilizer, 25);
        const state: StrokeState = { ...b, stab: new Stabilizer(strength, vp.view.zoom), pts: [], drawn: 0 };
        state.pts.push(...state.stab.push({ x: p.cx, y: p.cy, p: p.pressure }));
        stroke.current = state;
        if (state.pts.length) {
          strokeSegment(state, 0, false);
          state.drawn = state.pts.length;
        }
        requestDraw();
        return true;
      },
      move: (p) => {
        hover.current = [p.cx, p.cy];
        if (refDrag.current) {
          const g = refDrag.current;
          doc.setRefTransform({ ...g.t0, x: g.t0.x + p.cx - g.cx, y: g.t0.y + p.cy - g.cy }, null);
          return;
        }
        const st = stroke.current;
        if (!st) return;
        const fresh = st.stab.push({ x: p.cx, y: p.cy, p: p.pressure });
        if (!fresh.length) return;
        st.pts.push(...fresh);
        strokeSegment(st, Math.max(0, st.drawn - 1), false);
        st.drawn = st.pts.length;
        requestDraw();
      },
      up: () => {
        if (refDrag.current) {
          const g = refDrag.current;
          refDrag.current = null;
          if (doc.refT !== g.t0) doc.setRefTransform(doc.refT, g.t0);
          return;
        }
        const st = stroke.current;
        if (!st) return;
        stroke.current = null;
        st.pts.push(...st.stab.finish());
        if (!st.pts.length) return;
        const fullWidths = widthsFor(st.pts, { ...st.opts, taperStart: false, taperEnd: false });
        const bbox = strokeBounds(st.pts, fullWidths, st.mirror);
        if (st.taperFinal || st.drawn < st.pts.length) {
          // redraw the whole stroke so the end taper (and last points) are exact
          doc.restoreFromBackup(st.layer, bbox);
          strokeSegment(st, 0, true);
        }
        doc.endStroke(st.layer, bbox);
      },
      cancel: () => {
        if (refDrag.current) {
          doc.setRefTransform(refDrag.current.t0, null);
          refDrag.current = null;
        }
        const st = stroke.current;
        if (st) {
          stroke.current = null;
          doc.cancelStroke(st.layer);
        }
      },
      hover: (p) => {
        hover.current = p ? [p.cx, p.cy] : null;
        requestDraw();
      },
    };
    const off = attachViewport(el, vp, () => handlers, { penOnlyAfterPen: !s.fingerDraw });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, s.fingerDraw]);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.('input:not([type=range]):not([type=checkbox]), textarea, select')) return;
      if (uiStore.get().dialog || document.querySelector('.dialog-backdrop')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) doc.redo();
        else doc.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        doc.redo();
        return;
      }
      if (mod && k === 's') {
        e.preventDefault();
        setSaveOpen(true);
        return;
      }
      if (mod || e.altKey) return;
      const tool = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (tool && !e.shiftKey) {
        setTool(tool.id);
        return;
      }
      const cur = latest.current;
      const sizeKey = cur.tool === 'pen' ? 'penSize' : cur.tool === 'eraser' ? 'eraserSize' : cur.tool === 'fillbrush' ? 'fillSize' : cur.tool === 'shade' ? 'shadeSize' : null;
      if ((k === '[' || k === ']') && sizeKey) {
        const v = cur.s[sizeKey];
        set({ [sizeKey]: Math.max(1, Math.min(200, Math.round(k === ']' ? v * 1.2 + 1 : v / 1.2 - 1))) });
        requestDraw();
        return;
      }
      if (k === 'x') set({ mirror: !cur.s.mirror });
      else if (k === '0') vp.fit(W, H, 24);
      else if (k === '+' || k === '=') vp.zoomCenter(1.25);
      else if (k === '-') vp.zoomCenter(0.8);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  /* ---------------- leaving ---------------- */

  const leave = async () => {
    if (doc.dirty && !doc.isEmpty()) {
      await saveDraft(doc, launch.editPartId);
      toast('Your drawing is kept as a draft — it will be offered when you open the trace studio again.', { ms: 6000 });
    }
    exitTrace();
  };

  const cursor = keyState.space ? 'grab' : tool === 'hand' ? 'grab' : tool === 'reference' ? 'move' : uiTool === 'eyedropper' ? 'crosshair' : BRUSH_TOOLS.includes(tool) ? 'none' : 'crosshair';
  const refCorners = doc.ref ? corners(alignMatrix(doc.refT, doc.ref.src.width, doc.ref.src.height), doc.ref.src.width, doc.ref.src.height) : null;
  const sizeFor = tool === 'pen' ? 'penSize' : tool === 'eraser' ? 'eraserSize' : tool === 'fillbrush' ? 'fillSize' : tool === 'shade' ? 'shadeSize' : null;

  return (
    <div
      className="trace-studio"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
        if (!f) return;
        e.preventDefault();
        e.stopPropagation();
        void loadReferenceFile(f);
      }}
    >
      <header className="topbar trace-top">
        <div className="tb-group">
          <Btn icon="chevLeft" label="Mixer" tip="Back to the character mixer (unsaved drawings are kept as a draft)" onClick={leave} />
          <strong className="trace-title ellipsis">{editing ? `Editing ${editing.name}` : 'Trace a new part'}</strong>
        </div>
        <div className="tb-group">
          <Btn icon="undo" tip="Undo (Ctrl+Z)" disabled={!doc.canUndo()} onClick={() => doc.undo()} />
          <Btn icon="redo" tip="Redo (Ctrl+Shift+Z)" disabled={!doc.canRedo()} onClick={() => doc.redo()} />
        </div>
        <div className="tb-group">
          <Btn icon="template" tip="Template guides" active={s.template} onClick={() => set({ template: !s.template })} />
          <Btn icon="person" tip="Show your current character as a ghost" active={s.ghost} onClick={() => set({ ghost: !s.ghost })} />
          <Btn icon="symmetry" tip="Mirror drawing (X) — everything you draw is mirrored across the line" active={s.mirror} onClick={() => set({ mirror: !s.mirror })} />
          <span className="tb-sep" />
          <Btn icon="zoomOut" tip="Zoom out (-)" onClick={() => vp.zoomCenter(0.8)} />
          <Btn icon="zoomIn" tip="Zoom in (+)" onClick={() => vp.zoomCenter(1.25)} />
          <Btn icon="fit" tip="Fit (0)" onClick={() => vp.fit(W, H, 24)} />
        </div>
        <div className="tb-group tb-right">
          <Btn icon="sliders" tip="Show / hide the options panel" active={panelOpen} onClick={() => setPanelOpen(!panelOpen)} className="trace-panel-toggle" />
          <Btn icon="check" label="Save as part" variant="primary" tip="Send the drawing to the library as a part (Ctrl+S)" tour="trace-save" onClick={() => setSaveOpen(true)} />
        </div>
      </header>
      <div className={`trace-body${panelOpen ? '' : ' panel-closed'}`}>
        <nav className="trace-tools" aria-label="Tools">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={`trace-tool${tool === t.id ? ' is-on' : ''}`} data-tip={t.tip} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
              <Icon name={t.icon} size={20} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="trace-stage stage" ref={wrapRef} style={{ cursor }}>
          <canvas ref={canvasRef} className="stage-canvas" />
          {tool === 'reference' && refCorners && (
            <TransformHandles
              vp={vp}
              corners={refCorners}
              center={[doc.refT.x, doc.refT.y]}
              onBegin={() => (refStart.current = doc.refT)}
              onScale={(f) => refStart.current && doc.setRefTransform({ ...refStart.current, scale: Math.max(0.01, refStart.current.scale * f) }, null)}
              onRotate={(delta, e) => {
                if (!refStart.current) return;
                let r = refStart.current.rotation + delta;
                if (e.shiftKey) r = Math.round(r / 15) * 15;
                doc.setRefTransform({ ...refStart.current, rotation: r }, null);
              }}
              onEnd={() => refStart.current && doc.setRefTransform(doc.refT, refStart.current)}
            />
          )}
          {!doc.ref && (
            <div className="trace-empty">
              <Icon name="image" size={32} />
              <p>
                Load a reference image to trace over: drop it here, paste it (Ctrl+V) or{' '}
                <button type="button" className="link" onClick={() => fileRef.current?.click()}>
                  choose a file
                </button>
                . Or just draw freely.
              </p>
            </div>
          )}
          <div className="stage-hint">
            {tool === 'fill'
              ? 'Click inside a closed shape to fill it behind the lines'
              : tool === 'reference'
                ? 'Drag the reference · corners scale · top handle rotates'
                : tool === 'shade'
                  ? 'Gray shading is only visible inside the fill'
                  : 'Space or two fingers to pan · scroll / pinch to zoom · [ ] brush size'}
          </div>
        </div>
        <aside className="trace-panel panel" aria-label="Tool options">
          <div className="panel-scroll">
            <Section title={TOOLS.find((t) => t.id === tool)?.label ?? 'Tool'}>
              {sizeFor && (
                <Slider
                  label="Size"
                  tip="Brush size in canvas pixels ([ and ])"
                  value={s[sizeFor]}
                  min={1}
                  max={200}
                  unit="px"
                  onChange={(v) => set({ [sizeFor]: v })}
                />
              )}
              {tool === 'pen' && (
                <>
                  <Slider label="Stabilizer" tip="Smooths shaky lines — higher = smoother but less responsive in tight curves" value={s.stabilizer} min={0} max={100} unit="%" onChange={(v) => set({ stabilizer: v })} />
                  <Slider label="Taper" tip="Length of the thin, tapered ends of each line" value={s.taper} min={0} max={200} unit="px" onChange={(v) => set({ taper: v })} />
                  <div className="row wrap">
                    <Toggle label="Taper start" tip="Thin start of each line" checked={s.taperStart} onChange={(v) => set({ taperStart: v })} />
                    <Toggle label="Taper end" tip="Thin end of each line" checked={s.taperEnd} onChange={(v) => set({ taperEnd: v })} />
                  </div>
                  <div className="row">
                    <span className="muted small grow">Line color</span>
                    <ColorButton value={s.lineColor} tip="Line color (you can still recolor lines later in the mixer)" onChange={(lineColor) => set({ lineColor })} />
                  </div>
                </>
              )}
              {BRUSH_TOOLS.includes(tool) && (
                <>
                  <Toggle label="Pen pressure" tip="Pressure from a tablet or stylus changes the width" checked={s.pressure} onChange={(v) => set({ pressure: v })} />
                  {s.pressure && (
                    <Slider label="Min width" tip="Width at the lightest pressure" value={Math.round(s.minPressure * 100)} min={0} max={100} unit="%" onChange={(v) => set({ minPressure: v / 100 })} />
                  )}
                </>
              )}
              {tool === 'eraser' && (
                <div className="field">
                  <span>Erase on</span>
                  <Select
                    tip="Which layer the eraser works on"
                    value={eraserTarget}
                    onChange={setEraserTarget}
                    options={[
                      { value: 'line', label: 'Line art' },
                      { value: 'fill', label: 'Fill' },
                      { value: 'shade', label: 'Shading' },
                    ]}
                  />
                </div>
              )}
              {tool === 'fill' && (
                <>
                  <Slider
                    label="Gap close"
                    tip="Small gaps in the line art up to about twice this size are treated as closed, so the fill does not leak"
                    value={s.gap}
                    min={0}
                    max={16}
                    unit="px"
                    onChange={(v) => set({ gap: v })}
                  />
                  <p className="muted small">The fill is white/gray so smart tint can color it later. It goes behind the lines and slightly under them.</p>
                </>
              )}
              {tool === 'shade' && (
                <>
                  <Slider label="Tone" tip="How dark the gray shading is" value={s.shadeTone} min={20} max={98} unit="%" onChange={(v) => set({ shadeTone: v })} />
                  <p className="muted small">Shading is painted in gray and only shows inside the fill, so smart tint keeps working.</p>
                </>
              )}
              {tool === 'reference' && <p className="muted small">Drag the reference to move it. Use the corner handles to scale and the top handle to rotate.</p>}
              <Toggle label="Draw with finger" tip="Turn off when using a stylus: fingers then only pan and zoom (palm rejection)" checked={s.fingerDraw} onChange={(v) => set({ fingerDraw: v })} />
            </Section>
            <Section title="Reference" collapsible>
              <div className="row wrap">
                <Btn small icon="upload" label={doc.ref ? 'Replace…' : 'Load image…'} tip="Load a reference image (or drop / paste one)" onClick={() => fileRef.current?.click()} />
                {doc.ref && <Btn small icon="fit" label="Fit" tip="Fit the reference to the canvas" onClick={() => doc.setRefTransform(doc.fitRef(), doc.refT)} />}
                {doc.ref && <Btn small icon="x" label="Remove" tip="Remove the reference (undoable)" onClick={() => doc.setRefImage(null)} />}
              </div>
              {doc.ref && (
                <>
                  <Slider
                    label="Dim"
                    tip="Reference opacity"
                    value={Math.round(doc.refT.opacity * 100)}
                    min={5}
                    max={100}
                    unit="%"
                    onChange={(v) => doc.setRefTransform({ ...doc.refT, opacity: v / 100 }, null)}
                  />
                  <Toggle label="Show reference" tip="Hide the reference to check your lines" checked={doc.refT.visible} onChange={(v) => doc.setRefTransform({ ...doc.refT, visible: v }, null)} />
                </>
              )}
            </Section>
            <Section title="Layers" collapsible>
              <LayerRow name="Line art" visible={vis.line} onToggle={() => setVis({ ...vis, line: !vis.line })} onClear={() => doc.clearLayer('line')} />
              <LayerRow name="Fill" visible={vis.fill} onToggle={() => setVis({ ...vis, fill: !vis.fill })} onClear={() => doc.clearLayer('fill')} />
              <LayerRow name="Shading" visible={vis.shade} onToggle={() => setVis({ ...vis, shade: !vis.shade })} onClear={() => doc.clearLayer('shade')} />
              <div className="row">
                <Toggle label="Preview fill tint" tip="Shows the fill in a color while drawing (it is saved as white/gray)" checked={s.usePreviewTint} onChange={(v) => set({ usePreviewTint: v })} />
                {s.usePreviewTint && <ColorButton value={s.previewTint} tip="Preview tint color" onChange={(previewTint) => set({ previewTint })} />}
              </div>
            </Section>
            <Section title="Guides & mirror" collapsible>
              <Toggle label="Template guides" tip="Head, eye and shoulder guides" checked={s.template} onChange={(v) => set({ template: v })} />
              <Toggle label="Ghost of current character" tip="See your character while drawing a new part for it" checked={s.ghost} onChange={(v) => set({ ghost: v })} />
              {s.ghost && <Slider label="Ghost" tip="Ghost opacity" value={s.ghostOpacity} min={5} max={100} unit="%" onChange={(v) => set({ ghostOpacity: v })} />}
              <Toggle label="Mirror drawing" tip="Draw both sides at once (great for glasses, collars) — X" checked={s.mirror} onChange={(v) => set({ mirror: v })} />
              {s.mirror && (
                <Slider label="Axis" tip="Position of the mirror line" value={Math.round(mirrorX)} min={0} max={W} unit="px" onChange={(v) => setMirrorX(v)} />
              )}
            </Section>
          </div>
        </aside>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void loadReferenceFile(f);
        }}
      />
      {saveOpen && (
        <SavePartDialog
          doc={doc}
          editing={editing}
          categoryHint={launch.categoryId}
          onClose={() => setSaveOpen(false)}
          onSaved={(part, mode) => {
            setSaveOpen(false);
            doc.dirty = false;
            void clearDraft();
            exitTrace();
            setUI({ activeCategoryId: part.categoryId, libraryQuery: '', showTrash: false, mobileTab: 'library' });
            const char = activeCharacter();
            if (mode === 'new' && char && part.poseIds.includes(char.poseId)) choosePart(part.id);
            toast(mode === 'new' ? `Saved “${part.name}” to the library` : `Updated “${part.name}”`, { undo: true });
          }}
        />
      )}
    </div>
  );
}

function LayerRow({ name, visible, onToggle, onClear }: { name: string; visible: boolean; onToggle: () => void; onClear: () => void }) {
  return (
    <div className="row trace-layer">
      <button type="button" className="layer-eye" data-tip={visible ? `Hide ${name}` : `Show ${name}`} aria-label={visible ? `Hide ${name}` : `Show ${name}`} onClick={onToggle}>
        <Icon name={visible ? 'eye' : 'eyeOff'} size={16} />
      </button>
      <span className="grow">{name}</span>
      <Btn small icon="trash" tip={`Clear the ${name.toLowerCase()} layer (undoable)`} onClick={onClear} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Save as part                                                        */
/* ------------------------------------------------------------------ */

async function saveTraceSource(doc: TraceDoc): Promise<TraceSource> {
  const out: TraceSource = { canvasW: doc.W, canvasH: doc.H, refTransform: doc.refT };
  for (const l of ['line', 'fill', 'shade'] as const) {
    if (doc.isLayerEmpty(l)) continue;
    const blob = await canvasToBlob(doc.layers[l]);
    out[l] = await saveAsset(blob, doc.W, doc.H);
  }
  if (doc.ref) out.reference = await saveAsset(doc.ref.blob, doc.ref.src.width, doc.ref.src.height);
  return out;
}

function SavePartDialog({
  doc,
  editing,
  categoryHint,
  onClose,
  onSaved,
}: {
  doc: TraceDoc;
  editing?: Part;
  categoryHint?: ID;
  onClose: () => void;
  onSaved: (p: Part, mode: 'new' | 'update') => void;
}) {
  const project = useDoc((d) => d.project);
  const partCount = useDoc((d) => Object.keys(d.parts).length);
  const pose = activeCharacter()?.poseId ?? project.poses[0]?.id;
  const [name, setName] = useState(editing?.name ?? `traced-part-${partCount + 1}`);
  const [categoryId, setCategoryId] = useState<ID>(editing?.categoryId ?? categoryHint ?? uiStore.get().activeCategoryId ?? project.categories[0]?.id ?? '');
  const [poseIds, setPoseIds] = useState<ID[]>(editing?.poseIds ?? (pose ? [pose] : []));
  const [tags, setTags] = useState<string[]>(editing?.tags ?? ['traced']);
  const [busy, setBusy] = useState(false);
  const lineEmpty = doc.isLayerEmpty('line');
  const fillEmpty = doc.isLayerEmpty('fill');

  const save = async (mode: 'new' | 'update') => {
    if (lineEmpty && fillEmpty) {
      toast('Nothing to save yet — draw some line art or a fill first.');
      return;
    }
    setBusy(true);
    try {
      const prepared = prepareLayers({ line: lineEmpty ? undefined : doc.layers.line, fill: fillEmpty ? undefined : doc.mergedFill() }, doc.W * 2, doc.H * 2);
      if (!prepared) throw new Error('The drawing is empty');
      const align = canvasSpaceAlign(prepared, project.width);
      const trace = await saveTraceSource(doc);
      const clean = slugify(name) || 'traced-part';
      const stored = await storePart({ name: clean, categoryId, poseIds: poseIds.length ? poseIds : project.poses.map((p) => p.id), tags, prepared, align, trace });
      if (mode === 'update' && editing) {
        const patch: Partial<Part> = { name: clean, categoryId, poseIds: stored.poseIds, tags, images: stored.images, thumb: stored.thumb, w: stored.w, h: stored.h, align, poseAlign: undefined, trace };
        updatePart(editing.id, patch, `Update ${clean}`);
        onSaved({ ...editing, ...patch }, 'update');
      } else {
        addParts([stored], `Trace ${clean}`);
        onSaved(stored, 'new');
      }
    } catch (err) {
      toast(`Could not save: ${(err as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Save as part"
      icon="check"
      onClose={onClose}
      footer={
        <>
          <Btn label="Keep drawing" tip="Back to the drawing" onClick={onClose} />
          <span className="grow" />
          {editing && <Btn label="Save as a new part" tip="Keep the original part and add this as a new one" disabled={busy} onClick={() => save('new')} />}
          <Btn
            label={editing ? `Update “${editing.name}”` : 'Save to library'}
            icon="check"
            variant="primary"
            tip={editing ? 'Replace the part (every character using it updates; undoable)' : 'Add to the library with line and fill already split'}
            disabled={busy}
            onClick={() => save(editing ? 'update' : 'new')}
          />
        </>
      }
    >
      <div className="form">
        <p className="muted small">
          {lineEmpty ? 'No line art · ' : 'Line art ✓ · '}
          {fillEmpty ? 'no fill (only lines will be saved)' : 'fill + shading ✓ (smart tint ready)'}
        </p>
        <label className="field">
          <span>Name</span>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Category</span>
          <Select tip="Category" value={categoryId} onChange={setCategoryId} options={project.categories.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }))} />
        </label>
        <div className="field">
          <span>Poses</span>
          <PoseChips value={poseIds} onChange={setPoseIds} />
        </div>
        <div className="field">
          <span>Tags</span>
          <TagInput value={tags} onChange={setTags} />
        </div>
        <p className="muted small">The part keeps exactly the position you drew it in. You can still adjust its default alignment later.</p>
      </div>
    </Dialog>
  );
}
