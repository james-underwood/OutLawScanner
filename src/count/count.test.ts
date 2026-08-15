import { describe, expect, it } from 'vitest';
import { countBlobs, countFrame } from './vision/count';
import { connectedComponents } from './vision/segment';
import { ConsensusBuffer } from './consensus';
import { parseAsciiWeight, weightToCount } from './scale';
import type { Blob } from './vision/segment';

function blob(area: number): Blob {
  return { area, cx: 0, cy: 0, minX: 0, minY: 0, maxX: 1, maxY: 1 };
}

/** Draws `count` filled dark squares on a light field. */
function synthFrame(width: number, height: number, boxes: [number, number, number][]) {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(235);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  for (const [x0, y0, size] of boxes) {
    for (let y = y0; y < y0 + size; y += 1) {
      for (let x = x0; x < x0 + size; x += 1) {
        const p = (y * width + x) * 4;
        rgba[p] = 20;
        rgba[p + 1] = 20;
        rgba[p + 2] = 20;
      }
    }
  }
  return rgba;
}

describe('connectedComponents', () => {
  it('separates diagonally touching regions as one 8-connected component', () => {
    const mask = new Uint8Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);
    expect(connectedComponents(mask, 3, 3, 1)).toHaveLength(1);
  });

  it('keeps genuinely separate regions apart', () => {
    const mask = new Uint8Array([
      1, 0, 1,
      0, 0, 0,
      1, 0, 1,
    ]);
    expect(connectedComponents(mask, 3, 3, 1)).toHaveLength(4);
  });
});

describe('countBlobs', () => {
  it('counts well-separated units at high confidence', () => {
    const result = countBlobs([blob(100), blob(102), blob(98)], 100);
    expect(result.quantity).toBe(3);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('splits a merged blob using the footprint prior', () => {
    // Three units pushed together read as one blob of roughly triple the area.
    const result = countBlobs([blob(300)], 100);
    expect(result.quantity).toBe(3);
  });

  it('reports lower confidence when it had to split a blob', () => {
    const clean = countBlobs([blob(100), blob(100), blob(100)], 100);
    const merged = countBlobs([blob(300)], 100);
    expect(merged.confidence).toBeLessThan(clean.confidence);
  });

  it('discards fragments smaller than two-thirds of a unit', () => {
    expect(countBlobs([blob(100), blob(12)], 100).quantity).toBe(1);
  });

  it('treats an empty frame as a confident zero', () => {
    const result = countBlobs([], 100);
    expect(result.quantity).toBe(0);
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

describe('countFrame', () => {
  it('counts synthetic units end to end through threshold and labelling', () => {
    const boxes: [number, number, number][] = [
      [10, 10, 14],
      [40, 10, 14],
      [70, 10, 14],
      [10, 40, 14],
    ];
    const rgba = synthFrame(120, 80, boxes);
    expect(countFrame(rgba, 120, 80, 14 * 14).quantity).toBe(4);
  });
});

describe('ConsensusBuffer', () => {
  it('withholds an answer until enough frames agree', () => {
    const buffer = new ConsensusBuffer({ window: 5, agreement: 3, minFrameConfidence: 0.3 });
    expect(buffer.push(12, 0.8)).toBeNull();
    expect(buffer.push(12, 0.8)).toBeNull();
    expect(buffer.push(12, 0.8)?.quantity).toBe(12);
  });

  it('ignores frames below the confidence floor', () => {
    const buffer = new ConsensusBuffer({ window: 5, agreement: 3, minFrameConfidence: 0.5 });
    buffer.push(12, 0.1);
    buffer.push(12, 0.1);
    buffer.push(12, 0.1);
    expect(buffer.size).toBe(0);
  });

  it('does not settle while the count keeps changing', () => {
    const buffer = new ConsensusBuffer({ window: 5, agreement: 3, minFrameConfidence: 0.3 });
    expect(buffer.push(11, 0.9)).toBeNull();
    expect(buffer.push(12, 0.9)).toBeNull();
    expect(buffer.push(13, 0.9)).toBeNull();
    expect(buffer.push(14, 0.9)).toBeNull();
  });
});

describe('weightToCount', () => {
  it('derives a piece count from net weight', () => {
    expect(weightToCount(124, 12.4, { tareG: 0, integerTolerance: 0.15 }).quantity).toBe(10);
  });

  it('subtracts the container tare', () => {
    expect(weightToCount(224, 12.4, { tareG: 100, integerTolerance: 0.15 }).quantity).toBe(10);
  });

  it('refuses to auto-fill when the weight does not land near a whole unit', () => {
    // 10.5 units — consistent with a wrong tare or a mis-set unit weight.
    const result = weightToCount(130.2, 12.4, { tareG: 0, integerTolerance: 0.15 });
    expect(result.confidence).toBe(0);
  });

  it('treats an empty container as a confident zero', () => {
    expect(weightToCount(100, 12.4, { tareG: 100, integerTolerance: 0.15 })).toEqual({
      quantity: 0,
      confidence: 0.95,
    });
  });
});

describe('parseAsciiWeight', () => {
  it('reads a stable bench-scale line', () => {
    expect(parseAsciiWeight('ST,GS,   123.45 g')).toEqual({ grams: 123.45, stable: true });
  });

  it('marks an unstable reading', () => {
    expect(parseAsciiWeight('US,GS,   123.45 g')?.stable).toBe(false);
  });

  it('normalises other units to grams', () => {
    expect(parseAsciiWeight('1.5 kg')?.grams).toBeCloseTo(1500);
  });

  it('ignores lines with no weight in them', () => {
    expect(parseAsciiWeight('READY')).toBeNull();
  });
});
