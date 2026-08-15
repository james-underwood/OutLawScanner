# 01 — System Architecture

## Design principles

1. **Offline-first.** Vaults are concrete boxes with bad Wi-Fi. An audit that
   dies when the signal drops is worse than a clipboard. All session state lives
   locally and syncs opportunistically.
2. **Single writer to Metrc.** Whatever else happens, exactly one system in your
   stack is allowed to mutate Metrc. See [doc 02](02-integration-metrc-outlaw.md).
3. **Counts are observations, not facts.** A count event is immutable evidence
   with a timestamp, method, and confidence. Adjustments are a separate,
   human-approved decision derived from observations.
4. **Modality is pluggable.** Camera, scale, RFID and manual entry all implement
   one interface and are interchangeable per bin.
5. **Never put a Metrc credential on the device.** Vendor and user API keys are
   server-side only, always.

---

## Component overview

```
┌─────────────────────────────────────────────────────────┐
│  CAPTURE CLIENT  (PWA — phone / tablet / Maverick)      │
│                                                         │
│  Identity        ──► barcode scan (existing behavior)   │
│  Quantity        ──► CountSource adapter:               │
│                       • CameraCounter  (WebGL/WASM)     │
│                       • ScaleCounter   (Web Bluetooth)  │
│                       • RfidCounter    (Phase 3)        │
│                       • ManualCounter  (always present) │
│  Session state   ──► IndexedDB  (survives offline)      │
│  Outbox          ──► queued, idempotent sync            │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS, batched
┌──────────────────────────▼──────────────────────────────┐
│  SYNC + RECONCILIATION SERVICE                          │
│   • expected-inventory cache (from POS / Metrc)         │
│   • reconciliation engine → discrepancies               │
│   • audit log (append-only, immutable)                  │
│   • credential vault (Metrc keys never leave here)      │
└──────────────────────────┬──────────────────────────────┘
                           │
        ┌──────────────────┼───────────────────┐
        ▼                  ▼                   ▼
   ┌─────────┐      ┌────────────┐      ┌────────────┐
   │  Metrc  │      │ Outlaw /   │      │  Export    │
   │ (read)  │      │ POS API    │      │  CSV/PDF   │
   └─────────┘      └────────────┘      └────────────┘
     read-only       preferred write      v1 default
```

**Suggested stack** (matches tooling you already have connected):

- Client: React + Vite PWA, Dexie over IndexedDB, `getUserMedia` for camera.
- Inference: ONNX Runtime Web or TF.js with WebGL/WebGPU backend.
- Barcode: native `BarcodeDetector` where available (Android/Chrome), `zxing-wasm`
  as the fallback — notably on iOS Safari, which does not expose `BarcodeDetector`.
- Backend: Supabase (Postgres + Row Level Security + Realtime + Edge Functions).
- Metrc/POS calls: Edge Functions only, so keys stay server-side.

**A note on iOS.** If you land on iPads, seriously consider wrapping the PWA in
Capacitor. iOS's native `DataScannerViewController` does fast, reliable
multi-barcode scanning for free, and native camera control gives you manual
focus and exposure lock — both of which materially improve counting accuracy
over what Safari will give you.

---

## Data model

```sql
-- What Metrc/POS says should be there. Refreshed on sync.
create table expected_inventory (
  id                uuid primary key,
  facility_license  text not null,
  package_label     text not null,        -- Metrc UID, the join key
  item_name         text not null,
  sku               text,
  quantity          numeric not null,
  unit_of_measure   text not null,        -- 'Each' | 'Grams' | ...
  unit_weight_g     numeric,              -- null => scale counting unavailable
  source            text not null,        -- 'metrc' | 'pos'
  synced_at         timestamptz not null,
  unique (facility_license, package_label, source)
);

create table audit_sessions (
  id               uuid primary key,
  facility_license text not null,
  zone             text,                  -- 'vault-a', 'floor-display-3'
  operator_id      uuid not null,
  mode             text not null,         -- 'shadow' | 'live'
  status           text not null,         -- 'open' | 'submitted' | 'closed'
  opened_at        timestamptz not null,
  closed_at        timestamptz
);

-- Immutable evidence. Never updated, never deleted.
create table count_events (
  id                uuid primary key,     -- client-generated; the idempotency key
  session_id        uuid not null references audit_sessions(id),
  package_label     text not null,
  method            text not null,        -- 'camera'|'scale'|'rfid'|'manual'
  observed_quantity numeric not null,
  unit_of_measure   text not null,
  confidence        numeric,              -- 0..1, null for manual
  evidence_uri      text,                 -- frame capture, for disputes
  model_version     text,
  device_id         text not null,
  observed_at       timestamptz not null,
  created_at        timestamptz not null default now()
);

-- Derived, and the only thing a human acts on.
create table discrepancies (
  id                uuid primary key,
  session_id        uuid not null references audit_sessions(id),
  package_label     text not null,
  expected_quantity numeric not null,
  counted_quantity  numeric not null,
  variance          numeric generated always as
                      (counted_quantity - expected_quantity) stored,
  unit_of_measure   text not null,
  resolution        text,                 -- 'accepted'|'recount'|'escalated'
  resolved_by       uuid,
  resolved_at       timestamptz
);
```

