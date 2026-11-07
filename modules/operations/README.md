# @portico/operations

## Checkpoint

- **Done:** everything listed below is implemented, committed and green: `pnpm lint`, `pnpm typecheck`,
  `pnpm --filter @portico/operations test` (unit + integration), `pnpm --filter @portico/api test`.
- **Fixed:** the intermittent s13 failure — the delta-pull cursor is a cluster-wide snapshot xmin, so a long
  transaction in *another* test database could cause rows to be re-sent (at-least-once by design); the test now
  asserts "nothing new" instead of "empty".
- **Next steps (for the orchestrator):** bind `InventoryPort` to `@portico/inventory` in the composition root;
  register `createOperationsDemoSeed(operationsService)` in `DEMO_SEED_STEPS`; align reservations/inventory event
  payloads with *Events → expected payload fields* below; add `operations.task.read` to identity role templates.
- **Known failing tests:** none.

Operations makes the physical hotel legible and the work in it accountable: unit condition and readiness,
housekeeping planning and execution, inspections, generic tasks with SLA escalation, guest service requests,
maintenance work orders with inventory impact, assets and preventive schedules, lost & found, and an offline
sync API for the staff app. It is offered **standalone** next to an external PMS (adoption brief §2,
"replace selected capabilities") — see *Adoption modes*.

Spec: `docs/specs/operations.md` (product worktree, Draft v1). Contracts: `docs/architecture/domain-map.md` §
operations.

## Capabilities (spec → status)

