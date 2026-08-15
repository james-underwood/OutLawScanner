# 03 — Technical Roadblocks, Ranked

Ordered by how likely each is to kill the project, not by how interesting it is.

---

## 1. Staff will not trust it, and they are right not to

The most common failure mode for automated counting is not a bad model — it is
a correct system nobody uses. Staff are accountable for inventory they did not
personally count, on a product where discrepancies can cost someone a license.

**Mitigation:** shadow mode for 4–6 weeks (see
[doc 00](00-approach-analysis.md)), then show staff their own accuracy numbers
per SKU. Let the fallback to manual entry always be one tap away and never
punish its use. Frame the product as "confirm instead of count," never as
"replaces you" — the human stays in the compliance loop by design.

---

## 2. Occlusion, stacking and enclosure

Vision counts what it can see. Jars behind jars, product in closed boxes, and
bags overlapping in a bin are the normal state of a dispensary vault, not the
exception.

**Mitigation:** a capture protocol (single layer, top-down, guided overlay
frame) which roughly matches what a human already does to count by hand;
multi-frame consensus; and crucially, **routing enclosed and stacked goods to
the scale instead**, since weight does not care about line of sight. This is the
main reason the architecture is modality-pluggable.

---

## 3. Unit-of-measure mismatch

Counting objects only reconciles `Each` packages. Gram-denominated packages —
frequently a large share of vault value — cannot be served by a piece count at
all. A system that silently treats "14 jars" as reconciling a 396.9 g package
produces confident, wrong answers.

**Mitigation:** branch on UoM in the data model from day one; camera source
declines gram packages outright; scale reads grams natively.

---

## 4. Metrc vendor key gating and per-state divergence

Metrc is not one API — it is roughly two dozen state deployments with differing
endpoint versions, adjustment reason lists, and rules. Production vendor keys
require a formal validation process with legal sign-off and a sandbox capability
assessment (see [doc 02](02-integration-metrc-outlaw.md)).

**Mitigation:** design v1 to not need Metrc write access at all. Start the
onboarding paperwork in parallel if you expect to need it later. Never hardcode
adjustment reasons or endpoint paths; fetch and configure per state.

---

## 5. Double-write and conflicting adjustments

Two systems adjusting the same package is worse than no automation.

**Mitigation:** single-writer rule, enforced architecturally — v1 has no write
path to Metrc at all, so the rule cannot be violated by accident.

---

## 6. Detected shrink creates immediate legal obligations

This is the roadblock most likely to be overlooked because it is not technical.
A system that reliably finds discrepancies will find *real* ones, and several
jurisdictions require reporting suspected theft or significant loss within a
fixed window. Your software will manufacture knowledge that starts a clock.

**Mitigation:** build the escalation path before you go live — threshold
classification, notification to the compliance officer, evidence attached,
timestamps preserved. Involve whoever owns compliance at your business in the
design review, not after launch. Do not let large variances sit silently in a
table.

---

## 7. Training data and packaging drift

You need labeled images of *your* products, and cannabis packaging changes
constantly — new vendors, seasonal artwork, sudden format switches. A model
trained in March degrades by September without anyone noticing.

**Mitigation:** capture evidence frames continuously in production (that is
partly what `evidence_uri` is for), monitor per-SKU accuracy as a live metric,
and plan on periodic retraining as routine maintenance rather than a one-time
cost. Prefer approaches with fewer moving parts — template matching against a
known unit footprint degrades more gracefully and is trivially updated.

---

## 8. iOS Safari and browser platform limits

`BarcodeDetector` is unavailable on iOS Safari (WASM fallback needed); camera
control is limited compared to native — no reliable manual focus or exposure
lock, both of which matter for count accuracy; PWA install is awkward; and there
is no background execution.

**Mitigation:** WASM barcode fallback; consider a Capacitor wrapper to get
native camera control and iOS's excellent built-in multi-barcode scanner.
Decide the target device *before* building the capture layer — this choice is
expensive to reverse.

---

## 9. The physical environment

Vault Wi-Fi is poor or absent. Lighting is uneven. Staff wear gloves. Devices
get dropped. A six-hour audit outlives a phone battery running continuous
inference.

**Mitigation:** offline-first is non-negotiable (IndexedDB session state, sync
outbox); throttle inference to ~5 fps; large touch targets; test in the actual
room early, because bench conditions will mislead you.

---

## 10. Unit-weight variance limits the scale

Tare variance between jars, moisture changes in flower, and mixed container
types all degrade weight-derived counts.

**Mitigation:** establish per-SKU unit weight by sampling ~10 units; refuse to
auto-count when the measured value is not close to an integer multiple of unit
weight; keep sealed uniform goods on the scale and route variable goods to the
camera or manual entry.

---

## 11. False confidence is worse than no automation

An automated count that is wrong *and* trusted is the one outcome strictly worse
than the status quo.

**Mitigation:** confidence gating with a deliberately conservative threshold;
never auto-commit; always require human confirmation; track a "confirmed
unchanged" rate as the primary quality metric. If that rate is not high, the
automation is not ready — regardless of how good the offline accuracy looks.

---

## Cheapest experiments to de-risk, in order

1. **Buy one counting scale** (~$150) and time a real audit against the current
   process. Answers "is there a win here at all" this week, for almost nothing.
2. **Photograph 200 real shelf/tray layouts** in your actual vault lighting.
   That dataset determines whether the vision path is viable — and it is
   required work for any ML approach anyway.
3. **Email Outlaw** about RFID enablement and Outlink API access. May remove
   entire phases from this roadmap.
4. **Ask your compliance officer** what a detected discrepancy obliges you to do
   in your state. That answer shapes the product more than any technology choice
   in this document.
