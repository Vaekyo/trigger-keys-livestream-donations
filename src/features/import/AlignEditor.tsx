import { useEffect, useMemo, useRef, useState } from 'react';
import type { Align, ID } from '../../model/types';
import { docStore } from '../../state/store';
import { prefsStore, uiStore } from '../../state/ui';
import { onAssetLoaded, type DrawSource } from '../../db/assets';
import { drawCharacter } from '../../render/compositor';
import { drawSymmetry, drawTemplate, categoryAnchor } from '../../render/guides';
import { alignMatrix, apply, corners, DEG, invert } from '../../model/geom';
import { attachViewport, Viewport, type ToolHandlers } from '../canvas/viewport';
import { TransformHandles } from '../canvas/TransformHandles';
import { Btn, Slider, Toggle } from '../../ui/controls';
import { useStore } from '../../state/store';

interface Props {
  image: DrawSource | null;
  w: number;
  h: number;
  align: Align;
  onChange: (a: Align) => void;
  categoryId: ID;
  poseId: ID;
  /** Hide instances of this part from the ghost (when re-aligning an existing part). */
  excludePartId?: ID;
}

export function AlignEditor({ image, w, h, align, onChange, categoryId, poseId, excludePartId }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vp = useMemo(() => new Viewport(), []);
  const view = useStore(vp.store, (v) => v);
  const [ghost, setGhost] = useState(true);
  const [ghostOpacity, setGhostOpacity] = useState(0.55);
  const [template, setTemplate] = useState(true);
  const [partOpacity, setPartOpacity] = useState(0.9);
  const state = useRef({ align, onChange, image, ghost, ghostOpacity, template, partOpacity });
  state.current = { align, onChange, image, ghost, ghostOpacity, template, partOpacity };
  const start = useRef<Align>(align);
  const raf = useRef(0);

  const project = docStore.get().project;
  const W = project.width;
  const H = project.height;

  const draw = () => {
    raf.current = 0;
    const c = canvasRef.current;
    if (!c) return;
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
    const v = vp.view;
    x.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.x, dpr * v.y);
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, W, H);
    const s = state.current;
    const d = docStore.get();
    const charId = uiStore.get().characterId;
    const char = charId ? d.characters[charId] : undefined;
    const cats = d.project.categories;
    const idx = cats.findIndex((cc) => cc.id === categoryId);
    const below = new Set(cats.slice(0, Math.max(0, idx)).map((cc) => cc.id));
    const above = new Set(cats.slice(idx + 1).map((cc) => cc.id));
    const skip = new Set<ID>();
    if (char) for (const i of char.items) if (!i.shape && (d.parts[i.partId]?.categoryId === categoryId || i.partId === excludePartId)) skip.add(i.id);
    const ghostChar = char ? { ...char, poseId } : undefined;
    if (ghostChar && s.ghost) {
      x.save();
      x.globalAlpha = s.ghostOpacity;
      drawCharacter(x, d, ghostChar, { background: false, onlyCategories: below, skip, noShadow: true });
      x.restore();
    }
    if (s.image) {
      const m = alignMatrix(s.align, w, h);
      x.save();
      x.globalAlpha = s.partOpacity;
      x.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      x.drawImage(s.image, 0, 0, w, h);
      x.restore();
    }
    if (ghostChar && s.ghost) {
      x.save();
      x.globalAlpha = s.ghostOpacity;
      drawCharacter(x, d, ghostChar, { background: false, onlyCategories: above, skip, noShadow: true });
      x.restore();
    }
    const px = 1 / v.zoom;
    if (s.template) {
      const pose = d.project.poses.find((p) => p.id === poseId);
      x.save();
      x.globalAlpha = 0.75;
      drawTemplate(x, W, H, pose?.guide ?? 'front', pose?.guideImage, px);
      x.restore();
    }
    drawSymmetry(x, prefsStore.get().symmetryX * W, H, px * 0.6);
    x.strokeStyle = 'rgba(0,0,0,0.25)';
    x.lineWidth = px;
    x.strokeRect(0, 0, W, H);
  };
  const requestDraw = () => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  };

  useEffect(requestDraw);
  useEffect(() => {
    const subs = [vp.store.subscribe(requestDraw), onAssetLoaded(requestDraw)];
    return () => {
      subs.forEach((u) => u());
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      vp.w = r.width;
      vp.h = r.height;
      if (!vp.touched && r.width > 0) vp.fit(W, H, 16);
      requestDraw();
    });
    ro.observe(el);
    let dragStart: { cx: number; cy: number; a: Align } | null = null;
    const tool: ToolHandlers = {
      down: (p) => {
        const a = state.current.align;
        const m = alignMatrix(a, w, h);
        const [ix, iy] = apply(invert(m), p.cx, p.cy);
        if (ix < 0 || iy < 0 || ix > w || iy > h) return false;
        dragStart = { cx: p.cx, cy: p.cy, a };
        return true;
      },
      move: (p) => {
        if (!dragStart) return;
        let dx = p.cx - dragStart.cx;
        let dy = p.cy - dragStart.cy;
        if (p.e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        state.current.onChange({ ...dragStart.a, x: Math.round(dragStart.a.x + dx), y: Math.round(dragStart.a.y + dy) });
      },
      up: () => (dragStart = null),
      cancel: () => {
        if (dragStart) state.current.onChange(dragStart.a);
        dragStart = null;
      },
    };
    const off = attachViewport(el, vp, () => tool);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const step = e.shiftKey ? 10 : 1;
      const a = state.current.align;
      const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const d = map[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      state.current.onChange({ ...a, x: a.x + d[0], y: a.y + d[1] });
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      ro.disconnect();
      off();
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h]);

  void view;
  const m = alignMatrix(align, w, h);
  const scalePct = Math.round(align.scale * 1000) / 10;
  const anchor = categoryAnchor(categoryId, W, H);

  return (
    <div className="align-editor">
      <div className="align-stage" ref={wrapRef}>
        <canvas ref={canvasRef} className="stage-canvas" />
        <TransformHandles
          vp={vp}
          corners={corners(m, w, h)}
          center={[align.x, align.y]}
          onBegin={() => (start.current = align)}
          onScale={(f) => onChange({ ...start.current, scale: Math.max(0.01, start.current.scale * f) })}
          onRotate={(delta, e) => {
            let r = start.current.rotation + delta;
            if (e.shiftKey) r = Math.round(r / 15) * 15;
            onChange({ ...start.current, rotation: Math.round(r * 10) / 10 });
          }}
          onEnd={() => {}}
        />
        <div className="stage-hint">Drag the part · corners scale · top handle rotates · arrow keys nudge · scroll/pinch to zoom</div>
      </div>
      <div className="align-controls">
        <Slider label="Scale" tip="Size of the part on the canvas" value={scalePct} min={1} max={400} step={0.5} unit="%" onChange={(v) => onChange({ ...align, scale: v / 100 })} />
        <Slider label="Rotate" tip="Rotation" value={align.rotation} min={-180} max={180} unit="°" onChange={(rotation) => onChange({ ...align, rotation })} />
        <Slider label="X" tip="Center X on the canvas" value={Math.round(align.x)} min={-W} max={W * 2} unit="px" onChange={(x) => onChange({ ...align, x })} />
        <Slider label="Y" tip="Center Y on the canvas" value={Math.round(align.y)} min={-H} max={H * 2} unit="px" onChange={(y) => onChange({ ...align, y })} />
        <div className="row wrap">
          <Btn small label="Center" icon="symmetry" tip="Center horizontally on the symmetry line" onClick={() => onChange({ ...align, x: prefsStore.get().symmetryX * W })} />
          <Btn small label="To guide" icon="template" tip="Move to the template's spot for this category" onClick={() => onChange({ ...align, x: anchor[0], y: anchor[1] })} />
          <Btn
            small
            label="Fit width"
            icon="fit"
            tip="Scale to the canvas width"
            onClick={() => onChange({ ...align, scale: W / (w * Math.abs(Math.cos(align.rotation * DEG)) + h * Math.abs(Math.sin(align.rotation * DEG))) })}
          />
          <Btn small icon="fit" tip="Fit the view" onClick={() => vp.fit(W, H, 16)} />
        </div>
        <Toggle label="Show current character" tip="Ghost of the character you are editing, to line things up" checked={ghost} onChange={setGhost} />
        {ghost && <Slider label="Ghost" tip="Ghost opacity" value={Math.round(ghostOpacity * 100)} min={5} max={100} unit="%" onChange={(v) => setGhostOpacity(v / 100)} />}
        <Toggle label="Template guides" tip="Head, eye and shoulder guide lines" checked={template} onChange={setTemplate} />
        <Slider label="Part" tip="See-through amount of the part while aligning" value={Math.round(partOpacity * 100)} min={10} max={100} unit="%" onChange={(v) => setPartOpacity(v / 100)} />
      </div>
    </div>
  );
}
