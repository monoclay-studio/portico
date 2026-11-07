# Spec: day-close

Status: Draft v1 · 2026-11-07 · Wave 2 · Schema `day_close` · Prefix `DCL` · Entitlement `core.dayClose` (all editions)

## 1. Purpose

Day Close (glossary; staff hint "night audit") ends a property's business day as a **controlled, resumable,
non-blocking** process: it resolves the day's exceptions, posts room and package charges exactly once, handles
no-shows, closes allowance periods, proves the ledger is balanced, freezes the day's statistics and advances the
business date — without logging anyone out, and so that an interruption at 02:10 is a "resume", not a crisis.

## 2. Scope and non-goals

**In scope:** Day Close runs and steps, the continuous exception queue ("Day Close readiness"), scheduling and
auto-continue, statistics snapshots, day reports, post-advance exports, portfolio Day Close status.
**Non-goals:** the postings themselves (`finance`), no-show rules (`reservations`), business-date storage
(`platform`), accounting period close (`finance` FIN-R43 — Day Close is the operational roll; ledger period
close is separate), metric definitions (`analytics`).

## 3. Capabilities

- **DCL-R01** [MUST] **Continuous exception queue** all day: aggregated from modules' `listExceptions` (common
  shape `{code, severity, blocking, ref, owner, message, actions[]}`): arrivals not checked in, departures not
  checked out, overstays, incomplete check-ins/outs, payments pending verification, failed collection items, open
  cashier sessions, unbalanced/suspense items, departed stays with balance, unresolved relocations/conflicts,
  integration exceptions affecting the day (warnings), unacknowledged handovers (warning). Policy decides which
  codes block Day Close. Each item links to its resolution action.
