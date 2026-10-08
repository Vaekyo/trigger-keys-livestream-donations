import { useMemo, useRef, useState } from 'react';
import type { ID, Instance } from '../../model/types';
import { useDoc } from '../../state/store';
import { select, useUI } from '../../state/ui';
import { moveLayer, resortLayers, setInstancesHidden, stepLayer } from '../../state/actions';
import { homeCategory, slotOf, stackOf } from '../../model/layering';
import { Btn, Empty } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { LazyThumb } from '../library/LazyThumb';
import { SHAPE_LABELS } from '../../render/shapes';

const ROW_H = 46;

export function LayerPanel() {
  const charId = useUI((s) => s.characterId);
  const selection = useUI((s) => s.selection);
  const char = useDoc((d) => (charId ? d.characters[charId] : undefined));
  const project = useDoc((d) => d.project);
  const parts = useDoc((d) => d.parts);
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ id: ID; y0: number; dy: number; target: number } | null>(null);

  const display = useMemo(() => (char ? stackOf(project, parts, char).reverse() : []), [char, project, parts]);
  const catOf = (id: ID) => project.categories.find((c) => c.id === id);
  if (!char) return null;
  if (!display.length) return <Empty icon="layers" title="No parts yet">Pick parts from the library to start building the character.</Empty>;

  const startDrag = (inst: Instance, index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    setDrag({ id: inst.id, y0, dy: 0, target: index });
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      const target = Math.max(0, Math.min(display.length - 1, index + Math.round(dy / ROW_H)));
      setDrag({ id: inst.id, y0, dy, target });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      const dy = ev.clientY - y0;
      const target = Math.max(0, Math.min(display.length - 1, index + Math.round(dy / ROW_H)));
      setDrag(null);
      if (target !== index && ev.type === 'pointerup') {
        // display is top-first; convert to the bottom-up insertion index
        const restLen = display.length - 1;
        moveLayer(inst.id, restLen - target);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div className="layers" data-tour="layers">
      <div className="layers-tools">
        <Btn small icon="chevUp" tip="Move selected layer up (])" disabled={!selection.length} onClick={() => selection[0] && stepLayer(selection[0], 1)} />
        <Btn small icon="chevDown" tip="Move selected layer down ([)" disabled={!selection.length} onClick={() => selection[0] && stepLayer(selection[0], -1)} />
        <span className="grow" />
        <Btn small icon="refresh" label="Re-sort" tip="Put every part back in its category's default order" onClick={resortLayers} />
      </div>
      <ul className="layer-list" ref={listRef} role="listbox" aria-label="Layers, top first">
        {display.map((inst, i) => {
          const part = inst.shape ? undefined : parts[inst.partId];
          const home = homeCategory(inst, parts);
          const slot = slotOf(inst, parts);
          const cat = catOf(home);
          const offPose = !inst.shape && part && !part.poseIds.includes(char.poseId);
          const missing = !inst.shape && (!part || part.deletedAt);
          const isDragging = drag?.id === inst.id;
          let shift = 0;
          if (drag && !isDragging) {
            const from = display.findIndex((x) => x.id === drag.id);
            if (from < i && drag.target >= i) shift = -ROW_H;
            if (from > i && drag.target <= i) shift = ROW_H;
          }
          return (
            <li
              key={inst.id}
              className={`layer${selection.includes(inst.id) ? ' is-selected' : ''}${offPose || missing || inst.hidden ? ' is-dim' : ''}${isDragging ? ' is-dragging' : ''}`}
              style={{ transform: isDragging ? `translateY(${drag!.dy}px)` : shift ? `translateY(${shift}px)` : undefined }}
              role="option"
              aria-selected={selection.includes(inst.id)}
              onClick={(e) => {
                if (e.shiftKey) select(selection.includes(inst.id) ? selection.filter((s) => s !== inst.id) : [...selection, inst.id]);
                else select([inst.id]);
              }}
            >
              <span className="layer-grip" onPointerDown={startDrag(inst, i)} data-tip="Drag to reorder this part only (the category order stays the same)">
                <Icon name="grip" size={16} />
              </span>
              {inst.shape ? (
                <span className="thumb shape-thumb">
                  <Icon name="bubble" size={20} />
                </span>
              ) : (
                <LazyThumb assetId={part?.thumb} alt="" />
              )}
              <span className="layer-text">
                <span className="ellipsis">{inst.shape ? SHAPE_LABELS[inst.shape.kind] : (part?.name ?? 'missing part')}</span>
                <span className="muted small ellipsis">
                  {cat?.icon} {cat?.name}
                  {slot !== home ? ` · moved into ${catOf(slot)?.name ?? '?'}` : ''}
                  {offPose ? ' · not in this pose' : ''}
                  {part?.deletedAt ? ' · in Trash' : ''}
                </span>
              </span>
              <button
                type="button"
                className="layer-eye"
                data-tip={inst.hidden ? 'Show' : 'Hide'}
                aria-label={inst.hidden ? 'Show layer' : 'Hide layer'}
                onClick={(e) => {
                  e.stopPropagation();
                  setInstancesHidden([inst.id], !inst.hidden);
                }}
              >
                <Icon name={inst.hidden ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
