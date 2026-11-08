# Agent run: Wave1: operations module

- Started: 2026-11-07T07:32:35.588Z · last activity: 2026-11-07T11:56:01.787Z
- Turns: 301 · tool uses: 523 · output tokens: 521,946
- Type: general-purpose

## Brief (2026-11-07T07:32:35.588Z)

````text
You are the engineer for Portico's **operations** module (wave 1) — housekeeping, maintenance, tasks and service delivery. It must also be offerable STANDALONE alongside an external PMS (adoption brief §2: "replace selected capabilities", housekeeping is the flagship example), so design connected mode from the start. First read the shared playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md and follow it exactly.

Your worktree: /home/user/wt/operations (branch feat/operations-core). Test DB prefix: PORTICO_TEST_DB_PREFIX=w1_operations. Module path: modules/operations (package @portico/operations, schema `operations`). Spec: /home/user/wt/product/docs/specs/operations.md (may still be in progress — re-check later; also read the reservations and inventory specs there for interfaces).

Build (provider contract in domain-map § operations):
- Unit condition (dirty, cleaning, clean, inspected, failed_inspection) separate from physical occupancy (vacant/occupied from stays; discrepancies skip/sleep/occupied-no-luggage reported by housekeeping), DND, turndown status, readiness timestamps and expected completion.
- Housekeeping tasks generated from events and day plans: departure clean, stayover service, turndown, deep clean, inspection; priorities (arrival due soon, VIP, early check-in), credits/points workload model; assignment suggestions balancing workload by section/floor/island zone (explain the suggestion); supervisor reassign.
- Inspections with checklist and pass/fail reasons; failed inspection → re-clean task + operations.inspection.failed event with the affected arriving stay (scenario s07: front desk learns before the guest reaches reception; your part = event + readiness API showing not-ready with reason + ETA).
- Generic tasks: owning department, assignee, due time, priority, status (open, in_progress, blocked, done, verified, cancelled), SLA timers and escalation path (escalate to supervisor/department head after configurable delays), comments/attachments refs, links to stays/units/guests. Service requests (guest-originated) create tasks; "done" requires the task to be done (brief §8: a message saying done is insufficient).
- Maintenance work orders: asset/location registry (units, public areas, equipment), urgency, fault category, photos (object-store refs), parts/notes, history per asset, preventive schedules generating work orders. Request out-of-order/out-of-service via an InventoryPort.blockUnit (port; fake in tests) and surface affected assignments returned by inventory as "resolution required" items for front office (scenario s08). Return-to-service requires work order completion AND a passed inspection (configurable policy).
- Lost & found registry (item, location found, finder, storage, matched guest, release/disposal with signature ref).
- OFFLINE SYNC API for the mobile staff app (scenario s13): client submits a batch of mutations each with client mutation id, client timestamp, base version; server applies idempotently (mutation id dedupe), rejects stale ones with conflict details (e.g. room was re-assigned / already inspected by supervisor), returns authoritative state + per-mutation results; never applies a stale update silently. Also a delta-pull endpoint (changes since cursor).
- Event consumers (subscriptions in composition): reservations.stay.checkedOut → unit dirty + departure task; reservations.stay.moved → tasks; inventory.unit.blocked → mark unit/tasks; reservations.booking.confirmed for arrivals planning (consume when provided).
- Data authority domains `roomStatus` and `maintenance`: in connected mode (external PMS is authority with write_mode forward) record forwarded status changes as pending until acknowledged — model it; delivery is done by the integration module later.
- HTTP routes: boards (rooms by condition/occupancy/priority with filters), task CRUD/transitions, assignments, inspections, work orders, assets, preventive schedules, lost & found, offline sync. Permissions e.g. operations.unit.read, operations.housekeeping.update, operations.housekeeping.assign, operations.housekeeping.inspect, operations.task.manage, operations.task.update, operations.maintenance.manage, operations.lostFound.manage.
- Seed helper with realistic resort sections (island zones, overwater jetty), attendants and preventive schedules (AC servicing, water villa ladder inspection).

Tests: s07, s08 (operations part), s13 offline batch with stale + duplicate mutations, escalation timing with a fixed clock, workload assignment suggestion, isolation/permissions.
````

## Follow-up message (2026-11-07T07:32:35.588Z)

````text
You are the engineer for Portico's **operations** module (wave 1) — housekeeping, maintenance, tasks and service delivery. It must also be offerable STANDALONE alongside an external PMS (adoption brief §2: "replace selected capabilities", housekeeping is the flagship example), so design connected mode from the start. First read the shared playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md and follow it exactly.

