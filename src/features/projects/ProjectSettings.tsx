import { useRef, useState } from 'react';
import type { CropPreset, GroupRole, GuideStyle, ID } from '../../model/types';
import { useDoc } from '../../state/store';
import { closeDialog, setPrefs, toast, usePrefs } from '../../state/ui';
import {
  addColorGroup,
  addPose,
  deleteColorGroup,
  deletePose,
  movePose,
  renameProject,
  resizeCanvas,
  setExpressionCategories,
  updateCategory,
  updateColorGroup,
  updateCrops,
  updatePose,
  type ResizeAnchor,
} from '../../state/actions';
import { uid } from '../../model/ids';
import { decodeBlob, saveAsset } from '../../db/assets';
import { Dialog, confirmDialog, promptDialog } from '../../ui/overlays';
import { Btn, Segmented, Select, Slider, TextField, Toggle } from '../../ui/controls';

const GUIDES: { value: GuideStyle; label: string }[] = [
  { value: 'front', label: 'Bust, front' },
  { value: 'three-quarter', label: 'Bust, 3/4 view' },
  { value: 'full-body', label: 'Full body' },
  { value: 'none', label: 'No guide' },
];

const ROLES: { value: GroupRole; label: string }[] = [
  { value: 'hair', label: 'Hair' },
  { value: 'skin', label: 'Skin' },
  { value: 'eyes', label: 'Eyes' },
  { value: 'outfit', label: 'Outfit' },
  { value: 'accent', label: 'Accent' },
  { value: 'custom', label: 'Custom' },
];

const SIZE_PRESETS = [
  { label: 'Bust 1000×1600', w: 1000, h: 1600 },
  { label: 'Square icon 1000×1000', w: 1000, h: 1000 },
  { label: 'Full body 1000×2000', w: 1000, h: 2000 },
  { label: 'Landscape 1600×1000', w: 1600, h: 1000 },
  { label: 'HD bust 2000×3200', w: 2000, h: 3200 },
];

type Tab = 'general' | 'poses' | 'groups' | 'crops' | 'expressions' | 'canvas';

