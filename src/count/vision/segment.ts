/**
 * Classical single-class object counting.
 *
 * Deliberately not a neural network. Identity is already established by the
 * barcode scan, so the camera never has to answer "what is this" — only "how
 * many of the same thing are in frame". For units laid out in a single layer on
 * a contrasting tray, adaptive thresholding plus connected-component analysis
 * filtered by a known unit footprint solves that directly, with no training
 * data, no model hosting, and no seasonal drift when packaging artwork changes.
 *
 * A fine-tuned detector belongs here later, behind the same interface, for the
 * cases this cannot handle. It is not needed to ship.
 */

export interface Blob {
  area: number;
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SegmentOptions {
  /** Local window half-width for adaptive thresholding, in pixels. */
  windowRadius: number;
  /** How far below the local mean a pixel must fall to be considered foreground. */
  bias: number;
  /** Discards sensor noise and dust before footprint filtering. */
  minArea: number;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  windowRadius: 12,
  bias: 8,
  minArea: 40,
};

export function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    // Rec. 601 luma. Integer arithmetic keeps this cheap enough to run per frame.
    gray[i] = (rgba[p]! * 77 + rgba[p + 1]! * 151 + rgba[p + 2]! * 28) >> 8;
  }
  return gray;
}

/**
 * Summed-area table so the local mean is O(1) per pixel regardless of window
 * size — the difference between a usable frame rate and a slideshow on a
 * mid-range handheld.
 */
function integralImage(gray: Uint8Array, width: number, height: number): Float64Array {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x]!;
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)]! + rowSum;
    }
  }
  return integral;
}

/**
 * Adaptive rather than global thresholding because vault lighting is uneven —
 * a global cutoff loses the shadowed half of the tray.
 */
export function adaptiveThreshold(
  gray: Uint8Array,
  width: number,
  height: number,
  options: SegmentOptions,
): Uint8Array {
  const integral = integralImage(gray, width, height);
  const mask = new Uint8Array(width * height);
  const r = options.windowRadius;
  const stride = width + 1;

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)]! -
        integral[y0 * stride + (x1 + 1)]! -
        integral[(y1 + 1) * stride + x0]! +
        integral[y0 * stride + x0]!;
      mask[y * width + x] = gray[y * width + x]! * area < sum - options.bias * area ? 1 : 0;
    }
  }
  return mask;
}

/** Two-pass connected-component labelling, 8-connected, union-find. */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): Blob[] {
  const labels = new Int32Array(width * height);
  const parent: number[] = [0];

  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    // Path compression keeps the second pass near-linear on noisy masks.
    let node = x;
    while (parent[node] !== root) {
      const next = parent[node]!;
      parent[node] = root;
      node = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  };

  let next = 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (mask[i] === 0) continue;

      let label = 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0) continue;
        const neighbour = labels[ny * width + nx]!;
        if (neighbour === 0) continue;
        label = label === 0 ? neighbour : (union(label, neighbour), Math.min(label, neighbour));
      }

      if (label === 0) {
        label = next;
        parent[next] = next;
        next += 1;
      }
      labels[i] = label;
    }
  }

  const blobs = new Map<number, Blob>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const label = labels[y * width + x]!;
      if (label === 0) continue;
      const root = find(label);
      const blob = blobs.get(root);
      if (!blob) {
        blobs.set(root, { area: 1, cx: x, cy: y, minX: x, minY: y, maxX: x, maxY: y });
        continue;
      }
      blob.area += 1;
      blob.cx += x;
      blob.cy += y;
      if (x < blob.minX) blob.minX = x;
      if (x > blob.maxX) blob.maxX = x;
      if (y < blob.minY) blob.minY = y;
      if (y > blob.maxY) blob.maxY = y;
    }
  }

  const result: Blob[] = [];
  for (const blob of blobs.values()) {
    if (blob.area < minArea) continue;
    blob.cx /= blob.area;
    blob.cy /= blob.area;
    result.push(blob);
  }
  return result;
}

// Previously-visited neighbours only: W, NW, N, NE.
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
