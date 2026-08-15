# 02 — Getting Data Back Into Metrc / Outlaw / POS

## The rule that governs everything here

**Exactly one system may write inventory changes to Metrc.**

Today that system is Outlaw/your POS. If your new app also writes, you get
double adjustments, phantom variances, and a reconciliation problem strictly
worse than the manual counting you set out to eliminate. Cannabis regulators do
not grade on effort, and "our two systems both adjusted the same package" is a
genuinely bad conversation to have during an inspection.

So the integration question is not *"how do I write to Metrc"* — it is *"who
writes, and what do I hand them."* Three options, in the order you should
prefer them.

---

## Option A — Export a reconciliation file *(recommended for v1)*

Your app produces the discrepancy report; a human reviews it; the existing
system applies the adjustments exactly as it does today.

- Integration risk: zero. No API keys, no vendor agreement, no write path.
- Preserves the single-writer rule by construction.
- Still captures ~90% of the labor savings, because the labor was in the
  *counting*, not the data entry of the handful of packages that actually differ.
- Ships in days rather than months.

Emit both a CSV keyed on Metrc package label and a signed PDF audit report
(operator, timestamps, method, confidence, evidence links) for your records.

This is not a compromise or a stepping stone you apologize for. Given that
counting is the expensive part and discrepancies are typically a small fraction
of packages, the export path plausibly captures most of the available value
permanently. Prove you need more before building more.

---

## Option B — Write to Outlaw / the POS *(recommended for v2)*

The correct long-term target. Outlaw markets the Outlink web console as offering
bi-directional API integration with Metrc, Dutchie and Treez, so the plumbing you
want already exists — you would be feeding counts into a system that already owns
the Metrc write path and its compliance semantics.

Practical steps:

1. Contact Outlaw about partner/API access to Maverick or Outlink, specifically
   asking whether they expose a **cycle-count or audit-result ingest** endpoint.
2. Ask the same of your POS vendor (Dutchie and Treez both run partner API
   programs).
3. Fall back to their bulk count import format if no live API is offered — a
   file import into the existing tool still preserves single-writer.

**Ask about RFID while you are on that call.** Outlaw sells itself as
handheld-based RFID seed-to-sale software and the Maverick handheld supports
RFID tags. Some of what you are considering building may be a licensing
conversation rather than an engineering project, and finding that out costs one
email.

---

## Option C — Write directly to Metrc *(last resort)*

Technically straightforward, organizationally expensive.

### How the API works

- **Base URL is per-state**: `https://api-<state>.metrc.com` — e.g. `api-md`,
  `api-ma`, `api-co`. There is a matching `sandbox-api-<state>` for development.
  Build against sandbox first; it is also where Metrc evaluates you.
- **Auth is HTTP Basic**, base64 of `vendorApiKey:userApiKey`. The vendor key
  identifies your software; the user key identifies the licensee's user. Both
  are secrets and **neither may ever reach a browser or handheld** — server-side
  only, in a proper secret store.
- **Reads** you need: the active-packages endpoint per license, to build
  `expected_inventory`.
- **Writes** for an inventory correction go through the package *adjust*
  endpoint, carrying the package label, the adjustment quantity, unit of
  measure, an adjustment date, and an **AdjustmentReason** drawn from the
  reasons list endpoint. Several reasons additionally require a free-text note.
  Do not hardcode reason strings — fetch them per state, since they vary.
- **Rate limits** are enforced per facility and per vendor key. Handle `429`
  with `Retry-After`, and queue writes rather than firing them from the UI
  thread.
- Endpoint versions have moved from `v1` to `v2` on different timelines in
  different states. **Verify exact paths, payload field names, and current
  limits in your own state's `/Documentation` before writing code** — I could
  not reach the docs from this environment to confirm the specifics, and they
  legitimately differ by jurisdiction.

### The real cost: you must become a validated integrator

You cannot simply obtain a vendor API key. Metrc runs a formal onboarding:
submit company and software information, sign the Metrc Connect API Terms of Use
and Order Form, attend a training class and pass its test, receive a **sandbox**
vendor key, complete a **capability assessment** against a functionality
criteria document, and only after Metrc validates that evaluation do they issue
a **production** vendor key and add you to the Validated Integrator List. Note
also that a licensee may only share their user API key with an approved vendor.

That is a multi-week-to-multi-month process with legal review, and it applies
even when the software is for your own licenses. Budget for it as a real
project, and understand that it validates *capability*, not correctness — Metrc
checks that you can put a package in, not that your quantity is right. The
accuracy of what you write remains entirely your liability.

---

## Idempotency and the audit trail

Whichever path you take:

- Carry the client-generated `count_event.id` through as the idempotency key on
  any write. Handhelds lose connectivity mid-request; retries must not double-apply.
- Log every outbound call and response verbatim, append-only, tied to the audit
  session and the operator. If a state auditor asks why package
  `1A4FF...` changed by −3 units on a Tuesday, you want to answer in seconds.
- Record the *human* who approved each adjustment, not just the device that
  observed the count. The observation is machine-made; the decision must be
  attributable to a licensed person.

---

## Suggested sequence

1. **Read-only sync** from Metrc or the POS → build `expected_inventory`. Safe,
   immediately useful, exercises auth and the data model.
2. **Export** discrepancy CSV/PDF (Option A). Ship this.
3. **Partner conversation** with Outlaw and your POS vendor (Option B) — start
   this in parallel with step 1, since lead times are long.
4. **Metrc integrator onboarding** (Option C) only if 2 and 3 both prove
   insufficient. Start the paperwork early if you think you will need it.
