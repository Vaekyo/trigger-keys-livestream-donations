// Every user-facing change to the document goes through here. Each exported
// action is one undo step (or part of a gesture opened with docStore.begin).

import type {
  Align,
  BackgroundSpec,
  Category,
  Character,
  ColorGroup,
  ColorSpec,
  CropPreset,
  Doc,
  Expression,
  GuideStyle,
  ID,
  Instance,
  Part,
  Pose,
  Project,
  ShadowSpec,
  ShapeSpec,
} from '../model/types';
import { docStore } from './store';
import { prefsStore, select, setPrefs, setUI, toast, uiStore } from './ui';
import { newCharacter, newInstance, noColor, PRESET_PALETTES, type Palette, tintColor } from '../model/defaults';
import { uid } from '../model/ids';
import { effectiveAlign, shapeBaseAlign } from '../model/geom';
import { homeCategory, moveInStack, nextZ, resortByCategory, slotOf, stepInStack } from '../model/layering';
import { resolveColor } from '../render/compositor';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const getDoc = () => docStore.get();

export function activeCharId(): ID | null {
  return uiStore.get().characterId;
}

export function activeCharacter(): Character | undefined {
  const id = activeCharId();
  return id ? docStore.get().characters[id] : undefined;
}

export function withChar(d: Doc, id: ID, fn: (c: Character) => Character): Doc {
  const c = d.characters[id];
  if (!c) return d;
  const n = fn(c);
  if (n === c) return d;
  return { ...d, characters: { ...d.characters, [id]: { ...n, updatedAt: Date.now() } } };
}

export function withInst(c: Character, instId: ID, fn: (i: Instance) => Instance): Character {
  let changed = false;
  const items = c.items.map((i) => {
    if (i.id !== instId) return i;
    const n = fn(i);
    if (n !== i) changed = true;
    return n;
  });
  return changed ? { ...c, items } : c;
}

export function withPart(d: Doc, id: ID, fn: (p: Part) => Part): Doc {
  const p = d.parts[id];
  if (!p) return d;
  const n = fn(p);
  return n === p ? d : { ...d, parts: { ...d.parts, [id]: n } };
}

export function withParts(d: Doc, ids: ID[], fn: (p: Part) => Part): Doc {
  const parts = { ...d.parts };
  let changed = false;
  for (const id of ids) {
    const p = parts[id];
    if (!p) continue;
    const n = fn(p);
    if (n !== p) {
      parts[id] = n;
      changed = true;
    }
  }
  return changed ? { ...d, parts } : d;
}

export function withProject(d: Doc, fn: (p: Project) => Project): Doc {
  const n = fn(d.project);
  return n === d.project ? d : { ...d, project: { ...n, updatedAt: Date.now() } };
}

/** Commit a change to the active character. */
export function commitChar(label: string, fn: (c: Character, d: Doc) => Character, merge?: string) {
  const id = activeCharId();
  if (!id) return;
  docStore.commit(label, (d) => withChar(d, id, (c) => fn(c, d)), merge);
}

export function category(d: Doc, id: ID): Category | undefined {
  return d.project.categories.find((c) => c.id === id);
}

function instCategory(d: Doc, inst: Instance): ID {
  return homeCategory(inst, d.parts);
}

export function partLabel(d: Doc, inst: Instance): string {
  if (inst.shape) return inst.shape.text ? `“${inst.shape.text.slice(0, 18)}”` : inst.shape.kind;
  return d.parts[inst.partId]?.name ?? 'missing part';
}

/* ------------------------------------------------------------------ */
/* Placing parts                                                       */
/* ------------------------------------------------------------------ */

function makeInstanceFor(d: Doc, c: Character, part: Part, template?: Instance): Instance {
  const cat = category(d, part.categoryId);
  const inst = newInstance(part.id, cat?.colorGroupId ?? null, 0);
  if (template) {
    inst.colorGroupId = template.colorGroupId;
    inst.color = template.color;
    if (template.slot) inst.slot = template.slot;
    inst.z = template.z;
  } else {
    inst.z = nextZ(c, d.parts, part.categoryId);
  }
  return inst;
}

