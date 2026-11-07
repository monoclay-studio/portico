# guest-services — 10x brief (arrival prep, amenities, cases, safety, venues)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 2 for safety items; rest wave 3) · Spec
`docs/specs/guest-services.md` (GSV-R01–R34) · Parity: **none** · Journey gaps JG-10, JG-11 (`docs/journey/
gap-register.md`) · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with hotel
staff.**

## 1. Current state (evidence)

- **No `guest-services` module exists.** Building blocks: operations' tasks, escalation, service requests (fulfilled only
  when the task is done), lost & found (README-operations); guests' alerts, sensitive special needs (encrypted, audited)
  and preferences (README-guests R02/R03); reservations' handover with guest commitments (RES-R37) and arrival details;
  finance adjustments for compensation.
- **Gaps flagged elsewhere:** complaints with compensation (PAR-OPS-059 draft), guest-relations lists (PAR-GUE-070
  draft), allergy propagation (JG-11, P0 for resorts), emergency muster and continuity snapshot (JG-10, GSV-R15).
- **Owner question:** Q86 incident, medical and security records (scope, legal duties, retention).
- **UX1:** the delayed-seaplane case says "dinner and sunset dive flagged" without owners; the failed-inspection VIP case
  has no "notify butler" (persona 2).

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Service orders | OPERA 26.4 | One workflow for guest and internal requests, skills, follow-ups, board, photos | DD02a §1.2 |
| AI check-in summary | OPERA 26.4 | Reservation and profile summary at check-in | DD02a §1.3 |
| Connected resort | Agilysys | Spa/activities/dining on one itinerary | R01 §6.2 |
| Guest messaging + requests | Mews OS, Canary | Messaging bundled; AI front office | DD02c §2 |

No research evidence was found for allergy acknowledgement chains, muster mode or service cases in competitor PMSs —
treat these as Portico differentiators to validate, not parity (assumption).

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Allergy propagation with acknowledgement by every kitchen/outlet, shown on POS lookup | GSV-R07, R18; JG-11 |
| 2 | Continuity snapshot (in-house occupants incl. children and special assistance, allergies, balances) for outages and emergencies | GSV-R15; JG-10; gap plan M10 |
| 3 | Service case with owner, timeline and compensation through finance | GSV-R08, R09; PAR-OPS-059 |
| 4 | Arrival preparation plan per stay (T−n days, refreshed on changes) and amenity orders | GSV-R01, R02 |
| 5 | Lists: in-house VIPs, celebrations, returning guests, allergies this week | GSV-R04; PAR-GUE-070 |
| 6 | Incident log and evidence-backed damage charges | GSV-R10, R11; Q86 |
| 7 | Wake-up calls; host assignment and courtesy contacts | GSV-R24, R05, R06 |
| 8 | Emergency muster mode and guest locator | GSV-R13, R14 |
| 9 | Venues, special dining, minibar, laundry, luggage | GSV-R16–R26 |

## 4. The 10x outcome (TARGETS)

**Picture:** before a family lands, the butler's plan lists the cot, the birthday cake and the child's nut allergy —
already acknowledged by both restaurants; when something goes wrong a case has one owner until it is fixed and the
compensation lands on the bill with a reason; and if the internet fails during a storm, the duty manager still has the
full in-house list on a device.

| Dimension | Metric | Target |
|---|---|---|
| Powerful | Allergies recorded for in-house guests not acknowledged by every outlet that serves them | 0 at service time (blocking warning at POS lookup) |
| Powerful | Cases without an owner or closed without the guest outcome recorded | 0 |
| Seamless | Arrival plan prepared automatically from booking, profile and requests | 100% of arrivals at T−2 days, refreshed on change |
| Friendly | Staff locating "who is in villa 214, any children, any special assistance" during an outage | ≤ 30 s from the continuity snapshot |
| Well-rounded | Safety items working offline | snapshot + muster list on designated devices |

## 5. Next 3 increments

### Increment 1 — Safety first (allergies and continuity snapshot)
- Allergy propagation from guests' sensitive needs (consent-scoped) to outlets with acknowledgement records and a
  pre-arrival allergy list; continuity snapshot generated on schedule and on demand, encrypted at rest on designated
  devices, with a printable version and freshness label.
- **Acceptance:** GSV-R07, R15 tested; snapshot contents verified against the live data in tests; access to the snapshot
  audited; no sensitive detail beyond the guest-agreed alert text.

### Increment 2 — Cases and arrival preparation
- Service case aggregate (owner, timeline, promises, compensation via finance adjustment with reason), arrival plan per
  stay with amenity orders as operations tasks, guest-relations lists, wake-up calls.
- **Acceptance:** GSV-R01, R02, R04, R08, R09, R24 tested; compensation appears on the folio with the case link.

### Increment 3 — Incidents and muster
- Incident log with evidence and retention per Q86 default; evidence-backed damage charges; emergency muster mode with
  headcount per assembly point and guest locator (off-property via excursions/transfers from resort).
- **Acceptance:** GSV-R10, R11, R13, R14 tested; muster works from the continuity snapshot when offline.

## 6. Cross-module dependencies and contract changes

**guests:** sensitive needs and alerts (consent-scoped). **operations:** tasks for amenity orders and recovery.
**fnb-pos / resort:** allergy display at guest lookup; excursions for the locator. **finance:** compensation and damage
charges. **comms:** courtesy contacts; case updates to guests. **reservations:** arrival details, handover commitments.
**ai:** case and stay summaries (cited).

## 7. Power check — never lose or hide

Sensitive data stays minimal, encrypted and audited; acknowledgements are recorded per outlet; a case closes only with
an outcome; compensation is always a visible, reasoned finance entry; the snapshot never claims to be live.
