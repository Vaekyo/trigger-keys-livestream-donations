import type { Instance, ShapeSpec } from '../../model/types';
import { docStore, useDoc } from '../../state/store';
import { currentSelection, openDialog, setUI, useUI } from '../../state/ui';
import {
  duplicateInstances,
  flipInstances,
  mirrorInstances,
  removeInstances,
  resetInstances,
  setInstancesHidden,
  stepLayer,
  updateInstance,
} from '../../state/actions';
import { Btn, Empty, Kbd, Section, Slider } from '../../ui/controls';
import { ColorButton } from '../../ui/ColorPicker';
import { LazyThumb } from '../library/LazyThumb';
import { useSelectedInstance } from '../canvas/CanvasView';
import { ColorPanel } from './ColorPanel';
import { SHAPE_LABELS, shapeHasText } from '../../render/shapes';
import { Icon } from '../../ui/Icon';

const begin = (label: string) => () => docStore.begin(label);
const end = () => docStore.end();

export function PartInspector() {
  const inst = useSelectedInstance();
  const count = useUI((s) => s.selection.length);
  const project = useDoc((d) => d.project);
  const part = useDoc((d) => (inst ? d.parts[inst.partId] : undefined));
  if (!inst) {
    return (
      <div className="inspector">
        <Empty icon="move" title="No part selected">
          <p>Click a part on the canvas (or pick one in the library) to move, scale, flip and recolor it.</p>
          <p className="muted small">
            Tips: <Kbd>Alt</Kbd>+click selects the part underneath · <Kbd>Shift</Kbd>+click selects several · arrow keys nudge.
          </p>
        </Empty>
      </div>
    );
  }
  const cat = project.categories.find((c) => c.id === (inst.shape ? inst.shape.category : part?.categoryId));
  const W = project.width;
  const H = project.height;
  return (
    <div className="inspector">
      <header className="insp-head">
        {inst.shape ? (
          <div className="thumb shape-thumb">
            <Icon name="bubble" size={28} />
          </div>
        ) : (
          <LazyThumb assetId={part?.thumb} alt={part?.name ?? ''} />
        )}
        <div className="grow">
          <strong className="ellipsis">{inst.shape ? SHAPE_LABELS[inst.shape.kind] : (part?.name ?? 'Missing part')}</strong>
          <span className="muted small">
            {cat ? `${cat.icon} ${cat.name}` : ''}
            {count > 1 ? ` · ${count} selected` : ''}
          </span>
        </div>
      </header>
      <div className="action-row">
        <Btn icon="flipH" tip="Flip horizontally (H)" onClick={() => flipInstances(currentSelection(), 'x')} />
        <Btn icon="flipV" tip="Flip vertically (V)" onClick={() => flipInstances(currentSelection(), 'y')} />
        <Btn icon="mirror" tip="Mirror to the other side of the symmetry line" onClick={() => mirrorInstances(currentSelection())} />
        <Btn icon="copy" tip="Duplicate (Ctrl+D)" onClick={() => duplicateInstances(currentSelection())} />
        <Btn icon="reset" tip="Reset to default alignment (R)" onClick={() => resetInstances(currentSelection())} />
        <Btn icon="chevDown" tip="Move layer down ([)" onClick={() => stepLayer(inst.id, -1)} />
        <Btn icon="chevUp" tip="Move layer up (])" onClick={() => stepLayer(inst.id, 1)} />
        <Btn icon={inst.hidden ? 'eyeOff' : 'eye'} tip={inst.hidden ? 'Show' : 'Hide'} onClick={() => setInstancesHidden(currentSelection(), !inst.hidden)} />
        <Btn icon="trash" tip="Remove from character (Delete)" variant="danger" onClick={() => removeInstances(currentSelection())} />
      </div>
      {!inst.shape && part && (
        <p className="row small">
          <button type="button" className="link" onClick={() => openDialog({ kind: 'align', partId: part.id })} data-tip="Change where this part sits by default, for every character">
            Edit default alignment…
          </button>
          <span className="muted">·</span>
          <button
            type="button"
            className="link"
            onClick={() => setUI({ activeCategoryId: part.categoryId, libraryQuery: '', mobileTab: 'library' })}
            data-tip="Show this part's category in the library"
          >
            Show in library
          </button>
        </p>
      )}
      <Section title="Position & size" collapsible>
        <Slider label="X" tip="Horizontal offset from the default position" value={inst.dx} min={-W} max={W} unit="px" onStart={begin('Move part')} onEnd={end} onChange={(dx) => updateInstance(inst.id, { dx })} />
        <Slider label="Y" tip="Vertical offset from the default position" value={inst.dy} min={-H} max={H} unit="px" onStart={begin('Move part')} onEnd={end} onChange={(dy) => updateInstance(inst.id, { dy })} />
        <Slider
          label="Scale"
          tip="Size relative to the default"
          value={Math.round(inst.scale * 100)}
          min={5}
          max={400}
          unit="%"
          onStart={begin('Scale part')}
          onEnd={end}
          onChange={(v) => updateInstance(inst.id, { scale: v / 100 })}
        />
        <Slider label="Rotate" tip="Rotation in degrees" value={inst.rotation} min={-180} max={180} unit="°" onStart={begin('Rotate part')} onEnd={end} onChange={(rotation) => updateInstance(inst.id, { rotation })} />
        <Slider
          label="Opacity"
          tip="Transparency"
          value={Math.round(inst.opacity * 100)}
          min={0}
          max={100}
          unit="%"
          onStart={begin('Change opacity')}
          onEnd={end}
          onChange={(v) => updateInstance(inst.id, { opacity: v / 100 })}
        />
      </Section>
      {inst.shape ? (
        <Section title="Shape" collapsible>
          <ShapeEditor inst={inst} shape={inst.shape} />
        </Section>
      ) : (
        <Section title="Color" collapsible tour="color">
          <ColorPanel inst={inst} />
        </Section>
      )}
    </div>
  );
}

