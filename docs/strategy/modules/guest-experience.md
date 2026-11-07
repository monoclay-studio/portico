# guest-experience — 10x brief (guest portal, online check-in, upsell, express checkout, kiosk)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 3; online check-in and registration may be pulled forward —
Q120, Q43) · Spec `docs/specs/guest-experience.md` (GXP-R01–R35) · Parity: **none** · Journey gaps JG-03–JG-06 ·
Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with guests and hotel staff.**

## 1. Current state (evidence)

- **No guest-facing surface exists** (`apps/guest` not started). Building blocks: reservations' booking/stay records and
  previews, guests' consent and documents, payments' links and simulator (hosted card entry not built — PAR-PAY-021),
  finance folios and invoices, operations' service requests.
- **Parity:** reservations rows PAR-RES-083 (online check-in, **P0 missing**), 070 (pre-registration), 098/099 (express /
  online check-out) missing; guests PAR-GUE-068/069 (self-service edits, staged guest data) missing.
- **Owner questions:** Q120 guest self-service in the first release; Q43 registration and tourism reporting; Q84
  guest-facing AI; Q150 kiosk/biometric patents.

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Digital registration | OPERA 26.4 | Configurable e-forms matched by nationality, market, rate, room type; guest e-sign; purge after days; accompanying guests | DD02a §1.2; DG #13 |
| App-less portal | Mews | Web guest portal; single-use portal links (2026) | R02 §2.7; DD02b §1.3 |
| Upsell at every touchpoint | Stayntouch; Nor1 (Oracle) | Upgrades and extras at mobile check-in and kiosk, posted to the folio; Nor1 PRiME (patented) | R02 §4.3; DD02c §2; DD04 P7–P8 |
| Guest self-service and upsell in the booking path | Clock PMS+ | Strong self-service | R03 §8.4 |
| Research | Lui & Piccoli (163 hotels) | Kiosk benefits lag; **failed self-service lowers return intent** | DD03 §4 |
| Law | European Accessibility Act (from 28 Jun 2025) | Booking flows, self-service terminals incl. payment steps | DD05 §4 |

## 3. Gaps vs market (ranked)

| # | Gap | Spec / parity |
|---|---|---|
| 1 | Stay-scoped links with step-up for sensitive actions; booking summary in staff vocabulary | GXP-R01–R05 |
| 2 | Online check-in: registration card per market (nationality templates), document capture, e-signature with evidence, submission staged into the desk checklist | GXP-R11–R14; PAR-RES-083; JG-04 |
| 3 | Payments in the portal (hosted card entry, deposits, balances) | GXP-R10; PAY-R06 |
| 4 | Arrival and transfer details (seaplane weights/baggage for manifests) | GXP-R07; JG-04 |
| 5 | Requests and chat with live status (from operations/comms) | GXP-R20 |
| 6 | Digital folio, express checkout, e-invoice | GXP-R21, R26, R27 |
| 7 | Upsell catalogue with eligibility, live inventory, acceptance modes (rule-based) | GXP-R16, R17; Q150 |
| 8 | Assisted mode and graceful failure to staff with context | GXP-R31; DD03 §4 |
| 9 | Itinerary and self-booking of dining/activities (from resort/guest-services) | GXP-R19, R24 |
| 10 | Kiosk (devices, encoder via access) | GXP-R30, R32 |

## 4. The 10x outcome (TARGETS)

**Picture:** one link, no app, works on a weak island connection: the guest sees exactly what was booked and what it
costs in the same words staff use, completes registration once (passport-exact names, e-signature), adds seaplane
weights, pays the balance, requests a cot and watches its real status, and checks out in two minutes — and if anything
fails, the desk already has the context instead of the guest starting over.

| Dimension | Metric | Market reference | Target |
|---|---|---|---|
| Powerful | Desk fields re-typed for a guest who completed online check-in | — | 0 |
| Seamless | Online check-in completion time (registration + document + e-sign + arrival details) | baseline to measure | ≤ 4 min on a phone |
| Seamless | Express checkout with e-folio | — | ≤ 2 min, invoice delivered with status |
| Friendly | Self-service failures that strand the guest without a staff hand-off | failed self-service hurts return intent (DD03 §4) | 0; every failure creates a desk task with context |
| Friendly | Measured self-service failure rate | not published by vendors | measured and reported per property |
| Well-rounded | Accessibility on the guest path (WCAG 2.2 AA incl. payment steps) | EAA (DD05 §4) | 0 serious violations |
| Well-rounded | Page weight / time to interactive on 3G | — | ≤ 200 KB initial, ≤ 3 s TTI (target to validate on Maldivian networks) |

## 5. Next 3 increments

### Increment 1 — Stay-scoped portal (read) and requests
- `apps/guest` shell: stay-scoped signed links, step-up for sensitive actions, booking summary from reservations'
  record contract (same status vocabulary), property information, requests with live status from operations, provenance
  and environment banners (demo/trial never send or charge).
- **Acceptance:** GXP-R01–R05, R20, R22, R33, R34 tested; axe clean; works offline-tolerant (cached summary labelled
  with time).

### Increment 2 — Online check-in that feeds the desk
- Registration card per market (nationality templates from the market content pack), passport-exact names per occupant,
  document capture (policy-gated images, Q43), e-signature with evidence, arrival/transfer details incl. weights; staged
  submission merged by guests with provenance; desk checklist shows completed steps.
- **Acceptance:** PAR-RES-070, 083 and PAR-GUE-069 tested; EC-GUE-026 (desk edits while the guest submits) tested; no
  biometric matching.

### Increment 3 — Pay, upsell, check out
- Hosted card entry (with payments), deposit and balance payment, rule-based upsell catalogue with live inventory and
  approval modes posting to the folio, digital folio, express checkout with e-invoice, folio queries routed to finance.
- **Acceptance:** GXP-R10, R16, R17, R21, R26–R28 tested; payment states identical to staff screens; PAR-RES-098/099
  tested.

## 6. Cross-module dependencies and contract changes

**reservations:** guest commands with previews (manage my booking), check-in step model. **guests:** staged submissions,
consent. **payments:** hosted card entry, collection plans. **finance:** digital folio, e-invoice delivery. **operations /
guest-services / resort:** requests, itinerary, dining/activities. **access:** mobile key/PIN display. **comms:** link
delivery, chat. **distribution:** booking engine shares components. **identity:** guest principal (not a staff user).

## 7. Power check — never lose or hide

Guests see the same truth as staff (no friendlier-but-false states); every guest action goes through the owning module's
command with its preview and permissions; failures hand off to staff with context; sensitive data needs step-up; demo
and trial never message, charge or publish.
