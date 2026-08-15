/**
 * Multi-frame consensus.
 *
 * The highest-leverage trick in the whole capture pipeline, and it costs a ring
 * buffer. A detector that is right on 85% of individual frames becomes reliable
 * when it must produce the same integer on several consecutive frames — and
 * disagreement across frames *is* the confidence signal, so this doubles as
 * calibration. Nothing here needs training.
 */
export interface ConsensusOptions {
  /** How many recent frames to consider. */
  window: number;
  /** How many of them must agree on the same quantity. */
  agreement: number;
  /** Per-frame confidence floor; noisier frames are not admitted as votes. */
  minFrameConfidence: number;
}

export const DEFAULT_CONSENSUS: ConsensusOptions = {
  window: 5,
  agreement: 3,
  minFrameConfidence: 0.35,
};

export interface ConsensusResult {
  quantity: number;
  confidence: number;
  votes: number;
  window: number;
}

export class ConsensusBuffer {
  private readonly frames: { quantity: number; confidence: number }[] = [];

  constructor(private readonly options: ConsensusOptions = DEFAULT_CONSENSUS) {}

  push(quantity: number, confidence: number): ConsensusResult | null {
    if (confidence >= this.options.minFrameConfidence) {
      this.frames.push({ quantity, confidence });
      if (this.frames.length > this.options.window) this.frames.shift();
    }
    return this.settled();
  }

  settled(): ConsensusResult | null {
    if (this.frames.length < this.options.agreement) return null;

    const tally = new Map<number, { votes: number; confidenceSum: number }>();
    for (const frame of this.frames) {
      const entry = tally.get(frame.quantity) ?? { votes: 0, confidenceSum: 0 };
      entry.votes += 1;
      entry.confidenceSum += frame.confidence;
      tally.set(frame.quantity, entry);
    }

    let best: ConsensusResult | null = null;
    for (const [quantity, { votes, confidenceSum }] of tally) {
      if (votes < this.options.agreement) continue;
      // Agreement across frames dominates; per-frame confidence breaks ties.
      const confidence = (votes / this.frames.length) * (confidenceSum / votes);
      if (!best || confidence > best.confidence) {
        best = { quantity, confidence, votes, window: this.frames.length };
      }
    }
    return best;
  }

  reset(): void {
    this.frames.length = 0;
  }

  get size(): number {
    return this.frames.length;
  }
}
