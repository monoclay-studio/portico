# @portico/day-close

Day Close (glossary; staff hint "night audit") ends a property's business day as a **controlled, resumable,
non-blocking** process. Spec `docs/specs/day-close.md` (DCL-R01–R09, DCL-I01–I05); 10x brief
`docs/strategy/modules/day-close.md`; gap plan M6; parity `docs/parity/day-close.md`. Schema `day_close`.

## Checkpoint

- **Done:** the module (engine, readiness, nine steps, scheduler, reports, records, search, HTTP, demo seed), wired in
  `apps/api/src/composition.ts`, with module tests on a real database (real platform, rates and finance) and an HTTP
  test through the composed app. **Fix round 1** of the steward review (`docs/orchestration/reviews/review-day-close.md`):
  stable line identity and reconciliation (P0-1), allowances granted at the night's own close (P0-2), night decisions
  (P1-1), cut-over in the advance transaction (P2-2/P2-3), DST forward rule (P2-1), no daytime close (P2-5), PII-free
  report (P2-6), dead-man's switch (P2-7), the reviewer's probes as regression tests (`test/regressions-*.test.ts`).
  Rates gained an additive line identity (`PostingLine.lineKey`, `.occurrence`). Main merged @ `7b1b032`.
- **In progress:** nothing.
- **Next steps:** bind the stubbed provider functions when their owners ship them (§ Contract requests); re-run the
  scenarios through `apps/api/test/scenarios/` once `feat/integration-step` binds reservations' rates/finance ports.
- **Known failing tests:** none.

## The 10x targets (gap plan M6) and what is built against each

