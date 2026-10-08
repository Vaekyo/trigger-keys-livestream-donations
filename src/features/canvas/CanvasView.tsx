import { useEffect, useRef } from 'react';
import type { ID, Instance } from '../../model/types';
import { docStore, useDoc } from '../../state/store';
import { prefsStore, select, stopEyedropper, toast, uiStore, useUI } from '../../state/ui';
import { addInstance, updateInstance, withChar } from '../../state/actions';
import { onAssetLoaded, ctx2d, makeCanvas } from '../../db/assets';
import { drawCharacter, isPartVisibleInPose } from '../../render/compositor';
import { drawGrid, drawSymmetry, drawTemplate } from '../../render/guides';
import { hitTest } from '../../render/hitTest';
import { rgbToHex } from '../../render/color';
import { corners, effectiveAlign, instanceCenter, instanceMatrix, instanceSize, shapeBaseAlign } from '../../model/geom';
import { attachViewport, mainViewport, type ToolHandlers, type ToolPointer } from './viewport';
import { TransformHandles } from './TransformHandles';

const vp = mainViewport;

let checker: CanvasPattern | null = null;
function checkerPattern(x: CanvasRenderingContext2D): CanvasPattern | null {
  if (checker) return checker;
  const c = makeCanvas(16, 16);
  const cx = ctx2d(c);
  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, 16, 16);
  cx.fillStyle = '#e8e5ef';
  cx.fillRect(0, 0, 8, 8);
  cx.fillRect(8, 8, 8, 8);
  checker = x.createPattern(c, 'repeat');
  return checker;
}

/** Pick the rendered color at a canvas point (draws into a 1×1 canvas). */
export function pickCanvasColor(cx: number, cy: number): string | null {
  const d = docStore.get();
  const id = uiStore.get().characterId;
  const char = id ? d.characters[id] : undefined;
  if (!char) return null;
  const c = makeCanvas(1, 1);
  const x = ctx2d(c, true);
  x.translate(-Math.floor(cx), -Math.floor(cy));
  drawCharacter(x, d, char, { background: true });
  const p = x.getImageData(0, 0, 1, 1).data;
  if (p[3] < 8) return null;
  return rgbToHex(p[0], p[1], p[2]);
}

export function handleEyedropper(cx: number, cy: number) {
  const target = uiStore.get().eyedropperTarget;
  const hex = pickCanvasColor(cx, cy);
  if (!hex) {
    toast('Nothing to pick there — click on a colored area.');
    return;
  }
  stopEyedropper();
  target?.(hex);
  toast(`Picked ${hex}`);
}

interface DragState {
  startCx: number;
  startCy: number;
  startSx: number;
  startSy: number;
  items: Map<ID, { dx: number; dy: number }>;
  primary: ID;
  began: boolean;
}

