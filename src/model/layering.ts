import type { Character, ID, Instance, Part, Project } from './types';

/**
 * Layer stacking.
 *
 * Every instance lives in a "slot" — by default the category of its part. Slots
 * are drawn in category order (first category = bottom). Inside a slot,
 * instances are sorted by `z`. Moving one instance in the layer panel sets a
 * slot override on just that instance, so "this strand of hair goes behind the
 * earrings" survives later category reordering and never changes the
 * category's own default.
 */

export function homeCategory(inst: Instance, parts: Record<ID, Part>): ID {
  if (inst.shape) return inst.shape.category;
  return parts[inst.partId]?.categoryId ?? '';
}

export function slotOf(inst: Instance, parts: Record<ID, Part>): ID {
  return inst.slot ?? homeCategory(inst, parts);
}

function catIndexMap(project: Project): Map<ID, number> {
  const m = new Map<ID, number>();
  project.categories.forEach((c, i) => m.set(c.id, i));
  return m;
}

/** Instances sorted bottom → top. */
export function stackOf(project: Project, parts: Record<ID, Part>, char: Character): Instance[] {
  const idx = catIndexMap(project);
  const top = project.categories.length;
  const key = (inst: Instance) => {
    const slot = slotOf(inst, parts);
    const i = idx.get(slot) ?? idx.get(homeCategory(inst, parts)) ?? top;
    return i;
  };
  return char.items
    .map((inst, order) => ({ inst, k: key(inst), order }))
    .sort((a, b) => a.k - b.k || a.inst.z - b.inst.z || a.order - b.order)
    .map((e) => e.inst);
}

export function nextZ(char: Character, parts: Record<ID, Part>, slot: ID): number {
  let z = -1;
  for (const inst of char.items) if (slotOf(inst, parts) === slot) z = Math.max(z, inst.z);
  return z + 1;
}

/** Renumber z within each slot to 0..n-1 following the stack order. */
function normalize(stack: Instance[], parts: Record<ID, Part>): Map<ID, Instance> {
  const counters = new Map<ID, number>();
  const out = new Map<ID, Instance>();
  for (const inst of stack) {
    const slot = slotOf(inst, parts);
    const z = counters.get(slot) ?? 0;
    counters.set(slot, z + 1);
    out.set(inst.id, inst.z === z ? inst : { ...inst, z });
  }
  return out;
}

function rebuild(char: Character, map: Map<ID, Instance>): Character {
  return { ...char, items: char.items.map((i) => map.get(i.id) ?? i) };
}

/** Move an instance to `toIndex` in the bottom→top stack. */
export function moveInStack(
  project: Project,
  parts: Record<ID, Part>,
  char: Character,
  instId: ID,
  toIndex: number,
): Character {
  const stack = stackOf(project, parts, char);
  const from = stack.findIndex((i) => i.id === instId);
  if (from < 0) return char;
  const moving = stack[from];
  const rest = stack.filter((i) => i.id !== instId);
  const at = Math.max(0, Math.min(rest.length, toIndex));
  const below = rest[at - 1];
  const above = rest[at];
  let slot: ID;
  let z: number;
  if (below && above && slotOf(below, parts) === slotOf(above, parts)) {
    slot = slotOf(below, parts);
    z = (below.z + above.z) / 2;
  } else if (below) {
    slot = slotOf(below, parts);
    z = below.z + 0.5;
  } else if (above) {
    slot = slotOf(above, parts);
    z = above.z - 0.5;
  } else {
    slot = homeCategory(moving, parts);
    z = 0;
  }
  const home = homeCategory(moving, parts);
  const moved: Instance = { ...moving, slot: slot === home ? undefined : slot, z };
  if (moved.slot === undefined) delete moved.slot;
  const newStack = [...rest.slice(0, at), moved, ...rest.slice(at)];
  return rebuild({ ...char, items: char.items.map((i) => (i.id === instId ? moved : i)) }, normalize(newStack, parts));
}

/** Move one step up (+1) or down (-1) in the stack. */
export function stepInStack(
  project: Project,
  parts: Record<ID, Part>,
  char: Character,
  instId: ID,
  delta: number,
): Character {
  const stack = stackOf(project, parts, char);
  const from = stack.findIndex((i) => i.id === instId);
  if (from < 0) return char;
  return moveInStack(project, parts, char, instId, from + delta);
}

/** Clear every per-instance override so the stack follows category order again. */
export function resortByCategory(project: Project, parts: Record<ID, Part>, char: Character): Character {
  const cleared: Character = {
    ...char,
    items: char.items.map((i) => {
      if (i.slot === undefined) return i;
      const { slot: _slot, ...rest } = i;
      return rest as Instance;
    }),
  };
  return rebuild(cleared, normalize(stackOf(project, parts, cleared), parts));
}
