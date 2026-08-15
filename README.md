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

## Status

Design phase. No implementation yet.
