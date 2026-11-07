# distribution — 10x brief (channel manager core, booking engine, agentic channels)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 2b) · Spec `docs/specs/distribution.md` (DST-R01–R18) ·
Parity `docs/parity/distribution.md` · Decision D7 (hub first: Channex) · Source key: `docs/strategy/gap-plan.md` §0.
**All targets are TARGETS until validated with hotel staff and a real channel.**

## 1. Current state (evidence)

- **No `distribution` module exists.** Ready foundations: inventory's strongly consistent availability and events
  (README-inventory), rates' restrictions and channel eligibility enforced from the principal (README-rates RAT-R09/R10),
  reservations' **idempotent channel ingestion** with revisions, stale handling, field-loss review, conflicts and
  relocation (S02, README-reservations RES-R30–R34), integration's connector SDK, exchange log, outbound queue, health
  and the planned `channel.channex` catalogue entry (R1).
- **Parity:** 70 rows / 34 edge cases, 0% tested, **55 P0 open**, 22 P1 missing (per-channel restrictions and
  translations, tax/fee publication incl. Green Tax, guarantee/payment code mapping, commission reconciliation, tour-
  operator emails to draft bookings, booking-engine content, currency display, deep links, widget, analytics, group
  booking codes, guest self-modify, lowest-price calendar, bot/card-testing protection).
- **Dependencies:** Channex staging → certification → contract → production is an external path (X5, Q23); OTA tax
  collection rules (Q124); GDS via intermediary (Q123); hotel-collect card vault/PCI proxy (payments PAR-PAY-027).

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Channel mechanics | SiteMinder | Delta ARI ≤ 2-minute rounds, full-replacement modifications with stable ids, ack-or-resend, backoff, no retry on payload errors, mapping completeness counters, replay | R03 §4.3, §9.1 |
| One inventory | Cloudbeds | PMS + CM + BE + payments on one inventory; closes rooms across agencies | R03 §3.2 |
| Distribution embedded in an OS | Mews OS (SiteMinder engine inside) | Bundled channel manager | DD02b §1.2; DG #19 |
| Yield to channels | OPERA 25.4 | FPLOS from hurdle rates | DD02a §1.2 |
| Intelligence → distribution | Lighthouse | AI channel manager + pricing manager; ChatGPT direct-booking app; AI-visibility scores | DD02c §1; DD05 §3 |
| Agentic booking | Booking.com/Expedia apps in ChatGPT; Google AI Mode hotel booking | Hotel/OTA stays merchant | DD05 §3; DG #34 |
| Failure mode catalogue | (market) | Two-hop latency, unmapped bookings not decrementing, partial modification payloads, missed acks, out-of-order, OTA incidents, dual systems, linked inventory | R03 §9.2 |

Overbooking after a sync failure is the most damaging SMB review theme (R03 §1, §12).

## 3. Gaps vs market (ranked)

| # | Gap | Parity / spec |
|---|---|---|
| 1 | Outbound ARI pipeline: coalescing delta queue, full resync windows, last-acknowledged channel state per cell beside Portico's value | DST-R04–R06 |
| 2 | Inbound revision log with out-of-order handling, unmapped bookings accepted with provisional holds, recovery ("re-request since T") | DST-R08–R11; EC-DST-003, 032 |
| 3 | Health console: per-channel status, oldest unacked message, queue depth, error feed with one-click fixes, non-destructive replay, outage never shown as synced | DST-R13, R14; R03 §9.3 |
| 4 | OTA simulator with the fault matrix, then the Channex adapter (staging, R4) | D7; DST-R01 |
| 5 | Mapping with completeness counter, validation (occupancy, child pricing), guarantee/payment code mapping, remapping with future bookings | DST-R02; PAR-DST-002–004; EC-DST-014, 015 |
| 6 | Tax and fee publication so channels show the right all-in price (Green Tax, service charge); inclusive vs exclusive per channel; OTA-collected Green Tax | PAR-DST-010; EC-DST-016, 017; Q124 |
| 7 | Per-channel restrictions and translations; allotment pools (DST-R03) | PAR-DST-019, 020 |
| 8 | Booking engine (accessible, content, currency display, deep links, widget, self-modify, lowest-price calendar, bot protection) + Google free booking links | DST-R16, R17; PAR-DST-042–056 |
| 9 | AI agents as a channel: exposure rules, content accuracy checks, audit, offer caching for agent query loads | DG §2 distribution row; DD05 §3 |
| 10 | Commission per booking reconciled with OTA invoices; tour-operator email intake | PAR-DST-030, 034 |

