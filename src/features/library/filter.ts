import type { ID, Part } from '../../model/types';

export interface LibraryFilter {
  query: string;
  favoritesOnly: boolean;
  tag: string | null;
  poseId: ID | null;
}

export function matchesFilter(p: Part, f: LibraryFilter): boolean {
  if (p.deletedAt) return false;
  if (f.poseId && !p.poseIds.includes(f.poseId)) return false;
  if (f.favoritesOnly && !p.favorite) return false;
  if (f.tag && !p.tags.includes(f.tag)) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const words = q.split(/\s+/);
    const hay = `${p.name} ${p.tags.join(' ')}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function filterParts(parts: Record<ID, Part>, f: LibraryFilter): Part[] {
  return Object.values(parts)
    .filter((p) => matchesFilter(p, f))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.createdAt - b.createdAt || a.name.localeCompare(b.name));
}

export function allTags(parts: Record<ID, Part>): string[] {
  const s = new Set<string>();
  for (const p of Object.values(parts)) if (!p.deletedAt) for (const t of p.tags) s.add(t);
  return [...s].sort();
}

/** Guess a category from a file name ("eyes_round.png" → eyes). */
const SYNONYMS: Record<string, string[]> = {
  background: ['background', 'bg', 'backdrop', 'scene'],
  'hair-back': ['hairback', 'backhair', 'hair-back', 'hairb', 'ponytail', 'twintail', 'twintails'],
  'hair-front': ['hairfront', 'fronthair', 'bangs', 'fringe', 'hair-front', 'ahoge'],
  body: ['body', 'skin', 'torso', 'neck', 'base'],
  outfit: ['outfit', 'clothes', 'clothing', 'shirt', 'dress', 'top', 'uniform', 'hoodie', 'jacket', 'sweater', 'kimono'],
  'neck-accessory': ['necklace', 'choker', 'scarf', 'tie', 'collar', 'neckacc', 'neck-accessory'],
  face: ['face', 'head', 'faceshape'],
  blush: ['blush', 'cheek', 'cheeks'],
  eyes: ['eyes', 'eye', 'iris'],
  brows: ['brows', 'brow', 'eyebrows', 'eyebrow'],
  mouth: ['mouth', 'lips', 'lip', 'smile'],
  glasses: ['glasses', 'glass', 'spectacles', 'goggles', 'sunglasses'],
  earrings: ['earrings', 'earring', 'piercing'],
  'head-accessory': ['hat', 'hairpin', 'hairclip', 'clip', 'ribbon', 'bow', 'crown', 'headband', 'ears', 'horns', 'headacc', 'head-accessory'],
  effects: ['effect', 'effects', 'fx', 'sparkle', 'sparkles'],
  stickers: ['sticker', 'stickers', 'stamp'],
};

export function guessCategory(fileName: string, categories: { id: ID; name: string }[]): ID | null {
  const base = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  const squashed = base.replace(/[^a-z0-9]/g, '');
  const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);
  let best: { id: ID; score: number } | null = null;
  for (const c of categories) {
    const names = [c.name.toLowerCase(), c.id.toLowerCase(), ...(SYNONYMS[c.id] ?? [])];
    for (const n of names) {
      const sq = n.replace(/[^a-z0-9]/g, '');
      if (!sq) continue;
      let score = 0;
      if (squashed.includes(sq)) score = sq.length * 2;
      else if (tokens.includes(n)) score = n.length * 2;
      else if (tokens.some((t) => t.length >= 3 && sq.startsWith(t))) score = Math.min(sq.length, 4);
      if (score && (!best || score > best.score)) best = { id: c.id, score };
    }
  }
  return best?.id ?? null;
}
