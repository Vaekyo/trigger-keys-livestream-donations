// Core data model. Everything in here is plain JSON so it can be stored in
// IndexedDB, exported to a .zip and diffed by reference for undo/redo.

export type ID = string;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a part's image sits on the canvas: its center point, scale and rotation (degrees). */
export interface Align {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export type GuideStyle = 'front' | 'three-quarter' | 'full-body' | 'none';

export interface Pose {
  id: ID;
  name: string;
  guide: GuideStyle;
  /** Optional custom template image (asset id). Replaces the generated guide. */
  guideImage?: ID;
}

export interface Category {
  id: ID;
  name: string;
  icon: string;
  mode: 'single' | 'multiple';
  allowNone: boolean;
  /** Hidden when exporting "transparent". */
  isBackground: boolean;
  /** New instances of parts from this category link to this color group. */
  colorGroupId: ID | null;
}

export type GroupRole = 'hair' | 'skin' | 'eyes' | 'outfit' | 'accent' | 'custom';

export interface ColorGroup {
  id: ID;
  name: string;
  role: GroupRole;
}

export interface CropPreset {
  id: ID;
  name: string;
  /** Fractions of the canvas (0..1) so presets survive canvas resizes. */
  rect: Rect;
}

export interface Project {
  id: ID;
  name: string;
  width: number;
  height: number;
  categories: Category[];
  poses: Pose[];
  colorGroups: ColorGroup[];
  swatches: string[];
  crops: CropPreset[];
  /** Categories that make up an "expression" (Phase 3). */
  expressionCategoryIds: ID[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/**
 * The image layers of a part. All layers share the same frame (w×h).
 * - flat: a normal full-color (or grayscale) image
 * - fill: grayscale fill that "smart tint" colors while keeping shading
 * - line: line art drawn on top of the fill, can be recolored
 */
export interface PartImages {
  flat?: ID;
  fill?: ID;
  line?: ID;
}

/** Editable source layers kept for parts made in the trace studio. */
export interface TraceSource {
  /** Full-canvas sized layers (asset ids), so re-editing is lossless. */
  line?: ID;
  fill?: ID;
  shade?: ID;
  reference?: ID;
  refTransform?: { x: number; y: number; scale: number; rotation: number; opacity: number };
  canvasW: number;
  canvasH: number;
}

export interface Part {
  id: ID;
  name: string;
  categoryId: ID;
  poseIds: ID[];
  tags: string[];
  favorite: boolean;
  w: number;
  h: number;
  images: PartImages;
  thumb?: ID;
  align: Align;
  /** Per-pose override of the default alignment. */
  poseAlign?: Record<ID, Align>;
  trace?: TraceSource;
  placeholder?: boolean;
  createdAt: number;
  deletedAt?: number;
}

export interface Gradient {
  color2: string;
  /** CSS-style angle in degrees: 180 = top → bottom. */
  angle: number;
  /** Where the blend starts/ends along the gradient axis (0..1). */
  start: number;
  end: number;
}

export interface ColorSpec {
  mode: 'none' | 'shift' | 'tint';
  /** HSB shift: hue -180..180, saturation & brightness -100..100 */
  h: number;
  s: number;
  b: number;
  /** Smart tint base color. */
  fill: string;
  gradient: Gradient | null;
  /** Line art color, or null to keep the original lines. */
  line: string | null;
}

export type ShapeKind =
  | 'bubble'
  | 'shout'
  | 'thought'
  | 'text'
  | 'sparkle'
  | 'sweat'
  | 'anger'
  | 'heart'
  | 'star'
  | 'note'
  | 'lines';

export interface ShapeSpec {
  kind: ShapeKind;
  /** Category whose layer slot the shape lives in by default. */
  category: ID;
  text: string;
  fontSize: number;
  fill: string;
  stroke: string;
  textColor: string;
  /** Bubble tail direction in degrees (0 = right, 90 = down). */
  tail: number;
  /** Base size of the shape in canvas px. */
  w: number;
  h: number;
}

/** One placed part (or shape) on a character. */
export interface Instance {
  id: ID;
  /** Library part; empty for shapes. */
  partId: ID;
  shape?: ShapeSpec;
  /** Category whose slot in the stack this instance occupies (override); defaults to the part's category. */
  slot?: ID;
  /** Sort key within its slot. */
  z: number;
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  hidden: boolean;
  colorGroupId: ID | null;
  color: ColorSpec;
}

export type PatternKind = 'dots' | 'stripes' | 'checks' | 'grid' | 'hearts' | 'stars' | 'sunburst';

export interface BackgroundSpec {
  type: 'none' | 'solid' | 'gradient' | 'image' | 'pattern';
  color: string;
  color2: string;
  angle: number;
  image?: ID;
  pattern: PatternKind;
  patternScale: number;
}

export interface ShadowSpec {
  on: boolean;
  color: string;
  blur: number;
  x: number;
  y: number;
  opacity: number;
}

export interface Expression {
  id: ID;
  name: string;
  /** Snapshot of the instances of the expression categories. */
  items: Instance[];
  groupColors?: Record<ID, ColorSpec>;
}

export interface Character {
  id: ID;
  name: string;
  poseId: ID;
  items: Instance[];
  groupColors: Record<ID, ColorSpec>;
  background: BackgroundSpec;
  shadow: ShadowSpec;
  expressions: Expression[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/** Everything the app edits for one open project. Undo/redo snapshots this. */
export interface Doc {
  project: Project;
  parts: Record<ID, Part>;
  characters: Record<ID, Character>;
}

export interface AssetRecord {
  projectId: ID;
  id: ID;
  blob: Blob;
  w: number;
  h: number;
}
