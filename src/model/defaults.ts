import type {
  BackgroundSpec,
  Category,
  Character,
  ColorGroup,
  ColorSpec,
  CropPreset,
  Instance,
  Pose,
  Project,
  ShadowSpec,
} from './types';
import { uid } from './ids';

export const DEFAULT_CANVAS = { width: 1000, height: 1600 };

type CatSeed = [id: string, icon: string, mode: Category['mode'], allowNone: boolean, group: string | null];

const CATEGORY_SEEDS: CatSeed[] = [
  ['background', '🌄', 'single', true, null],
  ['hair-back', '💇', 'single', true, 'hair'],
  ['body', '🧍', 'single', true, 'skin'],
  ['outfit', '👕', 'single', true, 'outfit'],
  ['neck-accessory', '🎀', 'multiple', true, null],
  ['face', '🙂', 'single', false, 'skin'],
  ['blush', '😊', 'single', true, null],
  ['eyes', '👁️', 'single', false, 'eyes'],
  ['brows', '〰️', 'single', true, 'hair'],
  ['mouth', '👄', 'single', true, null],
  ['hair-front', '💁', 'single', true, 'hair'],
  ['glasses', '👓', 'single', true, null],
  ['earrings', '💎', 'multiple', true, null],
  ['head-accessory', '👑', 'multiple', true, null],
  ['effects', '✨', 'multiple', true, null],
  ['stickers', '⭐', 'multiple', true, null],
];

export function defaultCategories(): Category[] {
  return CATEGORY_SEEDS.map(([id, icon, mode, allowNone, group]) => ({
    id,
    name: id,
    icon,
    mode,
    allowNone,
    isBackground: id === 'background',
    colorGroupId: group,
  }));
}

export function defaultColorGroups(): ColorGroup[] {
  return [
    { id: 'hair', name: 'Hair', role: 'hair' },
    { id: 'skin', name: 'Skin', role: 'skin' },
    { id: 'eyes', name: 'Eyes', role: 'eyes' },
    { id: 'outfit', name: 'Outfit', role: 'outfit' },
  ];
}

export function defaultPoses(): Pose[] {
  return [
    { id: 'bust-front', name: 'bust-front', guide: 'front' },
    { id: 'bust-34', name: 'bust-34', guide: 'three-quarter' },
  ];
}

