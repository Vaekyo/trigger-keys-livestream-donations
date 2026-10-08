import { useStore } from '../../state/store';
import type { Viewport } from './viewport';

export type HandleKind = 'scale' | 'rotate';

interface Props {
  vp: Viewport;
  /** Frame corners in canvas coordinates (TL, TR, BR, BL of the image). */
  corners: [number, number][];
  center: [number, number];
  onBegin: (kind: HandleKind) => void;
  /** factor relative to gesture start */
  onScale: (factor: number) => void;
  /** degrees relative to gesture start; `absolute` is the pointer angle */
  onRotate: (delta: number, e: PointerEvent) => void;
  onEnd: () => void;
  others?: [number, number][][];
}

export function TransformHandles({ vp, corners, center, onBegin, onScale, onRotate, onEnd, others }: Props) {
  useStore(vp.store, (v) => v);
  const pts = corners.map(([x, y]) => vp.toScreen(x, y));
  const c = vp.toScreen(center[0], center[1]);
  const topMid: [number, number] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  let dirX = topMid[0] - c[0];
  let dirY = topMid[1] - c[1];
  const len = Math.hypot(dirX, dirY) || 1;
  dirX /= len;
  dirY /= len;
  const rot: [number, number] = [topMid[0] + dirX * 34, topMid[1] + dirY * 34];

  const start = (kind: HandleKind) => (e: React.PointerEvent<SVGElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const svg = el.ownerSVGElement ?? (el as unknown as SVGSVGElement);
    const r = svg.getBoundingClientRect();
    const [ccx, ccy] = vp.toScreen(center[0], center[1]);
    const p0 = [e.clientX - r.left - ccx, e.clientY - r.top - ccy];
    const d0 = Math.hypot(p0[0], p0[1]) || 1;
    const a0 = Math.atan2(p0[1], p0[0]);
    onBegin(kind);
    const move = (ev: PointerEvent) => {
      const px = ev.clientX - r.left - ccx;
      const py = ev.clientY - r.top - ccy;
      if (kind === 'scale') onScale(Math.max(0.02, Math.hypot(px, py) / d0));
      else onRotate(((Math.atan2(py, px) - a0) * 180) / Math.PI, ev);
    };
    const up = () => {
      el.removeEventListener('pointermove', move as EventListener);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onEnd();
    };
    el.addEventListener('pointermove', move as EventListener);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const poly = (p: [number, number][]) => p.map((q) => q.join(',')).join(' ');

  return (
    <svg className="handles" aria-hidden="true">
      {others?.map((o, i) => (
        <polygon key={i} points={poly(o.map(([x, y]) => vp.toScreen(x, y)))} className="handles-other" />
      ))}
      <polygon points={poly(pts)} className="handles-box" />
      <line x1={topMid[0]} y1={topMid[1]} x2={rot[0]} y2={rot[1]} className="handles-stalk" />
      <g data-no-viewport="">
        {pts.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={18} className="handle-hit" onPointerDown={start('scale')} data-tip="Drag to scale" />
            <circle cx={x} cy={y} r={7} className="handle" pointerEvents="none" />
          </g>
        ))}
        <circle cx={rot[0]} cy={rot[1]} r={18} className="handle-hit" onPointerDown={start('rotate')} data-tip="Drag to rotate (Shift snaps to 15°)" />
        <circle cx={rot[0]} cy={rot[1]} r={7} className="handle is-rotate" pointerEvents="none" />
      </g>
    </svg>
  );
}