## 4. The 10x outcome (TARGETS)

**Picture:** the revenue manager sees, per channel and per night, what Portico says and what the channel last
acknowledged; when Booking.com degrades at 19:00 a banner names the affected nights and offers "close the last two
villas on that channel" in one click; an unmapped booking still holds a villa instead of vanishing; and a guest booking
through an AI assistant gets the same price, taxes and policy as the booking engine.

| Dimension | Metric | Market reference | Target |
|---|---|---|---|
| Powerful | P0 rows + P0 edge cases tested | — | 100% |
| Powerful | Bookings lost, duplicated or silently unapplied in the fault matrix (duplicates, reorder, missing ack, outage, unmapped) | SiteMinder accepts unmapped bookings without decrementing (CS §1) | 0 |
| Powerful | Median ARI change → channel delivery (simulator/hub) | ≤ 2-minute rounds (R03 §4.3) | ≤ 60 s median, p95 ≤ 2 min |
| Seamless | Channel outage visible with impact list | silent failures (R03 §6.3) | ≤ 2 min after detection, with affected nights and bookings |
| Seamless | Mapping a new channel to go-live | baseline to measure | ≤ 20 min staff time with completeness counter at 100% |
| Friendly | Error messages without a fix action in the health feed | SiteMinder guidance pattern (R03 §9.3) | 0 |
| Well-rounded | Price shown on a channel / booking engine / AI channel vs Portico quote for the same stay | — | identical all-in price (taxes and fees) or a flagged discrepancy |
| Well-rounded | Channels via hub at R4 before a pilot that wants OTAs | — | Booking.com, Expedia, Agoda via Channex staging (no production until Q23) |

## 5. Next 3 increments

### Increment 1 — Core pipeline on the OTA simulator
- Schema and module; channel connection as an integration connection with distribution workflows; mapping with
  completeness counter and validation; coalescing delta ARI queue from inventory/rates events; full resync windows;
  last-acknowledged state per cell; inbound revision log feeding reservations' ingestion; provisional holds for
  unmapped bookings; OTA simulator with the R03 §9.2 fault matrix.
- **Acceptance:** S02 and S20 through `apps/api` with the simulator; EC-DST-003, 014, 015, 032 tested; DST-R02, R04–R06,
  R08–R10 tested; median delivery measured in CI.

### Increment 2 — Health console, recovery and taxes on channels
- Per-channel status card, error feed with fix actions, non-destructive replay (re-push range, re-request since T),
  outage banner that never says "synced", stop-sell protection (predictive close of last units on slow channels),
  per-channel restrictions and translations, tax/fee publication (inclusive/exclusive per channel, Green Tax handling per
  Q124 default), commission per booking.
- **Acceptance:** DST-R07, R11–R15 and PAR-DST-010, 019, 020, 030 and EC-DST-016, 017, 020 tested; health read model
  renders in the backoffice with no simulated data.

### Increment 3 — Channex staging and the booking engine API
- Channex adapter on the connector SDK against staging (R4 evidence recorded; production only after Q23); booking-
  engine API (offers, holds, book with hosted payment from payments, self-modify within policy, lowest-price calendar,
  currency display with charge currency stated, bot/card-testing protection); Google free booking links feed design
  (DST-R17); AI-agent channel profile (exposure rules + audit) designed on the same offer API.
- **Acceptance:** Channex staging certification checklist evidence in the readiness register; PAR-DST-044, 045, 054,
  055, 056 and EC-DST-025, 027 tested; agent and booking-engine quotes equal the desk quote for a test matrix.

## 6. Cross-module dependencies and contract changes

**inventory:** `sellable` per channel pool, availability events with ranges. **rates:** restriction source precedence,
FPLOS, lowest-price calendar, channel-price terms. **reservations:** ingestion contract (exists), channel-owned field
lock (RES-R14). **payments:** VCC metadata/activation dates, hosted card entry, PCI proxy decision. **integration:**
connector SDK, exchange log, health. **guest-experience:** booking engine UI and content. **groups/contracting:**
allotment pools and block codes for attendees. **analytics:** channel cost and conversion. **migration:** channel switch
at cutover.

## 7. Power check — never lose or hide

A channel outage never looks synced; a booking is never dropped (unmapped ones hold inventory); acknowledgements only
after durable commit; no dual control of a channel connection; never promise absolute overbooking prevention (brief §11);
parity is monitored and reported, never enforced (DD04 P9); supported vs configured vs tested vs live stay distinct.
