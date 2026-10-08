import type { Character, Doc, Instance } from '../model/types';
import { apply, instanceMatrix, instanceSize, invert } from '../model/geom';
import { visibleStack } from './compositor';
import { maskHit, partMask } from './partRender';

/** Instances under a canvas point, top-most first. Background categories are skipped. */
export function hitTest(doc: Doc, char: Character, cx: number, cy: number, includeBackground = false): Instance[] {
  const bg = new Set(doc.project.categories.filter((c) => c.isBackground).map((c) => c.id));
  const out: Instance[] = [];
  const stack = visibleStack(doc, char);
  for (let i = stack.length - 1; i >= 0; i--) {
    const inst = stack[i];
    const part = inst.shape ? undefined : doc.parts[inst.partId];
    const cat = inst.shape ? inst.shape.category : part?.categoryId;
    if (!includeBackground && cat && bg.has(cat)) continue;
    const m = instanceMatrix(doc.project, inst, part, char.poseId);
    const [px, py] = apply(invert(m), cx, cy);
    const { w, h } = instanceSize(inst, part);
    if (px < 0 || py < 0 || px > w || py > h) continue;
    if (inst.shape || !part) {
      out.push(inst);
      continue;
    }
    const mask = partMask(part);
    if (!mask || maskHit(mask, px, py)) out.push(inst);
  }
  return out;
}