export function ProjectSettings({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState<Tab>((initial as Tab) ?? 'general');
  return (
    <Dialog title="Project settings" icon="gear" wide onClose={closeDialog} footer={<Btn label="Done" variant="primary" tip="Close" onClick={closeDialog} />}>
      <div className="tabs inline" role="tablist">
        {(
          [
            ['general', 'General'],
            ['poses', 'Poses'],
            ['groups', 'Color groups'],
            ['crops', 'Crop presets'],
            ['expressions', 'Expressions'],
            ['canvas', 'Canvas view'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'general' && <GeneralTab />}
      {tab === 'poses' && <PosesTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'crops' && <CropsTab />}
      {tab === 'expressions' && <ExpressionsTab />}
      {tab === 'canvas' && <CanvasTab />}
    </Dialog>
  );
}

function GeneralTab() {
  const project = useDoc((d) => d.project);
  const [w, setW] = useState(project.width);
  const [h, setH] = useState(project.height);
  const [anchor, setAnchor] = useState<ResizeAnchor>('center');
  const changed = w !== project.width || h !== project.height;
  return (
    <div className="form">
      <label className="field">
        <span>Project name</span>
        <TextField value={project.name} tip="Project name" onCommit={renameProject} />
      </label>
      <div className="field">
        <span>Canvas size</span>
        <div className="row wrap">
          <input className="text-input num-wide" type="number" min={100} max={8000} value={w} onChange={(e) => setW(Math.round(+e.target.value) || 0)} aria-label="Width" data-tip="Width in pixels" />
          ×
          <input className="text-input num-wide" type="number" min={100} max={8000} value={h} onChange={(e) => setH(Math.round(+e.target.value) || 0)} aria-label="Height" data-tip="Height in pixels" />
          <Select
            tip="Common sizes"
            value=""
            onChange={(v) => {
              const p = SIZE_PRESETS.find((s) => s.label === v);
              if (p) {
                setW(p.w);
                setH(p.h);
              }
            }}
            options={[{ value: '', label: 'Presets…' }, ...SIZE_PRESETS.map((s) => ({ value: s.label, label: s.label }))]}
          />
        </div>
        {changed && (
          <div className="stack">
            <Segmented
              tip="Where existing parts stay when the canvas changes size"
              value={anchor}
              onChange={setAnchor}
              options={[
                { value: 'center', label: 'Keep centered' },
                { value: 'top', label: 'Keep at top' },
                { value: 'bottom', label: 'Keep at bottom' },
                { value: 'top-left', label: 'Top-left' },
                { value: 'scale', label: 'Scale to fit' },
              ]}
              small
            />
            <div className="row">
              <Btn
                label={`Resize to ${w}×${h}`}
                variant="primary"
                tip="Apply (undoable)"
                disabled={w < 100 || h < 100 || w > 8000 || h > 8000}
                onClick={() => {
                  resizeCanvas(w, h, anchor);
                  toast('Canvas resized', { undo: true });
                }}
              />
              <Btn
                label="Cancel"
                tip="Keep the current size"
                onClick={() => {
                  setW(project.width);
                  setH(project.height);
                }}
              />
            </div>
          </div>
        )}
        <p className="muted small">Default alignments of all parts move with the canvas, so nothing gets lost.</p>
      </div>
    </div>
  );
}

function PosesTab() {
  const poses = useDoc((d) => d.project.poses);
  const parts = useDoc((d) => d.parts);
  const fileRef = useRef<HTMLInputElement>(null);
  const [imgFor, setImgFor] = useState<ID | null>(null);
  return (
    <div className="form">
      <p className="muted small">
        Poses (or head angles) group your parts. Each part belongs to one or more poses; switching a character's pose shows only compatible parts. Each pose has its own template guide.
      </p>
      <ul className="settings-list">
        {poses.map((p, i) => {
          const count = Object.values(parts).filter((x) => !x.deletedAt && x.poseIds.includes(p.id)).length;
          return (
            <li key={p.id} className="row wrap">
              <TextField value={p.name} tip="Pose name" onCommit={(name) => updatePose(p.id, { name }, 'Rename pose')} />
              <span className="muted small">{count} parts</span>
              <Select tip="Template guide for this pose" value={p.guide} onChange={(guide) => updatePose(p.id, { guide }, 'Change guide')} options={GUIDES} />
              {p.guideImage ? (
                <Btn small icon="x" label="Remove guide image" tip="Use the generated guide again" onClick={() => updatePose(p.id, { guideImage: undefined }, 'Remove guide image')} />
              ) : (
                <Btn
                  small
                  icon="image"
                  label="Guide image…"
                  tip="Use your own template image (e.g. your base drawing) as the guide"
                  onClick={() => {
                    setImgFor(p.id);
                    fileRef.current?.click();
                  }}
                />
              )}
              <Btn small icon="chevUp" tip="Move up" disabled={i === 0} onClick={() => movePose(p.id, -1)} />
              <Btn small icon="chevDown" tip="Move down" disabled={i === poses.length - 1} onClick={() => movePose(p.id, 1)} />
              <Btn
                small
                icon="trash"
                variant="danger"
                tip="Delete pose"
                disabled={poses.length <= 1}
                onClick={async () => {
                  if (await confirmDialog({ title: `Delete pose “${p.name}”?`, message: 'Parts stay in the library (they are just removed from this pose). Characters in this pose switch to another pose. You can undo this.', confirmLabel: 'Delete pose', danger: true }))
                    deletePose(p.id);
                }}
              />
            </li>
          );
        })}
      </ul>
      <Btn
        icon="plus"
        label="Add pose…"
        tip="Add a pose such as bust-34 or full-body"
        onClick={async () => {
          const name = await promptDialog({ title: 'New pose', placeholder: 'e.g. bust-side, full-front', confirmLabel: 'Next' });
          if (!name) return;
          const copy = poses.length
            ? await confirmDialog({
                title: 'Reuse existing parts?',
                message: `Add every part of “${poses[0].name}” to “${name}” as well? (Good for parts that work in both, like backgrounds. You can adjust their alignment per pose.)`,
                confirmLabel: 'Yes, reuse parts',
              })
            : false;
          addPose(name, 'front', copy ? poses[0].id : null);
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f || !imgFor) return;
          try {
            const img = await decodeBlob(f);
            const id = await saveAsset(f, img.width, img.height, img);
            updatePose(imgFor, { guideImage: id }, 'Set guide image');
          } catch {
            toast('That file could not be read as an image.');
          }
        }}
      />
    </div>
  );
}

function GroupsTab() {
  const groups = useDoc((d) => d.project.colorGroups);
  const categories = useDoc((d) => d.project.categories);
  return (
    <div className="form">
      <p className="muted small">
        Parts linked to the same group share one color. Each character stores its own group colors. Make your own groups (e.g. “eye + earring gem”) and link parts from the Part panel.
      </p>
      <ul className="settings-list">
        {groups.map((g) => (
          <li key={g.id} className="row wrap">
            <TextField value={g.name} tip="Group name" onCommit={(name) => updateColorGroup(g.id, { name })} />
            <Select tip="Role: which color preset palettes give this group" value={g.role} onChange={(role) => updateColorGroup(g.id, { role })} options={ROLES} />
            <span className="muted small grow">
              Default for: {categories.filter((c) => c.colorGroupId === g.id).map((c) => c.name).join(', ') || '—'}
            </span>
            <Btn
              small
              icon="trash"
              variant="danger"
              tip="Delete group (linked parts keep their current color)"
              onClick={async () => {
                if (await confirmDialog({ title: `Delete color group “${g.name}”?`, message: 'Linked parts keep their current color as their own. You can undo this.', confirmLabel: 'Delete', danger: true })) deleteColorGroup(g.id);
              }}
            />
          </li>
        ))}
      </ul>
      <Btn
        icon="plus"
        label="Add group…"
        tip="New linked color group"
        onClick={async () => {
          const name = await promptDialog({ title: 'New color group', placeholder: 'e.g. eye + earring gem', confirmLabel: 'Add' });
          if (name) addColorGroup(name);
        }}
      />
      <h4>Default group per category</h4>
      <div className="grid-2">
        {categories.map((c) => (
          <label key={c.id} className="row">
            <span className="grow">
              {c.icon} {c.name}
            </span>
            <Select
              tip="New parts from this category link to this group"
              value={c.colorGroupId ?? ''}
              onChange={(v) => updateCategory(c.id, { colorGroupId: v || null }, 'Change default color group')}
              options={[{ value: '', label: '—' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function CropsTab() {
  const crops = useDoc((d) => d.project.crops);
  const set = (id: ID, patch: Partial<CropPreset['rect']> | { name: string }) =>
    updateCrops(crops.map((c) => (c.id !== id ? c : 'name' in patch ? { ...c, name: patch.name } : { ...c, rect: { ...c.rect, ...patch } })));
  return (
    <div className="form">
      <p className="muted small">Crop presets are fractions of the canvas, so they keep working if the canvas size changes. You can also drag the crop box in the Export dialog.</p>
      <ul className="settings-list">
        {crops.map((c) => (
          <li key={c.id} className="row wrap">
            <TextField value={c.name} tip="Preset name" onCommit={(name) => set(c.id, { name })} />
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <label key={k} className="row tight">
                <span className="muted small">{k.toUpperCase()}</span>
                <input
                  className="text-input num"
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(c.rect[k] * 1000) / 10}
                  onChange={(e) => set(c.id, { [k]: Math.max(0, Math.min(1, +e.target.value / 100)) })}
                  data-tip={`${k === 'x' ? 'Left' : k === 'y' ? 'Top' : k === 'w' ? 'Width' : 'Height'} in % of the canvas`}
                />
                <span className="muted small">%</span>
              </label>
            ))}
            <Btn small icon="trash" variant="danger" tip="Delete preset" disabled={crops.length <= 1} onClick={() => updateCrops(crops.filter((x) => x.id !== c.id))} />
          </li>
        ))}
      </ul>
      <Btn icon="plus" label="Add preset" tip="New crop preset" onClick={() => updateCrops([...crops, { id: uid(), name: 'Custom', rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.5 } }])} />
    </div>
  );
}

function ExpressionsTab() {
  const categories = useDoc((d) => d.project.categories);
  const ids = useDoc((d) => d.project.expressionCategoryIds);
  return (
    <div className="form">
      <p className="muted small">Which categories make up an “expression”. Saving an expression stores these parts; applying it swaps only these.</p>
      <div className="grid-2">
        {categories.map((c) => (
          <Toggle
            key={c.id}
            label={`${c.icon} ${c.name}`}
            tip={`Include ${c.name} in expressions`}
            checked={ids.includes(c.id)}
            onChange={(on) => setExpressionCategories(on ? [...ids, c.id] : ids.filter((x) => x !== c.id))}
          />
        ))}
      </div>
    </div>
  );
}

function CanvasTab() {
  const gridSize = usePrefs((p) => p.gridSize);
  const opacity = usePrefs((p) => p.templateOpacity);
  const symX = usePrefs((p) => p.symmetryX);
  const snapping = usePrefs((p) => p.snapping);
  return (
    <div className="form">
      <Slider label="Grid size" tip="Grid spacing in canvas pixels" value={gridSize} min={10} max={400} unit="px" onChange={(v) => setPrefs({ gridSize: v })} />
      <Slider label="Guide opacity" tip="How strong the template guide overlay is" value={Math.round(opacity * 100)} min={10} max={100} unit="%" onChange={(v) => setPrefs({ templateOpacity: v / 100 })} />
      <Slider label="Symmetry line" tip="Position of the symmetry line (50% = center)" value={Math.round(symX * 1000) / 10} min={0} max={100} step={0.5} unit="%" onChange={(v) => setPrefs({ symmetryX: v / 100 })} />
      <Toggle label="Snap parts to their default position and the symmetry line" tip="Hold Alt while dragging to move freely" checked={snapping} onChange={(v) => setPrefs({ snapping: v })} />
    </div>
  );
}
