# OutLawScanner

Design work for an automated inventory counting system for a regulated cannabis
retail environment currently running **Outlaw Technology / Maverick** handhelds
against **Metrc** and a POS.

## The problem, stated precisely

Today's Count Mode is already solved for *identity*: a staff member scans a
package barcode and the device knows exactly which Metrc package is in front of
them. The manual, expensive, error-prone step is **quantity acquisition** — a
human physically counts the units and types a number.

So this is not a general "identify arbitrary products on a shelf" computer
vision problem. It is a much narrower and much more tractable one:

> Given a **known, homogeneous** group of units whose identity has already been
> established by a scan, produce a trustworthy count without a human typing it.

Framing it this way changes which technology wins. See
[Approach analysis](docs/00-approach-analysis.md).

## Documents

| Doc | Covers |
|---|---|
| [00 — Approach analysis](docs/00-approach-analysis.md) | Which of CV / RFID / LiDAR / smart shelves to build, and why |
| [01 — System architecture](docs/01-architecture.md) | High-level design, data model, capture pipeline, offline-first sync |
| [02 — Integration](docs/02-integration-metrc-outlaw.md) | Writing results back to Metrc, Outlaw, and POS systems |
| [03 — Roadblocks](docs/03-roadblocks.md) | What will actually go wrong, ranked, with mitigations |

## Recommendation in one paragraph

Build a **quantity-capture layer**, not a new inventory system. Keep the
existing barcode scan for identity. Attach two pluggable count sources behind
one interface: (1) a camera-based counter for homogeneous single-layer groups,
running client-side in a PWA, and (2) a Bluetooth **counting scale** for units
where weight-per-piece is stable. Ship a reconciliation engine that turns counts
into a discrepancy report, and in v1 **export** that report rather than writing
to Metrc directly. Run it in shadow mode alongside manual counting until the
divergence data proves it. RFID is Phase 3 and belongs on *totes and cases*,
not on individual eighths. LiDAR and smart shelves do not earn their cost here.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # unit tests — counting, consensus, scale, reconciliation
npm run build && npm run smoke   # end-to-end browser test against the built app
```

Open the app, press **Load demo data**, and start a session. No backend, no
accounts, no network — everything lives in IndexedDB on the device.

## What is built

Phases 0–2 of the roadmap in [doc 01](docs/01-architecture.md):

- **Offline-first store** (Dexie/IndexedDB) — expected inventory, sessions, and
  an append-only count-event log with client-generated idempotency keys.
- **Pluggable count sources** behind one `CountSource` interface, routed
  per package by `supports()`:
  - **Camera** — adaptive thresholding, 8-connected component labelling, and
    footprint-prior blob splitting. No model, no training data, no drift.
  - **Scale** — Web Bluetooth, supporting both the SIG Weight Scale Service and
    the ASCII serial output cheap bench scales actually emit.
  - **Manual** — always available, always one tap away.
- **Multi-frame consensus** — an answer is withheld until N of the last M frames
  agree, which is also where the confidence number comes from.
- **Confidence gating** — automated counts pre-fill for confirmation only above
  a deliberately conservative threshold; below it, the operator counts by hand.
- **Shadow mode** — automated sources run unseen and are scored against the
  operator's manual count, producing per-SKU accuracy before anything is trusted.
- **Reconciliation** — variance classification with per-UoM tolerances, unexpected
  packages, and escalation of reportable variances.
- **Export** — discrepancy CSV, full event log, and an audit report.

## What is not built, deliberately

- **No write path to Metrc.** The app produces observations and exports them;
  the system of record applies adjustments. That preserves the single-writer
  rule structurally rather than by convention — see
  [doc 02](docs/02-integration-metrc-outlaw.md) for why, and for what becoming a
  validated Metrc integrator actually costs.
- **No sync server yet.** The outbox and idempotency keys are in place; the
  endpoint they post to is not.
- **No fine-tuned detector.** The classical pipeline handles single-layer
  homogeneous groups. A trained model slots in behind `CountSource` when the
  shadow-mode data shows where it is needed.