Two things worth calling out:

- `count_events.id` is generated on the client and doubles as the **idempotency
  key**. A handheld that loses signal mid-sync and retries cannot double-count.
- `evidence_uri` matters more than it looks. When a count disagrees with the POS
  by $4,000 of product, someone will want to see the frame. It is also what
  makes a regulator comfortable.

---

## The capture pipeline

```
  camera frame (throttled to ~5 fps, not 30 — battery)
        │
        ├─► barcode pass ──► package_label + expected UoM, SKU priors
        │
        └─► count pass (only if UoM = 'Each')
              │
              ├─ SKU has a template?  ──► template match, count peaks
              └─ else                 ──► single-class detector @ 640px
              │
              ▼
        multi-frame consensus: N of last M frames agree
              │
              ▼
        confidence gate
          high  ──► pre-fill, one-tap confirm
          low   ──► fall back to manual entry, log the miss
```

**Multi-frame consensus is the single highest-leverage trick here.** A detector
that is 88% accurate on one frame becomes far more reliable when you require
three of the last five frames to produce the same integer. It also gives you a
free confidence signal — disagreement across frames *is* low confidence — and it
costs nothing but a ring buffer.

Throttle to ~5 fps. Running inference at full frame rate will cook the battery
on a device someone needs for a six-hour shift, and buys nothing.

### The CountSource interface

```ts
type CountResult = {
  quantity: number;
  unitOfMeasure: 'Each' | 'Grams';
  confidence: number;          // 0..1
  evidence?: Blob;
  modelVersion?: string;
};

interface CountSource {
  readonly method: 'camera' | 'scale' | 'rfid' | 'manual';
  isAvailable(): Promise<boolean>;
  supports(pkg: ExpectedInventory): boolean;   // e.g. scale needs unit_weight_g
  count(pkg: ExpectedInventory): Promise<CountResult>;
}
```

`supports()` is what makes the per-SKU routing table in
[doc 00](00-approach-analysis.md) work at runtime: the scale source declines
packages with no known unit weight, the camera source declines gram-denominated
packages, and `ManualCounter` accepts everything as the guaranteed fallback.

---

## Reconciliation

Runs server-side when a session is submitted:

1. Aggregate `count_events` per `package_label`, taking the latest observation
   per package (recounts supersede).
2. Join against `expected_inventory` for the facility.
3. Emit a `discrepancies` row wherever variance ≠ 0.
4. Classify: `within_tolerance` / `investigate` / `reportable`.

That third bucket is a compliance obligation, not a UI state. Several states
require reporting suspected theft or significant loss within a fixed window
(often 24 hours). **The moment your system reliably detects shrink, it creates
a duty to act on it.** Build the escalation path deliberately — a clear
notification to the compliance officer, with the evidence attached — rather than
letting a large variance sit quietly in a table.

Also flag the inverse: packages *found* that the system did not expect at all.
Those are as compliance-relevant as missing ones and are easy to forget.

---

## Delivery phases

| Phase | Scope | Success measure |
|---|---|---|
| **0** | Read-only sync + digital count sheet, manual entry. No automation. | Replaces paper. Proves sync and data model. |
| **1** | Scale adapter + confirm-don't-type UX. | Count time per package drops. Cheapest real win. |
| **2** | Camera counter, **shadow mode only**. | Per-SKU accuracy dataset. Nothing user-visible. |
| **3** | Camera counter live, confidence-gated. | % of counts auto-filled and confirmed unchanged. |
| **4** | Write-back to POS/Outlaw; container-level RFID. | Full loop closed. |

Phase 1 before Phase 2 is deliberate and is probably the least intuitive
recommendation in this document. The scale is a few hundred dollars, ships in
days, needs no training data, and works on the stacked and enclosed goods where
vision fails. Get the workflow, sync, and reconciliation proven with the boring
technology first — then the camera work becomes an accuracy upgrade to a system
that already works, rather than a research project the whole product depends on.