export function CanvasView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const fitted = useRef(false);
  const drag = useRef<DragState | null>(null);
  const tool = useUI((s) => s.tool);
  const fitRequest = useUI((s) => s.fitRequest);

  const draw = () => {
    raf.current = 0;
    const c = canvasRef.current;
    if (!c || !docStore.isLoaded()) return;
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
    const d = docStore.get();
    const ui = uiStore.get();
    const prefs = prefsStore.get();
    const char = ui.characterId ? d.characters[ui.characterId] : undefined;
    if (!char) return;
    const { width: W, height: H } = d.project;
    const v = vp.view;
    x.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.x, dpr * v.y);
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.35)';
    x.shadowBlur = 24 * dpr;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, W, H);
    x.restore();
    const pat = checkerPattern(x);
    if (pat) {
      pat.setTransform?.(new DOMMatrix().scale(1 / v.zoom));
      x.fillStyle = pat;
      x.fillRect(0, 0, W, H);
    }
    x.save();
    x.beginPath();
    x.rect(0, 0, W, H);
    x.clip();
    x.imageSmoothingQuality = 'high';
    drawCharacter(x, d, char, { background: true, deviceScale: dpr * v.zoom });
    x.restore();
    const px = 1 / v.zoom;
    if (prefs.overlays.grid) drawGrid(x, W, H, prefs.gridSize, px);
    if (prefs.overlays.template) {
      const pose = d.project.poses.find((p) => p.id === char.poseId);
      x.save();
      x.globalAlpha = prefs.templateOpacity;
      drawTemplate(x, W, H, pose?.guide ?? 'front', pose?.guideImage, px);
      x.restore();
    }
    if (prefs.overlays.symmetry) drawSymmetry(x, prefs.symmetryX * W, H, px);
  };

  const requestDraw = () => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    const subs = [docStore.subscribe(requestDraw), uiStore.subscribe(requestDraw), prefsStore.subscribe(requestDraw), vp.store.subscribe(requestDraw), onAssetLoaded(requestDraw)];
    return () => {
      subs.forEach((u) => u());
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const first = !vp.w;
      vp.w = r.width;
      vp.h = r.height;
      if ((first || !fitted.current || !vp.touched) && docStore.isLoaded() && r.width > 0) {
        const d = docStore.get();
        vp.fit(d.project.width, d.project.height);
        fitted.current = true;
      }
      requestDraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!docStore.isLoaded() || !vp.w) return;
    const d = docStore.get();
    vp.fit(d.project.width, d.project.height);
  }, [fitRequest]);

  // pointer tools
  useEffect(() => {
    const el = wrapRef.current!;
    let hoverRaf = 0;
    const handlers: ToolHandlers = {
      down: (p: ToolPointer) => {
        const ui = uiStore.get();
        if (ui.tool === 'eyedropper') {
          handleEyedropper(p.cx, p.cy);
          return true;
        }
        const d = docStore.get();
        const char = ui.characterId ? d.characters[ui.characterId] : undefined;
        if (!char) return false;
        const hits = hitTest(d, char, p.cx, p.cy);
        let target: Instance | undefined;
        if (p.e.altKey && hits.length > 1) {
          const idx = hits.findIndex((h) => h.id === ui.selection[0]);
          target = hits[(idx + 1) % hits.length];
        } else {
          target = hits.find((h) => ui.selection.includes(h.id)) ?? hits[0];
        }
        if (!target) {
          if (!p.e.shiftKey) select([]);
          return false;
        }
        let sel = ui.selection;
        if (p.e.shiftKey) {
          sel = sel.includes(target.id) ? sel.filter((s) => s !== target!.id) : [...sel, target.id];
          select(sel);
          if (!sel.includes(target.id)) return true;
        } else if (!sel.includes(target.id)) {
          sel = [target.id];
          select(sel);
        } else if (sel[0] !== target.id) {
          sel = [target.id, ...sel.filter((s) => s !== target!.id)];
          select(sel);
        }
        const items = new Map<ID, { dx: number; dy: number }>();
        for (const inst of char.items) if (sel.includes(inst.id)) items.set(inst.id, { dx: inst.dx, dy: inst.dy });
        drag.current = { startCx: p.cx, startCy: p.cy, startSx: p.sx, startSy: p.sy, items, primary: target.id, began: false };
        return true;
      },
      move: (p) => {
        const g = drag.current;
        if (!g) return;
        if (!g.began) {
          if (Math.hypot(p.sx - g.startSx, p.sy - g.startSy) < 3) return;
          g.began = true;
          docStore.begin('Move part');
        }
        let ddx = p.cx - g.startCx;
        let ddy = p.cy - g.startCy;
        if (p.e.shiftKey) {
          if (Math.abs(ddx) > Math.abs(ddy)) ddy = 0;
          else ddx = 0;
        }
        const d = docStore.get();
        const ui = uiStore.get();
        const prefs = prefsStore.get();
        const char = ui.characterId ? d.characters[ui.characterId] : undefined;
        if (!char) return;
        const prim = g.items.get(g.primary);
        const primInst = char.items.find((i) => i.id === g.primary);
        if (prefs.snapping && !p.e.altKey && prim && primInst) {
          const thr = 8 / vp.view.zoom;
          const ndx = prim.dx + ddx;
          const ndy = prim.dy + ddy;
          if (Math.abs(ndx) < thr) ddx = -prim.dx;
          if (Math.abs(ndy) < thr) ddy = -prim.dy;
          if (prefs.overlays.symmetry) {
            const part = d.parts[primInst.partId];
            const base = primInst.shape || !part ? shapeBaseAlign(d.project) : effectiveAlign(part, char.poseId);
            const symX = prefs.symmetryX * d.project.width;
            if (Math.abs(base.x + prim.dx + ddx - symX) < thr) ddx = symX - base.x - prim.dx;
          }
        }
        docStore.commit('Move part', (doc) =>
          withChar(doc, char.id, (c) => ({
            ...c,
            items: c.items.map((i) => {
              const s = g.items.get(i.id);
              return s ? { ...i, dx: Math.round((s.dx + ddx) * 10) / 10, dy: Math.round((s.dy + ddy) * 10) / 10 } : i;
            }),
          })),
        );
      },
      up: () => {
        if (drag.current?.began) docStore.end('Move part');
        drag.current = null;
      },
      cancel: () => {
        if (drag.current?.began) docStore.cancel();
        drag.current = null;
      },
      hover: (p) => {
        if (hoverRaf) return;
        hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          const ui = uiStore.get();
          if (ui.tool === 'eyedropper') {
            el.style.cursor = 'crosshair';
            return;
          }
          if (!p) return;
          const d = docStore.get();
          const char = ui.characterId ? d.characters[ui.characterId] : undefined;
          if (!char) return;
          el.style.cursor = hitTest(d, char, p.cx, p.cy).length ? 'move' : 'grab';
        });
      },
    };
    const off = attachViewport(el, vp, () => handlers);
    return () => {
      off();
      cancelAnimationFrame(hoverRaf);
    };
  }, []);

  useEffect(() => {
    if (wrapRef.current) wrapRef.current.style.cursor = tool === 'eyedropper' ? 'crosshair' : '';
  }, [tool]);

  return (
    <div
      className="stage"
      ref={wrapRef}
      data-tour="canvas"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-part-id')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('application/x-part-id');
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        const r = wrapRef.current!.getBoundingClientRect();
        const [cx, cy] = vp.toCanvas(e.clientX - r.left, e.clientY - r.top);
        addInstance(id, [cx, cy]);
      }}
    >
      <canvas ref={canvasRef} className="stage-canvas" />
      <SelectionHandles />
      {tool === 'eyedropper' && (
        <div className="stage-hint">
          Click the canvas to pick a color · <button type="button" onClick={stopEyedropper}>Cancel (Esc)</button>
        </div>
      )}
    </div>
  );
}

