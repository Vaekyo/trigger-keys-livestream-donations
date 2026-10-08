import type { Character, Doc, Part } from '../src/model/types';
import { newCharacter, newInstance, newProject } from '../src/model/defaults';

export function part(id: string, categoryId: string, extra: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    categoryId,
    poseIds: ['bust-front'],
    tags: [],
    favorite: false,
    w: 10,
    h: 10,
    images: { flat: `${id}-img` },
    align: { x: 500, y: 500, scale: 1, rotation: 0 },
    createdAt: 0,
    ...extra,
  };
}

export function makeDoc(parts: Part[], chars: Character[] = []): Doc {
  const project = newProject('Test');
  return {
    project,
    parts: Object.fromEntries(parts.map((p) => [p.id, p])),
    characters: Object.fromEntries(chars.map((c) => [c.id, c])),
  };
}

export function charWith(partIds: [string, string][]): Character {
  const c = newCharacter('c', 'bust-front');
  c.items = partIds.map(([pid], i) => ({ ...newInstance(pid, null, 0), id: `i${i}` }));
  return c;
}