| Spec | Capability | Status | Evidence |
|---|---|---|---|
| OPS-R01 | Unit condition `dirty/cleaning/clean/inspected/failed_inspection`, separate from occupancy, append-only history (actor, source, client time) | R3 | `domain/conditions.test.ts`, s07, s13 |
| OPS-R02 | Physical occupancy derived from stays; `skip`/`sleep`/`occupied_no_luggage` discrepancies → front-office task with owner | R3 | `housekeeping.test.ts` (discrepancy) |
| OPS-R03 | DND (blocks in-room service tasks, releases them); welfare check after N h (policy) | R3 (no "service later at HH:MM") | `housekeeping.test.ts`, `escalation.test.ts` |
| OPS-R04 | Readiness for arrival + **estimated** ready time with explanation | R3 | s07, `conditions.test.ts` |
| OPS-R05 | Day plan: departure clean, stayover, turndown (resort/hotel default), vacant clean, arrival inspection; credits per kind/unit type | R3 (no "every n days" stayover policy, no sampled inspections, no forward plan for tomorrow beyond `date` param) | `housekeeping.test.ts`, `planning.test.ts` |
| OPS-R06 | Priority: guest waiting (`setGuestWaiting` provider / `POST /operations/stays/:id/guest-waiting`), arrival due soon (ETA), early check-in, VIP, same-day arrival; re-scored on booking events without bumping versions | R3 | `workload.test.ts`, s07 |
| OPS-R07 | Assignment suggestions balancing credits by section/island zone with explanations; supervisor apply/reassign | R3 (no device push notification) | `workload.test.ts`, `housekeeping.test.ts` |
| OPS-R08 | Attendant mobile flow (API side): start/finish/block/comment/photos/DND/discrepancy/lost & found | R3 API; UI R1 | s13 |
| OPS-R09 | Inspection pass/fail with checklist reasons & photo refs; urgent re-clean to the same attendant; `operations.inspection.failed` with the affected arrival + ETA | R3 | s07 |
| OPS-R10 | Supervisor board (condition × occupancy × priority, filters, counts) | R3 API | `housekeeping.test.ts`, HTTP test |
| OPS-R11/R15 | Tasks: department, kind, refs, priority, assignee, due, status incl. `verified`, comments/attachments | R3 | `tasks.test.ts`, isolation test |
| OPS-R12 | Escalation: acknowledgement (from creation, until started) and overdue steps per department, each step once | R3 | `escalation.test.ts` (fixed clock) |
| OPS-R13 | Service request ⇒ task; fulfilled only when the task is done | R3 | `escalation.test.ts`, HTTP test |
| OPS-R14 | Guest commitments (kind `guest_commitment`, provider `createTask`) | R3 (handover feed is reservations') | — |
| OPS-R16 | Work orders: asset/location, urgency, fault category, photos, parts, notes, target time | R3 | s08 |
| OPS-R17 | OOO/OOS via `InventoryPort.blockUnit` → front-office *resolution items* + `operations.resolution.required` | R3 (fake inventory) | s08 |
| OPS-R18 | Return to sale only after completion + (policy) cleaning + passed inspection after the repair | R3 | s08 |
| OPS-R19 | Assets, preventive schedules (interval, lead days, idempotent generation), asset history | R3 | `maintenance-lostfound.test.ts` |
| OPS-R20 | Lost & found: log, match, release (handed over / shipped with tracking + signature/receipt ref), dispose with retention | R3 | `maintenance-lostfound.test.ts` |
| OPS-R21/R22 | Offline sync: mutation-id dedupe, base versions, chains, explicit conflicts (reassigned, already inspected, blocked, stale), supervisor conflict list | R3 | s13 |
| OPS-R23 | `delayed` labelling | client-side (R1); server returns `serverTime` and cursors | — |

Readiness levels per CLAUDE.md §7: everything here is **R3 (implemented and tested internally)** at most. No
staff validation (UX) has happened; no external system was exercised (inventory is a fake in tests and
`unavailable` in the composition root until it merges).

## Invariants and the tests that prove them

| Invariant | Enforced by | Test |
|---|---|---|
| One condition per unit; every change logged (append-only) | `unit_status` row + `unit_status_log` (`core.make_append_only`) | s07 (audit), s13 (log count) |
| `inspected` only via an inspection record | `assertManualConditionChange` | `conditions.test.ts`, isolation test |
| Inspection records immutable | append-only table | s07 |
| Service request never fulfilled while its task is open | status derived in the same tx | `escalation.test.ts` |
| Return to sale needs completion + passed inspection after it (policy) | `checkReturnToService` | `inspection.test.ts`, s08 |
| Offline mutation applied at most once; stale never applied silently | `sync_mutations` PK claimed in the effect's tx; version checks | s13 (retry, concurrent duplicate) |
| Escalation steps fire once; time-derived updates never bump versions | `evaluateEscalation`; no version bump | `escalation.test.ts` |
| Business-keyed tasks are unique (no duplicate departure clean on event redelivery) | `unique (tenant_id, dedupe_key)` | `housekeeping.test.ts` |
| Delta pull never skips a committed change | `feed_xid` (writer xid) ≥ reader's snapshot xmin | s13 (pagination + cursor) |
| Tenant isolation | RLS forced on every table + permission checks | `isolation-permissions.test.ts`, HTTP test |

## Scenarios

| Test | Demonstrates |
|---|---|
| `test/scenario-s07-failed-inspection.test.ts` | Checkout → departure clean → suggestion → clean → **failed inspection** → re-clean to the same attendant, event with affected arrival + ETA, readiness not-ready with reason → re-clean → pass → ready |
| `test/scenario-s08-maintenance-outage.test.ts` | Jetty water outage: 3 work orders block 3 villas, resolution items for exactly the affected stays, idempotent inventory event, return-to-service gated, relaxed policy by configuration, permission for inventory impact |
| `test/scenario-s13-offline-sync.test.ts` | Offline batch: chained applies, `task_reassigned`, `unit_already_inspected`, dependent skip, retry ⇒ duplicates only, id reuse refused, stale conflict, supervisor conflict list, delta pull, concurrent duplicate submission, pagination |

## Permissions

`operations.unit.read`, `operations.housekeeping.read` (alias), `operations.unit.configure`,
`operations.housekeeping.update|assign|inspect`, `operations.task.read|update|manage`,
`operations.maintenance.report|read|manage`, `operations.maintenance.setInventoryImpact` ⚑, `operations.asset.manage`,
`operations.lostFound.manage`, `operations.syncConflict.resolve`, `operations.external.sync` ⚑ (integration
connectors). Attendants with `task.update` work only on their own (or unassigned) tasks; `task.manage` covers it.
**Identity follow-up:** role templates should add `operations.task.read` (front desk, attendants, engineers —
used as the record-history read permission) and `operations.maintenance.report` + `operations.housekeeping.update`
is enough for attendants to log lost & found.

## Events

Emitted: `operations.unit.conditionChanged`, `operations.unit.discrepancyReported`, `operations.inspection.passed|failed`,
`operations.task.created|statusChanged|assigned|escalated`, `operations.serviceRequest.created|completed`,
`operations.workOrder.created|unitBlocked|completed|returnedToService`, `operations.resolution.required`,
`operations.statusForward.requested|acknowledged|rejected`, `operations.sync.conflict`, `operations.arrival.guestWaiting`.

Consumed (`operations.stays`, `operations.unitBlocks` consumers): `reservations.booking.confirmed|modified|cancelled`,
`reservations.stay.checkedIn|checkedOut|moved|noShow|extended|shortened`, `inventory.unit.blocked|unblocked`,
`inventory.assignment.changed` (unit + nights of a stay). Expected payload
fields (tolerant Zod, unknown fields ignored): booking events `{ bookingId, stays: [{ stayId, unitId?, arrival,
departure, status?, vip?, earlyCheckIn?, eta?, guestProfileId?, guestLabel? }] }`; stay events `{ stayId, unitId?,
arrival?, departure? }`; moved `{ stayId, fromUnitId?, toUnitId, effectiveDate? }`; blocked `{ unitId, blockId, kind,
nights, reason?, affectedAssignments[], sourceRef? }`.

**Checked against the sibling worktrees (2026-11-07):** inventory's `unit.blocked` and `assignment.changed` and
reservations' `checkedOut`, `moved` (`fromUnitId/toUnitId`) and `extended/shortened` (`to: { arrival, departure }`)
match. **Gap:** reservations' `booking.confirmed|modified` currently carries only `stayIds`, so VIP, ETA, early
check-in and guest label do not reach housekeeping priorities; operations still learns each stay's unit and dates from
`inventory.assignment.changed`. Contract ask: add `stays: [{ stayId, unitId?, arrival, departure, vip?, earlyCheckIn?,
eta?, guestLabel? }]` to those payloads (additive), or call `setGuestWaiting`/a future `updateArrivalDetails` provider.

## Ports and bindings

| Port | Needs | Binding in `apps/api/src/composition.ts` |
|---|---|---|
| `PlatformPort` | property facts (system-scope read), `assertWritable`, `getDataAuthority`, `resolvePolicy`, departments | bound to `@portico/platform` |
| `InventoryPort` | `blockUnit`, `releaseBlock`, `listUnits` | **`unavailable('inventory')` — orchestrator binds at merge** |

Provider functions (domain map): `getUnitCondition(tx, unitId)`, `listUnitConditions(tx, { propertyId })`,
`setGuestWaiting(tx, { stayId, waiting })` (new, for reservations' waiting-guest flow),
`createTask(tx, { propertyId, departmentId?, departmentKind?, kind, title, ref?, dueAt?, priority, dedupeKey? })` on
`createOperationsService(ports)`. Also `listMyWork` (cross-module inbox), `operationsSearch`, `operationsJobs`,
`createOperationsDemoSeed(service)` (DemoSeedStep-compatible).

## Contract changes (additive)

- `getUnitCondition` returns more than `{ condition, inspectedAt, discrepancy }` (occupancy, dnd, readiness, block, provenance, pending).
- `createTask` accepts `departmentKind`, `description`, `dedupeKey` and returns `{ taskId, created }`.
- Room-status writes in forward mode are recorded as pending (`status_forwards`) — integration acknowledges via
  `acknowledgeForward` / mirrors inbound via `applyExternalRoomStatus`.
- PlatformPort `getProperty` reads `profile` (profile-dependent defaults).

## Adoption modes

Standalone next to an external PMS: yes. Hard dependencies: platform, identity, inventory (unit catalog — via
`syncUnitsFromInventory` or `upsertUnits` from integration mappings). Stays arrive as events (from reservations or
an integration mirror) into `stay_projection`; without a feed, maintenance, tasks and manual housekeeping still work.
Data authority: `roomStatus` external + `forward` ⇒ changes pending until acknowledged; `read_only` ⇒ refused with the
system name; Portico-originated system changes (checkout → dirty) are not written when room status is external.
`maintenance` external + `forward` ⇒ work orders and OOO requests forwarded, inventory not touched.

## Parity rows evidenced by tests (for `docs/parity/operations.md`, maintained by the parity workstream)

PAR-OPS-001, 003 (`readinessCondition` policy), 004, 007, 009 (welfare check; no "service later"), 010, 016 (deep
clean manual/preventive only), 020, 024, 026, 030, 031, 044, 047 (API), 048, 052, 053, 055, 056, 060 (provider),
063 (`/operations/my-work`), 064, 066, 067, 076, 084 (settings policy), 085, 086, 093 (check-out, move, extension,
shortening, cancellation). EC-OPS-001 (s07), 002 (If-Match 409), 003/005 (s13), 012/013 (discrepancy test),
015 (DND welfare), 017 (room move), 019/020 (s08), 021 (HTTP test: inventory failure ⇒ nothing created), 022 (s08),
026 (rejected forward), 031 (manual dirty with history), 032 (`escalation.test.ts`), 034 (domain test: downtime ⇒
all overdue steps fire once). Not covered: EC-OPS-004, 008, 009, 028, 045; PAR-OPS-011 (business-date driven
stayover once per night is via the day plan, no Day Close hook), 017, 022, 027 (device push), 036/042 (UI), 040
(photo routing UI), 061 (handover is reservations'), 092 (Day Close `listExceptions` not built), 098.

## Known gaps / open questions

- Spec work-order states `reported/triaged/scheduled/on_hold` map onto task states (`open`/`blocked`); urgency
  `P1..P4` ↔ `emergency/high/normal/low`. Lost-item `returned|shipped` ↔ `released` + `releaseMethod`.
- OPS-R22(c) (clean reported for a unit that became occupied ⇒ apply + discrepancy) not implemented.
- Minibar posting (SHOULD), "service later at HH:MM", forward plan for tomorrow, sampled inspections,
  stayover frequency policy, `listExceptions` for Day Close/handover: not built.
- Monthly preventive schedules drift to the clamped day after a short month (no anchor day stored).
- Housekeeping-sample attendants in the seed have generated user ids (no sign-in).
