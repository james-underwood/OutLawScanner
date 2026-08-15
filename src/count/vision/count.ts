import { type Blob, connectedComponents, adaptiveThreshold, toGrayscale, DEFAULT_SEGMENT_OPTIONS, type SegmentOptions } from './segment';

export interface FrameCount {
  quantity: number;
  /** 0..1, derived from how cleanly the blobs fit the expected unit footprint. */
  confidence: number;
  blobs: Blob[];
  /** Median blob area — feeds back as the footprint prior once a SKU is calibrated. */
  medianArea: number;
}

/**
 * Turns segmented blobs into a count.
 *
 * The footprint prior is what makes this work. Knowing roughly how large one
 * unit appears lets us both reject debris and, crucially, recognise that a blob
 * three times unit size is three units touching — the single most common
 * failure mode when product is pushed together on a tray.
 */
export function countBlobs(blobs: Blob[], footprintPrior: number | null): FrameCount {
  // An empty frame is a real answer — zero units — not a failure to detect.
  if (blobs.length === 0) {
    return { quantity: 0, confidence: 0.9, blobs, medianArea: 0 };
  }

  const areas = blobs.map((b) => b.area).sort((a, b) => a - b);
  const medianArea = areas[Math.floor(areas.length / 2)]!;
  const unitArea = footprintPrior ?? medianArea;

  let quantity = 0;
  let ambiguity = 0;

  for (const blob of blobs) {
    const ratio = blob.area / unitArea;

    // Below two-thirds of a unit is a fragment, a shadow, or clutter.
    if (ratio < 0.66) {
      ambiguity += 0.25;
      continue;
    }

    const units = Math.max(1, Math.round(ratio));
    quantity += units;

    // How far this blob sits from a clean integer multiple of one unit. A tray
    // of well-separated units scores near zero; a merged pile scores high.
    const residual = Math.abs(ratio - units);
    ambiguity += residual;

    // Splitting a merged blob is an inference, not an observation. Say so.
    if (units > 1) ambiguity += 0.15 * (units - 1);
  }

  const confidence = clamp(1 - ambiguity / Math.max(1, blobs.length), 0, 1);
  return { quantity, confidence, blobs, medianArea };
}

export function countFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  footprintPrior: number | null,
  options: SegmentOptions = DEFAULT_SEGMENT_OPTIONS,
): FrameCount {
  const gray = toGrayscale(rgba, width, height);
  const mask = adaptiveThreshold(gray, width, height, options);
  const blobs = connectedComponents(mask, width, height, options.minArea);
  return countBlobs(blobs, footprintPrior);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