/** Library click: pick (single), toggle (multiple), or clear when clicking the chosen one. */
export function choosePart(partId: ID) {
  const d = getDoc();
  const part = d.parts[partId];
  const c = activeCharacter();
  if (!part || !c) return;
  const cat = category(d, part.categoryId);
  const sameCat = c.items.filter((i) => !i.shape && d.parts[i.partId]?.categoryId === part.categoryId);
  const samePart = sameCat.filter((i) => i.partId === partId);
  if (cat?.mode === 'multiple') {
    if (samePart.length) {
      const ids = new Set(samePart.map((i) => i.id));
      commitChar(`Remove ${part.name}`, (ch) => ({ ...ch, items: ch.items.filter((i) => !ids.has(i.id)) }));
      select(uiStore.get().selection.filter((s) => !ids.has(s)));
    } else {
      addInstance(partId);
    }
    return;
  }
  if (samePart.length) {
    if (cat?.allowNone) {
      clearCategory(part.categoryId);
    } else {
      select([samePart[0].id]);
    }
    return;
  }
  const template = sameCat[0];
  const inst = makeInstanceFor(d, c, part, template);
  const removeIds = new Set(sameCat.map((i) => i.id));
  commitChar(`Choose ${part.name}`, (ch) => ({ ...ch, items: [...ch.items.filter((i) => !removeIds.has(i.id)), inst] }));
  select([inst.id]);
}

/** Add another instance of a part. `center` (canvas px) places it at a point. */
export function addInstance(partId: ID, center?: [number, number]): ID | null {
  const d = getDoc();
  const part = d.parts[partId];
  const c = activeCharacter();
  if (!part || !c) return null;
  const inst = makeInstanceFor(d, c, part);
  if (center) {
    const a = effectiveAlign(part, c.poseId);
    inst.dx = Math.round(center[0] - a.x);
    inst.dy = Math.round(center[1] - a.y);
  }
  const cat = category(d, part.categoryId);
  if (cat?.mode === 'single') {
    // keep "single choice" honest: replace instead of stacking
    const sameCat = c.items.filter((i) => !i.shape && d.parts[i.partId]?.categoryId === part.categoryId);
    if (sameCat.length) {
      const t = sameCat[0];
      inst.color = t.color;
      inst.colorGroupId = t.colorGroupId;
      inst.z = t.z;
      if (t.slot) inst.slot = t.slot;
    }
    const removeIds = new Set(sameCat.map((i) => i.id));
    commitChar(`Add ${part.name}`, (ch) => ({ ...ch, items: [...ch.items.filter((i) => !removeIds.has(i.id)), inst] }));
  } else {
    commitChar(`Add ${part.name}`, (ch) => ({ ...ch, items: [...ch.items, inst] }));
  }
  select([inst.id]);
  return inst.id;
}

export function addShape(shape: ShapeSpec, center?: [number, number]): ID | null {
  const c = activeCharacter();
  if (!c) return null;
  const d = getDoc();
  const inst = newInstance('', null, nextZ(c, d.parts, shape.category));
  inst.shape = shape;
  if (center) {
    const base = shapeBaseAlign(d.project);
    inst.dx = Math.round(center[0] - base.x);
    inst.dy = Math.round(center[1] - base.y);
  }
  commitChar(`Add ${shape.kind}`, (ch) => ({ ...ch, items: [...ch.items, inst] }));
  select([inst.id]);
  return inst.id;
}

export function clearCategory(catId: ID) {
  const d = getDoc();
  const cat = category(d, catId);
  commitChar(`Clear ${cat?.name ?? 'category'}`, (ch) => ({
    ...ch,
    items: ch.items.filter((i) => i.shape || d.parts[i.partId]?.categoryId !== catId),
  }));
  select([]);
}

