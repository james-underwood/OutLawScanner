import Dexie, { type EntityTable } from 'dexie';
import type { AuditSession, CountEvent, ExpectedInventory } from '../domain/types';

/**
 * Local-first storage.
 *
 * Non-negotiable rather than an optimisation: vaults are concrete rooms with
 * poor or absent Wi-Fi, and an audit that dies when the signal drops is worse
 * than a clipboard. Everything the operator does is written here first and
 * synced opportunistically; the network is never in the critical path.
 */
export class ScannerDb extends Dexie {
  expected!: EntityTable<ExpectedInventory, 'id'>;
  sessions!: EntityTable<AuditSession, 'id'>;
  events!: EntityTable<CountEvent, 'id'>;

  constructor(name = 'outlawscanner') {
    super(name);
    this.version(1).stores({
      expected: 'id, facilityLicense, packageLabel, zone, sku, [facilityLicense+packageLabel]',
      sessions: 'id, facilityLicense, status, openedAt',
      // syncedAt is indexed so the outbox query is a range scan, not a table scan.
      events: 'id, sessionId, packageLabel, observedAt, syncedAt, [sessionId+packageLabel]',
    });
  }
}

export const db = new ScannerDb();

/**
 * Client-generated so it can act as the idempotency key on sync. A handheld
 * that loses connectivity mid-request and retries must not double-count.
 */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function deviceId(): string {
  const KEY = 'outlawscanner.deviceId';
  let id = globalThis.localStorage?.getItem(KEY);
  if (!id) {
    id = newId();
    globalThis.localStorage?.setItem(KEY, id);
  }
  return id;
}

/** Events awaiting upload. Ordered so the server sees them in observation order. */
export async function outbox(database: ScannerDb = db): Promise<CountEvent[]> {
  return database.events.filter((e) => e.syncedAt === null).sortBy('observedAt');
}
