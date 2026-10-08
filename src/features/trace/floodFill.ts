// "Make fill": flood an area enclosed by line art, closing small gaps.
//
// 1. Pixels of the line layer above a threshold are walls.
// 2. Walls are grown by the gap tolerance, so gaps narrower than ~2× the
//    tolerance are sealed.
// 3. Flood-fill from the click on the non-wall pixels.
// 4. Grow the filled region back out by the tolerance (+1px) so it tucks
//    under the line art instead of leaving a halo.

export interface FillResult {
  mask: Uint8Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  touchesEdge: boolean;
  count: number;
}

const INF = 1e9;

/** Approximate Euclidean distance (chamfer 3-4) from every pixel to the nearest set pixel. */
export function distanceTo(set: Uint8Array, W: number, H: number, limit: number): Float32Array {
  const d = new Float32Array(W * H);
  const lim = (limit + 2) * 3;
  for (let i = 0; i < d.length; i++) d[i] = set[i] ? 0 : INF;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - W] + 3);
        if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
      }
      d[i] = v > lim ? INF : v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + 3);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
      }
      d[i] = v > lim ? INF : v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = d[i] >= INF ? INF : d[i] / 3;
  return d;
}

/** Scanline flood fill of `open` pixels (4-connected) from a seed. */
export function floodRegion(open: Uint8Array, W: number, H: number, sx: number, sy: number): FillResult | null {
  if (sx < 0 || sy < 0 || sx >= W || sy >= H || !open[sy * W + sx]) return null;
  const mask = new Uint8Array(W * H);
  const stack: number[] = [sx, sy];
  let minX = sx,
    maxX = sx,
    minY = sy,
    maxY = sy,
    count = 0;
  let touchesEdge = false;
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let i = y * W + x;
    while (x > 0 && open[i - 1] && !mask[i - 1]) {
      x--;
      i--;
    }
    let up = false;
    let down = false;
    for (; x < W && open[i] && !mask[i]; x++, i++) {
      mask[i] = 1;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || x === W - 1 || y === 0 || y === H - 1) touchesEdge = true;
      if (y > 0) {
        const u = i - W;
        if (open[u] && !mask[u]) {
          if (!up) {
            stack.push(x, y - 1);
            up = true;
          }
        } else up = false;
      }
      if (y < H - 1) {
        const dn = i + W;
        if (open[dn] && !mask[dn]) {
          if (!down) {
            stack.push(x, y + 1);
            down = true;
          }
        } else down = false;
      }
    }
  }
  return { mask, minX, minY, maxX, maxY, touchesEdge, count };
}

/**
 * Full "make fill" computation.
 * @param alpha line-art alpha channel (0..255), length W*H
 * @param gap gap-close tolerance in px
 */
export function computeFill(alpha: Uint8Array | Uint8ClampedArray, W: number, H: number, sx: number, sy: number, gap: number, threshold = 60): FillResult | null {
  const walls = new Uint8Array(W * H);
  for (let i = 0; i < walls.length; i++) walls[i] = alpha[i] > threshold ? 1 : 0;
  let blocked = walls;
  if (gap > 0) {
    const dist = distanceTo(walls, W, H, gap);
    blocked = new Uint8Array(W * H);
    for (let i = 0; i < blocked.length; i++) blocked[i] = dist[i] <= gap ? 1 : 0;
  }
  const open = new Uint8Array(W * H);
  for (let i = 0; i < open.length; i++) open[i] = blocked[i] ? 0 : 1;

  // clicked on/near a line: look for the closest open pixel nearby
  let seedX = Math.round(sx);
  let seedY = Math.round(sy);
  if (!open[seedY * W + seedX]) {
    let found = false;
    for (let r = 1; r <= gap + 6 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++)
        for (let dx = -r; dx <= r && !found; dx++) {
          const x = seedX + dx;
          const y = seedY + dy;
          if (x >= 0 && y >= 0 && x < W && y < H && open[y * W + x]) {
            seedX = x;
            seedY = y;
            found = true;
          }
        }
    }
    if (!found) return null;
  }
  const region = floodRegion(open, W, H, seedX, seedY);
  if (!region) return null;

  // grow back under the lines
  const grow = gap + 1.5;
  const dist = distanceTo(region.mask, W, H, grow);
  const mask = region.mask;
  let { minX, minY, maxX, maxY } = region;
  for (let y = Math.max(0, minY - Math.ceil(grow)); y <= Math.min(H - 1, maxY + Math.ceil(grow)); y++) {
    for (let x = Math.max(0, minX - Math.ceil(grow)); x <= Math.min(W - 1, maxX + Math.ceil(grow)); x++) {
      const i = y * W + x;
      if (mask[i] || dist[i] > grow) continue;
      // only grow into the band that the gap-closing ate away (or under lines)
      if (blocked[i]) {
        mask[i] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { ...region, mask, minX, minY, maxX, maxY };
}
