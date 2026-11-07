# day-close — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 2a; pilot-critical) · Spec `docs/specs/day-close.md`
(DCL-R01–R09) · Parity `docs/parity/day-close.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are
TARGETS until validated with hotel staff.**

## 1. Current state (evidence)

- **No `day-close` module exists.** Only the platform's business-date advance is shipped (`modules/platform` tests);
  finance supplies `getUnbalancedItems` and the integrity report (FIN-R44/R45), reservations supplies `markNoShow`
  (idempotent) and a Day Close feed from agreed terms (README-reservations scenario table), payments has jobs for
  renewals and VCC due dates.
- **Parity:** 64 rows / 35 edge cases; 8% / 3% tested (from platform); **57 P0 open**. P0 missing: EC-DCL-010 (arrival
  on a delayed seaplane at 23:30), 015 (invalid agreed price during postings), 020 (departure whose seaplane was
  cancelled). P1 missing: API trigger, arrivals with deposit balance, scheduled moves not completed, fixed charges posted
  by the close, skip-today with schedule log, failure policy for departures, DST start time, code deployed between
  failure and resume, day-use stays.
- **Prerequisites missing elsewhere:** common exception shape `listExceptions` (reservations has its own `listIssues`;
  operations and finance not yet), platform `lockBusinessDate` (PF), statistics consumer in analytics (planned).
- **UX1 persona 5 (night auditor): blocker** — no Day Close in navigation or search; lessons say "content coming".

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Completeness, restartable steps, scheduler | OPERA Cloud | Pre-roll checks, Post Room and Tax, mandatory/optional procedures, failed procedures retried until COMPLETE; auto EOD scheduler (24.4+) with emails, 3 retries at 5 min, halts on open items, stops at Print Final Reports | R01 §3.1 |
| … but blocking | OPERA | All users except the auditor are logged out to roll the date; next EOD cannot run until the prior completes | R01 §3.1 |
| No audit at all | Mews | Midnight rollover; editable history windows; late outlets and over/short pain | R02 §5.4, §2.8 #6 |
| Scheduled audit + API | Apaleo | Only the audit posts to past dates; scheduled time and API trigger | R02 §5.4 |
| Separate date roll vs fiscal close | Agilysys | Failure policies per step | R01 §6.5 |
| Per-step status report | Infor HMS | EOD status report | R01 §4.6 |

## 3. Gaps vs market (ranked)

| # | Gap | Parity / scenario |
|---|---|---|
| 1 | Continuous exception queue built on every module's `listExceptions`, with policy deciding what blocks | DCL-R01; PAR-DCL (queue rows) |
| 2 | Keyed idempotent steps, resume at the first incomplete step with per-step progress ("88 of 112 stays posted") | DCL-R02/R03; S09 |
| 3 | Non-blocking advance (no logout; postings before/after advance land on the right date) | DCL-R04; PAR-DCL-004 |
| 4 | Scheduler with auto-continue, notifications, retries, skip-today, DST-safe start | DCL-R05; PAR-DCL-083; EC-DCL-024 |
| 5 | Maldives realities: arrival on a delayed seaplane at 23:30, departure stranded by weather, day-use stays | EC-DCL-010, 020, 033 |
| 6 | Data-error resilience: invalid agreed price, code deployed between failure and resume | EC-DCL-015, 031 |
| 7 | Immutable day reports with "restatements since" annex | DCL-R07 |
| 8 | Guesthouse auto-close (only blocking checks surfaced, on the phone) | DCL-R09 |
| 9 | Portfolio Day Close board | DCL-R08 |

## 4. The 10x outcome (TARGETS)

**Picture:** at 23:00 the night auditor opens one page that already lists the only three things still open, fixes each
with the button beside it, presses **Close day** and goes back to the desk; nobody is logged out; if the power fails at
02:10, the page says "Room postings: 88 of 112 posted — Resume" and nothing is ever posted twice. A guesthouse owner's
day closes itself unless something truly needs her.

| Dimension | Metric | Market reference | Target |
|---|---|---|---|
| Powerful | P0 rows + P0 edge cases tested | — | 100% |
| Powerful | Duplicate postings after any interruption (kill at every step, concurrency with desk activity) | OPERA retries until COMPLETE (R01 §3.1) | 0 (S09 + chaos test per step) |
| Seamless | Auditor attention for a day with no blocking items | baseline to measure | ≤ 2 min, 1 page (UXP §19) |
| Seamless | Users logged out or blocked during the run | OPERA logs everyone out (R01 §3.1) | 0 |
| Friendly | Blocking items without a one-click resolution action | — | 0 |
| Friendly | Guesthouse owner interventions on a normal day | — | 0 (auto-close; phone notification only on blockers) |
| Well-rounded | Edge cases handled (DST, day use, stranded departures, invalid data) | — | 100% P0, ≥ 90% P1 |
| Automation | Days closed automatically by the scheduler without human action (normal days) | OPERA auto EOD stops at final reports (R01 §3.1) | ≥ 90% of days at properties that enable auto-close (pilot measure) |

## 5. Next 3 increments

### Increment 1 — Exception queue and the run engine
- Kernel/common exception shape agreed with the orchestrator; adapters calling reservations, finance, payments,
  operations, inventory, integration `listExceptions`; policy of blocking codes; run aggregate with ordered keyed steps
  (`preflight`, `no_shows`, `room_and_package_postings`, `allowance_close`, `payments_housekeeping`, `integrity`,
  `statistics_snapshot`, `advance`, `post_advance`), one active run per property (DB constraint), resume semantics.
- **Acceptance:** S09 through `apps/api` with a kill after N postings → resume posts the remainder exactly once;
  DCL-R01–R04, R06 tests; PAR-DCL rows for steps and resume `tested`.

### Increment 2 — Scheduler, reports and the auditor's page
- Scheduler with earliest start time (platform policy), auto-continue, retries 3× at 5 min for transient failures (never
  integrity), skip-today with log, DST-safe start; notifications to duty roles (simulated until comms); immutable day
  report pack with "restatements since" annex fed by finance corrections; API trigger; readiness read model for the UI.
- **Acceptance:** DCL-R05, R07; PAR-DCL-014, 083; EC-DCL-024 tested; the backoffice readiness page renders from the API
  with no simulated data.

### Increment 3 — Maldives and small-property behaviour
- Policies for arrivals on delayed transfers (roll arrival to D+1 with no-show protection, linked to reservations'
  disruption command), stranded departures (forced extra night per policy), day-use stays, fixed charges posted by the
  close, scheduled moves not completed, arrivals with deposit balance; guesthouse auto-close; portfolio board.
- **Acceptance:** EC-DCL-010, 015, 020, 031, 033 and PAR-DCL-025, 026, 043, 084 tested; DCL-R08, R09 built.

## 6. Cross-module dependencies and contract changes

- **All blocker owners:** `listExceptions(tx, propertyId, businessDate?)` in the common shape (gap plan §7.2).
- **platform:** `advanceBusinessDate(expected = D)`, `lockBusinessDate`, timing policies. **finance:** keyed room and
  package postings (`room:{stayId}:{D}`), `closeAllowancePeriod`, integrity report, restatements feed. **reservations:**
  `markNoShow`, disruption commands (reservations increment 3). **payments:** renewals and VCC schedule (no charges in
  the close). **analytics:** statistics snapshot consumer. **operations:** stayover planning event after advance.
  **integration:** accounting journal export after advance.

## 7. Power check — never lose or hide

The business date advances only through a completed close; every step is keyed and idempotent; integrity failures stop
the run and are never retried automatically; overrides of blocking items need a permission and a reason per item; day
reports are immutable and restatements are explained, not silent; nobody is logged out.
