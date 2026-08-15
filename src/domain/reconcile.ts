import type {
  AuditSession,
  CountEvent,
  Discrepancy,
  DiscrepancyClass,
  ExpectedInventory,
  ReconciliationReport,
} from './types';

export interface Tolerance {
  /** Absolute variance at or below this counts as within tolerance. */
  absolute: number;
  /** Fractional variance (0..1) at or below this counts as within tolerance. */
  percent: number;
  /** Variance at or above this is a compliance escalation, not a bookkeeping fix. */
  reportableAbsolute: number;
  reportablePercent: number;
}

/**
 * Defaults are deliberately tight for `Each` and looser for `Grams`, where scale
 * precision and moisture make exact agreement unrealistic. These belong in
 * facility config — the numbers a given state expects will differ.
 */
export const DEFAULT_TOLERANCE: Record<'Each' | 'Grams', Tolerance> = {
  Each: { absolute: 0, percent: 0, reportableAbsolute: 3, reportablePercent: 0.05 },
  Grams: { absolute: 0.5, percent: 0.01, reportableAbsolute: 5, reportablePercent: 0.05 },
};

export function classify(
  variance: number,
  expected: number,
  tolerance: Tolerance,
): DiscrepancyClass {
  if (variance === 0) return 'match';

  const abs = Math.abs(variance);
  // A variance against an expected quantity of zero has no meaningful percentage;
  // fall back to absolute thresholds rather than dividing by zero.
  const pct = expected === 0 ? Infinity : abs / Math.abs(expected);

  if (abs >= tolerance.reportableAbsolute || pct >= tolerance.reportablePercent) {
    return 'reportable';
  }
  if (abs <= tolerance.absolute || pct <= tolerance.percent) {
    return 'within_tolerance';
  }
  return 'investigate';
}

/**
 * Collapses the event log to one observation per package: the most recent
 * non-shadow event wins, because a recount is an operator correcting themselves.
 * Shadow events are excluded — they exist to measure the model, never to move
 * inventory.
 */
export function latestObservations(events: CountEvent[]): Map<string, CountEvent> {
  const latest = new Map<string, CountEvent>();
  for (const event of events) {
    if (event.shadow) continue;
    const current = latest.get(event.packageLabel);
    if (!current || event.observedAt > current.observedAt) {
      latest.set(event.packageLabel, event);
    }
  }
  return latest;
}

export function reconcile(
  session: AuditSession,
  expected: ExpectedInventory[],
  events: CountEvent[],
  tolerances: Record<'Each' | 'Grams', Tolerance> = DEFAULT_TOLERANCE,
): ReconciliationReport {
  const observations = latestObservations(events);
  const rows: Discrepancy[] = [];
  let counted = 0;
  let uncounted = 0;

  for (const pkg of expected) {
    const observation = observations.get(pkg.packageLabel);

    if (!observation) {
      uncounted += 1;
      rows.push({
        packageLabel: pkg.packageLabel,
        itemName: pkg.itemName,
        sku: pkg.sku,
        expectedQuantity: pkg.quantity,
        countedQuantity: null,
        variance: 0,
        variancePct: 0,
        unitOfMeasure: pkg.unitOfMeasure,
        classification: 'not_counted',
        method: null,
        confidence: null,
        observedAt: null,
        unexpected: false,
      });
      continue;
    }

    counted += 1;
    const variance = observation.observedQuantity - pkg.quantity;
    const tolerance = tolerances[pkg.unitOfMeasure];
    rows.push({
      packageLabel: pkg.packageLabel,
      itemName: pkg.itemName,
      sku: pkg.sku,
      expectedQuantity: pkg.quantity,
      countedQuantity: observation.observedQuantity,
      variance,
      variancePct: pkg.quantity === 0 ? 0 : variance / pkg.quantity,
      unitOfMeasure: pkg.unitOfMeasure,
      classification: classify(variance, pkg.quantity, tolerance),
      method: observation.method,
      confidence: observation.confidence,
      observedAt: observation.observedAt,
      unexpected: false,
    });
  }

  // Packages found on the shelf that expected inventory does not know about.
  // Easy to forget, and as compliance-relevant as a shortage.
  const known = new Set(expected.map((p) => p.packageLabel));
  for (const [label, observation] of observations) {
    if (known.has(label)) continue;
    counted += 1;
    rows.push({
      packageLabel: label,
      itemName: '(unknown package)',
      sku: null,
      expectedQuantity: 0,
      countedQuantity: observation.observedQuantity,
      variance: observation.observedQuantity,
      variancePct: 0,
      unitOfMeasure: observation.unitOfMeasure,
      classification: 'reportable',
      method: observation.method,
      confidence: observation.confidence,
      observedAt: observation.observedAt,
      unexpected: true,
    });
  }

  rows.sort((a, b) => severity(b) - severity(a) || Math.abs(b.variance) - Math.abs(a.variance));

  return {
    sessionId: session.id,
    facilityLicense: session.facilityLicense,
    zone: session.zone,
    generatedAt: Date.now(),
    countedPackages: counted,
    uncountedPackages: uncounted,
    rows,
  };
}

const SEVERITY: Record<DiscrepancyClass, number> = {
  reportable: 4,
  investigate: 3,
  not_counted: 2,
  within_tolerance: 1,
  match: 0,
};

function severity(row: Discrepancy): number {
  return SEVERITY[row.classification];
}
