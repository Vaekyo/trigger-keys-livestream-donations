// Share codes: a character as a short pasteable string. It references parts by
// id (with the part name as a fallback), so it works for anyone who has the
// same parts pack (e.g. imported from the same project .zip).

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { BackgroundSpec, Character, ColorSpec, Doc, Expression, ID, Instance, ShadowSpec, ShapeSpec } from '../model/types';
import { defaultBackground, defaultShadow, newCharacter, noColor } from '../model/defaults';
import { uid } from '../model/ids';

const PREFIX = 'PCM1.';

interface CodeItem {
  p?: string; // part id
  n?: string; // part name (fallback)
  sh?: ShapeSpec;
  sl?: string;
  z?: number;
  x?: number;
  y?: number;
  s?: number;
  r?: number;
  f?: number; // bit flags: 1 flipX, 2 flipY, 4 hidden
  o?: number;
  g?: string | null;
  c?: Partial<ColorSpec>;
}

interface CodeV1 {
  v: 1;
  name: string;
  pose: string;
  items: CodeItem[];
  groups?: Record<ID, Partial<ColorSpec>>;
  bg?: Partial<BackgroundSpec>;
  shadow?: Partial<ShadowSpec>;
  ex?: { name: string; items: CodeItem[] }[];
}

function compactColor(c: ColorSpec): Partial<ColorSpec> | undefined {
  const d = noColor();
  const out: Partial<ColorSpec> = {};
  let any = false;
  for (const k of Object.keys(c) as (keyof ColorSpec)[]) {
    if (JSON.stringify(c[k]) !== JSON.stringify(d[k])) {
      (out as Record<string, unknown>)[k] = c[k];
      any = true;
    }
  }
  return any ? out : undefined;
}

function encodeItem(doc: Doc, i: Instance): CodeItem {
  const it: CodeItem = {};
  if (i.shape) it.sh = i.shape;
  else {
    it.p = i.partId;
    it.n = doc.parts[i.partId]?.name;
  }
  if (i.slot) it.sl = i.slot;
  if (i.z) it.z = i.z;
  if (i.dx) it.x = Math.round(i.dx * 10) / 10;
  if (i.dy) it.y = Math.round(i.dy * 10) / 10;
  if (i.scale !== 1) it.s = Math.round(i.scale * 1000) / 1000;
  if (i.rotation) it.r = Math.round(i.rotation * 10) / 10;
  const f = (i.flipX ? 1 : 0) | (i.flipY ? 2 : 0) | (i.hidden ? 4 : 0);
  if (f) it.f = f;
  if (i.opacity !== 1) it.o = Math.round(i.opacity * 100) / 100;
  if (i.colorGroupId) it.g = i.colorGroupId;
  const c = compactColor(i.color);
  if (c) it.c = c;
  return it;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function characterToCode(doc: Doc, char: Character): CodeV1 {
  const groups: Record<ID, Partial<ColorSpec>> = {};
  for (const [gid, spec] of Object.entries(char.groupColors)) {
    const c = compactColor(spec);
    if (c) groups[gid] = c;
  }
  const bg: Partial<BackgroundSpec> = { ...char.background };
  if (bg.type === 'image') bg.type = 'solid';
  delete bg.image;
  return {
    v: 1,
    name: char.name,
    pose: char.poseId,
    items: char.items.map((i) => encodeItem(doc, i)),
    groups: Object.keys(groups).length ? groups : undefined,
    bg: char.background.type === 'none' ? undefined : bg,
    shadow: char.shadow.on ? char.shadow : undefined,
    ex: char.expressions.length ? char.expressions.map((e) => ({ name: e.name, items: e.items.map((i) => encodeItem(doc, i)) })) : undefined,
  };
}

/** Compact, compressed code (prefix PCM1.) */
export function encodeShareCode(doc: Doc, char: Character): string {
  return PREFIX + toBase64Url(deflateSync(strToU8(JSON.stringify(characterToCode(doc, char))), { level: 9 }));
}

/** Human-readable JSON version of the same code. */
export function encodeShareJson(doc: Doc, char: Character): string {
  return JSON.stringify(characterToCode(doc, char));
}

export interface DecodeResult {
  character: Character;
  missing: string[];
}

export function decodeShareCode(doc: Doc, text: string): DecodeResult {
  const t = text.trim();
  let data: CodeV1;
  if (t.startsWith('{')) data = JSON.parse(t);
  else if (t.startsWith(PREFIX)) data = JSON.parse(strFromU8(inflateSync(fromBase64Url(t.slice(PREFIX.length)))));
  else throw new Error('This does not look like a share code (it should start with “PCM1.” or “{”).');
  if (data.v !== 1 || !Array.isArray(data.items)) throw new Error('Unknown share code version.');

  const live = Object.values(doc.parts).filter((p) => !p.deletedAt);
  const byName = new Map(live.map((p) => [p.name, p]));
  const groupIds = new Set(doc.project.colorGroups.map((g) => g.id));
  const missing: string[] = [];

  const decodeItems = (items: CodeItem[]): Instance[] => {
    const out: Instance[] = [];
    for (const it of items) {
      let partId = '';
      if (!it.sh) {
        const part = (it.p && doc.parts[it.p] && !doc.parts[it.p].deletedAt ? doc.parts[it.p] : undefined) ?? (it.n ? byName.get(it.n) : undefined);
        if (!part) {
          missing.push(it.n ?? it.p ?? '?');
          continue;
        }
        partId = part.id;
      }
      const f = it.f ?? 0;
      const inst: Instance = {
        id: uid(),
        partId,
        z: it.z ?? 0,
        dx: it.x ?? 0,
        dy: it.y ?? 0,
        scale: it.s ?? 1,
        rotation: it.r ?? 0,
        flipX: !!(f & 1),
        flipY: !!(f & 2),
        hidden: !!(f & 4),
        opacity: it.o ?? 1,
        colorGroupId: it.g && groupIds.has(it.g) ? it.g : null,
        color: { ...noColor(), ...(it.c ?? {}) },
      };
      if (it.sl) inst.slot = it.sl;
      if (it.sh) inst.shape = it.sh;
      out.push(inst);
    }
    return out;
  };

  const poseId = doc.project.poses.some((p) => p.id === data.pose) ? data.pose : doc.project.poses[0].id;
  const c = newCharacter(data.name || 'Shared character', poseId);
  c.items = decodeItems(data.items);
  for (const [gid, spec] of Object.entries(data.groups ?? {})) if (groupIds.has(gid)) c.groupColors[gid] = { ...noColor(), ...spec };
  c.background = { ...defaultBackground(), ...(data.bg ?? {}) };
  c.shadow = { ...defaultShadow(), ...(data.shadow ?? {}) };
  c.expressions = (data.ex ?? []).map((e): Expression => ({ id: uid(), name: e.name, items: decodeItems(e.items) }));
  return { character: c, missing: [...new Set(missing)] };
}