Your worktree: /home/user/wt/operations (branch feat/operations-core). Test DB prefix: PORTICO_TEST_DB_PREFIX=w1_operations. Module path: modules/operations (package @portico/operations, schema `operations`). Spec: /home/user/wt/product/docs/specs/operations.md (may still be in progress — re-check later; also read the reservations and inventory specs there for interfaces).

Build (provider contract in domain-map § operations):
- Unit condition (dirty, cleaning, clean, inspected, failed_inspection) separate from physical occupancy (vacant/occupied from stays; discrepancies skip/sleep/occupied-no-luggage reported by housekeeping), DND, turndown status, readiness timestamps and expected completion.
- Housekeeping tasks generated from events and day plans: departure clean, stayover service, turndown, deep clean, inspection; priorities (arrival due soon, VIP, early check-in), credits/points workload model; assignment suggestions balancing workload by section/floor/island zone (explain the suggestion); supervisor reassign.
- Inspections with checklist and pass/fail reasons; failed inspection → re-clean task + operations.inspection.failed event with the affected arriving stay (scenario s07: front desk learns before the guest reaches reception; your part = event + readiness API showing not-ready with reason + ETA).
- Generic tasks: owning department, assignee, due time, priority, status (open, in_progress, blocked, done, verified, cancelled), SLA timers and escalation path (escalate to supervisor/department head after configurable delays), comments/attachments refs, links to stays/units/guests. Service requests (guest-originated) create tasks; "done" requires the task to be done (brief §8: a message saying done is insufficient).
- Maintenance work orders: asset/location registry (units, public areas, equipment), urgency, fault category, photos (object-store refs), parts/notes, history per asset, preventive schedules generating work orders. Request out-of-order/out-of-service via an InventoryPort.blockUnit (port; fake in tests) and surface affected assignments returned by inventory as "resolution required" items for front office (scenario s08). Return-to-service requires work order completion AND a passed inspection (configurable policy).
- Lost & found registry (item, location found, finder, storage, matched guest, release/disposal with signature ref).
- OFFLINE SYNC API for the mobile staff app (scenario s13): client submits a batch of mutations each with client mutation id, client timestamp, base version; server applies idempotently (mutation id dedupe), rejects stale ones with conflict details (e.g. room was re-assigned / already inspected by supervisor), returns authoritative state + per-mutation results; never applies a stale update silently. Also a delta-pull endpoint (changes since cursor).
- Event consumers (subscriptions in composition): reservations.stay.checkedOut → unit dirty + departure task; reservations.stay.moved → tasks; inventory.unit.blocked → mark unit/tasks; reservations.booking.confirmed for arrivals planning (consume when provided).
- Data authority domains `roomStatus` and `maintenance`: in connected mode (external PMS is authority with write_mode forward) record forwarded status changes as pending until acknowledged — model it; delivery is done by the integration module later.
- HTTP routes: boards (rooms by condition/occupancy/priority with filters), task CRUD/transitions, assignments, inspections, work orders, assets, preventive schedules, lost & found, offline sync. Permissions e.g. operations.unit.read, operations.housekeeping.update, operations.housekeeping.assign, operations.housekeeping.inspect, operations.task.manage, operations.task.update, operations.maintenance.manage, operations.lostFound.manage.
- Seed helper with realistic resort sections (island zones, overwater jetty), attendants and preventive schedules (AC servicing, water villa ladder inspection).

Tests: s07, s08 (operations part), s13 offline batch with stale + duplicate mutations, escalation timing with a fixed clock, workload assignment suggestion, isolation/permissions.
````

## Follow-up message (2026-11-07T11:13:05.264Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue exactly where you stopped (check `git status`, your last commit and your README Checkpoint section; your uncommitted work is still in the worktree). Commit after each meaningful step. Postgres was restarted and is up. When finished, deliver your final report as originally specified.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T11:37:13.858Z)

