# Parity: day-close

Module: `day-close` (Day Close runs and steps, continuous exception queue, scheduler, statistics snapshots, day
reports, portfolio board) · Spec: `docs/specs/day-close.md`.

**Baseline.** OPERA Cloud 26.2 *End of Day* (procedures, automatic scheduler, income audit, post room and tax, EOD
reports), Apaleo night audit (scheduled + API), Agilysys Stay date roll vs fiscal close, Infor HMS EOD status report,
Mews' no-audit model (editable history window) as the contrast. Evidence links at the end; **all verified
2026-11-07**.

**Status rule.** Statuses updated 2026-11-07 by the day-close module owner on `feat/day-close` (`modules/day-close`).
A `tested` row names the asserting test (file › test name, with what it asserts). Module tests run on a real database
with real platform, rates and finance and a strict Postgres-backed reservations fake (README § Scenarios); rows
marked `built` are implemented but their test is missing or another module's part is not built.

## Capabilities

### Business date and run control

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DCL-001 | Business date per property, decoupled from the calendar, advanced only by the close | OPERA [about End of Day][op-eod] · Apaleo [business date][ap-night-audit] | P0 | tested | platform.md PLT-R31; day-close.md DCL-R02 step 8 | modules/platform/test/platform.test.ts (business date); modules/day-close/test/scenario-s09-day-close-interrupted.test.ts › "resumes at the remaining 45 …" asserts `businessDate(org)` = 2026-11-08 only after the run completes |
| PAR-DCL-002 | Advance exactly one day; a duplicate or stale advance is refused | OPERA [update business date][op-eod] | P0 | tested | platform.md PLT-R31 | modules/platform/test/platform.test.ts (refuses a duplicate advance); modules/day-close/test/kill-and-resume.test.ts › "kill -9 inside the advance transaction: …" asserts one `business_date_log` row |
| PAR-DCL-003 | Earliest local start time for the close (cannot roll before e.g. 22:00 of date D) | assumption | P0 | tested | platform.md PLT-R32 | modules/day-close/test/lifecycle-and-security.test.ts › "refuses a start before the earliest local time, …" asserts `code: 'too_early_to_close'` with `earliestStartAt` |
| PAR-DCL-004 | Advancing never logs users out or blocks other commands | OPERA [session reinitialised on date update][op-eod] (contrast) | P0 | tested | day-close.md DCL-R04; platform.md PLT-R33 | modules/day-close/test/concurrency.test.ts › "lands before the advance on D, after it on D+1, …" (a bar posting and another user's readiness read succeed mid-run; Day Close never touches sessions) |
| PAR-DCL-005 | Ordered, idempotent steps with per-step status, counts, timings and errors | OPERA [post room and tax status][op-prt] · Infor [EOD status report][inf-eod] | P0 | tested | day-close.md DCL-R02 | modules/day-close/test/scenario-s09-day-close-interrupted.test.ts asserts `progress` "Room postings: 67 of 112 stay-nights posted, 45 remaining" and `attempts: 2` |
| PAR-DCL-006 | Resume at the first incomplete step; partially done steps safely re-run | OPERA [failed procedure retried][op-eod-auto] · Agilysys [manual roll retry][ag-manroll] | P0 | tested | day-close.md DCL-R03 | modules/day-close/test/scenario-s09-day-close-interrupted.test.ts (`postCalls === 90`, every item `attempts === 1`); modules/day-close/test/chaos-every-step.test.ts; modules/day-close/test/kill-and-resume.test.ts |
| PAR-DCL-007 | Only one active run per property | assumption | P0 | tested | day-close.md DCL-R06 | modules/day-close/test/concurrency.test.ts › "two Start presses at the same moment create one run; …" asserts one `day_close.runs` row |
| PAR-DCL-008 | Next run cannot start until the previous one completed | OPERA [EOD sequence][op-eod] | P0 | tested | day-close.md §4 | modules/day-close/test/lifecycle-and-security.test.ts › "the next date cannot close before the previous run completed …" asserts `previous_run_incomplete` |
| PAR-DCL-009 | Cancel a scheduled/blocked run with reason (nothing posted) | assumption | P1 | tested | day-close.md §4 | modules/day-close/test/lifecycle-and-security.test.ts › "a blocked run can be cancelled with a reason …" asserts `runStatus` cancelled, no `room:` entries, and `run_not_cancellable` after postings |
| PAR-DCL-010 | Configure which optional procedures run (activate/inactivate) | OPERA [modify procedures][op-eod-run] · [mandatory/optional][op-eod-procs] | P1 | built | day-close.md DCL-R05 (policy; steps `skipped (policy)`) | policy `steps.paymentsHousekeeping: run|skip`; other steps are mandatory by design (spec §4) |
| PAR-DCL-011 | Separate the operational day roll from the accounting (fiscal) day close | Agilysys [auto fiscal close][ag-fiscal-auto] · [manual fiscal close][ag-fiscal-man] | P1 | specified | day-close.md §2; accounting.md (GL period close) | — |
| PAR-DCL-012 | Keep past business dates open for income audit corrections, finalized in order | OPERA [income audit][op-ia] | P1 | different | finance.md FIN-R04 — corrections post today with `relatesToBusinessDate`; day report annex shows them | — |
| PAR-DCL-013 | No night audit at all (midnight rollover + editable history window) | Mews [editable history window][mw-ehw] | P2 | different | day-close.md §12 — controlled close kept; guesthouse auto-close (DCL-R09) gives the same ease | — |
| PAR-DCL-014 | Day Close triggerable by API | Apaleo [night audit endpoint][ap-ops] | P1 | tested | — | apps/api/test/day-close.test.ts › "readiness, start (idempotent), …" asserts 201 and a retried key returns the same run (API clients start runs with trigger `api`) |
| PAR-DCL-015 | Multi-property close from one screen (hub), concurrent per property | OPERA [hub EOD][op-eod-run] | P1 | specified | day-close.md DCL-R08 | — |

### Exceptions and pre-checks

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DCL-020 | Continuous exception queue all day (not only at night) with owners and resolution links | assumption (research 01 §3.1 design implication) | P0 | tested | day-close.md DCL-R01 | modules/day-close/test/readiness-and-overrides.test.ts › "aggregates every source; each item has an owner and a fix; …" |
| PAR-DCL-021 | Arrivals not checked in: check in, cancel, no-show or roll date | OPERA [arrivals not checked in][op-eod] | P0 | tested | day-close.md DCL-R01, step 2 | modules/day-close/test/readiness-and-overrides.test.ts (arrival item with checkIn / markNoShow / cancelStay); modules/day-close/test/no-shows-and-data-errors.test.ts |
| PAR-DCL-022 | Departures not checked out: check out, extend or resolve | OPERA [departures not checked out][op-eod] | P0 | tested | day-close.md DCL-R01 | modules/day-close/test/readiness-and-overrides.test.ts asserts `blocking` = departure_not_checked_out with actions checkOut, extendStay, override |
| PAR-DCL-023 | Open folios after checkout listed | OPERA [open folios][op-eod] | P0 | tested | finance.md FIN-R44 | modules/day-close/test/readiness-and-overrides.test.ts asserts `departed_with_balance` warning with `balanceMinor > 0` (finance FIN-R44 detects) |
| PAR-DCL-024 | Open cashier sessions: close required or auto-closed | OPERA [cashier closure / auto close][op-eod] | P0 | tested | day-close.md DCL-R01; finance.md FIN-R39 | modules/day-close/test/readiness-and-overrides.test.ts › "maps every finance check to an owner and a fix; …" asserts `cashier_session_open` → closeCashierSession, owner Front office (finance FIN-R39 detects) |
| PAR-DCL-025 | Arrivals with deposit balance must be resolved | OPERA [arrivals with deposit balance check][op-eod] | P1 | deferred | — | needs a deposit balance per due arrival from finance/reservations (README CR-3); not in spec v1 |
| PAR-DCL-026 | Scheduled room moves not completed | OPERA [scheduled room moves][op-eod] | P1 | deferred | — | reservations has no scheduled room moves yet (RES spec); Day Close lists them once reservations exposes them |
| PAR-DCL-027 | Country/state completeness check for guest registration | OPERA [country and state check][op-eod] | P2 | missing | — | — |
| PAR-DCL-028 | Payments pending verification and failed collections listed | assumption (S05) | P0 | tested | day-close.md DCL-R01 | modules/day-close/test/readiness-and-overrides.test.ts asserts `payment_pending_verification` (warning by default; blocking when policy says — "policy decides what blocks …") |
| PAR-DCL-029 | Unbalanced / suspense items and invoices blocked or overdue for issue | assumption | P0 | tested | finance.md FIN-R44 (+ branch `invoice_overdue_for_issue`) | modules/day-close/test/readiness-and-overrides.test.ts › "maps every finance check …" asserts entry_unbalanced (blocking, not overridable), suspense_balance and invoice_overdue_for_issue mapped |
| PAR-DCL-030 | Integration exceptions affecting the day (e.g., POS not balanced, channel failures) as warnings | Mews [POS end-of-day balancing][mw-pos-uc] | P1 | tested | day-close.md DCL-R01 | modules/day-close/test/readiness-and-overrides.test.ts asserts an `integration_exception` warning |
| PAR-DCL-031 | Policy decides which exception codes block; override per item with permission and reason | OPERA [auto EOD halts][op-eod] | P0 | tested | day-close.md DCL-R01, step 1 | modules/day-close/test/readiness-and-overrides.test.ts › "a blocking item stops the run; an override needs the permission and a reason; …" and › "policy decides what blocks: …" |
| PAR-DCL-032 | Weather / notes for the business day | OPERA [weather or notes][op-eod] | P2 | missing | — | — |
| PAR-DCL-033 | Readiness tile per property: arrivals and departures due, open cashiers, drill-down | OPERA [EOD property tile][op-eod-run] | P0 | built | day-close.md §9 readiness panel | readiness API: counts by blocking/warning/info, items with owners and fixes (tested in readiness-and-overrides); the backoffice tile is not built |

### Nightly postings and procedures

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DCL-040 | Post room and taxes for every in-house stay exactly once per night | OPERA [post room and tax][op-prt] · Apaleo [night audit posts charges][ap-night-audit] | P0 | tested | day-close.md DCL-R02 step 3; finance.md FIN-R08 | modules/day-close/test/scenario-s09-day-close-interrupted.test.ts (112 `room:` keys, each once); modules/day-close/test/chaos-every-step.test.ts |
| PAR-DCL-041 | Post package/inclusion charges per posting rhythm and nightly fees | OPERA [post room and tax][op-prt] | P0 | tested | day-close.md DCL-R02 step 3 | modules/day-close/test/scenario-s19-day-close-packages.test.ts asserts each plan line of the night once and the departure transfer posted on its service date |
| PAR-DCL-042 | Package profit/loss and allowance breakage at period end | OPERA [package profit/loss][op-prt] | P0 | tested | day-close.md DCL-R02 step 4 | modules/day-close/test/scenario-s19-day-close-packages.test.ts asserts one `breakage:` entry for the unused night and allowance instances used/granted |
| PAR-DCL-043 | Fixed (scheduled) charges posted by the close | OPERA [fixed charges][op-prt] | P1 | deferred | — | no source of scheduled fixed charges exists yet (finance/reservations); Day Close posts them once a posting-plan source offers them |
| PAR-DCL-044 | No-show processing per policy (incl. no-show charge rules) | OPERA [reservation no shows][op-eod-procs] · [no show posting rules][op-noshow-rules] | P0 | tested | day-close.md DCL-R02 step 2; reservations.md RES-R29 | modules/day-close/test/no-shows-and-data-errors.test.ts › "auto: records each no-show once with the agreed fee; …" asserts the fee equals rates' `evaluateCancellationPenalty` and one `penalty:no_show:` entry |
| PAR-DCL-045 | Rolling no-show: move unarrived guaranteed arrivals forward instead of no-show | OPERA [rolling no show][op-eod] | P2 | missing | — | — |
| PAR-DCL-046 | Allotment / block cut-off release | OPERA [allotment cutoff][op-eod-procs] | P1 | specified | groups.md (release at cut-off, per groups spec) | — |
| PAR-DCL-047 | Credit card authorization top-ups for in-house stays | OPERA [night audit authorization][op-eod-procs] | P1 | specified | day-close.md DCL-R02 step 5 (renewals scheduled by payments) | — |
| PAR-DCL-048 | Batch deposit charging for due deposits | OPERA [batch deposit processing][op-eod-procs] | P1 | specified | payments.md PAY-R22 (payments' own executor) | — |
| PAR-DCL-049 | Auto folio settlement during the close | OPERA [auto folio settlement][op-eod] | P2 | missing | — | — |
| PAR-DCL-050 | Room status update for occupied rooms (e.g., set to dirty) and front-office status sync | OPERA [update room statuses][op-eod-procs] · Apaleo [flags occupied units dirty][ap-night-audit] | P1 | specified | day-close.md DCL-R02 step 9 (events for stayover planning) | — |
| PAR-DCL-051 | AR aging update and commission calculation | OPERA [A/R aging, commissions][op-eod-procs] | P1 | specified | finance.md FIN-R28 (aging as of date), FIN-R31 | — |
| PAR-DCL-052 | Catch-up for stays checked in after the posting step (night not posted) | assumption | P0 | tested | day-close.md DCL-R04, DCL-I04 | modules/day-close/test/concurrency.test.ts › "a stay checked in after the advance gets its missed night posted by the next close (catch-up), once" |
| PAR-DCL-053 | Posting status per procedure with iteration count | OPERA [postings status][op-prt] | P1 | tested | day-close.md DCL-R03 | modules/day-close/test/scenario-s09-day-close-interrupted.test.ts asserts `attempts: 2` and live progress |

### Integrity, statistics and reports

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DCL-060 | Integrity step: trial balance, guest ledger = folios, deposits and receivables controls; failure stops the run | OPERA [guest ledger / trial balance procedures][op-eod-procs] | P0 | tested | day-close.md DCL-R02 step 6, DCL-I02 | modules/day-close/test/readiness-and-overrides.test.ts › "a failed integrity check stops before the advance, …" and › "the guest ledger off by USD 0.02: …" |
| PAR-DCL-061 | Inventory ledger consistency for the day | assumption | P1 | tested | day-close.md DCL-R02 step 6 | modules/day-close/test/readiness-and-overrides.test.ts (inventory discrepancy fails integrity) |
| PAR-DCL-062 | Immutable statistics snapshot for the date (rooms, occupancy, ADR, RevPAR, revenue, nationality) | OPERA [generating reservation statistics][op-eod-procs] | P0 | tested | day-close.md DCL-R02 step 7, DCL-I03 | modules/day-close/test/scheduler-and-reports.test.ts › "keeps the as-closed pack and frozen facts; …" (occupancy, ADR, house use); nationality reported incomplete (Q43); modules/day-close/test/lifecycle-and-security.test.ts (facts immutable) |
| PAR-DCL-063 | Statistics available in real time during the day, not only after the audit | assumption (contrast to OPERA) | P1 | specified | analytics.md ANL-R02 (live facts) | — |
| PAR-DCL-064 | Final report pack generated, filed and emailed; resend and regenerate past reports | OPERA [EOD reports][op-eod-reports] | P0 | built | day-close.md DCL-R02 step 9, DCL-R07 | pack generated and stored once per date (tested in scheduler-and-reports); rendering, filing as a document and e-mail are not built |
| PAR-DCL-065 | EOD report set (manager report, trial balance, guest ledger, cashier summary, no-shows, adjustments, paid-outs, deposits transferred) | OPERA [EOD reports list][op-rpt-eod] | P0 | building | day-close.md DCL-R07; finance.md FIN-R42 | manager flash, trial balance, exceptions, overrides and step log built; guest ledger, cashier summary, no-shows, adjustments, paid-outs and deposits sections not yet |
| PAR-DCL-066 | Day reports keep a "restatements since" annex | assumption (brief §10) | P0 | tested | day-close.md DCL-R07 | modules/day-close/test/scheduler-and-reports.test.ts asserts `restatementsSince.changed` and one entry relating to D after an adjustment; pack unchanged |
| PAR-DCL-067 | Accounting export queued after the advance | OPERA [generate data export][op-eod-procs] | P0 | built | day-close.md DCL-R02 step 9 | requested through the integration port when accounting is external; port stubbed (README CR-12) → "journal export pending" follow-up |
| PAR-DCL-068 | Searchable run logs / EOD status report per step | Apaleo [night audit logs][ap-night-audit] · Infor [EOD status report][inf-eod] | P0 | tested | day-close.md DCL-R03, §9 run page | modules/day-close/test/scenario-s09-day-close-interrupted.test.ts (run view steps, executions, audit actions) |
| PAR-DCL-069 | Archived EOD reports migrated from the previous system downloadable | OPERA [EOD reports archive][op-eod-reports] | P2 | specified | integration.md (historical archive) | — |
| PAR-DCL-070 | Audit totals: auditor enters/verifies totals per charge code | OPERA [audit procedure][op-eod] | P2 | missing | — | — |

### Scheduling, automation and notification

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DCL-080 | Scheduled automatic close per property with auto-continue | OPERA [automatic EOD schedule][op-eod-auto] · Apaleo [scheduled night audit][ap-night-audit] | P0 | tested | day-close.md DCL-R05 | modules/day-close/test/scheduler-and-reports.test.ts › "fires at 02:00 property time, waits while something blocks, continues by itself …" |
| PAR-DCL-081 | Retry transient failures (3 × 5 min) but never integrity failures | OPERA [3 retries every 5 minutes][op-eod-auto] | P0 | tested | day-close.md DCL-R05 | modules/day-close/test/scheduler-and-reports.test.ts › "retries a transient failure three times five minutes apart, …" and › "never retries an integrity failure automatically" |
| PAR-DCL-082 | Notifications at start, blocked, failed, completed to duty roles | OPERA [EOD emails][op-eod-auto] | P0 | built | day-close.md DCL-R05 | notification requests emitted on start/blocked/failed/completed with mode (tested: blocked once, simulated in demo); delivery by comms not built |
| PAR-DCL-083 | Skip the schedule for today to run manually; schedule change log | OPERA [skip schedule, changes log][op-eod-auto] | P1 | tested | — | modules/day-close/test/scheduler-and-reports.test.ts › "skip today: …" asserts schedule log `configured`, `skipped_today` |
| PAR-DCL-084 | Configurable failure policy for remaining departures (continue vs stop on payment failure) | Agilysys [auto date roll][ag-autoroll] · [departures][ag-departures] | P1 | different | — | Day Close never checks a guest out; departures not checked out block or warn per policy (overridable with a reason) |
| PAR-DCL-085 | Guesthouse mode: close runs itself, owner confirms blocking items on the phone | assumption (vision guesthouse persona) | P0 | built | day-close.md DCL-R09 | auto-close with auto-continue and one blocked notification request (tested in scheduler-and-reports); the owner's phone confirmation needs comms/backoffice |
| PAR-DCL-086 | Portfolio Day Close board with lagging-property alerts | assumption | P1 | tested | day-close.md DCL-R08 | modules/day-close/test/scheduler-and-reports.test.ts › "the portfolio board shows each property, …" asserts lag alert |
| PAR-DCL-087 | Day Close on copied trial data compared with the source system's audit reports | assumption (adoption brief) | P1 | specified | day-close.md §14 | — |
| PAR-DCL-088 | Connected mode: business date mirrors the external PMS audit | assumption | P1 | tested | platform.md PLT-R34; day-close.md §14 | modules/day-close/test/lifecycle-and-security.test.ts asserts `external_system_of_record` when reservations is external (the date mirror itself is platform PLT-R34) |
| PAR-DCL-089 | Permissions: start, resume, cancel, override exceptions, manage policy | OPERA [EOD tasks][op-roles] | P0 | tested | day-close.md §8 | modules/day-close/test/lifecycle-and-security.test.ts › isolation and permissions; modules/day-close/test/readiness-and-overrides.test.ts (override / policy permissions) |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-DCL-001 | Process killed during room postings after 60% of stays | Resume posts only the remaining 40%; no duplicates; run page shows "68 of 112 posted, 44 remaining"; trial balance balanced throughout (S09) | P0 | tested | modules/day-close/test/scenario-s09-day-close-interrupted.test.ts (67 of 112, resume posts 45) |
| EC-DCL-002 | Two night auditors press Start at the same moment | One run created; the second request returns the running run (DCL-R06) | P0 | tested | modules/day-close/test/concurrency.test.ts › "two Start presses at the same moment create one run; …" |
| EC-DCL-003 | A second advance for the same date is attempted after the first succeeded | Refused "already advanced"; nothing posted twice | P0 | tested | modules/platform/test/platform.test.ts; modules/day-close/test/kill-and-resume.test.ts (one business_date_log row) |
| EC-DCL-004 | Guest checks in at 01:30 after room postings finished but before `advance` | Stay's first night flagged "night not posted"; next run's preflight catch-up posts it with key `room:{stay}:{D}`; never silently missed (DCL-R04) | P0 | tested | modules/day-close/test/concurrency.test.ts › "a delayed seaplane arrival is not a no-show; checked in after the postings step, its night is posted once before the advance" |
| EC-DCL-005 | Bar posts a charge at 00:40 while the run is in progress | Charge commits with the business date current at commit; belongs to D if before `advance`, D+1 after; no blocking | P0 | tested | modules/day-close/test/concurrency.test.ts › "lands before the advance on D, after it on D+1, and an in-flight posting is surfaced in the report" (in-flight prevention: FR-1) |
| EC-DCL-006 | Integrity check finds the guest ledger off by USD 0.02 | Run `failed` at integrity; business date not advanced; alarm to Finance owner; no automatic retry (DCL-I02) | P0 | tested | modules/day-close/test/readiness-and-overrides.test.ts › "the guest ledger off by USD 0.02: …" |
| EC-DCL-007 | Database failover during the advance step | Advance is one transaction: either D+1 committed or not; resume re-checks `expected = D` | P0 | tested | modules/day-close/test/kill-and-resume.test.ts › "kill -9 inside the advance transaction: the date stays D; resume advances exactly once" |
| EC-DCL-008 | Blocking exception remains at the scheduled 02:00 start | Run goes `blocked`, duty roles notified with the list; when resolved the run continues automatically | P0 | tested | modules/day-close/test/scheduler-and-reports.test.ts › "fires at 02:00 property time, waits while something blocks, …" (one blocked notification request) |
| EC-DCL-009 | Night manager overrides a blocking item (guest departed without checkout at an island guesthouse) | Override needs `dayClose.exception.override` and a reason per item; logged and shown in the day report | P0 | tested | modules/day-close/test/readiness-and-overrides.test.ts › "a blocking item stops the run; an override needs the permission and a reason; …" |
| EC-DCL-010 | Expected arrival on a delayed seaplane at 23:30 not yet checked in | Not auto no-showed if the stay has a recorded ETA/transfer delay; listed as "arrival pending (transfer delayed)" with owner; no-show only by explicit decision | P0 | tested | modules/day-close/test/concurrency.test.ts › "a delayed seaplane arrival is not a no-show; …" |
| EC-DCL-011 | Guaranteed arrival due today did not arrive; terms allow first-night charge | No-show step marks no-show (key `noshow:{stay}`) and the penalty posts once; card MIT only if terms disclosed it | P0 | tested | modules/day-close/test/no-shows-and-data-errors.test.ts › "auto: records each no-show once …" (collection only on the agreed guarantee) |
| EC-DCL-012 | No-show reinstated next morning because the guest arrived after midnight | Reinstatement reverses inventory release; penalty reversed by linked adjustment; restatement visible (E15) | P0 | specified | — |
| EC-DCL-013 | Guesthouse did not run Day Close for three days | Runs must go D, D+1, D+2 in order; each run's postings use its own night keys; banner until caught up | P0 | tested | modules/day-close/test/chaos-every-step.test.ts (24 consecutive dates closed in order, each with its own keys); modules/day-close/test/scheduler-and-reports.test.ts (lag alert) |
| EC-DCL-014 | Scheduler fires while the platform is in maintenance | Transient failure retried 3 × 5 min; then failed with notification to run manually | P0 | tested | modules/day-close/test/scheduler-and-reports.test.ts › "retries a transient failure three times five minutes apart, …" |
| EC-DCL-015 | Room postings step hits a stay with an invalid agreed price (data error) | That stay is reported as a step error with a fix link; other stays continue; run cannot advance until resolved or overridden | P0 | tested | modules/day-close/test/no-shows-and-data-errors.test.ts › "a stay with tampered terms fails alone; …" |
| EC-DCL-016 | Tax rule changes effective tomorrow while today's close runs | Night D posts with the rule effective on D; D+1 postings use the new rule (E08) | P0 | specified | — |
| EC-DCL-017 | Cashier forgot to close the drawer and is off shift | Policy: auto-close as "unattended", count later by supervisor; or block. Variance posted when counted, linked to the session | P1 | specified | — |
| EC-DCL-018 | POS outlet closes after midnight and sends its end-of-day after the advance | Late outlet totals compared against postings by business date; differences become exceptions on the earlier date, not silently moved (Mews over/short pain) | P0 | specified | — |
| EC-DCL-019 | Pending-verification payment at close time | Warns or blocks per policy with owner; resolver may resolve during the run; status re-evaluated before advance | P0 | tested | modules/day-close/test/readiness-and-overrides.test.ts › "what blocks is re-checked right before the advance: a payment pending since preflight stops the date (EC-DCL-019)" and › "policy decides what blocks: …" |
| EC-DCL-020 | A stay is due out but the seaplane was cancelled for weather | Departure listed with reason; extension created by policy decision; never auto-checked out with a balance | P0 | tested | modules/day-close/test/readiness-and-overrides.test.ts (departure_not_checked_out blocks with extendStay; Day Close never checks out) |
| EC-DCL-021 | Day report regenerated after a correction to D | Original "as closed" report stays; regenerated version shows "restatements since" annex with links; snapshot facts unchanged (DCL-I03) | P0 | tested | modules/day-close/test/scheduler-and-reports.test.ts › "keeps the as-closed pack and frozen facts; a later correction appears as a restatement" |
| EC-DCL-022 | Statistics snapshot step fails after postings succeeded | Run `failed` at statistics; resume re-runs only that step; snapshot written once | P0 | tested | modules/day-close/test/chaos-every-step.test.ts (crash before/after statistics_snapshot; one facts row per date) |
| EC-DCL-023 | Accounting export after advance fails (SFTP down) | Business date already advanced (export is post-advance); export retried by integration; exception "journal export pending" with owner | P1 | built | "journal export pending" follow-up when the integration port refuses; not tested |
| EC-DCL-024 | Property in a DST zone: scheduled start 02:30 on a spring-forward night | Runs at the next valid local minute; business date logic unaffected; schedule log shows actual start | P1 | tested | modules/day-close/src/domain/domain.test.ts › "starts at the next valid local minute on a spring-forward night (EC-DCL-024)" |
| EC-DCL-025 | Property time zone changed (e.g., data error corrected) | Business date unaffected; schedule recalculated; change audited; no run triggered twice | P2 | missing | — |
| EC-DCL-026 | Close started before the earliest allowed local time | Refused with the earliest time shown (PLT-R32) | P0 | tested | modules/day-close/test/lifecycle-and-security.test.ts › "refuses a start before the earliest local time, …" |
| EC-DCL-027 | Staff at another property in the group keep working during this property's close | Unaffected; no logout, no lock (DCL-R04) | P0 | tested | modules/day-close/test/concurrency.test.ts › "two properties of one group close at the same time without waiting for each other" |
| EC-DCL-028 | Run cancelled while blocked | Nothing posted; reason recorded; a new run can start later | P1 | tested | modules/day-close/test/lifecycle-and-security.test.ts › "a blocked run can be cancelled with a reason …" |
| EC-DCL-029 | In connected mode the external PMS has not sent its audit/date roll | Portico business date stays mirrored; banner "external audit not received since …"; no local close | P1 | specified | — |
| EC-DCL-030 | Allowance close for per-night allowances when a guest consumed after midnight | Allowance period follows business date (EC-FIN-049); breakage posted at `allowance_close` for D only | P0 | tested | modules/day-close/test/scenario-s19-day-close-packages.test.ts (consumption on D+1 draws the D+1 allowance; D's closed at its close) |
| EC-DCL-031 | A step's code is deployed in a newer version between failure and resume | Resume uses keyed effects so results are identical; run records both versions in its log | P1 | tested | modules/day-close/test/scenario-s09-day-close-interrupted.test.ts asserts each execution records `codeVersion` |
| EC-DCL-032 | Internet outage at the resort during the close (cloud keeps running) | Run continues server-side; notifications queue; on reconnect the auditor sees the exact step state | P0 | tested | modules/day-close/test/scheduler-and-reports.test.ts › "a scheduled close whose process died mid-step is resumed by the worker …" (runs server-side without any client) |
| EC-DCL-033 | Day-use stay arrives and departs on D | No night posting; included in statistics as day use; not flagged as departure not checked out | P1 | deferred | needs a day-use flag from reservations (README CR-6); a day-use stay still in house shows as an overstay today |
| EC-DCL-034 | Complimentary and house-use stays | Room nights counted in statistics as comp/house use (excluded from ADR per metric definition); zero-rated postings per policy | P0 | built | statistics count house use and exclude it from ADR/RevPAR (tested in scheduler-and-reports); Green Tax of zero-price nights not posted (README CR-10) |
| EC-DCL-035 | Auto Day Close on a guesthouse with an unresolved blocking item and no staff at night | Close stays blocked; owner gets one phone notification "2 things to settle"; next morning one-tap resolve then continue | P0 | built | blocked auto-close notifies once and continues when settled (tested in scheduler-and-reports); phone delivery needs comms |

## Evidence sources (all verified 2026-11-07)

Verification method: pages on docs.oracle.com, docs.mews.com, help.mews.com, api.apaleo.com, apaleo.dev and
docs.stripe.com were fetched and read on 2026-11-07. Pages on hosts this environment's proxy blocks
(central.xero.com, quickbooks.intuit.com, help.rguest.com, docs.infor.com, apaleo.zendesk.com,
mewssystems.freshdesk.com, Toast, Omniboost, Stayntouch, Clock, TrustRadius, oracle.com marketing) were verified
2026-11-07 through web-search results showing the page and its content, or through `docs/research/` citations;
re-open them before any external use. Third-party pages (Omniboost, Stayntouch, Clock, TrustRadius) describe a
competitor's behaviour indirectly and are weaker evidence than the vendor's own documentation.

[op-eod]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_endofday_procedures.htm
[op-eod-run]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_endofday_running_end_of_day.htm
[op-ia]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_endofday_income_audit.htm
[op-prt]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_post_room_tax.htm
[op-eod-reports]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_processing_endofday_reports.htm
[op-eod-auto]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_automatic_end_of_day_schedule.htm
[op-eod-procs]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_mandatory_optional_procedures.htm
[op-noshow-rules]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_cashiering_configuring_no_show_posting_rules.htm
[op-rpt-eod]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_end_of_day.htm
[op-roles]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_manage_roles.htm
[ap-night-audit]: https://apaleo.zendesk.com/hc/en-us/articles/115003519971-Night-Audit-Revenue-Recognition-and-Prepayment-Handling-payment-deposits
[ap-ops]: https://api.apaleo.com/swagger/operations-v1/swagger.json
[ag-autoroll]: https://help.rguest.com/stay/UserGuide/Auto%20Date%20Roll.htm
[ag-manroll]: https://help.rguest.com/stay/UserGuide/Manual%20Date%20Roll.htm
[ag-departures]: https://help.rguest.com/stay/UserGuide/Managing%20Departures%20for%20Automatic.htm
[ag-fiscal-auto]: https://help.rguest.com/stay/UserGuide/Automatically%20Closing%20a%20Fiscal.htm
[ag-fiscal-man]: https://help.rguest.com/stay/UserGuide/Manually%20Closing%20a%20Fiscal.htm
[inf-eod]: https://docs.infor.com/hms/3.8/en-us/hmsolh/pages/endofdaycompletionsummaryreport_help.html
[mw-ehw]: https://mewssystems.freshdesk.com/support/solutions/articles/31000129871-editable-history-window
[mw-pos-uc]: https://docs.mews.com/connector-api/use-cases/point-of-sale