- **DCL-R02** [MUST] A run for business date D consists of ordered, **idempotent** steps, each with status, counts,
  timings and errors:
  1. `preflight` — evaluate exceptions; stop (`blocked`) if blocking items remain, unless a user with
     `dayClose.exception.override` ⚑ proceeds with reason per item.
  2. `no_shows` — expected arrivals for D per policy → `reservations.markNoShow(stayId, key "noshow:{stayId}")`.
  3. `room_and_package_postings` — for each stay in house for night D: room charge per agreed terms
     (`room:{stayId}:{D}`), inclusions per rhythm (`inclusion:{stayId}:{inclusionId}:{D}`), nightly fees.
  4. `allowance_close` — `finance.closeAllowancePeriod` for per-night allowances of D (breakage).
  5. `payments_housekeeping` — authorization renewals due, VCC charges due tomorrow scheduled (no charges run
     here; payments' own executors run them).
  6. `integrity` — trial balance balanced; guest ledger = Σ folios; deposits and receivables controls; inventory
     ledger consistency (INV-I02) for D; any failure stops the run (`failed`, integrity alarm).
  7. `statistics_snapshot` — immutable facts for D (rooms sold/available/OOO/comp/house use, occupancy, ADR,
     RevPAR, revenue by department and charge code, guests and guest-nights by nationality, no-shows,
     cancellations, arrivals/departures) handed to `analytics`.
  8. `advance` — `platform.advanceBusinessDate(propertyId, expected = D)`.
  9. `post_advance` — day report pack rendered and stored; accounting journal export queued via `integration`;
     events for operations (stayover planning).
- **DCL-R03** [MUST] **Resume**: a `failed` or interrupted run resumes at the first non-completed step; completed
  steps are not re-run; partially completed steps re-run safely because every effect is keyed (S09). The run page
  shows, per step, what completed (e.g. "Room postings: 88 of 112 stays posted, 24 remaining").
- **DCL-R04** [MUST] **Non-blocking**: no logout, no global lock; other commands continue; postings committed before
  `advance` belong to D, after to D+1 (FIN-I10). A stay checked in during the run after step 3 has its first night
  posted by a catch-up check in the next run's preflight (exception "night not posted") — never silently missed.
- **DCL-R05** [MUST] **Scheduler**: per property start time (policy, ≥ `dayClose.earliestStartLocalTime`),
  auto-continue when no blocking exceptions, notifications (start, blocked, failed, completed) to the duty roles;
  retries transient failures 3× at 5-minute intervals; never retries integrity failures automatically.
- **DCL-R06** [MUST] Only one active run per property (DB constraint); a second start returns the running run.
- **DCL-R07** [MUST] **Day reports** are immutable snapshots with a "restatements since" annex fed by finance
  corrections that relate to D (FIN-R04), so historical reports stay understandable after corrections.
- **DCL-R08** [SHOULD] Portfolio Day Close board: each property's business date, run status, blocking items count,
  last completion time; alerts for properties lagging ≥ 1 day.
- **DCL-R09** [SHOULD] Guesthouse profile: Day Close runs automatically with only blocking checks surfaced on the
  owner's phone ("2 things to settle before today can close"), one-tap confirmation.

## 4. Entities and states

`run(id, property_id, business_date, status, started_by, started_at, finished_at?, version)` UNIQUE active per property ·
`step(run_id, key, status, counts jsonb, error?, started_at, finished_at)` · `override(run_id, exception_ref, user,
reason)` · `stats_snapshot(property_id, business_date, facts jsonb, generated_at)` · `day_report(property_id,
business_date, artifact_ref, restatements jsonb)`.

**Run:** `scheduled → preflight → blocked → preflight` (after resolution) · `preflight → running → completed` ·
`running → failed → running` (resume) · `scheduled|blocked → cancelled` (user, reason; nothing posted). A run for D
cannot start unless D is the property's current business date and the previous run is `completed`.
**Step:** `pending → running → completed | failed | skipped (policy)`; `failed → running` (resume).

## 5. Invariants

- **DCL-I01** For each stay and night, at most one room posting exists (finance key uniqueness), whatever the number
  of runs, resumes or crashes (S09, E07).
- **DCL-I02** A business date advances only after `integrity` passed for that run.
- **DCL-I03** Statistics snapshots for D are immutable; later corrections appear as restatements, not edits.
- **DCL-I04** Every in-house night up to D−1 has room postings once the run for D completes (catch-up check).
- **DCL-I05** At most one non-terminal run per property.

## 6. Cross-module interactions

Calls `reservations` (listInHouseStaysForNight, listDueArrivals/Departures, markNoShow, listExceptions), `finance`
(postCharge, closeAllowancePeriod, getUnbalancedItems, integrity checks), `payments` (listUnresolved), `inventory`
(getAvailability, consistency check), `operations` (listExceptions), `integration` (exceptions, export), `platform`
(advanceBusinessDate, policies), `analytics` (snapshot handoff). Domain map dependency arrow already lists these.

### Proposed contract changes

Common `listExceptions` shape across modules (see reservations spec); `finance.runIntegrityChecks(tx, {propertyId,
businessDate})`; `analytics.recordDailySnapshot(tx, {...})`.

## 7. Events

Emitted: `dayClose.run.started|blocked|failed|completed`, `dayClose.step.completed`.
Consumed: `platform.property.businessDateAdvanced` (confirmation), module exception events for the readiness panel.

## 8. Permissions

Module key `dayClose` (schema `day_close`). `dayClose.run.read` · `dayClose.run.start` · `dayClose.run.resume` ·
`dayClose.run.cancel` ⚑ · `dayClose.exception.override` ⚑ · `dayClose.policy.manage` ⚑ · `dayClose.report.read`;
advancing also requires `platform.businessDate.advance` (implemented; Night auditor role template).

## 9. UX surfaces

Day Close readiness panel (counts by blocking/warning with owners, available all day on the night auditor's and
GM's workspaces), Run page (step list with live counts, resume button, overrides with reasons), Day report viewer
with restatement annex, Portfolio board.

## 10. Proof scenarios and evidence

| ID | Day Close must demonstrate |
|---|---|
| S09 / E07 | Kill the process during step 3 after 60% of postings; resume posts only the remaining 40%; trial balance balanced; run page shows exact progress; no duplicates. |
| S05 (supporting) | A pending-verification payment blocks or warns per policy, with owner. |
| S10 (supporting) | Late charge posted after Day Close of the departure date is a D+n posting with `relatesToBusinessDate`; day report annex shows it. |
| E08 (supporting) | Postings after a tax change use rule versions per service date; snapshots unchanged. |
| E15 | Mistaken no-show reinstated before ledger impact (reservations); restatement visible. |

## 11. Maldives specifics

Resorts commonly run the audit between 00:00 and 03:00 local time with a small night team; guesthouses rarely have a
night auditor (DCL-R09). Statistics include guest-nights by nationality (Ministry of Tourism reporting needs are
unverified — Q43). Green Tax postings per person-night are part of nightly postings (rates rule pack).

## 12. Competitive inspirations

OPERA business date, End of Day procedures, auto scheduler with retries, halts on exceptions, statistics after audit,
global logout (research 01 §3.1) — we keep the business date and deterministic restartable steps, remove the logout
and make exceptions continuous. Separate date roll from fiscal close and failure policies — Agilysys (research 01
§6.5). Scheduled, API-triggerable audit and "only the audit posts to past dates" — Apaleo (research 02 §3.3.6).
Per-step EOD status report — Infor (research 01 §4.5). Mews' no-audit model shifts pain to finance (late outlets,
over/short — research 02 §2.6), which is why Portico keeps a controlled close.

## 13. Open questions

Q43 (statistics reporting obligations). Product decision: integrity failures never auto-retry.

## 14. Adoption modes

- **Standalone alongside an external PMS:** no. Day Close exists only where Portico is authoritative for
  `reservations` and `charges`.
- **Hard dependencies:** `platform`, `reservations`, `finance`, `payments`, `inventory`, `operations`.
- **Connected mode:** disabled when `reservations` is external (the external PMS runs its own audit; Portico's business
  date mirrors it, PLT-R34). When only `accounting` is external, Day Close runs fully and step 9 exports journals.
- **Data-authority domains:** respects `reservations`, `charges`, `accounting`; owns none.
- **Trial:** Day Close can be run on copied data to compare Portico's day report with the source system's audit
  reports; differences are listed, nothing is exported.
