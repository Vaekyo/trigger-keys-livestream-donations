import type { Category, Character, ColorSpec, Doc, ID, Instance, Part } from '../../model/types';
import { newInstance, PRESET_PALETTES, SKIN_TONES, tintColor } from '../../model/defaults';
import { mixHex } from '../../render/color';
import { docStore } from '../../state/store';
import { prefsStore, select, toast, uiStore, type RandomMode } from '../../state/ui';
import { activeCharId, withChar } from '../../state/actions';

export interface RandomOptions {
  mode: RandomMode;
  favoritesOnly?: boolean;
  locked?: Set<ID>;
  rng?: () => number;
}

/** Chance that a single-choice category that allows "none" ends up empty. */
const NONE_CHANCE: Record<string, number> = {
  background: 0.1,
  'hair-back': 0.15,
  body: 0,
  outfit: 0.05,
  blush: 0.35,
  brows: 0.05,
  mouth: 0.02,
  'hair-front': 0.08,
  glasses: 0.65,
};

function pick<T>(list: T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

function multiCount(cat: Category, rng: () => number): number {
  const r = rng();
  const fx = cat.id === 'effects' || cat.id === 'stickers';
  if (cat.allowNone) {
    if (r < (fx ? 0.6 : 0.45)) return 0;
    if (r < (fx ? 0.9 : 0.9)) return 1;
    return 2;
  }
  return r < 0.7 ? 1 : 2;
}

export function candidatesFor(doc: Doc, char: Character, catId: ID, favoritesOnly: boolean): Part[] {
  return Object.values(doc.parts).filter(
    (p) => p.categoryId === catId && !p.deletedAt && p.poseIds.includes(char.poseId) && (!favoritesOnly || p.favorite),
  );
}

export function randomizeCharacter(doc: Doc, char: Character, opts: RandomOptions): Character {
  const rng = opts.rng ?? Math.random;
  const locked = opts.locked ?? new Set<ID>();
  const { parts, project } = doc;
  let items: Instance[] = [...char.items];

  if (opts.mode !== 'colors') {
    for (const cat of project.categories) {
      if (locked.has(cat.id)) continue;
      const candidates = candidatesFor(doc, char, cat.id, !!opts.favoritesOnly);
      if (!candidates.length) continue;
      const existing = items.filter((i) => !i.shape && parts[i.partId]?.categoryId === cat.id);
      const template = existing[0];
      const removeIds = new Set(existing.map((i) => i.id));
      items = items.filter((i) => !removeIds.has(i.id));
      const make = (p: Part, z: number): Instance => {
        const inst = newInstance(p.id, template ? template.colorGroupId : cat.colorGroupId, z);
        if (template) {
          inst.color = template.color;
          if (template.slot) inst.slot = template.slot;
        }
        return inst;
      };
      if (cat.mode === 'single') {
        const none = cat.allowNone ? (NONE_CHANCE[cat.id] ?? 0.3) : 0;
        if (rng() < none) continue;
        items.push(make(pick(candidates, rng), template?.z ?? 0));
      } else {
        const k = Math.min(candidates.length, multiCount(cat, rng));
        const pool = [...candidates];
        for (let n = 0; n < k; n++) {
          const idx = Math.floor(rng() * pool.length) % pool.length;
          const [p] = pool.splice(idx, 1);
          items.push(make(p, (template?.z ?? 0) + n));
        }
      }
    }
  }

  let groupColors = char.groupColors;
  if (opts.mode !== 'parts') {
    const pal = pick(PRESET_PALETTES, rng);
    const lockedGroups = new Set(project.categories.filter((c) => locked.has(c.id) && c.colorGroupId).map((c) => c.colorGroupId as ID));
    groupColors = { ...char.groupColors };
    for (const g of project.colorGroups) {
      if (lockedGroups.has(g.id)) continue;
      let spec: ColorSpec;
      switch (g.role) {
        case 'hair': {
          spec = tintColor(pal.hair, pal.line);
          if (pal.hair2 && rng() < 0.35) spec.gradient = { color2: pal.hair2, angle: 180, start: 0.5, end: 1 };
          break;
        }
        case 'skin':
          spec = tintColor(rng() < 0.5 ? pal.skin : pick(SKIN_TONES, rng), pal.line);
          break;
        case 'eyes':
          spec = tintColor(pal.eyes, pal.line);
          break;
        case 'outfit':
          spec = tintColor(rng() < 0.5 ? pal.outfit : mixHex(pal.accent, '#ffffff', 0.3), pal.line);
          break;
        default:
          spec = tintColor(pal.accent, pal.line);
      }
      groupColors[g.id] = spec;
    }
    // unlinked parts in unlocked categories get a fresh color too
    items = items.map((i) => {
      if (i.colorGroupId || i.shape) return i;
      const cat = parts[i.partId]?.categoryId;
      if (cat && locked.has(cat)) return i;
      if (i.color.mode === 'tint') return { ...i, color: { ...i.color, fill: pick([pal.accent, pal.outfit, pal.hair, pal.eyes], rng), gradient: null } };
      if (i.color.mode === 'shift') return { ...i, color: { ...i.color, h: Math.round(rng() * 360 - 180) } };
      return i;
    });
  }

  return { ...char, items, groupColors };
}

export function randomizeActive(opts: { mode?: RandomMode; favoritesOnly?: boolean } = {}) {
  const id = activeCharId();
  if (!id) return;
  const d = docStore.get();
  const char = d.characters[id];
  if (!char) return;
  const pid = d.project.id;
  const locked = new Set(prefsStore.get().randomLocks[pid] ?? []);
  const mode = opts.mode ?? prefsStore.get().randomMode;
  if (opts.favoritesOnly && !Object.values(d.parts).some((p) => p.favorite && !p.deletedAt && p.poseIds.includes(char.poseId))) {
    toast('No favorites yet — star some parts in the library first.');
    return;
  }
  const label = opts.favoritesOnly ? 'Surprise me' : mode === 'colors' ? 'Randomize colors' : mode === 'parts' ? 'Randomize parts' : 'Randomize';
  docStore.commit(label, (doc) => withChar(doc, id, (c) => randomizeCharacter(doc, c, { mode, favoritesOnly: opts.favoritesOnly, locked })));
  if (uiStore.get().selection.length) select([]);
}