function ShapeEditor({ inst, shape }: { inst: Instance; shape: ShapeSpec }) {
  const set = (patch: Partial<ShapeSpec>) => updateInstance(inst.id, (i) => ({ ...i, shape: { ...i.shape!, ...patch } }), 'Edit shape');
  return (
    <div className="stack">
      {shapeHasText(shape.kind) && (
        <label className="field">
          <span className="muted small">Text</span>
          <textarea
            className="text-input"
            rows={2}
            defaultValue={shape.text}
            key={inst.id}
            data-tip="Text inside the bubble (Enter for a new line)"
            onBlur={(e) => e.target.value !== shape.text && set({ text: e.target.value })}
          />
        </label>
      )}
      {shapeHasText(shape.kind) && (
        <Slider label="Font size" tip="Text size" value={shape.fontSize} min={12} max={200} unit="px" onStart={begin('Edit shape')} onEnd={end} onChange={(fontSize) => set({ fontSize })} />
      )}
      <Slider label="Width" tip="Shape width" value={shape.w} min={30} max={1600} unit="px" onStart={begin('Resize shape')} onEnd={end} onChange={(w) => set({ w })} />
      <Slider label="Height" tip="Shape height" value={shape.h} min={30} max={1600} unit="px" onStart={begin('Resize shape')} onEnd={end} onChange={(h) => set({ h })} />
      {(shape.kind === 'bubble' || shape.kind === 'shout' || shape.kind === 'thought') && (
        <Slider label="Tail" tip="Direction of the bubble's tail" value={shape.tail} min={0} max={360} unit="°" onStart={begin('Edit shape')} onEnd={end} onChange={(tail) => set({ tail })} />
      )}
      <div className="row wrap">
        <ColorButton label="Fill" value={shape.fill} tip="Fill color" onStart={begin('Shape color')} onEnd={end} onChange={(fill) => set({ fill })} />
        <ColorButton label="Outline" value={shape.stroke} tip="Outline color" onStart={begin('Shape color')} onEnd={end} onChange={(stroke) => set({ stroke })} />
        {shapeHasText(shape.kind) && <ColorButton label="Text" value={shape.textColor} tip="Text color" onStart={begin('Shape color')} onEnd={end} onChange={(textColor) => set({ textColor })} />}
      </div>
    </div>
  );
}