````text
The coordinator sent a message while you were working:
Orchestrator: steward verdict on feat/operations-core — "merge after fixes": P0 2, P1 12, P2 22, P3 14. Full report: /home/user/portico/docs/orchestration/reviews/review-operations.md; reproducing tests (each asserts the defect): /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-operations-copy/modules/operations/test/review-experiments.test.ts, review-real-inventory.test.ts, review-port-check.ts — invert them into regression tests.
Fix:
- P0 stale offline update applied silently (service/sync.ts ~433-440, 464-471; domain/sync.ts ~28-41): version check FIRST; "already in this state" must not rebase a stale mutation; stale "clean"/"done" against reassigned/re-opened work must be rejected with a clear conflict.
- P0 /sync/mutations has no permission gate (routes.ts ~615): require permissions + property scope per mutation; never return records/history from other properties; conflicts list per property scope only; no guest names in task titles exposed beyond permission.
- P1 out-of-order events: use main's new `aggregateVersion` + kernel `isNewerThan` (merge main) — keep last applied version per aggregate and ignore stale events; also set aggregateVersion on your own events.
- P1 InventoryPort vs the real inventory provider: align to inventory's actual listUnits/releaseBlock shapes (read /home/user/wt/inventory/modules/inventory README "Contract changes"); per new ADR-0015 (docs/adr/0015 on main) providers won't re-check their own permission keys on port calls, but YOU must check operations permission + property scope; wrap blockUnit in withSavepoint and, when inventory refuses (already blocked, external system of record), keep the work order with the refusal reason and next step instead of rolling back.
- P1 standalone housekeeping: inbound PMS stays contract and CR-6 PMS-side edit rule are integration wave-2 items — document exactly what's missing in your README §Adoption modes (don't claim end-to-end); fix maintenance forward acknowledgement so return to service can complete.
- P1 time semantics: escalation from due/planned time, not creation; preventive due times in property time zone (use kernel zonedTimeToInstant/instantToZoned).
- Remaining P1s per report; cheap P2s; use @portico/db pgCode/withSavepoint.
Then `git merge --no-edit main` (resolve composition.ts: one block per module), lint/typecheck/tests, commit, report back briefly.

Address this before completing your current task.
````

## Report (2026-11-07T11:15:25.245Z)

````text
The operations module is built on branch `feat/operations-core` in `/home/user/wt/operations` and committed; latest commit is 0089542, a merge of current main. `pnpm lint` (including the boundary check) and `pnpm typecheck` pass. `pnpm --filter @portico/operations test` passes 90/90: 65 unit tests on the pure domain logic and 25 integration tests on a real database. `pnpm --filter @portico/api test` passes 15/15, of which 4 are new operations HTTP tests.

**What's built** (`modules/operations`, one migration):
- Unit condition kept separate from occupancy, plus discrepancies (each opens a front-office task), DND (with a welfare check after too long) and turndown.
- Arrival readiness with an estimated ready time and the reason it is not ready.
- Day plan from stays, explained workload suggestions by section and island zone, supervisor reassignment, waiting-guest priority.
- Checklist inspections; a failure re-tasks the attendant who cleaned.
- Generic tasks with escalation (not started in time, then overdue); service requests are fulfilled only when their task is done.
- Work orders, assets and preventive schedules; out-of-order goes through `InventoryPort`, and affected stays become items for the front office to resolve.
- Return to service requires the repair completed and a passed inspection (configurable).
- Lost & found, including shipping items abroad.
- Offline sync: duplicate mutations are ignored, stale ones are rejected with an explanation, a supervisor can list conflicts, and there is a changes-since-cursor feed.
- Connected mode for `roomStatus` and `maintenance`: changes forwarded to the external system stay pending until acknowledged.
- Also delivered: the record contract fields, record types, a search provider, a "My work" listing, scheduled jobs, event consumers and resort/guesthouse seeds.

**Scenarios:** s07 (failed inspection), s08 (maintenance outage), s13 (offline sync with stale, duplicate and concurrent submissions). Escalation is tested with a fixed clock, workload suggestions on the seeded resort, plus isolation and permissions.

**Ports and wiring:** the platform port is bound to the real platform module. **`InventoryPort` is bound to an `unavailable('inventory')` stub**, so out-of-order actions return 503 "nothing was changed" until you bind inventory. The demo seed is exported as `createOperationsDemoSeed(service)` but not registered in `DEMO_SEED_STEPS` yet.

**Contract changes (additive):** `getUnitCondition` returns more fields; `createTask` accepts `departmentKind` and `dedupeKey`; new `setGuestWaiting` provider; record types `task`, `service_request`, `work_order`, `asset`, `lost_found_item` and others. Operations does not declare `unit`; room-status audit entries go under `unit` so they appear on inventory's unit timeline.

**Risks:**
- Reservations' `booking.confirmed|modified` events carry only `stayIds`, so VIP, ETA and early check-in never reach housekeeping priorities. Unit and dates still arrive via `inventory.assignment.changed`. The fix is to add a `stays[]` array to those payloads.
- Role templates lack `operations.task.read`, which is the read permission for task history.
- The changes-since-cursor feed can send a row twice (by design, so nothing is ever skipped); clients must update records by version.
- Not built: minibar posting, Day Close exceptions listing, stayover frequency policy, "service later at" for DND, any UI.
- Foundation requests: none.

