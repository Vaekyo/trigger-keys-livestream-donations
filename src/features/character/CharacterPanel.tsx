import { useRef, useState } from 'react';
import type { BackgroundSpec, ColorSpec, ID, PatternKind, ShapeKind } from '../../model/types';
import { docStore, useDoc } from '../../state/store';
import { openDialog, toast, useUI } from '../../state/ui';
import {
  addShape,
  applyExpression,
  applyPalette,
  deleteExpression,
  moveExpression,
  PRESET_PALETTES,
  renameCharacter,
  renameExpression,
  saveExpression,
  setBackground,
  setGroupColor,
  setPose,
  setShadow,
} from '../../state/actions';
import { noColor } from '../../model/defaults';
import { Btn, Section, Segmented, Select, Slider, TextField, Toggle } from '../../ui/controls';
import { ColorButton } from '../../ui/ColorPicker';
import { MenuButton, promptDialog, confirmDialog } from '../../ui/overlays';
import { ColorSpecEditor } from '../inspector/ColorPanel';
import { decodeBlob, saveAsset } from '../../db/assets';
import { defaultShape, SHAPE_LABELS } from '../../render/shapes';
import { randomizeActive } from '../randomize/randomize';
import { Icon } from '../../ui/Icon';

const begin = (label: string) => () => docStore.begin(label);
const end = () => docStore.end();

function specChip(spec: ColorSpec | undefined): string {
  if (!spec || spec.mode === 'none') return 'linear-gradient(135deg,#fff 0 45%,#ddd 45% 55%,#fff 55%)';
  if (spec.mode === 'tint') return spec.gradient ? `linear-gradient(180deg, ${spec.fill}, ${spec.gradient.color2})` : spec.fill;
  return `hsl(${spec.h}, 70%, 60%)`;
}