export function defaultCrops(): CropPreset[] {
  return [
    { id: 'full', name: 'Full', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { id: 'bust', name: 'Bust', rect: { x: 0, y: 0.1, w: 1, h: 0.65 } },
    { id: 'face', name: 'Face icon', rect: { x: 0.2, y: 0.14, w: 0.6, h: 0.375 } },
  ];
}

export function newProject(name: string, width = DEFAULT_CANVAS.width, height = DEFAULT_CANVAS.height): Project {
  const now = Date.now();
  return {
    id: uid(),
    name,
    width,
    height,
    categories: defaultCategories(),
    poses: defaultPoses(),
    colorGroups: defaultColorGroups(),
    swatches: ['#2b2140', '#f6d8c4', '#8a5a3c', '#c9d1e0', '#f4a6c0', '#6aa8d8', '#e0763a', '#ffffff'],
    crops: defaultCrops(),
    expressionCategoryIds: ['eyes', 'brows', 'mouth', 'blush'],
    createdAt: now,
    updatedAt: now,
  };
}

export function noColor(): ColorSpec {
  return { mode: 'none', h: 0, s: 0, b: 0, fill: '#ffffff', gradient: null, line: null };
}

export function tintColor(fill: string, line: string | null = null): ColorSpec {
  return { ...noColor(), mode: 'tint', fill, line };
}

export function defaultBackground(): BackgroundSpec {
  return { type: 'none', color: '#fde8f0', color2: '#c9d8ff', angle: 180, pattern: 'dots', patternScale: 1 };
}

export function defaultShadow(): ShadowSpec {
  return { on: false, color: '#2b2140', blur: 24, x: 12, y: 16, opacity: 0.35 };
}

export function newCharacter(name: string, poseId: string): Character {
  const now = Date.now();
  return {
    id: uid(),
    name,
    poseId,
    items: [],
    groupColors: {},
    background: defaultBackground(),
    shadow: defaultShadow(),
    expressions: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function newInstance(partId: string, colorGroupId: string | null, z: number): Instance {
  return {
    id: uid(),
    partId,
    z,
    dx: 0,
    dy: 0,
    scale: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    hidden: false,
    colorGroupId,
    color: noColor(),
  };
}

export interface Palette {
  name: string;
  hair: string;
  hair2?: string;
  eyes: string;
  skin: string;
  outfit: string;
  accent: string;
  line: string;
}

export const PRESET_PALETTES: Palette[] = [
  { name: 'Cool silver', hair: '#cdd5e4', hair2: '#9fb4d8', eyes: '#5b9bd5', skin: '#fbe9e1', outfit: '#3e4a6b', accent: '#9fd3ff', line: '#3c4560' },
  { name: 'Warm brown', hair: '#8a5a3c', eyes: '#b0703f', skin: '#f6d8c4', outfit: '#c97b4a', accent: '#f2c46d', line: '#4a2c20' },
  { name: 'Sakura', hair: '#f6aac4', hair2: '#fff0f5', eyes: '#d0587e', skin: '#fde8e4', outfit: '#ffffff', accent: '#ff8fb8', line: '#6b3346' },
  { name: 'Midnight', hair: '#2e3352', hair2: '#6a5acd', eyes: '#8b6cf0', skin: '#f3dfd6', outfit: '#23263b', accent: '#c7b6ff', line: '#1a1a2e' },
  { name: 'Ginger', hair: '#e0763a', eyes: '#3f9a6a', skin: '#fbe0cc', outfit: '#2f5f4a', accent: '#ffcf70', line: '#5a2e1a' },
  { name: 'Mint pop', hair: '#8fe0c8', hair2: '#f7fff0', eyes: '#f08a5d', skin: '#fdeee3', outfit: '#fff4d6', accent: '#ff9fb2', line: '#2f5250' },
  { name: 'Golden', hair: '#f2d27a', hair2: '#fff3c4', eyes: '#4f86c6', skin: '#fde5d2', outfit: '#3b5ba5', accent: '#e94b5a', line: '#6b4a1e' },
  { name: 'Raven', hair: '#26252c', hair2: '#4b3a6b', eyes: '#c0392b', skin: '#f7e4da', outfit: '#1e1e24', accent: '#c0392b', line: '#121216' },
  { name: 'Lavender dream', hair: '#b9a3e3', hair2: '#f3c6e8', eyes: '#7e57c2', skin: '#fdeaf0', outfit: '#e8e0ff', accent: '#ffb3d9', line: '#4b3a6b' },
  { name: 'Sun-kissed', hair: '#3b2a20', eyes: '#d49a3a', skin: '#c68a62', outfit: '#f1e3c6', accent: '#e8a33d', line: '#2a1a12' },
];

export const SKIN_TONES = ['#fde8e0', '#fbe0cc', '#f6d8c4', '#efc8a8', '#d9a47c', '#c68a62', '#9c6644', '#7a4b33'];

export const CATEGORY_ICONS = [
  '🌄', '🏞️', '🌌', '💇', '💁', '🧍', '👕', '👗', '🧥', '👘', '🎀', '🧣', '🙂', '😊', '😳', '👁️', '〰️', '👄', '👓', '🕶️',
  '💎', '💍', '👑', '🎩', '🧢', '🐱', '🦊', '🐰', '✨', '⭐', '💫', '❤️', '🌸', '🍀', '🔥', '💧', '🎵', '💬', '📌', '🧩',
  '🎨', '🖌️', '🦋', '🌙', '☀️', '🍓', '🍰', '🎧', '📷', '🗡️',
];
