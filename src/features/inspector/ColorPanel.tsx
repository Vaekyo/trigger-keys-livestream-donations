import type { ColorSpec, Instance } from '../../model/types';
import { docStore, useDoc } from '../../state/store';
import { useUI } from '../../state/ui';
import { linkInstance, setInstanceColor } from '../../state/actions';
import { resolveColor } from '../../render/compositor';
import { mixHex } from '../../render/color';
import { Segmented, Select, Slider, Toggle } from '../../ui/controls';
import { ColorButton, ColorPicker } from '../../ui/ColorPicker';
import { startEyedropper } from '../../state/ui';

const begin = () => docStore.begin('Change color');
const end = () => docStore.end();

/** Editor for a ColorSpec (shared by part colors and group colors). */
export function ColorSpecEditor({
  spec,
  onChange,
  hasLine,
  hint,
}: {
  spec: ColorSpec;
  onChange: (spec: ColorSpec) => void;
  hasLine: boolean;
  hint?: string;
}) {
  const set = (patch: Partial<ColorSpec>) => onChange({ ...spec, ...patch });
  const g = spec.gradient;
  return (
    <div className="color-editor">
      <Segmented
        tip="How this part is recolored"
        value={spec.mode}
        onChange={(mode) => {
          begin();
          set({ mode });
          end();
        }}
        options={[
          { value: 'none', label: 'Original', tip: 'Keep the original colors of the image' },
          { value: 'shift', label: 'Shift', tip: 'Shift hue, saturation and brightness — works on any image' },
          { value: 'tint', label: 'Tint', tip: 'Smart tint: colors a grayscale fill while keeping its shading' },
        ]}
      />
      {hint && <p className="muted small">{hint}</p>}
      {spec.mode === 'shift' && (
        <div className="stack">
          <Slider
            label="Hue"
            tip="Rotate the hue"
            value={spec.h}
            min={-180}
            max={180}
            unit="°"
            gradient="linear-gradient(90deg,#0ff,#00f,#f0f,#f00,#ff0,#0f0,#0ff)"
            onStart={begin}
            onEnd={end}
            onChange={(h) => set({ h })}
          />
          <Slider label="Saturation" tip="More or less colorful" value={spec.s} min={-100} max={100} unit="%" onStart={begin} onEnd={end} onChange={(s) => set({ s })} />
          <Slider label="Brightness" tip="Lighter or darker" value={spec.b} min={-100} max={100} unit="%" onStart={begin} onEnd={end} onChange={(b) => set({ b })} />
        </div>
      )}
      {spec.mode === 'tint' && (
        <div className="stack">
          <ColorPicker
            value={spec.fill}
            onChange={(fill) => set({ fill })}
            onStart={begin}
            onEnd={end}
            onEyedropper={() =>
              startEyedropper((fill) => {
                begin();
                set({ fill });
                end();
              })
            }
          />
          <Toggle
            label="Two-color gradient"
            tip="Blend into a second color (e.g. hair tips)"
            checked={!!g}
            onChange={(on) => {
              begin();
              set({ gradient: on ? { color2: mixHex(spec.fill, '#ffffff', 0.55), angle: 180, start: 0.45, end: 1 } : null });
              end();
            }}
          />
          {g && (
            <div className="stack indent">
              <div className="row">
                <span className="muted small grow">Second color</span>
                <ColorButton value={g.color2} tip="Second gradient color" onStart={begin} onEnd={end} onChange={(color2) => set({ gradient: { ...g, color2 } })} />
              </div>
              <Slider label="Direction" tip="Gradient direction (180° = top to bottom)" value={g.angle} min={0} max={360} unit="°" onStart={begin} onEnd={end} onChange={(angle) => set({ gradient: { ...g, angle } })} />
              <Slider
                label="Starts at"
                tip="Where the blend begins"
                value={Math.round(g.start * 100)}
                min={0}
                max={100}
                unit="%"
                onStart={begin}
                onEnd={end}
                onChange={(v) => set({ gradient: { ...g, start: v / 100 } })}
              />
              <Slider
                label="Ends at"
                tip="Where the second color is reached"
                value={Math.round(g.end * 100)}
                min={0}
                max={100}
                unit="%"
                onStart={begin}
                onEnd={end}
                onChange={(v) => set({ gradient: { ...g, end: v / 100 } })}
              />
            </div>
          )}
        </div>
      )}
      {hasLine && (
        <div className="row">
          <Toggle
            label="Recolor line art"
            tip="Give the line art its own color (e.g. dark brown lines for warm palettes)"
            checked={!!spec.line}
            onChange={(on) => {
              begin();
              set({ line: on ? mixHex(spec.mode === 'tint' ? spec.fill : '#5a3a2a', '#000000', 0.6) : null });
              end();
            }}
          />
          {spec.line && <ColorButton value={spec.line} tip="Line art color" onStart={begin} onEnd={end} onChange={(line) => set({ line })} />}
        </div>
      )}
    </div>
  );
}

export function ColorPanel({ inst }: { inst: Instance }) {
  const charId = useUI((s) => s.characterId);
  const char = useDoc((d) => (charId ? d.characters[charId] : undefined));
  const project = useDoc((d) => d.project);
  const part = useDoc((d) => d.parts[inst.partId]);
  if (!char) return null;
  const spec = resolveColor(project, char, inst);
  const group = inst.colorGroupId ? project.colorGroups.find((g) => g.id === inst.colorGroupId) : undefined;
  const linked = group ? char.items.filter((i) => i.colorGroupId === group.id).length : 0;
  const hasLine = !!part?.images.line;
  const grayscaleFriendly = !!part?.images.fill;
  return (
    <div className="stack">
      <div className="row">
        <span className="muted small">Color link</span>
        <Select
          className="grow"
          tip="Linked parts share one color (e.g. hair-back, hair-front and brows). Choose “Own color” to unlink."
          value={inst.colorGroupId ?? ''}
          onChange={(v) => linkInstance(inst.id, v || null)}
          options={[{ value: '', label: 'Own color (unlinked)' }, ...project.colorGroups.map((g) => ({ value: g.id, label: `🔗 ${g.name}` }))]}
        />
      </div>
      {group && (
        <p className="muted small">
          {linked > 1
            ? `Shared with ${linked - 1} other part${linked - 1 === 1 ? '' : 's'} in the “${group.name}” group — changes apply to all of them.`
            : `Uses the “${group.name}” group color. Other parts linked to “${group.name}” will share it.`}
        </p>
      )}
      <ColorSpecEditor
        spec={spec}
        hasLine={hasLine}
        hint={spec.mode === 'tint' && !grayscaleFriendly ? 'Tint multiplies the image: it works best on grayscale/white artwork.' : undefined}
        onChange={(s) => setInstanceColor(inst.id, s)}
      />
    </div>
  );
}
