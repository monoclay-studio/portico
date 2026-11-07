# @portico/operations

## Checkpoint

- **Done:** module complete per the original brief, plus the steward review fixes (see *Review fixes* below).
  Green: `pnpm lint`, `pnpm typecheck`, `pnpm --filter @portico/operations test`, `pnpm --filter @portico/api test`.
- **Next steps (orchestrator / other workstreams):** bind `InventoryPort` to `@portico/inventory` in the composition
  root (shapes now match the inventory branch; run S08 against the real provider); decide the composite-unit model
  (P1-8); integration wave 2: inbound PMS stays contract + CR-6 (see *Adoption modes*); reservations to version stay
  events (`aggregateVersion`) and send `stays[]` in booking events; identity templates: `operations.task.read`.
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
| `InventoryPort` | `blockUnit`, `releaseBlock(tx, { blockId, reason? })`, `listUnits(tx, propertyId, { status? })` — shapes of the inventory branch provider (`createInventoryService`) | **`unavailable('inventory')` — orchestrator binds at merge.** Per ADR-0015 operations authorizes the user's intent (`operations.maintenance.setInventoryImpact` at the property); the provider must not re-check `inventory.block.manage` on port calls. A refusal by inventory (already blocked, past dates, external system of record, unavailable) keeps the work order with `block.status = 'refused'`, the reason and the next step (`withSavepoint`). Composite units are not mirrored. |

Provider functions (domain map; per ADR-0015 they do not re-check the caller's operations permissions — the
calling module authorizes its own action): `getUnitCondition(tx, unitId)`, `listUnitConditions(tx, { propertyId })`,
`setGuestWaiting(tx, { stayId, waiting })` (new, for reservations' waiting-guest flow),
`createTask(tx, { propertyId, departmentId?, departmentKind?, kind, title, ref?, dueAt?, priority, dedupeKey? })` on
`createOperationsService(ports)`. Also `listMyWork` (cross-module inbox), `operationsSearch`, `operationsJobs`,
`createOperationsDemoSeed(service)` (DemoSeedStep-compatible).

## Contract changes (additive)

- `getUnitCondition` returns more than `{ condition, inspectedAt, discrepancy }` (occupancy, dnd, readiness, block, provenance, pending).
- `createTask` accepts `departmentKind`, `description`, `dedupeKey` and returns `{ taskId, created }`.
- Room-status writes in forward mode are recorded as pending (`status_forwards`) — integration acknowledges via
  `acknowledgeForward` / mirrors inbound via `applyExternalRoomStatus`.
- PlatformPort `getProperty` reads `profile` (profile-dependent defaults); `getDataAuthority` also reads `availability`.
- Readiness uses reservations' policy `reservations.checkIn.requiredCondition` when it is set (one policy for one
  concept); `operations.settings.readinessCondition` is the fallback.
- Own events carry `aggregateVersion` (unit, task, work order). Consumers of `reservations.stay.*` honour the stay's
  `aggregateVersion` when present; without it, stay status only moves forward (late events never regress it).
- Spec vocabulary deviations (P2-17, to reconcile in the spec/domain map): task kinds are concrete
  (`departure_clean`, `vacant_clean`, `stayover`, `turndown`, `deep_clean`, `inspection`, `reclean`, `service_request`,
  `work_order`, `guest_commitment`, `general`) instead of `housekeeping/maintenance/follow_up/custom`; events
  `task.statusChanged` (not `task.completed|verified|cancelled`), `unit.discrepancyReported` (not
  `discrepancy.detected`), `workOrder.unitBlocked` (not `inventoryImpactChanged`); no `dnd.changed` /
  `discrepancy.resolved` events.

## Adoption modes

**Honest status (review P1-5/P1-6):** next to an external PMS, operations works today for **manual housekeeping
lists, tasks, service requests, lost & found and maintenance without out-of-order** (R3 with internal tests). The
**automatic loop** (PMS checkout → dirty → departure clean → inspection → ready in the PMS) is **not end to end yet
(R1)**. What is missing, exactly:

1. **Inbound stay contract for a mirrored PMS (integration wave 2).** Operations exposes `upsertStayProjection`
   (requires `operations.external.sync`, order-tolerant) but a connector still has no operations-owned API that
   also triggers the checkout effects (dirty + departure clean), carries source timestamps / external revision for
   idempotency, records last-sync time and yields `delayed` provenance past a freshness SLA (A03).
