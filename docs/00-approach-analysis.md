# 00 — Approach Analysis

## Reframing the problem first

The four candidate technologies were evaluated against the wrong question.
"Which technology can look at a shelf and tell me what's on it?" is a hard,
open-world problem. That is not the problem in front of you.

Your current workflow already establishes identity with a barcode scan. What
you are missing is **the number**. That reduces the task to counting a set of
**identical objects whose identity is already known**, which is a closed-world,
single-class counting problem — dramatically easier and far more accurate.

Three consequences follow, and they drive the whole recommendation:

1. **You do not need object *classification*.** No YOLO/COCO class taxonomy, no
   "is this a Blue Dream cart or a Sour Diesel cart" model. You need a
   single-class detector or, in many cases, no ML at all.
2. **The counting modality can be chosen per product type.** Pre-rolls in a box,
   cartridges in a tray, and eighths in jars have different physics. One
   modality will not win everywhere. Design for pluggability.
3. **Metrc's unit of truth is the package label, not the physical object.** Any
   count that cannot be attributed to a specific package label is useless for
   reconciliation, no matter how accurate the number is.

### The unit-of-measure trap

Metrc packages carry a quantity *and* a unit of measure. A package of
pre-packaged eighths may be tracked as `Each`, while bulk flower is tracked in
grams. **Counting physical objects only reconciles against `Each` packages.**
For weight-based packages, a piece count is meaningless and you need a scale
reading in grams instead. Your data model must branch on UoM from day one, or
you will build something that silently produces garbage for half the vault.

---

## Scoring the four approaches

Scored for a dispensary: small items, visually similar packaging, high
regulatory scrutiny, frequent SKU churn, vault with poor connectivity.

| | Accuracy on your goods | Capex | Per-unit opex | Time to MVP | Resolves package identity |
|---|---|---|---|---|---|
| **Computer vision** | Medium (high when constrained) | ~$0 | $0 | Weeks | No — needs the scan |
| **RFID (per unit)** | High | $2–5k/reader | $0.08–0.15/tag **+ labor** | Months | Yes |
| **LiDAR / ToF** | Low for this use case | Device-dependent | $0 | Months | No |
| **Smart shelves** | High but ambiguous | $150–400/shelf | $0 | Months | No |
| **Counting scale** (not on your list) | **Very high for uniform units** | $80–300/scale | $0 | Days | No — needs the scan |

### 1. Computer vision — **yes, with a narrowed scope**

Viable *because* identity is already solved. Counting 14 identical jars in a
single-layer tray is a tractable problem that a small fine-tuned detector, or
even classical contour/blob detection with a known unit footprint, handles well.

It fails exactly where your cons predicted: stacked, overlapping, or enclosed
goods. The mitigation is procedural, not technical — a capture protocol that
says "lay it out in one layer, shoot top-down" — and that protocol is *already*
roughly what a human does when counting by hand, so it costs little.

Note on tech stack: **COCO-SSD is the wrong model.** Its class list is
`bottle`, `cup`, `book` — it will neither find nor count dispensary packaging
reliably. Plan on fine-tuning a small single-class detector (YOLOv8n or similar)
on 300–800 labeled photos of *your own* shelves, exported to run client-side.
Alternatively, for the many cases where units sit in a regular grid in a tray,
skip ML entirely: template match one unit and count peaks.

### 2. RFID — **right technology, wrong layer, wrong phase**

Note that Outlaw already markets itself as RFID-based seed-to-sale software and
the Maverick handheld already supports RFID tags. **Rebuilding per-unit RFID
would be re-implementing a capability your vendor already sells you.** Before
building anything here, get a quote from Outlaw for enabling RFID on your
existing hardware — that may make this whole line of work unnecessary for the
bulk-count use case.

Where RFID genuinely wins and nobody is doing it for you: **tote-, case- and
shelf-level tagging.** Tag the container, not the eighth. A single fixed reader
at the vault door tells you which totes moved, and a handheld sweep tells you
which totes are present in seconds. The per-unit tagging labor — a human
touching every item once to apply a tag — is the cost that kills per-unit RFID,
and tagging containers avoids it entirely while still collapsing the search
space for the human count.

### 3. LiDAR — **skip**

Depth sensing measures volume and geometry. It cannot distinguish two
identically-shaped mylar bags of different SKUs, which is the dominant condition
in a dispensary vault. It solves a problem (low light, spatial mapping) you do
not have — your vault has lights and your goods do not need 3D mapping. The
narrow case where it helps, segmenting touching identical objects into separate
instances, is better solved by making the human lay them flat.

### 4. Smart shelves / load cells — **skip for MVP, revisit for the vault**

Your own con is the fatal one: mixed SKUs on one shelf make the signal
ambiguous. Add that dispensary vaults get reorganized constantly, so any
fixed shelf-to-SKU mapping decays immediately. High capex, low tolerance for the
messy reality of the room.

But the *underlying physics* — weight ÷ unit weight = count — is excellent. It
just belongs in a handheld scale, not the shelving.

### 5. The approach missing from the list: a counting scale

Every warehouse on earth counts small identical parts by weight, because it is
faster and more accurate than counting them. A $100–300 Bluetooth counting scale
plus the barcode scan you already do gives you:

- Tare the container, weigh, divide by known unit weight → count.
- Works when items are stacked, overlapping, in a bag, or in a closed jar —
  every case where computer vision fails.
- No line of sight, no lighting, no model training, no drift.
- Also directly reads out **grams** for weight-based Metrc packages, which is
  the half of your inventory computer vision structurally cannot serve.

Its weakness is unit-weight variance. It is excellent for cartridges, edibles,
pre-rolls and sealed packaged goods; it degrades for anything where tare or
moisture varies (loose flower in mismatched jars). Establish per-SKU unit weight
by sampling 10 units and taking the mean, and refuse to auto-count when the
measured remainder is not close to an integer multiple.

---

## Recommendation

**Build a pluggable quantity-capture layer with two count sources in v1:
camera and scale.** Keep barcode for identity. Add RFID at container level in
Phase 3 if Outlaw's existing RFID support doesn't already cover it.

The reason for pluggability is not architectural purity — it is that no single
modality covers your catalog:

| Product form | Best count source |
|---|---|
| Cartridges/edibles in a tray | Camera (single layer, high contrast) |
| Pre-rolls in a box | Scale (uniform, stacked) |
| Pre-packaged eighths (jars/bags) | Scale, camera as cross-check |
| Bulk flower (grams) | Scale only — camera cannot serve this |
| Sealed cases in the vault | Container RFID or scanned case label |

### The thing that actually matters

**Ship an interaction change, not just a technology.** The measurable win is
replacing *"type a number"* with *"confirm a number."* Even a count that is
only 90% accurate saves most of the labor, because the human's job becomes
verification instead of enumeration — and verification keeps a licensed human
in the compliance loop, which you want anyway.

That also means: **never auto-commit a count.** Confidence-gate it. High
confidence pre-fills and asks for one tap. Low confidence falls back to today's
manual entry. Your accuracy target for v1 is not "correct" — it is "correct
often enough that confirming is faster than counting, and wrong in a way the
human always catches."

### Prove it before you trust it: shadow mode

Run the app alongside the existing manual process for 4–6 weeks. The staffer
counts and types as they do today; the app captures in parallel and logs its
own answer without showing it. You get, for free:

- An honest per-SKU accuracy measurement under real vault conditions.
- A labeled training/eval dataset from actual operations.
- The evidence needed to convince staff and any regulator that this is sound.

Do not skip this. It is also the cheapest possible way to discover that the
whole idea does not work for a given product category before you have spent
money on hardware for it.