export function removeInstances(ids: ID[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  const d = getDoc();
  const c = activeCharacter();
  const first = c?.items.find((i) => set.has(i.id));
  const label = ids.length === 1 && first ? `Remove ${partLabel(d, first)}` : `Remove ${ids.length} parts`;
  commitChar(label, (ch) => ({ ...ch, items: ch.items.filter((i) => !set.has(i.id)) }));
  select(uiStore.get().selection.filter((s) => !set.has(s)));
}

export function duplicateInstances(ids: ID[]) {
  const c = activeCharacter();
  if (!c || !ids.length) return;
  const d = getDoc();
  const copies: Instance[] = [];
  for (const inst of c.items) {
    if (!ids.includes(inst.id)) continue;
    const slot = slotOf(inst, d.parts);
    copies.push({ ...inst, id: uid(), dx: inst.dx + 24, dy: inst.dy + 24, z: nextZ(c, d.parts, slot) + copies.length });
  }
  if (!copies.length) return;
  commitChar(copies.length === 1 ? `Duplicate ${partLabel(d, copies[0])}` : `Duplicate ${copies.length} parts`, (ch) => ({
    ...ch,
    items: [...ch.items, ...copies],
  }));
  select(copies.map((i) => i.id));
}

export function updateInstance(instId: ID, patch: Partial<Instance> | ((i: Instance) => Instance), label = 'Edit part', merge?: string) {
  commitChar(label, (c) => withInst(c, instId, (i) => (typeof patch === 'function' ? patch(i) : { ...i, ...patch })), merge);
}

export function updateInstances(ids: ID[], fn: (i: Instance) => Instance, label: string, merge?: string) {
  const set = new Set(ids);
  commitChar(label, (c) => {
    let changed = false;
    const items = c.items.map((i) => {
      if (!set.has(i.id)) return i;
      const n = fn(i);
      if (n !== i) changed = true;
      return n;
    });
    return changed ? { ...c, items } : c;
  }, merge);
}

export function nudge(ids: ID[], dx: number, dy: number) {
  updateInstances(ids, (i) => ({ ...i, dx: i.dx + dx, dy: i.dy + dy }), 'Nudge', `nudge:${ids.join(',')}`);
}

export function resetInstances(ids: ID[]) {
  updateInstances(ids, (i) => ({ ...i, dx: 0, dy: 0, scale: 1, rotation: 0, flipX: false, flipY: false, opacity: 1 }), 'Reset to default alignment');
}

export function flipInstances(ids: ID[], axis: 'x' | 'y') {
  updateInstances(ids, (i) => (axis === 'x' ? { ...i, flipX: !i.flipX } : { ...i, flipY: !i.flipY }), axis === 'x' ? 'Flip horizontal' : 'Flip vertical');
}

/** Flip and move to the mirror position across the symmetry line. */
export function mirrorInstances(ids: ID[]) {
  const d = getDoc();
  const c = activeCharacter();
  if (!c) return;
  const symX = prefsStore.get().symmetryX * d.project.width;
  updateInstances(
    ids,
    (i) => {
      const part = d.parts[i.partId];
      const base = i.shape || !part ? shapeBaseAlign(d.project) : effectiveAlign(part, c.poseId);
      const cx = base.x + i.dx;
      const mx = 2 * symX - cx;
      return { ...i, flipX: !i.flipX, dx: mx - base.x, rotation: -i.rotation - 2 * base.rotation };
    },
    'Mirror to other side',
  );
}

export function setInstancesHidden(ids: ID[], hidden: boolean) {
  updateInstances(ids, (i) => ({ ...i, hidden }), hidden ? 'Hide part' : 'Show part');
}

export function moveLayer(instId: ID, toIndex: number) {
  commitChar('Reorder layers', (c, d) => moveInStack(d.project, d.parts, c, instId, toIndex));
}

export function stepLayer(instId: ID, delta: number) {
  commitChar(delta > 0 ? 'Move layer up' : 'Move layer down', (c, d) => stepInStack(d.project, d.parts, c, instId, delta));
}

export function resortLayers() {
  commitChar('Re-sort layers by category', (c, d) => resortByCategory(d.project, d.parts, c));
}

/* ------------------------------------------------------------------ */
/* Color                                                               */
/* ------------------------------------------------------------------ */

export function instanceColor(inst: Instance): ColorSpec {
  const d = getDoc();
  const c = activeCharacter();
  if (!c) return inst.color;
  return resolveColor(d.project, c, inst);
}

/** Set the color of an instance — writes to its linked group if it has one. */
export function setInstanceColor(instId: ID, spec: ColorSpec, label = 'Change color', merge?: string) {
  const d = getDoc();
  commitChar(
    label,
    (c) => {
      const inst = c.items.find((i) => i.id === instId);
      if (!inst) return c;
      const gid = inst.colorGroupId;
      if (gid && d.project.colorGroups.some((g) => g.id === gid)) {
        return { ...c, groupColors: { ...c.groupColors, [gid]: spec } };
      }
      return withInst(c, instId, (i) => ({ ...i, color: spec }));
    },
    merge,
  );
}

export function setGroupColor(groupId: ID, spec: ColorSpec, label = 'Change group color', merge?: string) {
  commitChar(label, (c) => ({ ...c, groupColors: { ...c.groupColors, [groupId]: spec } }), merge);
}

/** Link an instance to a color group, or unlink it (null) keeping its current look. */
export function linkInstance(instId: ID, groupId: ID | null) {
  const d = getDoc();
  commitChar(groupId ? 'Link color' : 'Unlink color', (c) => {
    const inst = c.items.find((i) => i.id === instId);
    if (!inst) return c;
    const current = resolveColor(d.project, c, inst);
    let next = withInst(c, instId, (i) => ({ ...i, colorGroupId: groupId, color: groupId ? i.color : current }));
    if (groupId && !c.groupColors[groupId]) next = { ...next, groupColors: { ...next.groupColors, [groupId]: current } };
    return next;
  });
}

export function applyPalette(p: Palette) {
  const d = getDoc();
  commitChar(`Apply palette “${p.name}”`, (c) => {
    const gc = { ...c.groupColors };
    for (const g of d.project.colorGroups) {
      const hex =
        g.role === 'hair' ? p.hair : g.role === 'skin' ? p.skin : g.role === 'eyes' ? p.eyes : g.role === 'outfit' ? p.outfit : p.accent;
      const prev = gc[g.id];
      const spec = tintColor(hex, p.line);
      if (prev?.gradient) spec.gradient = { ...prev.gradient, color2: g.role === 'hair' && p.hair2 ? p.hair2 : prev.gradient.color2 };
      gc[g.id] = spec;
    }
    return { ...c, groupColors: gc };
  });
}

export function addSwatch(hex: string) {
  docStore.commit('Save swatch', (d) =>
    d.project.swatches.includes(hex) ? d : withProject(d, (p) => ({ ...p, swatches: [...p.swatches, hex] })),
  );
}

export function removeSwatch(hex: string) {
  docStore.commit('Remove swatch', (d) => withProject(d, (p) => ({ ...p, swatches: p.swatches.filter((s) => s !== hex) })));
}

/* ------------------------------------------------------------------ */
/* Characters / gallery                                                */
/* ------------------------------------------------------------------ */

/**
 * Switch pose. Parts that do not exist in the new pose stay on the character
 * (hidden) and come back when switching back. Required categories (e.g. face,
 * eyes) that would end up empty get a compatible part for the new pose.
 */
export function setPose(poseId: ID) {
  const d = getDoc();
  const pose = d.project.poses.find((p) => p.id === poseId);
  const filled: string[] = [];
  commitChar(`Switch pose to ${pose?.name ?? poseId}`, (c) => {
    if (c.poseId === poseId) return c;
    const items = [...c.items];
    const visibleIn = (pid: ID, cat: ID) => items.some((i) => !i.shape && d.parts[i.partId]?.categoryId === cat && !d.parts[i.partId]?.deletedAt && d.parts[i.partId]?.poseIds.includes(pid));
    for (const cat of d.project.categories) {
      if (cat.allowNone) continue;
      if (!visibleIn(c.poseId, cat.id) || visibleIn(poseId, cat.id)) continue;
      const candidates = Object.values(d.parts).filter((p) => p.categoryId === cat.id && !p.deletedAt && p.poseIds.includes(poseId));
      const pick = candidates.find((p) => p.favorite) ?? candidates[0];
      if (!pick) continue;
      const template = items.find((i) => !i.shape && d.parts[i.partId]?.categoryId === cat.id);
      const inst = newInstance(pick.id, template ? template.colorGroupId : cat.colorGroupId, template?.z ?? nextZ(c, d.parts, cat.id));
      if (template) inst.color = template.color;
      items.push(inst);
      filled.push(`${cat.name}: ${pick.name}`);
    }
    return { ...c, poseId, items };
  });
  if (filled.length) toast(`Added parts made for ${pose?.name ?? 'this pose'} — ${filled.join(', ')}`, { ms: 5000 });
}

export function renameCharacter(id: ID, name: string) {
  docStore.commit('Rename character', (d) => withChar(d, id, (c) => (c.name === name ? c : { ...c, name })));
}

export function openCharacter(id: ID) {
  const pid = uiStore.get().projectId;
  setUI({ characterId: id, selection: [] });
  if (pid) setPrefs((p) => ({ lastCharacter: { ...p.lastCharacter, [pid]: id } }));
}

/** Fill the categories that require a part with their first available part. */
export function seedRequired(d: Doc, c: Character): Character {
  let items = [...c.items];
  for (const cat of d.project.categories) {
    if (cat.allowNone) continue;
    if (items.some((i) => !i.shape && d.parts[i.partId]?.categoryId === cat.id)) continue;
    const part = Object.values(d.parts).find((p) => p.categoryId === cat.id && !p.deletedAt && p.poseIds.includes(c.poseId));
    if (part) items = [...items, newInstance(part.id, cat.colorGroupId, 0)];
  }
  return { ...c, items };
}

export function createCharacter(): ID {
  const d = getDoc();
  const cur = activeCharacter();
  const poseId = cur?.poseId ?? d.project.poses[0]?.id ?? '';
  const count = Object.values(d.characters).filter((c) => !c.deletedAt).length;
  let c = newCharacter(`Character ${count + 1}`, poseId);
  if (cur) c.groupColors = { ...cur.groupColors };
  c = seedRequired(d, c);
  docStore.commit('New character', (doc) => ({ ...doc, characters: { ...doc.characters, [c.id]: c } }));
  openCharacter(c.id);
  return c.id;
}

export function duplicateCharacter(id: ID): ID | null {
  const d = getDoc();
  const src = d.characters[id];
  if (!src) return null;
  const now = Date.now();
  const copy: Character = {
    ...structuredClone(src),
    id: uid(),
    name: `${src.name} copy`,
    createdAt: now,
    updatedAt: now,
  };
  delete copy.deletedAt;
  copy.items = copy.items.map((i) => ({ ...i, id: uid() }));
  docStore.commit('Duplicate character', (doc) => ({ ...doc, characters: { ...doc.characters, [copy.id]: copy } }));
  return copy.id;
}

function firstLiveCharacter(d: Doc, except?: ID): Character | undefined {
  return Object.values(d.characters)
    .filter((c) => !c.deletedAt && c.id !== except)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function trashCharacter(id: ID) {
  const d = getDoc();
  const c = d.characters[id];
  if (!c) return;
  docStore.commit(`Delete ${c.name}`, (doc) => withChar(doc, id, (ch) => ({ ...ch, deletedAt: Date.now() })));
  if (activeCharId() === id) {
    const next = firstLiveCharacter(getDoc(), id);
    if (next) openCharacter(next.id);
    else createCharacter();
  }
  toast(`Moved “${c.name}” to Trash`, { undo: true });
}

export function restoreCharacter(id: ID) {
  docStore.commit('Restore character', (doc) =>
    withChar(doc, id, (ch) => {
      const { deletedAt: _d, ...rest } = ch;
      return rest as Character;
    }),
  );
}

export function purgeCharacters(ids: ID[]) {
  docStore.commit('Delete forever', (doc) => {
    const characters = { ...doc.characters };
    for (const id of ids) delete characters[id];
    return { ...doc, characters };
  });
}

export function setBackground(patch: Partial<BackgroundSpec>, label = 'Change background', merge?: string) {
  commitChar(label, (c) => ({ ...c, background: { ...c.background, ...patch } }), merge);
}

export function setShadow(patch: Partial<ShadowSpec>, label = 'Change drop shadow', merge?: string) {
  commitChar(label, (c) => ({ ...c, shadow: { ...c.shadow, ...patch } }), merge);
}

/* ------------------------------------------------------------------ */
/* Expressions (Phase 3)                                               */
/* ------------------------------------------------------------------ */

export function expressionItems(d: Doc, c: Character): Instance[] {
  const cats = new Set(d.project.expressionCategoryIds);
  return c.items.filter((i) => cats.has(instCategory(d, i)));
}

export function saveExpression(name: string, replaceId?: ID) {
  const d = getDoc();
  const c = activeCharacter();
  if (!c) return;
  const items = structuredClone(expressionItems(d, c));
  const groupIds = new Set(items.map((i) => i.colorGroupId).filter(Boolean) as ID[]);
  const groupColors: Record<ID, ColorSpec> = {};
  for (const gid of groupIds) if (c.groupColors[gid]) groupColors[gid] = c.groupColors[gid];
  commitChar(replaceId ? `Update expression “${name}”` : `Save expression “${name}”`, (ch) => {
    if (replaceId) return { ...ch, expressions: ch.expressions.map((e) => (e.id === replaceId ? { ...e, name, items, groupColors } : e)) };
    const e: Expression = { id: uid(), name, items, groupColors };
    return { ...ch, expressions: [...ch.expressions, e] };
  });
}

/** Character items with an expression's parts swapped in. */
export function itemsWithExpression(d: Doc, c: Character, e: Expression): Instance[] {
  const cats = new Set(d.project.expressionCategoryIds);
  const kept = c.items.filter((i) => !cats.has(instCategory(d, i)));
  return [...kept, ...e.items.map((i) => ({ ...i, id: uid() }))];
}

export function applyExpression(id: ID) {
  const d = getDoc();
  const c = activeCharacter();
  const e = c?.expressions.find((x) => x.id === id);
  if (!c || !e) return;
  commitChar(`Apply expression “${e.name}”`, (ch) => ({ ...ch, items: itemsWithExpression(d, ch, e) }));
  select([]);
}

export function renameExpression(id: ID, name: string) {
  commitChar('Rename expression', (c) => ({ ...c, expressions: c.expressions.map((e) => (e.id === id ? { ...e, name } : e)) }));
}

export function deleteExpression(id: ID) {
  commitChar('Delete expression', (c) => ({ ...c, expressions: c.expressions.filter((e) => e.id !== id) }));
}

export function moveExpression(id: ID, delta: number) {
  commitChar('Reorder expressions', (c) => {
    const list = [...c.expressions];
    const i = list.findIndex((e) => e.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return c;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...c, expressions: list };
  });
}

/* ------------------------------------------------------------------ */
/* Parts / library                                                     */
/* ------------------------------------------------------------------ */

export function addParts(parts: Part[], label?: string) {
  if (!parts.length) return;
  docStore.commit(label ?? (parts.length === 1 ? `Add part ${parts[0].name}` : `Add ${parts.length} parts`), (d) => {
    const next = { ...d.parts };
    for (const p of parts) next[p.id] = p;
    return { ...d, parts: next };
  });
}

export function updatePart(id: ID, patch: Partial<Part>, label = 'Edit part') {
  docStore.commit(label, (d) => withPart(d, id, (p) => ({ ...p, ...patch })));
}

export function updateParts(ids: ID[], fn: (p: Part) => Part, label: string) {
  docStore.commit(label, (d) => withParts(d, ids, fn));
}

export function toggleFavorite(id: ID) {
  const p = getDoc().parts[id];
  if (!p) return;
  updatePart(id, { favorite: !p.favorite }, p.favorite ? 'Unfavorite' : 'Favorite');
}

export function setPartAlign(id: ID, align: Align, poseId: ID | 'all') {
  docStore.commit('Change default alignment', (d) =>
    withPart(d, id, (p) => {
      if (poseId === 'all') return { ...p, align, poseAlign: undefined };
      if (poseId === p.poseIds[0] && !p.poseAlign) return { ...p, align };
      return { ...p, poseAlign: { ...(p.poseAlign ?? {}), [poseId]: align } };
    }),
  );
}

export function trashParts(ids: ID[]) {
  if (!ids.length) return;
  const d = getDoc();
  const now = Date.now();
  const label = ids.length === 1 ? `Delete ${d.parts[ids[0]]?.name}` : `Delete ${ids.length} parts`;
  docStore.commit(label, (doc) => withParts(doc, ids, (p) => ({ ...p, deletedAt: now })));
  toast(ids.length === 1 ? `Moved “${d.parts[ids[0]]?.name}” to Trash` : `Moved ${ids.length} parts to Trash`, { undo: true });
}

export function restoreParts(ids: ID[]) {
  docStore.commit(ids.length === 1 ? 'Restore part' : `Restore ${ids.length} parts`, (doc) =>
    withParts(doc, ids, (p) => {
      const { deletedAt: _d, ...rest } = p;
      return rest as Part;
    }),
  );
}

/** Permanently remove parts (still undoable this session) and their instances. */
export function purgeParts(ids: ID[]) {
  const set = new Set(ids);
  docStore.commit(ids.length === 1 ? 'Delete part forever' : `Delete ${ids.length} parts forever`, (doc) => {
    const parts = { ...doc.parts };
    for (const id of ids) delete parts[id];
    const characters: Record<ID, Character> = {};
    for (const [cid, c] of Object.entries(doc.characters)) {
      const strip = (items: Instance[]) => items.filter((i) => !set.has(i.partId));
      const items = strip(c.items);
      const touched = items.length !== c.items.length || c.expressions.some((e) => strip(e.items).length !== e.items.length);
      characters[cid] = touched ? { ...c, items, expressions: c.expressions.map((e) => ({ ...e, items: strip(e.items) })) } : c;
    }
    return { ...doc, parts, characters };
  });
}

export function emptyTrash() {
  const d = getDoc();
  const partIds = Object.values(d.parts).filter((p) => p.deletedAt).map((p) => p.id);
  const charIds = Object.values(d.characters).filter((c) => c.deletedAt).map((c) => c.id);
  docStore.begin('Empty trash');
  if (partIds.length) purgeParts(partIds);
  if (charIds.length) purgeCharacters(charIds);
  docStore.end('Empty trash');
}

export function placeholderIds(): ID[] {
  return Object.values(getDoc().parts)
    .filter((p) => p.placeholder && !p.deletedAt)
    .map((p) => p.id);
}

/** Where (in which characters) a set of parts is used. */
export function usageCount(partIds: ID[]): number {
  const set = new Set(partIds);
  return Object.values(getDoc().characters).filter((c) => !c.deletedAt && c.items.some((i) => set.has(i.partId))).length;
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export function addCategory(name: string): ID {
  const id = uid();
  const cat: Category = { id, name, icon: '🧩', mode: 'single', allowNone: true, isBackground: false, colorGroupId: null };
  docStore.commit(`Add category ${name}`, (d) => withProject(d, (p) => ({ ...p, categories: [...p.categories, cat] })));
  return id;
}

export function updateCategory(id: ID, patch: Partial<Category>, label = 'Edit category') {
  docStore.commit(label, (d) =>
    withProject(d, (p) => ({ ...p, categories: p.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  );
}

export function moveCategory(id: ID, toIndex: number) {
  docStore.commit('Reorder categories', (d) =>
    withProject(d, (p) => {
      const list = p.categories.filter((c) => c.id !== id);
      const cat = p.categories.find((c) => c.id === id);
      if (!cat) return p;
      list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, cat);
      return { ...p, categories: list };
    }),
  );
}

/** Delete a category; its parts move to another category or to the Trash. */
export function deleteCategory(id: ID, moveTo: ID | 'trash') {
  const d = getDoc();
  const cat = category(d, id);
  if (!cat) return;
  const now = Date.now();
  docStore.commit(`Delete category ${cat.name}`, (doc) => {
    const ids = Object.values(doc.parts).filter((p) => p.categoryId === id).map((p) => p.id);
    let next = withParts(doc, ids, (p) => (moveTo === 'trash' ? { ...p, deletedAt: p.deletedAt ?? now } : { ...p, categoryId: moveTo }));
    next = withProject(next, (p) => ({
      ...p,
      categories: p.categories.filter((c) => c.id !== id),
      expressionCategoryIds: p.expressionCategoryIds.filter((c) => c !== id),
    }));
    return next;
  });
  if (uiStore.get().activeCategoryId === id) setUI({ activeCategoryId: getDoc().project.categories[0]?.id ?? null });
}

/* ------------------------------------------------------------------ */
/* Poses                                                               */
/* ------------------------------------------------------------------ */

export function addPose(name: string, guide: GuideStyle, copyFrom: ID | null): ID {
  const id = uid();
  const pose: Pose = { id, name, guide };
  docStore.commit(`Add pose ${name}`, (d) => {
    let next = withProject(d, (p) => ({ ...p, poses: [...p.poses, pose] }));
    if (copyFrom) {
      const ids = Object.values(d.parts).filter((p) => p.poseIds.includes(copyFrom)).map((p) => p.id);
      next = withParts(next, ids, (p) => ({
        ...p,
        poseIds: [...p.poseIds, id],
        poseAlign: p.poseAlign?.[copyFrom] ? { ...p.poseAlign, [id]: p.poseAlign[copyFrom] } : p.poseAlign,
      }));
    }
    return next;
  });
  return id;
}

export function updatePose(id: ID, patch: Partial<Pose>, label = 'Edit pose') {
  docStore.commit(label, (d) => withProject(d, (p) => ({ ...p, poses: p.poses.map((x) => (x.id === id ? { ...x, ...patch } : x)) })));
}

export function movePose(id: ID, delta: number) {
  docStore.commit('Reorder poses', (d) =>
    withProject(d, (p) => {
      const list = [...p.poses];
      const i = list.findIndex((x) => x.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return p;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...p, poses: list };
    }),
  );
}

export function deletePose(id: ID) {
  const d = getDoc();
  if (d.project.poses.length <= 1) {
    toast('A project needs at least one pose.');
    return;
  }
  const fallback = d.project.poses.find((p) => p.id !== id)!.id;
  docStore.commit('Delete pose', (doc) => {
    let next = withProject(doc, (p) => ({ ...p, poses: p.poses.filter((x) => x.id !== id) }));
    const ids = Object.values(doc.parts).filter((p) => p.poseIds.includes(id)).map((p) => p.id);
    next = withParts(next, ids, (p) => {
      const poseAlign = p.poseAlign ? { ...p.poseAlign } : undefined;
      if (poseAlign) delete poseAlign[id];
      return { ...p, poseIds: p.poseIds.filter((x) => x !== id), poseAlign };
    });
    const characters = { ...next.characters };
    for (const c of Object.values(characters)) if (c.poseId === id) characters[c.id] = { ...c, poseId: fallback };
    return { ...next, characters };
  });
}

/* ------------------------------------------------------------------ */
/* Project                                                             */
/* ------------------------------------------------------------------ */

export function renameProject(name: string) {
  docStore.commit('Rename project', (d) => withProject(d, (p) => ({ ...p, name })));
}

export type ResizeAnchor = 'top-left' | 'top' | 'center' | 'bottom' | 'scale';

export function resizeCanvas(W2: number, H2: number, anchor: ResizeAnchor) {
  const d = getDoc();
  const { width: W1, height: H1 } = d.project;
  if (W1 === W2 && H1 === H2) return;
  let k = 1;
  let ox = 0;
  let oy = 0;
  if (anchor === 'scale') {
    k = Math.min(W2 / W1, H2 / H1);
    ox = (W2 - W1 * k) / 2;
    oy = (H2 - H1 * k) / 2;
  } else {
    const ax = anchor === 'top-left' ? 0 : 0.5;
    const ay = anchor === 'top-left' || anchor === 'top' ? 0 : anchor === 'center' ? 0.5 : 1;
    ox = (W2 - W1) * ax;
    oy = (H2 - H1) * ay;
  }
  const mapAlign = (a: Align): Align => ({ ...a, x: a.x * k + ox, y: a.y * k + oy, scale: a.scale * k });
  // shapes are positioned relative to the canvas center
  const shapeDx = ox + (W1 * k) / 2 - W2 / 2;
  const shapeDy = oy + (H1 * k) / 2 - H2 / 2;
  docStore.commit(`Resize canvas to ${W2}×${H2}`, (doc) => {
    const parts: Record<ID, Part> = {};
    for (const p of Object.values(doc.parts)) {
      const poseAlign = p.poseAlign ? Object.fromEntries(Object.entries(p.poseAlign).map(([pid, a]) => [pid, mapAlign(a)])) : undefined;
      parts[p.id] = { ...p, align: mapAlign(p.align), poseAlign };
    }
    const mapItems = (items: Instance[]) =>
      items.map((i) =>
        i.shape
          ? { ...i, dx: i.dx * k + shapeDx, dy: i.dy * k + shapeDy, scale: i.scale * k }
          : k !== 1
            ? { ...i, dx: i.dx * k, dy: i.dy * k }
            : i,
      );
    const characters: Record<ID, Character> = {};
    for (const c of Object.values(doc.characters)) {
      characters[c.id] = { ...c, items: mapItems(c.items), expressions: c.expressions.map((e) => ({ ...e, items: mapItems(e.items) })) };
    }
    return { project: { ...doc.project, width: W2, height: H2, updatedAt: Date.now() }, parts, characters };
  });
  setUI((s) => ({ fitRequest: s.fitRequest + 1 }));
}

export function addColorGroup(name: string): ID {
  const id = uid();
  const g: ColorGroup = { id, name, role: 'custom' };
  docStore.commit(`Add color group ${name}`, (d) => withProject(d, (p) => ({ ...p, colorGroups: [...p.colorGroups, g] })));
  return id;
}

export function updateColorGroup(id: ID, patch: Partial<ColorGroup>) {
  docStore.commit('Edit color group', (d) =>
    withProject(d, (p) => ({ ...p, colorGroups: p.colorGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),
  );
}

/** Delete a group; linked instances keep their current color as their own. */
export function deleteColorGroup(id: ID) {
  docStore.commit('Delete color group', (d) => {
    let next = withProject(d, (p) => ({
      ...p,
      colorGroups: p.colorGroups.filter((g) => g.id !== id),
      categories: p.categories.map((c) => (c.colorGroupId === id ? { ...c, colorGroupId: null } : c)),
    }));
    const characters: Record<ID, Character> = {};
    for (const c of Object.values(next.characters)) {
      const gc = c.groupColors[id];
      const unlink = (items: Instance[]) =>
        items.map((i) => (i.colorGroupId === id ? { ...i, colorGroupId: null, color: gc ?? i.color } : i));
      const { [id]: _drop, ...groupColors } = c.groupColors;
      characters[c.id] = { ...c, items: unlink(c.items), groupColors, expressions: c.expressions.map((e) => ({ ...e, items: unlink(e.items) })) };
    }
    next = { ...next, characters };
    return next;
  });
}

export function updateCrops(crops: CropPreset[]) {
  docStore.commit('Edit crop presets', (d) => withProject(d, (p) => ({ ...p, crops })));
}

export function setExpressionCategories(ids: ID[]) {
  docStore.commit('Edit expression categories', (d) => withProject(d, (p) => ({ ...p, expressionCategoryIds: ids })));
}

/* ------------------------------------------------------------------ */
/* Undo / redo with feedback                                           */
/* ------------------------------------------------------------------ */

export function undo() {
  const label = docStore.undo();
  if (label) toast(`Undid: ${label}`);
}

export function redo() {
  const label = docStore.redo();
  if (label) toast(`Redid: ${label}`);
}

export { PRESET_PALETTES, noColor };