2. **CR-6 (Path B, Portico authoritative for room status).** `applyExternalRoomStatus` refuses inbound PMS status
   with `not_system_of_record`; the direction rules (discrepancy for a "more ready" edit, task for a "less ready"
   edit, re-send of Portico's value), CR-2 timeout → pending verification and CR-3 expected/"from" value on forwards
   are not implemented.
3. **Delivery** of `operations.statusForward.requested` to the PMS/CMMS and calling `acknowledgeForward` is the
   integration module's job (not built). Operations' side is complete: room-status and work-order forwards
   (create / block / release) become effective only on acknowledgement, and rejections are shown with reasons.

Hard dependencies: platform, identity, inventory (unit catalog via `syncUnitsFromInventory`, composites excluded).
Data authority: `roomStatus` external + `forward` ⇒ changes pending until acknowledged; `read_only` ⇒ refused with
the system name; checkout → dirty is not written by Portico when room status is external. `maintenance` external +
`forward` ⇒ work orders and OOO requests forwarded, effective on acknowledgement. `availability` external ⇒ OOO is
forwarded (forward mode) or refused with "set it in <system>" (read-only); the work order is always kept.

## Review fixes (steward review 2026-11-07)

| Finding | Fix | Regression test |
|---|---|---|
| P0-1 stale offline change applied via "no change" | version check first; no-op only when base = current; chain never advances past a server version the device did not produce | `review-regressions` E1, E1b |
| P0-2 `/sync/mutations` without authorization | per-mutation permission at the property **before any read**; foreign-property ids answer not-found; response and delta pull filtered by read permission (other departments' tasks hidden); conflicts only for authorized callers | E2/E2b, wrong-property, delta pull |
| P1-1 late `inventory.unit.blocked` re-blocks | `operations.unit_blocks` mirror keyed by block id; released blocks are never re-applied | R5 |
| P1-2 out-of-order stay events | `aggregateVersion` guard per stay + monotonic status; booking modifications never reset status | E3, E9, versioned |
| P1-3 InventoryPort ≠ provider; rollback loses work order | port shapes aligned; `withSavepoint`; refusal kept with reason + next step | R3 |
| P1-4 maintenance forward dead end | acknowledged work-order forwards apply (create/block/release); availability authority checked | E6 |
| P1-7 acknowledgement escalation on creation time | anchor = max(created, service-day start in property time); no acknowledgement step for work without a due time | E4 |
| P1-9 OPS-R22(c) | offline clean for a unit occupied meanwhile applies and creates a front-office check task | OPS-R22(c) test |
| P1-10 next-best units | `alternatives` (ready vacant units of the same type) in `operations.inspection.failed` and arrival readiness | s07 |
| P1-12 block released directly in inventory | work order flagged `releasedExternallyAt` with a blocking issue | R4 |
| P2-1/P3-1 time zones | preventive due = 23:59 property time (`zonedTimeToInstant`); private helper removed | — |
| P2-2 DND after checkout | cleared on checkout; welfare check only for occupied units | E5 |
| P2-3 completion policy / offline inspection time | completion is an invariant; inspection compared by performed (device) time | E8, domain test |
| P2-4 transient failures | sync result `retryable: true` for unexpected failures | — |
| P2-8 sleep discrepancy | not ready (`reported_occupied`) | domain test |
| P2-9 two readiness policies | reservations' `reservations.checkIn.requiredCondition` wins when set | — |
| P2-11 cancellation / no-show | unstarted in-room service of the stay cancelled | cancellation test |
| P2-14 stale readiness across business date | refreshed on `platform.property.businessDateAdvanced` | business-date test |
| P2-15 condition override | `operations.housekeeping.overrideCondition` ⚑ (or inspect) + mandatory reason to leave inspected/failed directly | override test |
| P2-16 unauthorized stay mirroring | `upsertStayProjection` requires `operations.external.sync` | — |
| P3-4/6/7/8/13 | GET routes for resolution items and schedules; discrepancy task dedupe per stay; audit target `stay`; `house_use` readiness code; release reason passed | — |

**Not fixed (documented):** P1-5/P1-6 (integration wave 2, above); P1-8 composite units (cross-module decision;
composites are excluded from the mirror and assignment events for unmirrored units are ignored, so a composite stay
occupies no operations unit yet); P1-11 parity file (owned by the parity workstream — claims corrected below);
P2-5 (conflict list lacks the device's attempted value and resolve actions), P2-10 (time-based priority rescoring),
P2-12/P2-13 (one owner for "stays affected by a block"; several blocks per unit), P2-18/P2-19 (partial MUSTs below),
P2-21 (re-send window), P3-5/P3-9/P3-10/P3-11/P3-12/P3-14.

## Parity rows evidenced by tests (for `docs/parity/operations.md`, maintained by the parity workstream)

Tested: PAR-OPS-001, 003, 004, 007, 010, 020, 024, 026, 030, 031, 044, 048, 052, 056, 060 (provider), 063
(`/operations/my-work`), 064, 066 (fake inventory), 067, 076, 084 (settings policy). EC-OPS-001 (s07), 002 (If-Match
409), 003/005 (s13), 004 (OPS-R22(c) test), 012/013 (discrepancy test), 015 (welfare check, occupied units only),
019 (s08, fake inventory), 021 (work order kept with refusal), 022 (s08), 026 (rejected forward), 031 (override with
reason), 032 (`escalation.test.ts`), 034 (domain: downtime ⇒ overdue steps fire once).
**Partial (not to be marked tested):** PAR-OPS-009 (no "service later at"), 016 (no deep clean from schedules),
047 (API board only, no "ready vs needed by hour"), 053 (links, no task checklists), 055 (per department, not per
priority), 085 (no assignment-scoped attendant rights), 086 (see *Adoption modes*), 093 (checkout, move, extension,
shortening, cancellation, no-show re-plan; tested: checkout, move, extension, cancellation). EC-OPS-017: in-progress
service tasks follow the guest to the new unit (the matrix expects them to stay) — a deliberate difference to
review with product. EC-OPS-020: OOO on an in-house unit is not refused; the stay becomes a resolution item.
Not covered: EC-OPS-008, 009, 028, 045; PAR-OPS-011, 017, 022, 027, 036/042 (UI), 040, 061, 092, 098.

## Known gaps / open questions

- Spec work-order states `reported/triaged/scheduled/on_hold` map onto task states (`open`/`blocked`); urgency
  `P1..P4` ↔ `emergency/high/normal/low`. Lost-item `returned|shipped` ↔ `released` + `releaseMethod`.
- Minibar posting (SHOULD), "service later at HH:MM", forward plan for tomorrow, sampled inspections,
  stayover frequency policy, `listExceptions` for Day Close/handover: not built.
- Monthly preventive schedules drift to the clamped day after a short month (no anchor day stored).
- Housekeeping-sample attendants in the seed have generated user ids (no sign-in).