| Target | What makes it true | Evidence |
|---|---|---|
| **≤ 2 minutes of the auditor's attention** on a day with nothing blocking: one page, one press | `GET …/readiness` answers in one sentence ("Ready to close: nothing open."); one `POST …/runs` runs every step; nothing else needs a person | `test/lifecycle-and-security.test.ts` › "a day with nothing blocking: readiness says so in one sentence; one Start closes the day; nobody else acts" (asserts the only user-attributed Day Close audit actions are the start, the advance and the completion of that one press). Staff validation of the 2 minutes: **not done** (R3 only) |
| **Nobody logged out** | Day Close never touches identity sessions and takes no global lock: only its own executors serialize, on the run row; the advance takes a per-property advisory lock | `test/concurrency.test.ts` › "lands before the advance on D, after it on D+1, …" (a bar posting and another user's readiness read succeed mid-run) |
| **Zero duplicate postings after any interruption** | Every item's progress commits in the same transaction as its effects; done items are never re-executed; finance keys are rates' stable line identity (`room:{stay}:{night}`, `inclusion:{stay}:{inclusion}:{night}` for nightly lines, `…:arrival` / `…:departure` / `…:stay-night-{n}` for once-per-stay lines — never the night a line happens to be allocated to) plus `penalty:no_show:{stay}`, registered in `day_close.line_postings` so a re-priced line is never posted twice; the advance and its step completion commit together; a dead executor's lease expires before anyone else may take over | `test/scenario-s09-day-close-interrupted.test.ts`; `test/kill-and-resume.test.ts` (real `kill -9`); `test/chaos-every-step.test.ts` (25 crash points over 25 consecutive dates; final check: no ledger key twice, one departure transfer per stay, one advance, one report and one day-closed announcement per date); `test/regressions-money.test.ts` (re-priced lines: extension, shortening, cancelled seaplane) |

## Capabilities (spec) — status and readiness

Readiness per CLAUDE.md §7: everything below is at most **R3 (implemented and tested internally)**. Nothing is
validated with hotel staff. External effects (notifications, fee collection, journal export) are requests to other
modules, simulated in non-live organizations.

| Spec | Capability | Status | Evidence |
|---|---|---|---|
| DCL-R01 | Readiness all day: arrivals not checked in, arrivals on a delayed transfer, departures not checked out, finance's Day Close checks (departed with balance, settled folio with balance, cashier sessions, unverified recorded payments, invoices overdue, suspense, ledger alarms), payments pending verification, nights not posted, integration exceptions, units without a housekeeping status, room-status discrepancies, Day Close's own follow-ups. Owner per item (the property's department of that kind), fixes per item with disabled reasons, blocking separate from warnings, policy decides, sources that cannot be read are listed | R3 | `test/readiness-and-overrides.test.ts` › "aggregates every source; …", › "a source that cannot be read is listed as missing, …" |
| DCL-R02 | Nine ordered steps: preflight, no_shows, room_and_package_postings, allowance_close, payments_housekeeping, integrity, final_sweep (last postings + blocker re-check), advance (facts frozen in the advance transaction), post_advance; status, counts, timings, errors per step | R3 (payments housekeeping is a stub: skipped honestly) | `test/scenario-s09-…`, `test/chaos-every-step.test.ts` |
| DCL-R02.2 | No-shows per policy (`auto` / `decide` / `off`), delayed-transfer protection, fee from the agreed terms (rates via reservations), collection only through payments on the agreed guarantee | R3; collection stub (CR-7) | `test/no-shows-and-data-errors.test.ts` |
| DCL-R02.3 | Room and package postings from the agreement in force through rates' posting plan, each line under its stable identity (`lineKey`) and registered once: room, inclusions, added items (`finance.postCharge`), allowances (`finance.grantAllowance`); taxes and Green Tax by finance through the rates rule pack. Lines served after their night (departure transfer) are expectations reconciled against the agreement at every close (moved, cancelled, or flagged `posted_line_changed` when already charged) and posted right after the advance to their service date — on the folio before check-out; stays no longer in house are reconciled from reservations' agreement lookup (CR-18; until bound, the last known line on its date, flagged). A line finance already holds with other content is set aside with `posting_conflict` — the rest of the night posts. Catch-up of nights not posted; final sweep of stays checked in during the close; zero-price nights raise `levy_not_posted` | R3 | `test/scenario-s19-day-close-packages.test.ts`, `test/scenario-s04-day-close-split-billing.test.ts`, `test/concurrency.test.ts`, `test/regressions-money.test.ts` |
| DCL-R02.4 | Night N's allowance is granted at N's own close — never before the night exists — valid the day after (the day the guests wake up to), and closed at N+1's close or at check-out (`finance.closeAllowances`, forfeit → breakage). An early departure or a guest-count correction never meets a grant for a night that did not happen (review P0-2) | R3 | `test/scenario-s19-…`, `test/regressions-money.test.ts` › P0-2 |
| DCL-R02.6 | Integrity: finance's integrity report (trial balance balanced FIN-I02, control accounts = sub-ledgers FIN-I14), finance's ledger alarms, inventory ledger consistency (INV-I02); a failure stops before the advance, raises a blocking alarm to finance, is never overridden and never retried automatically | R3 | `test/readiness-and-overrides.test.ts` › "a failed integrity check stops before the advance, …" |
| DCL-R02.7 | Day facts frozen once, in the advance transaction — from the state the advance closes, after the final sweep (review P2-3) (occupancy, ADR, RevPAR with Decimal; rooms capacity/out of order/sold/complimentary/house use; revenue by charge code; arrivals, no-shows, in-house, guests). Departures count and nationality reported as missing (CR-3, CR-17) | R3 | `test/scheduler-and-reports.test.ts` › "keeps the as-closed pack and frozen facts; …", `test/regressions-ops.test.ts` › R-STATS |
| DCL-R02.8 | Advance through `platform.advanceBusinessDate(expected = D)` with the acting person's own `platform.businessDate.advance` (sensitive); what blocks is re-checked right before the date moves (EC-DCL-019, in `final_sweep`); the advance transaction re-checks under the advance lock that no in-house stay of D is unposted and loops back to the sweep (DCL-I04) | R3 | `test/lifecycle-and-security.test.ts` › "advancing needs platform.businessDate.advance on the person: …"; `test/readiness-and-overrides.test.ts` › "what blocks is re-checked right before the advance: …" |
| DCL-R02.9 | Day report pack (manager flash, trial balance as of D, exceptions, overrides, step log) stored once; journal export requested when accounting is external (stub, CR-12); `dayClose.day.closed` announced once | R3 (export R1) | `test/scheduler-and-reports.test.ts`, `test/chaos-every-step.test.ts` |
| DCL-R03 | Resume at the first incomplete step; failed items retried, done items never; run page progress "88 of 112 posted" counted live from committed items | R3 | `test/scenario-s09-…` (asserts `'Room postings: 67 of 112 stay-nights posted, 45 remaining'`) |
| DCL-R04 | Non-blocking; cut-over: postings before the advance land on D, after it on D+1; an in-flight posting stamped D after the close is a named follow-up for finance (`posted_after_close`, checked right after the advance and at the next close; journal re-export flagged when accounting is external) and labelled in the report (prevention needs FR-1) | R3 (detection only) | `test/concurrency.test.ts` › "postings arriving during the close" |
| DCL-R05 | Scheduler at the property's local time — the first instant at or after it, correct east and west of UTC (review P2-1) — auto-continue, blocked runs re-checked every minute and audited/notified only when the blockers change, a run open past the next close time re-checked hourly (not every minute), a run created by hand first adopted by the schedule, crashed auto-close runs resumed after their lease expires, transient failures retried 3 × 5 min, never integrity; skip-today with log. Earliest start always set (default 22:00), the schedule may not be earlier (MUST), the no-show step re-checks the cut-off (non-overridable, review P2-5). Enabling or changing a schedule needs `platform.businessDate.advance` and records who (review P2-12). Dead-man's switch: a refused fire raises `close_not_started` at once; a close 2 h overdue (or a run open 6 h) raises `close_overdue` and pages the duty roles from a separate job (review P2-7) | R3 | `test/scheduler-and-reports.test.ts`, `test/regressions-ops.test.ts`, `src/domain/domain.test.ts` |
| DCL-R06 | One active run per property (two partial unique indexes); a second start returns the active run | R3 | `test/concurrency.test.ts` › "two Start presses at the same moment create one run; …" |
| DCL-R07 | Immutable "as closed" report — codes and references only, no guest names or other modules' prose (messages and names rendered on read, so erasure reaches them, review P2-6) — with a "restatements since" annex computed on read and labelled by cause: corrections (`relatesToBusinessDate`), posted after close, Day Close's own late postings for the date; other modules' late charges are labelled not connected (CR-19) | R3 | `test/scheduler-and-reports.test.ts` › "keeps the as-closed pack and frozen facts; a later correction appears as a restatement", `test/regressions-ops.test.ts` › R-PII, R-LATE |
| DCL-R08 | Portfolio board (business date, run, blocking count, lag alert) | R3 | `test/scheduler-and-reports.test.ts` › "the portfolio board shows each property, …" |
| DCL-R09 | Guesthouse auto-close: schedule + auto-continue; the duty roles get one notification request when something blocks | R3 (delivery to a phone needs comms: R1) | `test/scheduler-and-reports.test.ts` › "fires at 02:00 property time, …" |
| — | Night decisions (review P1-1): overriding a failed stay-night records a pending decision; the next close is blocked by `night_decision_needed` until a person decides "Day Close posts it" (posted once with the plan key, also after the guest left) or "charged another way" (never posted); the catch-up never fills a decided night. `POST …/night-decisions` (`dayClose.exception.override`, sensitive, reason, audited) | R3 | `test/regressions-money.test.ts` › P1-1 |
| — | Overrides of blocking items and of failed items: `dayClose.exception.override` (sensitive) and a reason per item; integrity items and the no-show cut-off never | R3 | `test/readiness-and-overrides.test.ts` › "a blocking item stops the run; …", `test/no-shows-and-data-errors.test.ts` › "a stay with tampered terms fails alone; …" |
| — | Cancel a run only while nothing was posted (`dayClose.run.cancel`, sensitive, reason) | R3 | `test/lifecycle-and-security.test.ts` › "a blocked run can be cancelled …" |
| — | Policy endpoint: refused when unusable (integrity codes demoted), If-Match; a stored unreadable policy fails closed | R3 | `test/readiness-and-overrides.test.ts` |

## Invariants and the tests that prove them

| Invariant | Enforced by | Test |
|---|---|---|
| DCL-I01 at most one posting per agreement line, whatever the runs, resumes, crashes or re-pricings | item progress committed with its effects + done items skipped; `day_close.line_postings` PK (tenant, stay, line identity) and `night_postings` PK (tenant, stay, night); finance's unique idempotency key = the line identity | `scenario-s09-…`, `kill-and-resume`, `chaos-every-step`, `regressions-money` › P0-1 |
| DCL-I02 the business date advances only after `integrity` passed in that run | step order; check in the advance transaction; DB trigger on `day_close.steps` | `readiness-and-overrides` › "the database refuses to complete the advance step unless integrity completed in the same run" |
| DCL-I03 day facts immutable; corrections are restatements | `core.make_append_only` on `day_facts`, `day_reports`, `night_postings`, `overrides` | `lifecycle-and-security` › "day facts and reports are immutable; …", `scheduler-and-reports` › restatement |
| DCL-I04 every occupied night up to D−1 is posted (or decided by a person) once the run for D completes | catch-up items in step 3 (in-house stays, nights whose own close completed); the final sweep and the in-transaction check of the advance; the post-advance sweep; Day Close's record of late check-ins (`watched_stays`, from reservations' stay events) for stays that left before the next close — posted from reservations' agreement lookup (CR-18), or a blocking `night_not_posted_departed` while it is not bound | `concurrency` › "… catch-up …", › "a delayed seaplane arrival …"; `regressions-ops` › P2-2. **Partial in the composed app until CR-18** (departed stays are flagged, not posted) |
| DCL-I05 at most one non-terminal run per property | partial unique indexes + `on conflict do nothing` | `concurrency` › "two Start presses …" |
| A completed step is never re-run; a done item never redone; a completed/cancelled run is final | DB triggers on `steps`, `step_items`, `runs` | `lifecycle-and-security` › immutability, `chaos-every-step` |
| Only the lease holder commits effects; a stale executor stops | every executor transaction renews the lease `where lease_owner = me` first (takes the run row lock) | `concurrency` › "a stale executor that wakes up after a take-over stops …" |
| The advance and its step completion commit together | one transaction | `kill-and-resume` › "kill -9 inside the advance transaction: …", `chaos-every-step` (after-commit crash point) |

## Scenarios (module-level scenario tests; binding manifest and assertion map)

These run on a real database through Day Close's public service API with **real** platform, rates (sealed terms from
real quotes, posting plan, Maldives tax pack) and finance (ledger, postings, allowances, integrity). Reservations is a
**strict Postgres-backed fake** (`test/harness.ts`): it serves stays whose terms are real sealed rates terms and
records no-shows as reservations does (rates' penalty evaluation, finance key `penalty:no_show:{stay}`). Payments,
inventory, operations and integration are small fakes with the providers' shapes and refusal codes.
**Composed-app runs (`apps/api/test/scenarios/`) are blocked-by-binding** on main: reservations' rates and finance ports
are stubs until `feat/integration-step` merges. `apps/api/test/day-close.test.ts` exercises the composed bindings
over HTTP without stays.

| Scenario | Test | Ports real / fake | Catalogue line → assertion |
|---|---|---|---|
| **S09** | `test/scenario-s09-day-close-interrupted.test.ts` | platform, rates, finance real; reservations fake | **Pre** 112 in-house stays, fault after 67 → crash hook at item 67. **Steps** run page shows 67 of 112 → `expect(postings?.progress).toBe('Room postings: 67 of 112 stay-nights posted, 45 remaining')`; Resume → `resumeRun` (refused while the lease is live: `code: 'run_in_progress'`). **State** completed, D+1, snapshot → `runStatus 'completed'`, `businessDate … '2026-11-08'`, `facts.rooms.sold 112`. **Money** 112 room postings + inclusions, no duplicates, TB balanced at every point → `room toHaveLength(112)` all `n === 1`, breakfast 112, `postCalls === 90`, `assertBooksBalance` mid-run and at the end. **Inventory** unchanged → `.todo`: inventory is a fake here (INV-I02 is checked through the port; real inventory binding is in composition). **Audit** step log with failure and resume → actions contain `dayClose.run.recovered`, `dayClose.run.resume`, two executions. **Recovery** resume idempotent at every step → `chaos-every-step`, `kill-and-resume` |
| **S04** (Day Close part) | `test/scenario-s04-day-close-split-billing.test.ts` | platform, rates, finance real | **Money** postings routed exactly as previewed → preview allocations = company folio for ROOM, guest folio for FB_BREAKFAST; after the close `charges(companyFolio) = ['ROOM']`, `charges(guestFolio) = ['FB_BREAKFAST']`; Green Tax 3 × USD 12 on the company folio; one entry per night |
| **S19** (Day Close part) | `test/scenario-s19-day-close-packages.test.ts` | platform, rates, finance real | **Steps** Day Close posts nights (room + meal components + allowance) → each plan line of night D once; allowance consumed partly and exceeded → instances `used 10_000 / granted 10_000`; breakage nightly → one `breakage:` entry for the unused arrival night, none for the fully used night. **Money** taxes by rule: room line Green Tax `-3_600`, TGST present; ledger reconciles → integrity report incl. `allowance_clearing_equals_outstanding`. **Audit** postings with rule-version ids → `tax_rule_version_id is not null` on room postings |
| E07 | `test/chaos-every-step.test.ts`, `test/kill-and-resume.test.ts` | as S09 | crash at each step boundary (before/after every step), inside the first item of every step with items, and right after the advance and the report commit; real SIGKILL mid-item and inside the advance |

Global consistency after each scenario: trial balance balanced and control accounts = sub-ledgers
(`assertBooksBalance`); no duplicate idempotency effects (`entriesByKey … n === 1`); audit rows for start, advance and
completion. Not checked here: INV-I02/I03 and RES-I02 against real inventory/reservations (fakes).

## Permissions (manifest)

`dayClose.run.read` · `dayClose.run.start` · `dayClose.run.resume` · `dayClose.run.cancel` ⚑ ·
`dayClose.exception.override` ⚑ · `dayClose.issue.resolve` · `dayClose.policy.manage` ⚑ · `dayClose.report.read`.
Advancing also needs `platform.businessDate.advance` ⚑ on the acting person. Role grants Day Close needs are in
`DAY_CLOSE_ROLE_GRANTS` (`src/manifest.ts`): identity's `night_auditor` and `general_manager` templates already hold
them (`test/lifecycle-and-security.test.ts` › "identity's night-auditor template …"); the `finance` template and a
`front_office_manager` template are contract requests (CR-13).

## Events

Emitted: `dayClose.run.started|blocked|failed|completed|cancelled`, `dayClose.step.completed`, `dayClose.day.closed`
(once per date, with the frozen facts reference). Run events carry `notification: { roles, mode }` where `mode` comes
from `assertExternalEffectAllowed(ctx, 'message.staff')` (`simulate` in demo/trial/training). Payloads carry ids,
dates and counts — no guest names. Also `dayClose.close.overdue` (dead-man's switch). Consumed (`dayCloseSubscriptions`, bound in the composition root): `reservations.stay.checkedIn|extended|shortened|checkedOut` → Day Close's record of late check-ins and their last announced departure (review P2-2). Payload Zod schemas are not exported yet (P3-8).

## Ports (`src/ports.ts`) and binding status (composition)

| Port | Functions | Binding |
|---|---|---|
| `PlatformPort` | getProperty, getBusinessDate, **advanceBusinessDate (acting user)**, resolvePolicy, setPropertyPolicy, getDataAuthority, hasEntitlement, listProperties, listDepartments | **real** platform |
| `ReservationsPort` | getStayAgreement | **stub** `module_not_available` (CR-18) — departed stays: last known line posted on its date (flagged), unposted nights flagged blocking |
| `ReservationsPort` | listInHouseStaysForNight, listDueArrivals, listDueDepartures, markNoShow (the composition adapter refuses a stay of another property — code only: no stay can be created in the composed app on main, so it is untested there; the module fake enforces the same rule) | **real** (`reservationsProvider`, system scope after Day Close authorized). Note: on main reservations' own rates/finance ports are stubs, so `markNoShow` with a fee and terms in rates' canonical form arrive with `feat/integration-step` |
| `RatesPort` | verifyTerms, postingPlan (with the additive `lineKey` / `occurrence`), allowances, nightLevies (statutory per-person / per-unit taxes of a night, from the sealed terms) | **real** rates |
| `FinancePort` | postCharge, defaultFolio, grantAllowance, closeAllowances, getUnbalancedItems (`financeProvider(finance, 'dayClose')`); integrityReport, trialBalance, dailyRevenue (system scope, CR-9) | **real** finance |
| `PaymentsPort` | listUnresolved | **real** payments |
| | collectAgreedNoShowFee, scheduleDueCollections | **stub** `module_not_available` (CR-7, CR-8) — Day Close then raises "no-show fee to collect" / skips the step honestly |
| `InventoryPort` | getAvailability, checkLedgerConsistency (filtered to the property in the adapter, CR-16), listUnits | **real** inventory |
| `OperationsPort` | listUnitConditions | **real** operations |
| `IntegrationPort` | listOpenExceptions | **real** integration (`integration.listExceptions`) |
| | queueJournalExport | **stub** `module_not_available` (CR-12) — raises "journal export pending" |

## Contract requests (to other modules)

| # | To | Request | Why |
|---|---|---|---|
| CR-1 | reservations | `listInHouseStaysForNight` returns each stay's `arrival` and `departure` | the adapter reads every stay again (`getStay`) |
| CR-2 | reservations | a list of stays occupying a night **including departed ones** (`listStaysForNight`) | catch-up of a night for a stay checked in after the posting step and checked out before the next close |
| CR-3 | reservations | `listDueArrivals` carries the agreed no-show charge preview; `listDeparturesForDate(date)` for statistics | readiness shows the fee; facts report departures (now `null`) |
| CR-4 | reservations | at check-out, post the plan's departure-dated lines with their `lineKey` | Day Close posts them right after the advance to their service date (before check-out); a change on the departure day itself (a stay shortened that morning) is still a late charge until CR-4 |
| CR-5 | reservations | (re-scoped) if a package intends a credit for the arrival day, grant it at check-in under its own key | night N's credit is valid the day after N, so the arrival day has no credit unless reservations grants one |
| CR-6 | reservations | day-use stays (EC-DCL-033); no-show reinstatement (RES-R10, EC-DCL-012) | today a day-use stay still in house shows as an overstay |
| CR-7 | payments | `collectAgreedNoShowFee(tx, { propertyId, bookingId, stayId, amount, idempotencyKey })` → `requested | not_agreed | pending_verification` + mode | ADR-0015 Amendments 1 and 2: payments decides the card (supplied for this booking, the booking's channel card, or a mandate whose purposes include `no_show`, whose amount cap and bookings cover it); Day Close never picks a card |
| CR-8 | payments | `scheduleDueCollections(tx, { propertyId, businessDate })` | DCL-R02.5 (renewals, VCC due) |
| CR-9 | finance | `runIntegrityChecks`, `trialBalance`, `dailyRevenue` on the `dayClose` provider surface with `ProviderScope` | today bound with system scope (ledger reads are organization-level permissions) |
| CR-10 | finance + rates | a levy-only posting for zero-price nights (complimentary / house-use Green Tax) and a levy line in the posting plan | zero-amount lines are skipped; the levy is not posted (gap) |
| CR-11 | platform + finance | `lockBusinessDate` at posting (FR-1) | prevents in-flight postings landing on a closed date |
| CR-12 | integration | `queueJournalExport(tx, { propertyId, businessDate, idempotencyKey })` | DCL-R02.9 when accounting is external |
| CR-13 | identity | `finance` template + `dayClose.run.read`, `dayClose.report.read`, `dayClose.issue.resolve`; new `front_office_manager` template = `DAY_CLOSE_ROLE_GRANTS.front_office_manager` | role templates for the three Day Close roles |
| CR-14 | operations, comms | consume `dayClose.day.closed` (stayover planning); deliver run notification requests to duty roles | PAR-DCL-050, DCL-R05 |
| CR-15 | analytics | consume the frozen day facts | DCL-R02.7 hand-off |
| CR-16 | inventory | `checkLedgerConsistency` with a required property scope | tenant-wide today, filtered in the adapter |
| CR-17 | guests | guest-nights by nationality | facts report nationality as incomplete (Q43) |
| CR-18 | reservations | `getStayAgreement(tx, { propertyId, stayId })` → the stay's agreement in force whatever its status (dates, status, commercial type, occupancy, segments with sealed terms) | reconcile a departed or shortened stay's remaining lines and post a late check-in's night after the guest left (DCL-I04, review P0-1/P2-2) |
| CR-19 | finance | postings by service date posted after that date closed (`listLatePostings({ propertyId, serviceDate })`), or stamp `relatesToBusinessDate = serviceDate` on a late posting | the day report's annex shows other modules' late charges for D (S10, review P2-13) |
| rates (done, additive) | rates | `PostingLine.lineKey` (stable identity: component + occurrence) and `PostingLine.occurrence` | review P0-1 root cause; existing `idempotencyKey` unchanged (`feat/integration-step` also touches rates) |

## Adoption modes and data authority

Day Close runs only where Portico is authoritative for `reservations` and `charges`: a start is refused with
`external_system_of_record` naming the system — both domains tested in `test/lifecycle-and-security.test.ts` ›
"refuses a start … in connected mode …". When only `accounting` is external, the close runs fully and requests the journal export. Owns no
data-authority domain. In non-live organizations Day Close's notification requests carry the kernel's effect mode
(`simulate`; tested for a demo organization in `test/lifecycle-and-security.test.ts` › "a demo organization closes its
day with notifications simulated, never sent"); fee collection and journal export are decided by payments and
integration under their own environment checks.

## Known gaps

- FR-1: postings in flight across the advance are detected (`posted_after_close` follow-up, report annex), not prevented.
- DCL-I04 for stays that leave before the next close needs reservations' agreement lookup (CR-18): until bound, the
  night is flagged (blocking `night_not_posted_departed`), not posted. A check-in whose event reaches Day Close only
  after the next close (worker down) is not watched.
- Late charges of other modules for a closed date are not in its annex until finance lists them by service date (CR-19).
- A schedule acts for the person who configured it, but a later loss of that person's advance permission is not
  re-checked at fire time (needs an identity lookup of another person's grants); changing the schedule needs it again.
- A blocked automatic close still bumps the run version on each re-check (claim + release); `If-Match` of a person
  acting at the same moment gets a 409 with the current version (P3-1 residual; audit rows and notifications only on
  change).
- DCL-R01 sources not aggregated yet: incomplete check-ins/check-outs, failed collection items, unresolved relocations
  and inventory conflicts, unacknowledged handovers (their modules expose no list yet); day facts omit cancellations
  (review P3-11).
- The arrival day has no package credit (night N's credit is valid the day after N; CR-5 re-scoped).
- The composition `markNoShow` property check is untested (no stays in the composed app on main, P3-7).
- Stubbed provider functions (CR-7, CR-8, CR-12); notification delivery (comms) and the readiness screen (backoffice)
  are not built — Day Close produces data and requests only.
- Report pack lacks guest ledger, cashier summary, no-show list, adjustments, paid-outs and deposits sections
  (PAR-DCL-065); report rendering/e-mail (PAR-DCL-064) not built.
- Zero-price nights: Green Tax of complimentary/house-use stays is not posted (CR-10); each such night raises
  `levy_not_posted` for finance with the amount.
- Day-use stays, reinstated no-shows, arrivals with deposit balance, scheduled room moves, fixed charges (CR-6,
  PAR-DCL-025/026/043): not handled.
- Tax change effective tomorrow (EC-DCL-016) relies on rates/finance computing by service date; no Day Close test.
- Composed-app scenarios blocked-by-binding until `feat/integration-step` merges.

## Open questions

Q43 (statistics reporting obligations: nationality) — existing. No new owner question: the no-show fee collection
default is conservative (only on the agreed guarantee; otherwise a follow-up for a person).
