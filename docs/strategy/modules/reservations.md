# reservations — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · Built (wave 1, R3) · Spec `docs/specs/reservations.md` · Parity
`docs/parity/reservations.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated
with hotel staff.**

## 1. Current state (evidence)

- **Built, R3 against fakes** except inventory, which is proven against the real module (S01, S03)
  (README-reservations § What is built). 147 module tests + 33 API tests green; steward review fixed (R-01, R-04…R-09,
  R-10…R-15 contract work) (README § Checkpoint; REV-reservations).
- **Strong:** separate booking/stay status machines, segments that partition nights (DB exclusion), previews with
  fingerprints and `preview_stale` + alternatives, resumable check-in/out with external steps never repeated,
  idempotent channel ingestion with field-loss review, relocation cases, handover, universal record contract.
- **Parity:** 123 capabilities / 52 edge cases; the generated report says **1% tested, 100 P0 open** — but this is
  **stale**: S01/S02/S03/S04/S14/S17 tests prove rows such as PAR-RES-040/041/043/044/113/114 that still read
  `specified`. Genuinely missing P0: PAR-RES-083 online check-in; EC-RES-002/003/004 (seaplane/weather), 012 (walk-in
  at 00:30 before Day Close), 039 (channel cancels a checked-in stay), 046 (island outage during check-ins).
- **Open integration items** (README § Next (integration); PF): `ratesPortFrom` adapter over rates' sealed
  `TermsSnapshot`; channel-price terms; deposits via `rates.instantiatePaymentSchedule`; bind payments, finance, guests,
  operations; R-25 composite `assignedUnitId`. Being done on `feat/integration-step` (c14342d, c33a27c).
- **Known gaps** (README § Known gaps): reinstatement / reverse check-in (RES-R10), channel-owned field lock (R14),
  non-guaranteed auto-release (R06), upgrade offers (R23), waiting-guests list, handover escalation, common exception
  shape, collection plans, cancellation deposit treatment and no-show charging (unowned, PF), mirror mode, relocation
  completion does not execute the move.
- **How it feels (UX1, simulated UI):** nothing can be created (walk-in, booking, quote — blocker); cancel disabled
  with no policy shown; no departures / in-house lists; check-in allowed 9 days early and for a guest still in the air;
  booking record lacks rate plan, source, policy, guarantee. Best-rated screen in the product: the extend preview —
  but it dead-ends when the unit is taken because Move is disabled (UX1 persona 1, 2, 3).

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Status model and depth | OPERA Cloud | Reservation statuses, types that drive inventory deduction, waitlist, business-date due in/out | R01 §3.2–3.3 |
| Booking as a container | Apaleo, Mews | Booking holds single-unit reservations; requested type vs assigned unit; offers API | R02 §3.3.4–3.3.5, §2.4 |
| Visual planning | Mews Timeline | Density modes, hours/days/months, colour by status, locked vs unlocked assignment | R02 §2.7 |
| Fast date changes | Stayntouch room diary | Drag arrival/departure flags with safe server validation | R02 §4.5 |
| Mobile desk | Stayntouch | Check-in, room moves and payments from tablets | R02 §4.3 |
| Arrival prep | OPERA 25.1–26.4 | Batch card authorization for arrivals, Pre-Arrivals screen, partial key failure handling, AI reservation summary at check-in | DD02a §1.2–1.3 |
| Cancellation automation | OPERA 25.1/25.4 | Auto cancellation penalty posting, auto mass cancellation, tiered cancel/deposit schedules | DD02a §1.2 |
| Channel semantics | SiteMinder | Full-replacement modifications with stable ids, ack-or-resend, field-loss risk | R03 §4.3, §9.2 |

Nobody combines OPERA's depth with a preview of every consequence before commit; Mews and Cloudbeds lack it (UX1
top-10 #2; CS D3).

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Parity rows / edge cases |
|---|---|---|---|
| 1 | No composed create → check-in → check-out loop (ports stubbed; UI simulated) | A hotel cannot take a booking | PAR-RES-001, 075, 097; UX1 top-20 #1–#2 |
| 2 | Departures, in-house and waiting-guest lists; check-out to settlement | Desk can't finish a stay | PAR-RES-071, 089, 096, 101; RES-R35 |
| 3 | Maldives transfer and weather disruptions | Daily reality for island resorts | EC-RES-002, 003, 004, 036 |
| 4 | Reinstatement, reverse check-in, reinstate checked-out | Recovery from mistakes (brief §15) | PAR-RES-034, 090, 103; EC-RES-033 |
| 5 | Channel-owned fields, channel cancels a checked-in stay, late/past-date deliveries, channel+direct duplicates | Overbooking and data-loss traps | PAR-RES-054, 053; EC-RES-039, 040, 041, 042 |
| 6 | Business-date edge: walk-in or arrival after midnight before Day Close | Desk confusion at night | EC-RES-001, 012 |
| 7 | Guard rails on check-in (arrival date, ETA/transfer status) | UX1 found check-in allowed 9 days early | EC-RES-021, 036 |
| 8 | Mass operations (mass cancel with penalty preview, mass update, mass check-in) | Resort and group days | PAR-RES-033, 051, 074 |
| 9 | Upgrade offers, express check-out, pro forma | Revenue and speed | PAR-RES-021, 098; RES-R23 |
| 10 | Connected (mirror) mode | Adoption path 1 | PAR-RES-122 |
| 11 | Online check-in and pre-registration (with guest-experience) | Guests never asked twice | PAR-RES-070, 083 |

## 4. The 10x outcome (TARGETS)

**Picture:** an agent who has never used Portico takes a walk-in, moves a family between villas and checks out a
company-paid stay with split bills on her first shift — each change previewed, nothing re-typed, nothing that can
silently double-sell, and when a seaplane is grounded the twenty affected arrivals are re-planned in one action.

| Dimension | Metric | Today | Market reference | Target |
|---|---|---|---|---|
| Powerful | P0 parity rows + P0 edge cases `tested` | stale 1% (true share higher; reconcile) | OPERA completeness (R01 §3) | 100% |
| Powerful | Proof scenarios through `apps/api` real workflows | S01, S03 real inventory only | — | S01–S05, S14, S15 (links), S17, S20 green |
| Seamless | Walk-in: quote, book, assign, check in | impossible (UX1) | baseline to measure | ≤ 3 min, ≤ 3 screens (UXP §19) |
| Seamless | Prepared arrival check-in incl. payment authorization | impossible | baseline to measure | ≤ 60 s, single screen + checklist |
| Seamless | Room move with preview / extend with alternative unit | move impossible; extend simulated | baseline to measure | ≤ 30 s / ≤ 45 s, 0 unintended price changes |
| Seamless | Check-out with split folios and settlement | impossible | baseline to measure | ≤ 90 s, 0 wrong payer |
| Seamless | Data re-typed at check-in that Portico already holds (OTA, online check-in, profile) | — | — | 0 fields |
| Seamless | Transfer disruption: re-plan N arrivals | — | manual in every system (assumption — verify) | 1 previewed action for all affected stays |
| Friendly | Dead ends (a preview that warns but offers no path) | ≥ 1 (UX1 extend) | — | 0 |
| Friendly | New agent completes the 10 core desk tasks unaided | — | 4 months–3 years to confidence (DD03 §2.2, sponsored) | within 1 shift (≤ 4 h training) |
| Well-rounded | Edge cases in catalogue handled and tested | 0% recorded | — | 100% P0, ≥ 90% P1 |
| Well-rounded | Adoption modes | forward (pending records) only | — | standalone + mirror + forward, tested (A01–A03) |
| Automation | Arrivals with zero blockers 60 min before ETA (assigned, inspected, payment secured, details complete) | — | — | ≥ 90% on a normal day (pilot measure) |

## 5. Next 3 increments

### Increment 1 — Reconcile and bind (with the integration step)
- Reconcile `docs/parity/reservations.md` against the README and tests: every row proven by a test moves to `tested`
  with the test path; rows partially done stay `building` with a note.
- Bind real rates (`ratesPortFrom`, terms stored verbatim), payments, finance, guests, operations; channel-price
  terms from rates; deposits from `instantiatePaymentSchedule`; R-25 composite assignment; `aggregateVersion` on
  stay/booking events and `stays[]` in booking events (PF).
- **Acceptance:** S01–S05, S14, S17, S20 run in `apps/api/test/scenarios/` against real providers; no
  `module_not_available` in the composed app; parity report shows the true tested share.

### Increment 2 — The desk loop, end to end
- Departures / in-house / waiting-guests lists with balances, readiness, overstay flags; check-out completes through
  finance settlement and invoice; reinstate booking, reverse check-in, reinstate checked-out (RES-R10); check-in guard
  (not before arrival business date; warning when ETA/transfer is still in the air); `listExceptions` in the common
  shape (gap plan §7.2); every `allowedAction` exported to the action registry with hotkeys.
- **Acceptance:** UX1 persona 1–3 core tasks (walk-in, check-in, move, extend, cancel with fee, check-out split)
  possible through the API with previews; EC-RES-001, 006, 007, 009, 012, 021 tested; PAR-RES-034, 071, 089, 090, 096,
  097, 103 tested.

### Increment 3 — Maldives disruptions and channel safety
- Disruption commands over many stays: shift ETA (seaplane/speedboat), "overnight in Malé" (move arrival night,
  protect from no-show, preview cost per agreed terms), forced extra night on weather (policy: charge, comp or
  discounted with reason), each previewed per stay and committed as one batch with per-stay results.
- Channel-owned field lock with explicit local override (RES-R14); channel cancellation of a checked-in stay → owned
  exception, never auto-checkout; late delivery for past dates; duplicate detection channel + direct with merge.
- **Acceptance:** EC-RES-002, 003, 004, 036, 039, 040, 041, 042 tested; PAR-RES-033 (mass cancellation with per-booking
  penalty preview), 053, 054 tested; scenario S12 hook (itinerary consumer) documented for `resort`.

## 6. Cross-module dependencies and contract changes

- **rates:** channel-price `TermsSnapshot` (`priceSource: 'channel'`), `instantiatePaymentSchedule`, multi-unit quotes
  (PAR-RAT-075). **payments:** collection plans (PAY-R20) replace reservations' local deposit preview; no-show MIT
  charge with terms cross-check. **finance:** settlement, receipts, pro forma (PAR-RES-021), cancellation-fee invoice
  without a stay (EC-FIN-075). **operations:** waiting-guest priority (`setGuestWaiting` exists), ready-notification
  event. **guests:** booker-role stay history; phone/email search. **access:** keys for future-dated moves (segment
  level). **resort:** itinerary consumer of ETA changes. **guest-experience:** online check-in submission → desk
  checklist. **day-close:** exceptions + no-show step. **integration:** mirror handler for external PMS bookings.
- **Kernel:** action registry and common exception shape (gap plan §7.1–7.2).

## 7. Power check — never lose or hide

Booking status, stay status, occupancy, unit condition, availability and payment status stay **distinct**; every
change is previewed and a stale preview never commits; agreed terms are immutable and never re-priced silently; the
last unit is sold exactly once; resumable workflows never repeat an external step; 409s show the field diff and who
changed it; channel revisions stay idempotent and ordered; relocation is never executed without a preview; the
Timeline must never lock other users (Stayntouch anti-pattern, R02 §4.6).