export function CharacterPanel() {
  const charId = useUI((s) => s.characterId);
  const char = useDoc((d) => (charId ? d.characters[charId] : undefined));
  const project = useDoc((d) => d.project);
  const [openGroup, setOpenGroup] = useState<ID | null>(null);
  if (!char) return null;
  return (
    <div className="inspector">
      <Section title="Character">
        <label className="field">
          <span className="muted small">Name</span>
          <TextField value={char.name} tip="Character name" onCommit={(n) => renameCharacter(char.id, n)} />
        </label>
        <label className="field">
          <span className="muted small">Pose</span>
          <Select
            tip="Pose / head angle. Only parts made for this pose are shown and drawn."
            value={char.poseId}
            onChange={(p) => setPose(p)}
            options={project.poses.map((p) => ({ value: p.id, label: p.name }))}
          />
        </label>
        <div className="row wrap">
          <Btn small icon="gallery" label="Gallery" tip="All your saved characters" onClick={() => openDialog({ kind: 'gallery' })} />
          <Btn small icon="gear" label="Poses…" tip="Add or edit poses and their template guides" onClick={() => openDialog({ kind: 'project-settings', tab: 'poses' })} />
        </div>
      </Section>

      <Section title="Colors" tour="groups" actions={<Btn small icon="dice" tip="Randomize colors only" onClick={() => randomizeActive({ mode: 'colors' })} />}>
        <p className="muted small">Linked color groups. Every part linked to a group shares its color.</p>
        <ul className="group-list">
          {project.colorGroups.map((g) => {
            const spec = char.groupColors[g.id];
            const members = char.items.filter((i) => i.colorGroupId === g.id).length;
            const open = openGroup === g.id;
            return (
              <li key={g.id} className={open ? 'is-open' : ''}>
                <button type="button" className="group-row" onClick={() => setOpenGroup(open ? null : g.id)} data-tip={`Edit the ${g.name} color (${members} linked part${members === 1 ? '' : 's'})`} aria-expanded={open}>
                  <span className="color-chip" style={{ background: specChip(spec) }} />
                  <span className="grow">{g.name}</span>
                  <span className="muted small">{members} 🔗</span>
                  <Icon name={open ? 'chevUp' : 'chevDown'} size={14} />
                </button>
                {open && (
                  <div className="group-editor">
                    <ColorSpecEditor spec={spec ?? noColor()} hasLine onChange={(s) => setGroupColor(g.id, s)} />
                    {spec && spec.mode !== 'none' && (
                      <Btn small icon="reset" label="Original colors" tip="Stop recoloring this group" onClick={() => setGroupColor(g.id, noColor(), 'Reset group color')} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <Btn small icon="gear" label="Edit groups…" tip="Create your own groups (e.g. “eye + earring gem”) and choose default groups per category" onClick={() => openDialog({ kind: 'project-settings', tab: 'groups' })} />
      </Section>

      <Section title="Preset palettes" collapsible tour="palettes">
        <div className="palette-grid">
          {PRESET_PALETTES.map((p) => (
            <button key={p.name} type="button" className="palette" onClick={() => applyPalette(p)} data-tip={`Apply “${p.name}” to all color groups`}>
              <span className="palette-dots">
                {[p.hair, p.eyes, p.skin, p.outfit, p.line].map((c, i) => (
                  <span key={i} style={{ background: c }} />
                ))}
              </span>
              <span className="small">{p.name}</span>
            </button>
          ))}
        </div>
      </Section>

      <ExpressionsSection />
      <ShapesSection />
      <BackgroundSection bg={char.background} />
      <ShadowSection />
    </div>
  );
}

function ExpressionsSection() {
  const charId = useUI((s) => s.characterId);
  const char = useDoc((d) => (charId ? d.characters[charId] : undefined));
  const cats = useDoc((d) => d.project.expressionCategoryIds);
  const categories = useDoc((d) => d.project.categories);
  if (!char) return null;
  const catNames = cats.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean).join(' + ');
  return (
    <Section
      title="Expressions"
      collapsible
      tour="expressions"
      actions={
        <Btn
          small
          icon="plus"
          tip="Save the current face as a named expression"
          onClick={async () => {
            const name = await promptDialog({ title: 'Save expression', message: `Saves the current ${catNames}.`, placeholder: 'happy, angry, flustered…', confirmLabel: 'Save' });
            if (name) saveExpression(name);
          }}
        />
      }
    >
      <p className="muted small">
        Saves {catNames || 'the expression categories'} as one-click presets.{' '}
        <button type="button" className="link" onClick={() => openDialog({ kind: 'project-settings', tab: 'expressions' })}>
          Change categories
        </button>
      </p>
      {char.expressions.length === 0 ? (
        <p className="muted small">No expressions yet. Set up a face, then press +.</p>
      ) : (
        <ul className="expr-list">
          {char.expressions.map((e, i) => (
            <li key={e.id}>
              <button type="button" className="expr-apply" onClick={() => applyExpression(e.id)} data-tip={`Apply “${e.name}”`}>
                <Icon name="smile" size={16} /> {e.name}
              </button>
              <MenuButton
                small
                tip="Expression options"
                items={[
                  { label: 'Update with current face', icon: 'refresh', onClick: () => saveExpression(e.name, e.id) },
                  {
                    label: 'Rename…',
                    icon: 'text',
                    onClick: async () => {
                      const n = await promptDialog({ title: 'Rename expression', value: e.name });
                      if (n) renameExpression(e.id, n);
                    },
                  },
                  { label: 'Move up', icon: 'chevUp', disabled: i === 0, onClick: () => moveExpression(e.id, -1) },
                  { label: 'Move down', icon: 'chevDown', disabled: i === char.expressions.length - 1, onClick: () => moveExpression(e.id, 1) },
                  { separator: true, label: '' },
                  {
                    label: 'Delete',
                    icon: 'trash',
                    danger: true,
                    onClick: async () => {
                      if (await confirmDialog({ title: `Delete expression “${e.name}”?`, confirmLabel: 'Delete', danger: true, message: 'You can undo this.' })) deleteExpression(e.id);
                    },
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {char.expressions.length > 0 && (
        <Btn small icon="gallery" label="Export expression sheet…" tip="All expressions of this character in one image" onClick={() => openDialog({ kind: 'export', tab: 'sheet' })} />
      )}
    </Section>
  );
}

const SHAPE_KINDS: ShapeKind[] = ['bubble', 'shout', 'thought', 'text', 'sparkle', 'sweat', 'anger', 'heart', 'star', 'note', 'lines'];

function shapeCategory(kind: ShapeKind, ids: ID[]): ID {
  const has = (id: ID) => ids.includes(id);
  const effects = ['sparkle', 'sweat', 'anger', 'note', 'lines'];
  if (effects.includes(kind) && has('effects')) return 'effects';
  if (has('stickers')) return 'stickers';
  return ids[ids.length - 1] ?? '';
}

function ShapesSection() {
  const ids = useDoc((d) => d.project.categories.map((c) => c.id).join('|'));
  return (
    <Section title="Text, bubbles & stickers" collapsible defaultOpen={false} tour="shapes">
      <div className="shape-grid">
        {SHAPE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="shape-btn"
            data-tip={`Add a ${SHAPE_LABELS[k].toLowerCase()}`}
            onClick={() => addShape(defaultShape(k, shapeCategory(k, ids.split('|'))))}
          >
            <ShapeIcon kind={k} />
            <span className="small">{SHAPE_LABELS[k]}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function ShapeIcon({ kind }: { kind: ShapeKind }) {
  const map: Partial<Record<ShapeKind, string>> = { sparkle: '✨', sweat: '💧', anger: '💢', heart: '💗', star: '⭐', note: '🎵', lines: '❗', text: 'Aa', bubble: '💬', shout: '🗯️', thought: '💭' };
  return <span className="shape-emoji">{map[kind]}</span>;
}

const PATTERNS: { value: PatternKind; label: string }[] = [
  { value: 'dots', label: 'Polka dots' },
  { value: 'stripes', label: 'Stripes' },
  { value: 'checks', label: 'Gingham' },
  { value: 'grid', label: 'Grid' },
  { value: 'hearts', label: 'Hearts' },
  { value: 'stars', label: 'Stars' },
  { value: 'sunburst', label: 'Sunburst' },
];

function BackgroundSection({ bg }: { bg: BackgroundSpec }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Section title="Background" collapsible defaultOpen={false} tour="background">
      <Segmented
        tip="Background type (drawn behind every part)"
        value={bg.type}
        onChange={(type) => {
          if (type === 'image' && !bg.image) fileRef.current?.click();
          else setBackground({ type });
        }}
        options={[
          { value: 'none', label: 'None', tip: 'Transparent (or use a background part from the library)' },
          { value: 'solid', label: 'Solid', tip: 'One color' },
          { value: 'gradient', label: 'Gradient', tip: 'Two-color gradient' },
          { value: 'pattern', label: 'Pattern', tip: 'Simple generated pattern' },
          { value: 'image', label: 'Image', tip: 'Upload an image' },
        ]}
        small
      />
      {bg.type !== 'none' && (
        <div className="row wrap">
          <ColorButton label={bg.type === 'pattern' ? 'Base' : bg.type === 'image' ? 'Fill' : 'Color'} value={bg.color} tip="Background color" onStart={begin('Background color')} onEnd={end} onChange={(color) => setBackground({ color })} />
          {(bg.type === 'gradient' || bg.type === 'pattern') && (
            <ColorButton label={bg.type === 'pattern' ? 'Pattern' : 'Color 2'} value={bg.color2} tip="Second color" onStart={begin('Background color')} onEnd={end} onChange={(color2) => setBackground({ color2 })} />
          )}
        </div>
      )}
      {bg.type === 'gradient' && (
        <Slider label="Direction" tip="Gradient direction" value={bg.angle} min={0} max={360} unit="°" onStart={begin('Background gradient')} onEnd={end} onChange={(angle) => setBackground({ angle })} />
      )}
      {bg.type === 'pattern' && (
        <>
          <Select tip="Pattern" value={bg.pattern} onChange={(pattern) => setBackground({ pattern })} options={PATTERNS} />
          <Slider
            label="Size"
            tip="Pattern size"
            value={Math.round(bg.patternScale * 100)}
            min={25}
            max={400}
            unit="%"
            onStart={begin('Pattern size')}
            onEnd={end}
            onChange={(v) => setBackground({ patternScale: v / 100 })}
          />
        </>
      )}
      {bg.type === 'image' && <Btn small icon="image" label="Choose image…" tip="Upload a background image" onClick={() => fileRef.current?.click()} />}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const img = await decodeBlob(f);
            const id = await saveAsset(f, img.width, img.height, img);
            setBackground({ type: 'image', image: id }, 'Background image');
          } catch {
            toast('That file could not be read as an image.');
          }
        }}
      />
    </Section>
  );
}

function ShadowSection() {
  const charId = useUI((s) => s.characterId);
  const sh = useDoc((d) => (charId ? d.characters[charId]?.shadow : undefined));
  if (!sh) return null;
  return (
    <Section title="Drop shadow" collapsible defaultOpen={false}>
      <Toggle label="Shadow behind the character" tip="Soft drop shadow behind all non-background parts" checked={sh.on} onChange={(on) => setShadow({ on })} />
      {sh.on && (
        <div className="stack">
          <ColorButton label="Color" value={sh.color} tip="Shadow color" onStart={begin('Shadow color')} onEnd={end} onChange={(color) => setShadow({ color })} />
          <Slider label="Blur" tip="Softness" value={sh.blur} min={0} max={120} unit="px" onStart={begin('Shadow blur')} onEnd={end} onChange={(blur) => setShadow({ blur })} />
          <Slider label="Offset X" tip="Horizontal offset" value={sh.x} min={-150} max={150} unit="px" onStart={begin('Shadow offset')} onEnd={end} onChange={(x) => setShadow({ x })} />
          <Slider label="Offset Y" tip="Vertical offset" value={sh.y} min={-150} max={150} unit="px" onStart={begin('Shadow offset')} onEnd={end} onChange={(y) => setShadow({ y })} />
          <Slider
            label="Strength"
            tip="Shadow opacity"
            value={Math.round(sh.opacity * 100)}
            min={0}
            max={100}
            unit="%"
            onStart={begin('Shadow strength')}
            onEnd={end}
            onChange={(v) => setShadow({ opacity: v / 100 })}
          />
        </div>
      )}
    </Section>
  );
}

