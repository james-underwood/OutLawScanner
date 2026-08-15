import { describe, expect, it } from 'vitest';
import { classify, DEFAULT_TOLERANCE, latestObservations, reconcile } from './reconcile';
import type { AuditSession, CountEvent, ExpectedInventory } from './types';

const session: AuditSession = {
  id: 'session-1',
  facilityLicense: 'LIC-1',
  zone: 'vault-a',
  operatorId: 'op-1',
  mode: 'live',
  status: 'open',
  openedAt: 0,
  closedAt: null,
};

function pkg(over: Partial<ExpectedInventory> = {}): ExpectedInventory {
  return {
    id: 'e1',
    facilityLicense: 'LIC-1',
    packageLabel: 'LABEL-1',
    itemName: 'Item',
    sku: 'SKU',
    quantity: 10,
    unitOfMeasure: 'Each',
    unitWeightG: 5,
    unitFootprintPx: null,
    zone: 'vault-a',
    source: 'import',
    syncedAt: 0,
    ...over,
  };
}

function event(over: Partial<CountEvent> = {}): CountEvent {
  return {
    id: 'c1',
    sessionId: 'session-1',
    packageLabel: 'LABEL-1',
    method: 'manual',
    observedQuantity: 10,
    unitOfMeasure: 'Each',
    confidence: null,
    evidence: null,
    modelVersion: null,
    deviceId: 'dev-1',
    observedAt: 1000,
    shadow: false,
    syncedAt: null,
    ...over,
  };
}

describe('classify', () => {
  it('treats an exact match as a match', () => {
    expect(classify(0, 10, DEFAULT_TOLERANCE.Each)).toBe('match');
  });

  it('escalates a large absolute variance to reportable', () => {
    expect(classify(-4, 100, DEFAULT_TOLERANCE.Each)).toBe('reportable');
  });

  it('escalates a large proportional variance even when small in absolute terms', () => {
    expect(classify(-1, 4, DEFAULT_TOLERANCE.Each)).toBe('reportable');
  });

  it('allows scale noise on gram-denominated packages', () => {
    expect(classify(0.3, 453.6, DEFAULT_TOLERANCE.Grams)).toBe('within_tolerance');
  });

  it('does not divide by zero when nothing was expected', () => {
    expect(classify(2, 0, DEFAULT_TOLERANCE.Each)).toBe('reportable');
  });
});

describe('latestObservations', () => {
  it('lets a recount supersede an earlier count', () => {
    const observations = latestObservations([
      event({ id: 'a', observedQuantity: 8, observedAt: 100 }),
      event({ id: 'b', observedQuantity: 9, observedAt: 200 }),
    ]);
    expect(observations.get('LABEL-1')?.observedQuantity).toBe(9);
  });

  it('never lets a shadow observation move inventory', () => {
    const observations = latestObservations([
      event({ id: 'a', observedQuantity: 8, observedAt: 100 }),
      event({ id: 'b', observedQuantity: 99, observedAt: 200, shadow: true, method: 'camera' }),
    ]);
    expect(observations.get('LABEL-1')?.observedQuantity).toBe(8);
  });
});

describe('reconcile', () => {
  it('reports uncounted packages without inventing a variance', () => {
    const report = reconcile(session, [pkg()], []);
    expect(report.uncountedPackages).toBe(1);
    expect(report.rows[0]?.countedQuantity).toBeNull();
    expect(report.rows[0]?.variance).toBe(0);
    expect(report.rows[0]?.classification).toBe('not_counted');
  });

  it('computes variance against expected quantity', () => {
    const report = reconcile(session, [pkg({ quantity: 10 })], [event({ observedQuantity: 7 })]);
    expect(report.rows[0]?.variance).toBe(-3);
    expect(report.rows[0]?.classification).toBe('reportable');
  });

  it('flags a package found on the shelf but absent from expected inventory', () => {
    const report = reconcile(
      session,
      [pkg()],
      [event({ packageLabel: 'GHOST-1', observedQuantity: 5 })],
    );
    const ghost = report.rows.find((r) => r.packageLabel === 'GHOST-1');
    expect(ghost?.unexpected).toBe(true);
    expect(ghost?.classification).toBe('reportable');
  });

  it('ranks an uncounted package above a clean match', () => {
    const report = reconcile(
      session,
      [pkg({ id: 'e1', packageLabel: 'A' }), pkg({ id: 'e2', packageLabel: 'B' })],
      [event({ id: 'c1', packageLabel: 'A', observedQuantity: 10 })],
    );
    expect(report.rows[0]?.packageLabel).toBe('B');
    expect(report.rows[0]?.classification).toBe('not_counted');
  });

  it('sorts the most severe rows to the top', () => {
    const report = reconcile(
      session,
      [pkg({ id: 'e1', packageLabel: 'A' }), pkg({ id: 'e2', packageLabel: 'B' })],
      [
        event({ id: 'c1', packageLabel: 'A', observedQuantity: 10 }),
        event({ id: 'c2', packageLabel: 'B', observedQuantity: 2 }),
      ],
    );
    expect(report.rows[0]?.packageLabel).toBe('B');
  });
});