Everything is at most R3 (implemented and tested internally).
````

## Report (2026-11-07T11:56:01.683Z)

````text
Both P0s and the review P1s except four are fixed on `feat/operations-core` at bc8d02e, with current main merged and the composition conflicts resolved. One blocker: `pnpm lint` fails after the merge on a boundary-checker false positive in inventory's code, which I could not fix within my boundary.

**Lint blocker:** `modules/inventory/src/service/external.ts` interpolates `${input.operations.length}` inside a `sql` template. `tools/check-boundaries.mjs` reads that as a reference to the `operations` schema. The one-line fix (strip `${…}` before matching) is in `modules/operations/FOUNDATION_REQUESTS.md` (FR-1). Biome and `pnpm typecheck` pass.

**Tests:** operations 120/120 and api 28/28 pass. The new `test/review-regressions.test.ts` inverts each of your experiments (E1, E1b, E2/E2b, E3, E4, E5, E6, E8, E9, R3, R4, R5), and `test/real-inventory.test.ts` runs R1 to R5 against the real inventory provider.

**P0s:**
- **P0-1:** the offline sync version check now runs first. A mutation is a harmless no-op only when its base equals the current version, so the batch chain never jumps past a change the device didn't make.
- **P0-2:** every offline mutation is permission-checked at the property before any record is read. Records from other properties answer not-found. The batch response and delta pull only return what the caller may read; attendants see housekeeping work only. Conflicts are recorded only for authorized callers.

**P1s fixed:**
- **P1-1 (late block events):** a block mirror keyed by block id means a late `inventory.unit.blocked` never re-applies a released block.
- **P1-2 (out-of-order stay events):** stay events are guarded by `aggregateVersion`; without a version, stay status only moves forward, and booking modifications never reset it.
- **P1-3 (`InventoryPort`):** now bound to the real inventory service in composition.
  - Port shapes match the provider.
  - Calls are wrapped in `withSavepoint`; a refusal keeps the work order with the reason and next step.
  - The adapter calls inventory with system scope, because inventory on main still re-checks `inventory.block.manage` on port calls (ADR-0015).
- **P1-4 (maintenance forward):** acknowledgements now take effect for create, block and release, so return to service completes. When availability is managed externally, out-of-order is forwarded, or refused with the next step.
- **P1-7 (escalation anchor):** the acknowledgement clock starts at the later of creation and the start of the service day in property time; work with no due time has no acknowledgement step.
- **Preventive due times:** due at 23:59 property time via `zonedTimeToInstant`.
- **P1-9:** an offline "clean" for a unit occupied meanwhile applies and creates a front-office check task.
- **P1-10:** next-best ready units appear in `inspection.failed` and arrival readiness.
- **P1-12:** a block released directly in inventory is flagged on the work order as a blocking issue.
- **Own events:** unit, task and work-order events now carry `aggregateVersion`.

**P2/P3s fixed:**
- DND is cleared on checkout, and welfare checks run only for occupied units.
- Work-order completion is no longer a policy option; inspections are compared by the time they were performed.
- Offline sync results carry a `retryable` flag for transient failures.
- A "sleep" discrepancy makes the unit not ready.
- Readiness uses reservations' check-in policy when set.
- Cancellation and no-show cancel the stay's planned tasks.
- Readiness refreshes when the business date advances.
- New permission `operations.housekeeping.overrideCondition` (flagged sensitive), with a mandatory reason.
- Stay mirroring now needs `operations.external.sync`; the private time helper was replaced by the kernel one.
- Cheap P3s: GET routes for resolution items and preventive schedules, discrepancy task dedupe, audit target, `house_use` readiness code, release reason passed to inventory.

**Not fixed, documented in the README:**
- P1-5/P1-6 (inbound PMS stays, CR-6): integration wave 2. The connected PMS loop is stated as R1, not end to end.
- P1-8 composites: needs a cross-module decision. Composites are excluded from the mirror for now.
- P1-11 parity file: owned by the parity workstream; I corrected the README's claims.
- P2s left open: 5, 10, 12, 13, 18, 19, 21.

**Still needed elsewhere:** the FR-1 lint fix; inventory to drop its own permission re-check on port calls; reservations to version stay events and send `stays[]` in booking events.
````

