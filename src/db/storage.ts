/**
 * Storage availability probe.
 *
 * IndexedDB is not guaranteed to exist just because the API is present. It is
 * blocked in private browsing on some engines, on `file://` origins, inside
 * sandboxed frames, and by enterprise policy on managed devices — all of which
 * are realistic for staff handhelds. An offline-first audit tool that hard-fails
 * in those conditions is worse than useless, so probe first and degrade to an
 * in-memory store rather than showing a blank screen.
 */
export type StorageMode = 'persistent' | 'memory';

/**
 * Actually opens a database rather than checking for the global. Blocked
 * environments expose `indexedDB` and then throw, or hang, on open.
 */
function probe(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    try {
      if (typeof indexedDB === 'undefined') return done(false);

      const request = indexedDB.open('outlawscanner-probe');
      request.onsuccess = () => {
        request.result.close();
        try {
          indexedDB.deleteDatabase('outlawscanner-probe');
        } catch {
          // Cleanup is best-effort; the probe already succeeded.
        }
        done(true);
      };
      request.onerror = () => done(false);
      request.onblocked = () => done(false);

      // Some sandboxes neither resolve nor reject. Do not let the app hang on it.
      setTimeout(() => done(false), 1500);
    } catch {
      done(false);
    }
  });
}

/**
 * Must run before any Dexie instance is constructed, so the polyfill is in
 * place when Dexie captures the global.
 */
export async function ensureStorage(): Promise<StorageMode> {
  if (await probe()) return 'persistent';

  const fake = await import('fake-indexeddb');
  Object.defineProperty(globalThis, 'indexedDB', { value: fake.indexedDB, configurable: true });
  Object.defineProperty(globalThis, 'IDBKeyRange', { value: fake.IDBKeyRange, configurable: true });
  return 'memory';
}