function SelectionHandles() {
  const sel = useUI((s) => s.selection);
  const charId = useUI((s) => s.characterId);
  const char = useDoc((d) => (charId ? d.characters[charId] : undefined));
  const project = useDoc((d) => d.project);
  const parts = useDoc((d) => d.parts);
  const start = useRef({ scale: 1, rotation: 0 });
  if (!char || !sel.length) return null;
  const visible = (i: Instance) => !i.hidden && (i.shape || isPartVisibleInPose(parts[i.partId], char.poseId));
  const selected = char.items.filter((i) => sel.includes(i.id) && visible(i));
  const primary = selected.find((i) => i.id === sel[0]) ?? selected[0];
  if (!primary) return null;
  const frame = (i: Instance) => {
    const part = i.shape ? undefined : parts[i.partId];
    const m = instanceMatrix(project, i, part, char.poseId);
    const { w, h } = instanceSize(i, part);
    return corners(m, w, h);
  };
  const part = primary.shape ? undefined : parts[primary.partId];
  return (
    <TransformHandles
      vp={vp}
      corners={frame(primary)}
      center={instanceCenter(project, primary, part, char.poseId)}
      others={selected.filter((i) => i !== primary).map(frame)}
      onBegin={(kind) => {
        start.current = { scale: primary.scale, rotation: primary.rotation };
        docStore.begin(kind === 'scale' ? 'Scale part' : 'Rotate part');
      }}
      onScale={(f) => updateInstance(primary.id, { scale: Math.round(Math.min(20, Math.max(0.05, start.current.scale * f)) * 1000) / 1000 })}
      onRotate={(delta, e) => {
        let r = start.current.rotation + delta;
        if (e.shiftKey) r = Math.round(r / 15) * 15;
        r = ((((r + 180) % 360) + 360) % 360) - 180;
        updateInstance(primary.id, { rotation: Math.round(r * 10) / 10 });
      }}
      onEnd={() => docStore.end()}
    />
  );
}

export function useSelectedInstance(): Instance | undefined {
  const sel = useUI((s) => s.selection[0]);
  const charId = useUI((s) => s.characterId);
  return useDoc((d) => (charId && sel ? d.characters[charId]?.items.find((i) => i.id === sel) : undefined));
}
