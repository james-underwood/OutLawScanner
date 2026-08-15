import type { CountEvent, CountMethod, ExpectedInventory } from './types';

export interface AccuracyStat {
  key: string;
  method: CountMethod;
  samples: number;
  exact: number;
  /** Fraction of observations that matched the human count exactly. */
  exactRate: number;
  meanAbsError: number;
  /** Signed mean — a persistent bias usually means a calibration problem, not noise. */
  meanSignedError: number;
  worstAbsError: number;
}

/**
 * Shadow mode is how this system earns the right to be trusted: the automated
 * source records an answer the operator never sees, and it is scored against
 * what the operator typed. That produces an honest per-SKU accuracy measurement
 * under real vault conditions, and doubles as a labelled evaluation set.
 *
 * Pairs each shadow observation with the manual observation for the same
 * package in the same session.
 */
export function scoreShadowMode(
  events: CountEvent[],
  expected: ExpectedInventory[],
  groupBy: 'sku' | 'method' = 'sku',
): AccuracyStat[] {
  const skuByLabel = new Map(expected.map((p) => [p.packageLabel, p.sku ?? p.itemName]));

  const truth = new Map<string, CountEvent>();
  for (const event of events) {
    if (event.shadow || event.method !== 'manual') continue;
    const key = `${event.sessionId}::${event.packageLabel}`;
    const current = truth.get(key);
    if (!current || event.observedAt > current.observedAt) truth.set(key, event);
  }

  const buckets = new Map<string, { method: CountMethod; errors: number[] }>();

  for (const event of events) {
    if (!event.shadow) continue;
    const reference = truth.get(`${event.sessionId}::${event.packageLabel}`);
    // No human count for this package means nothing to score against. Skip it
    // rather than assuming the automated answer was right.
    if (!reference) continue;

    const key =
      groupBy === 'method'
        ? event.method
        : `${skuByLabel.get(event.packageLabel) ?? 'unknown'} · ${event.method}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { method: event.method, errors: [] };
      buckets.set(key, bucket);
    }
    bucket.errors.push(event.observedQuantity - reference.observedQuantity);
  }

  const stats: AccuracyStat[] = [];
  for (const [key, { method, errors }] of buckets) {
    const samples = errors.length;
    const exact = errors.filter((e) => e === 0).length;
    stats.push({
      key,
      method,
      samples,
      exact,
      exactRate: exact / samples,
      meanAbsError: errors.reduce((sum, e) => sum + Math.abs(e), 0) / samples,
      meanSignedError: errors.reduce((sum, e) => sum + e, 0) / samples,
      worstAbsError: errors.reduce((worst, e) => Math.max(worst, Math.abs(e)), 0),
    });
  }

  return stats.sort((a, b) => a.exactRate - b.exactRate);
}
