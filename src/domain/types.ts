/**
 * Metrc denominates packages in a unit of measure. Piece counting only ever
 * reconciles `Each`; weight-denominated packages must be resolved on a scale.
 * Every count path in this app branches on this, so it is modelled explicitly
 * rather than inferred from the number.
 */
export type UnitOfMeasure = 'Each' | 'Grams';

export type CountMethod = 'manual' | 'scale' | 'camera' | 'rfid';

/** What Metrc / the POS says should be on the shelf. Read-only, refreshed on sync. */
export interface ExpectedInventory {
  id: string;
  facilityLicense: string;
  /** Metrc UID. The join key for everything downstream. */
  packageLabel: string;
  itemName: string;
  sku: string | null;
  quantity: number;
  unitOfMeasure: UnitOfMeasure;
  /** Mean grams per unit, established by sampling. Null => scale counting unavailable. */
  unitWeightG: number | null;
  /** Mean footprint in px² at the reference capture distance. Null => no camera prior. */
  unitFootprintPx: number | null;
  zone: string | null;
  source: 'metrc' | 'pos' | 'import';
  syncedAt: number;
}

export type SessionMode = 'shadow' | 'live';
export type SessionStatus = 'open' | 'submitted' | 'closed';

export interface AuditSession {
  id: string;
  facilityLicense: string;
  zone: string | null;
  operatorId: string;
  mode: SessionMode;
  status: SessionStatus;
  openedAt: number;
  closedAt: number | null;
}

/**
 * Immutable evidence of an observation. Never updated, never deleted — a recount
 * appends a new event and supersedes by timestamp. `id` is generated client-side
 * and doubles as the idempotency key for sync, so a handheld that loses signal
 * mid-request and retries cannot double-count.
 */
export interface CountEvent {
  id: string;
  sessionId: string;
  packageLabel: string;
  method: CountMethod;
  observedQuantity: number;
  unitOfMeasure: UnitOfMeasure;
  /** 0..1. Null for manual entry — a human typing a number has no model confidence. */
  confidence: number | null;
  /** Captured frame / scale reading, retained for dispute and for model eval. */
  evidence: Blob | null;
  modelVersion: string | null;
  deviceId: string;
  observedAt: number;
  /** In shadow mode the automated answer is recorded but never shown to the operator. */
  shadow: boolean;
  syncedAt: number | null;
}

/**
 * `not_counted` is deliberately its own state rather than a match. An
 * unverified package is an absence of evidence, and reporting it as agreement
 * is how a partial audit gets mistaken for a complete one.
 */
export type DiscrepancyClass =
  | 'match'
  | 'within_tolerance'
  | 'not_counted'
  | 'investigate'
  | 'reportable';

export interface Discrepancy {
  packageLabel: string;
  itemName: string;
  sku: string | null;
  expectedQuantity: number;
  countedQuantity: number | null;
  variance: number;
  variancePct: number;
  unitOfMeasure: UnitOfMeasure;
  classification: DiscrepancyClass;
  method: CountMethod | null;
  confidence: number | null;
  observedAt: number | null;
  /** Present on the shelf but absent from expected inventory — as reportable as a shortage. */
  unexpected: boolean;
}

export interface ReconciliationReport {
  sessionId: string;
  facilityLicense: string;
  zone: string | null;
  generatedAt: number;
  countedPackages: number;
  uncountedPackages: number;
  rows: Discrepancy[];
}
