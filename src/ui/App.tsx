import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deviceId, newId } from '../db/schema';
import { DEMO_LICENSE, demoInventory, parseInventoryCsv, replaceExpectedInventory } from '../db/seed';
import { reconcile } from '../domain/reconcile';
import { scoreShadowMode } from '../domain/shadow';
import type { AuditSession, CountEvent, ExpectedInventory, SessionMode } from '../domain/types';
import { attachWedgeListener, looksLikeMetrcLabel } from '../barcode/detector';
import type { StorageMode } from '../db/storage';
import { CountPanel } from './CountPanel';
import { ReviewScreen } from './ReviewScreen';

type View = 'setup' | 'count' | 'review';

export function App({ storage }: { storage: StorageMode }) {
  const [view, setView] = useState<View>('setup');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const session = useLiveQuery(
    async () => (sessionId ? ((await db.sessions.get(sessionId)) ?? null) : null),
    [sessionId],
  );

  const expected = useLiveQuery(
    async () =>
      session
        ? db.expected
            .where('facilityLicense')
            .equals(session.facilityLicense)
            .filter((p) => !session.zone || p.zone === session.zone)
            .toArray()
        : [],
    [session?.facilityLicense, session?.zone],
    [] as ExpectedInventory[],
  );

  const events = useLiveQuery(
    async () => (sessionId ? db.events.where('sessionId').equals(sessionId).toArray() : []),
    [sessionId],
    [] as CountEvent[],
  );

  // Hardware barcode guns present as keyboards. Honouring them means the
  // existing scanning workflow keeps working unchanged on Maverick-class
  // devices, where identity is already a solved problem.
  useEffect(() => {
    if (view !== 'count') return;
    return attachWedgeListener(document, (value) => {
      const label = value.trim().toUpperCase();
      if (looksLikeMetrcLabel(label) || label.length >= 6) setActiveLabel(label);
    });
  }, [view]);

  const countedLabels = useMemo(
    () => new Set(events.filter((e) => !e.shadow).map((e) => e.packageLabel)),
    [events],
  );

  const activePkg = expected.find((p) => p.packageLabel === activeLabel) ?? null;

  const visible = expected.filter((p) => {
    if (!filter.trim()) return true;
    const needle = filter.toLowerCase();
    return (
      p.itemName.toLowerCase().includes(needle) ||
      p.packageLabel.toLowerCase().includes(needle) ||
      (p.sku ?? '').toLowerCase().includes(needle)
    );
  });

  const startSession = async (facilityLicense: string, zone: string | null, mode: SessionMode) => {
    const record: AuditSession = {
      id: newId(),
      facilityLicense,
      zone,
      operatorId: deviceId(),
      mode,
      status: 'open',
      openedAt: Date.now(),
      closedAt: null,
    };
    await db.sessions.add(record);
    setSessionId(record.id);
    setView('count');
  };

  const commitCount: React.ComponentProps<typeof CountPanel>['onCommit'] = async (input) => {
    if (!session || !activeLabel) return;
    await db.events.add({
      id: newId(),
      sessionId: session.id,
      packageLabel: activeLabel,
      method: input.method,
      observedQuantity: input.quantity,
      unitOfMeasure: input.unitOfMeasure,
      confidence: input.confidence,
      evidence: null,
      modelVersion: input.modelVersion,
      deviceId: deviceId(),
      observedAt: Date.now(),
      // A shadow session records the operator's manual count as the reference
      // truth; only automated observations within it are marked shadow.
      shadow: session.mode === 'shadow' && input.method !== 'manual',
      syncedAt: null,
    });
    setActiveLabel(null);
  };

  if (view === 'setup' || !session) {
    return (
      <div className="app">
        <Header subtitle="Automated inventory counting" />
        <StorageWarning storage={storage} />
        <SetupScreen onStart={startSession} />
      </div>
    );
  }

  if (view === 'review') {
    return (
      <div className="app">
        <Header subtitle={`${session.facilityLicense} · ${session.zone ?? 'all zones'}`} />
        <StorageWarning storage={storage} />
        <ReviewScreen
          report={reconcile(session, expected, events)}
          events={events}
          onBack={() => setView('count')}
        />
      </div>
    );
  }

  const shadowStats = session.mode === 'shadow' ? scoreShadowMode(events, expected) : [];

  return (
    <div className="app">
      <Header subtitle={`${session.zone ?? 'all zones'} · ${countedLabels.size}/${expected.length} counted`} />
      <StorageWarning storage={storage} />

      {session.mode === 'shadow' && (
        <div className="banner">
          <strong>Shadow session.</strong> Automated counts are logged and scored
          against your manual entry but never shown. This is how the system earns
          the right to be trusted before it fills anything in.
          {shadowStats.length > 0 && (
            <div className="small" style={{ marginTop: 8 }}>
              {shadowStats.map((s) => (
                <div key={s.key}>
                  {s.key}: {(s.exactRate * 100).toFixed(0)}% exact over {s.samples} —
                  mean abs error {s.meanAbsError.toFixed(2)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activePkg ? (
        <CountPanel
          pkg={activePkg}
          shadow={session.mode === 'shadow'}
          onCommit={commitCount}
          onCancel={() => setActiveLabel(null)}
        />
      ) : (
        <div className="card">
          <h2>Scan or select a package</h2>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Scan a label, or search by item / SKU"
          />
          {activeLabel && !activePkg && (
            <div className="banner bad" style={{ marginTop: 12, marginBottom: 0 }}>
              <span className="mono">{activeLabel}</span> is not in expected inventory
              for this zone. Counting it anyway will flag it as unexpected.
            </div>
          )}
        </div>
      )}

      <div className="stack">
        {visible.map((pkg) => {
          const done = countedLabels.has(pkg.packageLabel);
          return (
            <button key={pkg.id} className="pkg" onClick={() => setActiveLabel(pkg.packageLabel)}>
              <div className="grow">
                <div className="name truncate">{pkg.itemName}</div>
                <div className="mono muted truncate">{pkg.packageLabel}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="qty">{pkg.quantity}</div>
                <div className="small muted">{pkg.unitOfMeasure}</div>
              </div>
              <span className={`pill ${done ? 'ok' : ''}`}>{done ? 'counted' : 'pending'}</span>
            </button>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="grow" onClick={() => setView('setup')}>End session</button>
        <button className="primary grow" onClick={() => setView('review')}>
          Review &amp; export
        </button>
      </div>
    </div>
  );
}

/**
 * When storage is in-memory the operator must know before they spend an hour
 * counting. Silently losing an audit is the worst failure this app has.
 */
function StorageWarning({ storage }: { storage: StorageMode }) {
  if (storage === 'persistent') return null;
  return (
    <div className="banner bad">
      <strong>This browser is blocking local storage.</strong> The app still works,
      but the audit is held in memory only and will be lost if you refresh or close
      the tab. Export before you leave the page.
    </div>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <header className="bar">
      <div>
        <h1>OUTLAWSCANNER</h1>
        <div className="sub">{subtitle}</div>
      </div>
      <span className="pill accent">v0.1</span>
    </header>
  );
}

function SetupScreen({
  onStart,
}: {
  onStart: (license: string, zone: string | null, mode: SessionMode) => void;
}) {
  const [license, setLicense] = useState(DEMO_LICENSE);
  const [zone, setZone] = useState('');
  const [mode, setMode] = useState<SessionMode>('shadow');
  const [status, setStatus] = useState<string | null>(null);

  const inventory = useLiveQuery(
    async () => db.expected.where('facilityLicense').equals(license).toArray(),
    [license],
    [] as ExpectedInventory[],
  );

  const zones = [...new Set(inventory.map((p) => p.zone).filter(Boolean))] as string[];

  const loadDemo = async () => {
    const count = await replaceExpectedInventory(DEMO_LICENSE, demoInventory());
    setLicense(DEMO_LICENSE);
    setStatus(`Loaded ${count} demo packages.`);
  };

  const importCsv = async (file: File) => {
    const items = parseInventoryCsv(await file.text(), license);
    if (items.length === 0) {
      setStatus('No rows parsed — check the header row.');
      return;
    }
    await replaceExpectedInventory(license, items);
    setStatus(`Imported ${items.length} packages.`);
  };

  return (
    <>
      <div className="card">
        <h2>Expected inventory</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Normally a read-only sync from Metrc or the POS. Until that integration
          exists, import a CSV export — which is also the fastest way to trial
          this against a real vault without waiting on vendor API access.
        </p>
        <div className="stack">
          <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="Facility licence" />
          <div className="row wrap">
            <button onClick={() => void loadDemo()}>Load demo data</button>
            <label className="grow">
              <input
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importCsv(file);
                }}
              />
              <span className="row" style={{ justifyContent: 'center' }}>
                <button type="button" onClick={(e) => e.currentTarget.closest('label')?.click()}>
                  Import CSV
                </button>
              </span>
            </label>
          </div>
          {status && <div className="small muted">{status}</div>}
          <div className="small muted">
            {inventory.length} package{inventory.length === 1 ? '' : 's'} loaded for this licence.
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Start an audit</h2>
        <div className="stack">
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">All zones</option>
            {zones.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>

          <div className="row wrap">
            <button className={mode === 'shadow' ? 'primary' : ''} onClick={() => setMode('shadow')}>
              Shadow mode
            </button>
            <button className={mode === 'live' ? 'primary' : ''} onClick={() => setMode('live')}>
              Live mode
            </button>
          </div>
          <div className="small muted">
            {mode === 'shadow'
              ? 'Count by hand as usual. Automated sources run in parallel, unseen, and are scored against you — run this for a few weeks before trusting anything.'
              : 'Automated counts pre-fill and you confirm. Manual entry stays one tap away.'}
          </div>

          <button
            className="primary"
            disabled={inventory.length === 0}
            onClick={() => onStart(license, zone || null, mode)}
          >
            Start session
          </button>
        </div>
      </div>
    </>
  );
}
