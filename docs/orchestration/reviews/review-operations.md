# Steward review: `feat/operations-core` (module `operations`)

Reviewer: architecture steward · 2026-11-07 · worktree `/home/user/wt/operations` @ `0089542` (not modified)
Experiments were run in a scratch copy at `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-operations-copy`, with `PORTICO_TEST_DB_PREFIX=review_operations`.

## Verdict: **merge after fixes** (blocking: both P0s and P1-1 to P1-9)

The module is large, careful and well tested on the happy paths. The pure domain code, RLS, If-Match and Idempotency-Key handling, per-mutation dedupe and the xmin-based delta feed are solid.

But two things in the core offline-sync path fail under attack:
- The S13 promise "never silently overwritten" (OPS-I04) can be broken.
- `/sync/mutations` has no authorization gate.

Housekeeping next to an external PMS (the flagship standalone mode) does **not** work end to end yet:
- There is no inbound stay contract.
- The real inventory refuses out-of-order (OOO) blocks when availability is external.
- Maintenance forward mode never becomes effective.
- CR-6 is not implemented.

Severity counts: **P0 2 · P1 12 · P2 22 · P3 14**

## Command results

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` (worktree) | pass |
| `pnpm lint` | pass. Biome: 149 files. Boundaries OK (3 modules). |
| `pnpm typecheck` | pass. The turbo cache was hit, so I re-ran `tsc --noEmit` uncached for operations and api: pass. |
| `pnpm --filter @portico/operations test` | pass: 15 files, **90 tests** |
| `pnpm --filter @portico/api test` | pass: 4 files, 15 tests |
| Merge with `main@9363f2d` (merge-tree, archived to a scratch dir) | Merges cleanly. Lint, typecheck (9/9 uncached), operations 90/90, api 5 files/16 tests (incl. the new permission-catalog test), db 12/12: all pass. |
| Merge with `main@c2bf70c` (guests merged during this review) | **CONFLICT in `apps/api/src/composition.ts`.** Trivial: one block per module. |
| Parity gate (`node tools/parity-report.mjs --gate operations`, run with `/home/user/wt/parity-ops/docs/parity/operations.md` copied in) | **FAIL.** 98 capabilities, 1% tested; 48 edge cases, 0% tested; 61 P0 rows open; 38 P1 rows missing. |
| Real inventory bound to `InventoryPort` (type check, `test/review-port-check.ts`) | **FAIL**: TS2322 on `releaseBlock` (returns `UnitBlock`, port expects `void`) and on `listUnits` (signature and shape). |
| Review experiments: `test/review-experiments.test.ts` (11) and `test/review-real-inventory.test.ts` (5) in the scratch copy | 16/16 pass. Each test asserts the defective behaviour, so a pass means the defect exists. Details below. |

**Experiments (all in the scratch copy):**
- **E1**: the "no change" shortcut lets a stale offline base through. Result: a stale "clean" overwrites a re-clean that is in progress after a failed inspection. Results were `applied, applied`.
- **E1b**: the same mechanism lets a stale "done" complete a task that was reassigned to someone else and started by them.
- **E2**: a user with **no operations permission** submits a batch. Result: `applied` (no change) plus the full unit and task records (task title "Call Mr Rasheed…").
- **E2b**: the same user gets a recorded `conflict`. The result includes the unit's change history (who and when), and the entry appears on the property's supervisor conflict list.
- **E3**: `booking.modified` (the additive payload the README asks reservations to send) resets an in-house stay to `expected`. The unit becomes `vacant` and ready, and the stay is listed again in today's arrivals.
- **E4**: a day plan for **tomorrow** escalates "not acknowledged" to the supervisor 16 minutes after planning.
- **E5**: DND survives checkout. 49 hours later a welfare-check task is created for the **vacant** unit.
- **E6**: maintenance external·forward. Acknowledging the create and block forwards leaves the work order `pending_forward` forever, and return to service is refused.
- **E7**: two devices submit concurrently on the same unit with the same base. Result: exactly one `applied` and one `conflict`. This is a correct result.
- **E8**: with `requireCleaning=false`, an offline inspection made **before** the repair (synced after it) satisfies "passed inspection after the repair". The block is released.
- **E9**: `stay.checkedIn` delivered after `stay.checkedOut` leaves the vacated unit `occupied`.
- **R1** (real inventory): an engineer with every operations permission cannot set OOO (`forbidden: inventory.block.manage`). The whole command rolls back, so the fault report is lost.
- **R2** (real inventory): availability external·forward. Result: `forwarding_not_available`, and the work order is not created.
- **R3** (real inventory): a second work order on an already-blocked unit fails with `unit_already_blocked`.
- **R4** (real inventory): a release done directly in inventory leaves the work order `block: active`, `awaiting_completion`, while inventory shows the block `released`. The OPS-I02 gate is bypassed.
- **R5** (real inventory): after a correct return to service, the outbox then delivers `inventory.unit.blocked` and `inventory.unit.unblocked`. The unit ends **out of order again** in operations (`ready: false`).

What I could **not** break: concurrent duplicate submission of the same mutation id (the PK claim serializes it correctly), concurrent conflicting devices (E7), and delta-feed pagination and xmin cursors.

## Findings (ranked)

### P0

| id | where | problem | why it matters | fix |
|---|---|---|---|---|
| P0-1 | `service/sync.ts:433-440` (unit), `:464-471` (task); `domain/sync.ts:28-41` | The "no change" shortcut runs **before** the version check. It returns `applied` with `resultVersion = current server version`. `BatchChain.resolve` then moves the chain base for every later mutation of the same record to that server version, which absorbs all foreign changes in between. Proven by E1 and E1b. | Violates OPS-I04, the core S13 promise. A stale offline change overwrites newer server state with no conflict: a failed inspection's re-clean is silently set to `clean`, and with the guesthouse profile (`readinessCondition: clean`) the unit becomes ready. A reassigned task is completed by the old assignee. | Do the version comparison first. Treat a mutation as "no change" only when `base === current`. When the base is stale, return the conflict explanation (it already says `unit_already_inspected`). Never advance the chain past a version the client did not produce. Add E1/E1b as regression tests. |
| P0-2 | `routes.ts:615-620`, `service/sync.ts:72-158, 429-459` | `/sync/mutations` has no permission check for `input.propertyId`. The version and no-change checks run **before** the service's `requirePermission`. The final read returns every touched unit and task (`unitView`/`taskView`) with no read check, filtered only by the client-supplied `propertyId`. Conflicts are recorded and emitted (`operations.sync.conflict`) for unauthorized callers. Proven by E2 and E2b. | Authorization bypass inside an organization: any authenticated user, even one with no operations grant or a grant on another property, can read a unit or task by id (guest names in titles, readiness, stays) and its change history with staff names. They can also inject fake conflicts into any property's supervisor list. Property scope is a hard boundary for groups and owners (CLAUDE.md §6: deny by default). | Add `requireAny(tx, [housekeeping.update, task.update, task.manage, housekeeping.inspect, lostFound.manage], propertyId)` per mutation, before any state read. Authorize each op before explaining a conflict. Filter the response records by read permission. Add a test with a no-permission user and a wrong-property user. |

### P1

| id | where | problem | why it matters | fix |
|---|---|---|---|---|
| P1-1 | `service/maintenance.ts:748-768`, `events.ts:429-459`; `core.claim_deliveries` gives no ordering guarantee | `mirrorUnitBlock` is idempotent only on the *current* `block_id`. A late `inventory.unit.blocked` delivered after the block was released (or after `unblocked`) re-applies it. Proven by R5: the normal return-to-service flow leaves the unit out of order in operations. | A repaired villa stays "out of order, not ready" on the board, arrival readiness, day plan and in `listUnitConditions` (reservations reads this). No error is raised. | Keep a block mirror keyed by `block_id` with status. Ignore `blocked` events for released blocks. Alternatively, re-read inventory (`getBlock`) before mirroring. Add an out-of-order delivery test. |
| P1-2 | `events.ts:131-157` (line 144), `187-202`, `205-218`; `service/units.ts:1119-1133` | Stay projection status is overwritten by whatever event arrives last. `booking.modified` without `status` resets in-house and departed stays to `expected` (E3). `checkedIn` after `checkedOut` makes the unit occupied again (E9). | Readiness shows ready while a guest is inside. A departed stay reappears as today's arrival. Latent today (reservations sends only `stayIds`), but the README's own contract ask triggers it. | Make projection transitions monotonic (`expected → in_house → departed`; cancelled and no_show are terminal), or order by an event or source version per stay. Never default `status` on modification events. |
| P1-3 | `ports.ts:46-69` vs inventory branch `service.ts:99-104,195-199`, `blocks.ts:201-...` | `InventoryPort` does not match the real provider. See *InventoryPort contract* below, and R1 to R3. | Binding at merge either fails to compile or fails at runtime in the S08 flow, and the failure loses the whole work order. | Agree the contract (a provider facade or adapter) and fix permission delegation (see *InventoryPort contract*). Run S08 against the real inventory before closing the TODO in composition. |
| P1-4 | `service/maintenance.ts:625-690`, `service/units.ts:1280-1309` | Maintenance connected mode is a dead end. Acknowledging a `work_order` forward only marks the forward row: `acknowledgeForward` handles only `target_type === 'unit'`. The work order stays `pending_forward`, the block stays `pending_forward`, and `returnToService` refuses with `no_active_block` (E6). The case maintenance=portico with availability=external (spec §14: "OOO forwarded… shows 'OOO pending in <system>'") calls `inventory.blockUnit`, which the real inventory refuses (R2). | Spec §14 and ADR-0014 forward semantics are not met. A CMMS- or PMS-connected property can never complete the flow. | Apply acknowledged `work_order` forwards (create → effective; block → active with the external ref; release → released). Check `availability` authority in `requestUnitBlock` and record a pending forward (or agree that inventory forwards it). Test ack and reject. |
| P1-5 | `events.ts` (stays only from `reservations.*`), `service/index.ts:54` (`upsertStayProjection` exposed with no route and no authz) | **Standalone next to an external PMS does not work end to end.** There is no inbound contract for a mirrored PMS's arrivals and departures. `upsertStayProjection` exists, but it creates no departure clean and sets no dirty on checkout (only the `reservations.stay.checkedOut` handler does). It has no permission check, no source timestamp or ordering, and no last-sync/`delayed` freshness for A03. An integration connector would have to impersonate `reservations.*` events. | The flagship "replace selected capabilities" module (adoption brief §2; spec §14 A03) cannot run its core loop of checkout → dirty → departure clean → inspection with an external PMS. | Add an operations-owned inbound API, for example `applyExternalStayEvent` or `mirrorStays`, under `operations.external.sync`. It should have source timestamps, idempotency by external id and revision, `external` provenance with last-sync, and a freshness SLA that yields `delayed`. Reuse the same handlers as the reservations events. |
| P1-6 | `service/units.ts:1335-1350` | CR-6 is not implemented. When Portico is the authority for `roomStatus` (Path B, the recommended mode), any inbound PMS status is refused with `not_system_of_record`. No discrepancy is raised for a "more ready" edit, no request or task is created for a "less ready" edit, and Portico does not re-send its value. ST-05 and ST-06 are unmet. CR-2 timeout to "pending verification" (ST-03) and CR-3 precondition (the forward carries no expected or "from" value) are also missing. | Path B silently diverges from the PMS copy that reception still sees. | Implement the CR-6 direction rules in `applyExternalRoomStatus`. Add `expected`/`from` to forward payloads, and add a pending-verification state with a timeout. |
| P1-7 | `service/tasks.ts:187`, `domain/settings.ts:87-93`, `domain/escalation.ts:24-30` | Acknowledgement escalation is anchored on `created_at` for every task, including day-plan housekeeping tasks with no due time and **future service dates**. Tomorrow's plan escalates today (E4). Preventive work orders generated `leadDays` ahead escalate on day 0. With the default config, every task in a 07:00 plan escalates at 07:15 unless started. | False escalations to supervisors and department heads (OPS-R12), which erodes trust in alerts. A time-zone and business-date error. | Anchor acknowledgement steps to `max(created_at, service window start)`, using the property's local service date via the kernel's `zonedTimeToInstant`. Skip acknowledgement steps for planned housekeeping work, or give housekeeping its own default path. |
| P1-8 | inventory `contracts.ts:196-218` (`isComposite`, `componentUnitIds`) vs operations' unit mirror and stay projection | Operations has no composite-unit concept. `listUnits` returns composite units, and `inventory.assignment.changed` carries the composite `unitId`. If composites are mirrored, operations treats the virtual combined villa as a cleanable unit and marks it occupied, while its physical component villas look vacant and get vacant cleans. If they are filtered out, stays on composites have no unit. | Wrong housekeeping state for Maldives connecting or 2-bedroom villas. PAR-OPS-034 is listed as missing. | Decide the model: occupancy and condition per component, with tasks on the components. Map composite assignments to their components in the projection, and exclude composites from the catalog mirror. |
| P1-9 | `service/sync.ts`, `test/scenario-s13-offline-sync.test.ts` | OPS-R22(c) is missing (a MUST): a "clean" reported for a unit that became occupied should apply **and** raise a discrepancy. The README admits it. EC-OPS-004 is P0 in parity. | S13/E10 behaviour is incomplete. | Implement it and add a test. |
| P1-10 | `domain/records.ts`, `events.ts:inspection.failed` payload | OPS-R09 (MUST) asks for the desk alert to include the **next-best ready units**. Only the affected arrival, ETA and expected-ready time are sent. `alternatives` in the workload code are alternative *attendants*. | The S07 "desk alerted with alternatives" requirement is not demonstrated. | Compute ready vacant units of the same unit type for the arrival's nights, then include them in the event and in arrival readiness. |
| P1-11 | `/home/user/wt/parity-ops/docs/parity/operations.md` | The parity gate fails: 61 P0 rows open, 0 rows marked tested. The README lists rows it claims are evidenced, but several claims are wrong (see *Scenario and parity claims*). | CLAUDE.md §7: the module is not complete until the gate passes. | Update the Status and Test columns only where a test proves the row. Fix or remove the false claims. |
| P1-12 | `service/maintenance.ts:1126-1166` with inventory `releaseBlock` HTTP route | OPS-I02 is enforced only inside operations. Inventory lets anyone with `inventory.block.manage` release a block whose `sourceRef` is a work order (R4). Operations then shows an inconsistent work order (`block active`, `awaiting_completion`) and does not flag it. | A unit can return to sale before the repair and inspection. | Inventory should refuse releasing a block that operations owns unless the origin is operations, or operations should own the release command. At minimum, operations should consume `unblocked` and raise a blocking issue on the work order. |

### P2

| id | where | problem | fix |
|---|---|---|---|
| P2-1 | `service/maintenance.ts:1359` | Preventive work orders are due at ``${dueOn}T23:59:00Z``, which is UTC, not property-local. In the Maldives that is 04:59 the next local day, and overdue escalation then fires around 05:00 to 05:30 local. | `zonedTimeToInstant(dueOn, '23:59', tz)` (kernel, on main). |
| P2-2 | `events.ts:205-270`, `service/tasks.ts:1041-1067` | Checkout does not clear DND. The welfare check queries every DND unit regardless of occupancy (E5). The next guest inherits DND-blocked service. | Clear DND on checkout or room-move-out with a log entry. Run the welfare check only for occupied units. |
| P2-3 | `domain/settings.ts:96`, `domain/inspection.ts:131-141`; `service/inspections.ts:335` | (a) `requireWorkOrderCompletion` is a policy, but OPS-I02 is an invariant. (b) "Inspection after the repair" compares the server `inspected_at`, so an offline inspection made before the repair counts when `requireCleaning=false` or `roomStatus` is external (E8). | Make completion unconditional. Compare with the clamped `client_inspected_at`, or reject offline inspections whose client time predates completion. |
| P2-4 | `service/sync.ts:98-113` | Unexpected failures (deadlock or serialization between concurrent device batches, DB errors) are reported as `status: 'rejected'`, the status for permanent refusals, with no retryable flag. A client that follows the contract drops the change (for example, a lost & found item). | Add `retry`/`failed_transient` (or `retryable: true`) to the result contract. |
| P2-5 | `service/sync.ts:744-780`; table `sync_mutations` | The supervisor conflict list does not include the device's attempted value (spec: "with both values"). It has no resolve or acknowledge action, despite the permission being named `operations.syncConflict.resolve`. The list grows forever (`limit 200`). | Store the mutation payload (non-PII fields) and add resolve actions (accept the device value with the current base, or dismiss). |
| P2-6 | `service/sync.ts:638-700` | Delta pull checks only `unit.read` but returns **all** property tasks: front office, management welfare checks, guest service requests. | Filter tasks by task-read permission, department and assignment. |
| P2-7 | `domain/records.ts:58-148` | `allowedActions` ignore data authority. With `roomStatus` read_only, "Mark clean", "Mark dirty" and similar are enabled (ST-01 says no control is shown and the text names the system). Forward mode is not labelled as a request. | Pass the authority into the facets, then disable with the system name or relabel as "Request … (pending in X)". |
| P2-8 | `domain/conditions.ts:155-158` | Readiness uses system occupancy only. A `sleep` discrepancy (housekeeping found someone in the unit) still yields ready (OPS-R04 says "physically vacant"). | Treat an open `sleep` or `occupied_no_luggage` discrepancy as not ready, with its reason. |
| P2-9 | `domain/settings.ts:28,69` vs reservations `reservations.checkIn.requiredCondition` | There are two policies for one concept. OPS-R04 says readiness uses the **reservations** policy, but operations has its own `readinessCondition`. The board can say ready while check-in refuses, or the reverse. | Read the reservations policy key, or move the key to platform as one shared policy. |
| P2-10 | `service/tasks.ts:287-325` | Priority is time-derived ("arrival due soon" within 180 min) but is rescored only on events. A 07:00 task for a 14:00 ETA never becomes `arrival_due_soon` at 11:00. | Rescore periodically in the escalation job without bumping versions. |
| P2-11 | `events.ts:159-185` | Cancellation and no-show do not cancel planned turndown, stayover or inspection tasks (spec §7: "remove planned tasks"). There are no tests for cancelled, noShow or shortened events. | Cancel unstarted tasks of the stay with a reason, and add tests. |
| P2-12 | `resolution_items` (operations) vs inventory `UnitBlock.outstandingAssignments` and inventory conflicts | Two modules model "stays affected by a block". Operations' items never auto-close when the stay is moved (no consumer of `assignment.changed` for them). | One owner. If operations keeps it, close items on `inventory.assignment.changed` or `reservations.stay.moved` away from the unit. |
| P2-13 | `unit_status.block_*` (one slot) | Only one block is mirrored per unit. A future block (OOS next week) overwrites the current one. Releasing either can leave a wrong mirror. Combined with R3, a second fault on a blocked unit cannot be expressed. | Use a block mirror table, and attach a second work order to the existing block instead of failing. |
| P2-14 | `service/units.ts:841-866` | `listUnitConditions` (read by reservations) returns *stored* readiness. Nothing refreshes it when the business date advances (`platform.property.businessDateAdvanced` is not consumed), so future-dated blocks become active without readiness changing. | Compute it fresh (as `getUnitCondition` does) or refresh it on date advance. |
| P2-15 | `service/units.ts:676-700`; manifest | `housekeeping.update` can change **any** unit at the property (spec: own tasks or assigned units). There is no `operations.housekeeping.overrideCondition` ⚑: attendants can do `inspected → dirty` and `failed_inspection → clean` without a reason. `task.manageEscalation` and `maintenance.verify` are not registered. | Scope to assigned units or tasks, and add the override permission with a mandatory reason. |
| P2-16 | `service/index.ts:37-41, 54`; `service/units.ts:822-866` | Service entry points without authorization: `upsertStayProjection`, `getUnitCondition` and `listUnitConditions` (the last two are documented as "caller authorizes"). | Require `operations.external.sync` on stay mirroring. Document the provider exemption in the README contract changes. |
| P2-17 | Spec OPS-R11, §7, domain-map `createTask` | Contract drift that is not listed under "Contract changes". Task kinds are `departure_clean/…/general` rather than spec `housekeeping/maintenance/follow_up/custom`. Event names differ from spec proposals: `task.statusChanged` vs `task.completed/verified/cancelled`, `unit.discrepancyReported` vs `discrepancy.detected`, `workOrder.unitBlocked` vs `workOrder.inventoryImpactChanged`, and there is no `dnd.changed` or `discrepancy.resolved`. | Align, or record the deviations in the README and request a domain-map or spec update. |
| P2-18 | OPS-R05, R06, R07, R10, R12, R15 | Partial MUSTs: no forward plan for tomorrow (the `date` param uses *today's* condition and occupancy), no every-n-days stayover, no sampled or VIP inspection policy, no deep clean from schedules, no late-checkout priority, no device notification, no per-priority escalation, no verification policy, and no board "ready vs needed by hour" or attendant progress. | Implement, or downgrade the readiness rows to partial in the README. |
| P2-19 | OPS-R03 | "Service later at HH:MM" is missing (MUST). | Implement it with a property-local time via `zonedTimeToInstant`. |
| P2-20 | README "Parity rows evidenced" | Claims contradicted by code or tests. EC-OPS-021: the expected behaviour is "work order saved with impact pending", but the test proves "nothing created". EC-OPS-020: no refusal of OOO on an in-house stay exists. EC-OPS-017: in-progress tasks *are* moved to the new unit, while the expected behaviour keeps them on the old one. PAR-OPS-093 includes cancellation, which is not implemented or tested. PAR-OPS-009, 016, 047, 055, 085 and 086 are partial. | Correct the claims. |
| P2-21 | `service/sync.ts` delta cursor | At-least-once with a cluster-wide xmin means one long write transaction anywhere (Day Close, an import, another tenant) makes every pull re-send everything written since. That is heavy on 2G jetties. | Accept for now, but add a per-table high-water mark plus a bounded re-send window, and document it. |
| P2-22 | `events.ts` onMoved and resolution logic | No coverage for a stay moved while its old unit is being cleaned. | Add a test, consistent with EC-OPS-017. |

### P3

| id | problem |
|---|---|
| P3-1 | `service/internal.ts:68-90`: the private `localTimeToInstant` makes a single offset pass, so it is wrong around DST transitions. main now has kernel `zonedTimeToInstant`; use it. |
| P3-2 | `service/internal.ts:399` `pgUniqueViolation` and the raw `savepoint` in `service/sync.ts:267,276` duplicate main's new shared `pgCode`, `pgConstraint` and `withSavepoint` (9363f2d). |
| P3-3 | `service/housekeeping.ts:292-300`: the day plan sets `turndown='pending'` with no `unit_status_log` entry or version bump. |
| P3-4 | Manifest record routes `/operations/resolution-items/:id` and `/operations/preventive-schedules/:id` have no GET handlers. |
| P3-5 | `service/internal.ts:225` and `domain/records.ts:335`: owner `{ id: 'housekeeping' }` or `departmentKind` is used as a department id when no department exists. |
| P3-6 | `service/units.ts:656`: the discrepancy task dedupe key includes the timestamp, so repeated reports create several tasks. |
| P3-7 | `service/tasks.ts:1297`: the `setGuestWaiting` audit target type is `unit` with a stay id when the stay has no unit. |
| P3-8 | `domain/conditions.ts:147`: a `house_use` block is reported with the readiness code `out_of_order`. |
| P3-9 | `service/inspections.ts`: an inspection can pass a `dirty` unit straight to `inspected` (not a spec transition). |
| P3-10 | `property_directory`/`job_properties()` exposes every (tenant, property) pair to the app role, and the escalation job opens a transaction per property every minute. Inventory instead routes only tenants with due work. Converge on one core routing helper. |
| P3-11 | `apps/api/src/composition.ts`: job errors go to `console.error` with `String(err)` rather than the redacting logger. |
| P3-12 | `upsertAttendant` is an upsert over a create endpoint, with no If-Match on update. |
| P3-13 | `service/maintenance.ts:1166`: `releaseBlock` is called without a `reason`, so the inventory audit shows none. `sourceRef` type `work_order` vs inventory's documented `workOrder`: agree one EntityRef type vocabulary. |
| P3-14 | `unit_status_log` does not record the device id (OPS-R01 says "actor, device, time, source"). The device id is only in `sync_mutations`. |

## Focus areas

### (a) Offline sync (s13)
- **Duplicate application under concurrency:** I could not cause one. `sync_mutations` PK `(tenant_id, client_mutation_id)` is claimed in the effect's transaction. A concurrent duplicate waits, then replays the stored outcome. Mutation-id reuse by another actor or with another payload is refused. Concurrent devices on the same base serialize to one apply and one conflict (E7).
- **Stale silent apply:** reproduced (P0-1).
- **Authorization gap:** reproduced (P0-2).
- **Remaining issues:** a transient failure is reported as permanent (P2-4). Conflicts lack both values and a resolve action (P2-5). OPS-R22(c) is missing (P1-9). The pull over-exposes tasks (P2-6).
- **Delta feed:** sound. Every update path stamps `feed_xid`, the cursor is the snapshot xmin, and pagination keeps per-table positions. The cost is re-sends (P2-21).

### (b) Condition, occupancy and availability; return to service
- **Separation:** good. The fields are separate (`condition`, `occupancy`, `observedOccupancy`, `discrepancy`, `block`), and the records expose separate status families.
- **Gaps:** readiness ignores observed occupancy (P2-8). Readiness policy duplicates reservations' policy (P2-9). Stored readiness goes stale across the business date (P2-14). There is one block slot (P2-13).
- **Return to service:** correct on the happy path with the fake inventory. It fails with a zombie block after normal event delivery (P1-1), can be bypassed through inventory (P1-12), and is weakened by a configurable completion requirement and server-time inspection comparison (P2-3).

### (c) Connected mode and standalone
- **roomStatus forward mode (Path A):** works inside operations: changes stay pending until acknowledged, read_only refuses with the system name, and inbound updates are mirrored with `external` provenance.
- **Path B (Portico authoritative):** CR-6 is missing (P1-6).
- **Maintenance forward:** never becomes effective (P1-4). With the real inventory, availability external blocks OOO entirely (R2).
- **Stays:** there is no inbound feed for a mirrored PMS (P1-5).
- **Judgement:** housekeeping next to an external PMS works today only for manual housekeeping lists, tasks and maintenance without OOO. The core automatic loop (checkout → dirty → departure clean → inspection → ready) cannot run against an external PMS. The README's "Standalone next to an external PMS: yes" is an overclaim; state it as R1/R2 for the connected loop.

### (d) Escalation, time zones and business dates
- **Sound:** step timing math (UTC durations, fire once, catch-up after downtime) and business-date usage in the day plan and lost & found.
- **Wrong:**
  - The acknowledgement anchor ignores the service date (P1-7).
  - The preventive due time uses UTC end of day (P2-1).
  - The private zoned-time helper mishandles DST (P3-1).
  - Time-derived priority is never refreshed (P2-10).
  - Escalation is per department only, not per priority (P2-18).

### (e) InventoryPort contract vs the inventory branch provider (`/home/user/wt/inventory/modules/inventory`)
1. **`listUnits` signature:** the port is `listUnits(tx, { propertyId })`. The provider is `listUnits(tx, propertyId, filter?: { unitTypeId?, status? })`. This is TS2322.
2. **`listUnits` result shape:** the port expects `{ id, number, unitTypeId: string|null, unitTypeCode: string|null, locationPath: string|null, features, active: boolean }`. The provider returns `Unit`:
   - `unitTypeCode` is absent (needs `listUnitTypes`).
   - `location` is `{ building, floor, zone }`, not `locationPath`.
   - It has `status: active|inactive|retired` plus `inInventoryFrom/To`, not `active`.
   - It also includes composite units (`isComposite`, `componentUnitIds`) that operations cannot represent (P1-8).
3. **`releaseBlock`:** the port returns `Promise<void>`; the provider returns `Promise<UnitBlock>` (TS2322). The provider accepts `reason?` and `expectedVersion?`, which operations never passes.
4. **`blockUnit` types:** compatible. The provider returns a superset: `block` and `conflictsCreated`, plus `unitId` and `viaCompositeUnitId` per affected assignment.
5. **`blockUnit` runtime semantics operations does not handle:**
   - It requires **`inventory.block.manage`** (and `houseUse.create`) on the acting user, so an operations engineer is refused (R1).
   - It refuses with `forwarding_not_available` (availability forward, R2) or `external_system_of_record` (read_only).
   - It refuses overlapping blocks with `unit_already_blocked` (R3).
   - It refuses `block_in_past` (from < business date), `block_component_units` and `unit_not_active`.
   - In every case the whole operations command rolls back, including the work order.
6. **Release:** inventory releases from `max(block start, business date)` and keeps past nights as history. Operations clears its whole mirror; this is acceptable.
7. **Events:** `inventory.unit.blocked`, `unit.unblocked` and `assignment.changed` payloads match the README. Ordering is not guaranteed, and the consumers are not order-tolerant (P1-1, P1-2).
8. **Who owns relocation:** inventory creates "inventory conflicts" for oversold nights and exposes live `outstandingAssignments`. Operations creates its own `resolution_items` (P2-12).

## Spec coverage summary

- **Fully met MUSTs:** OPS-R01 (except device on the log), R02, R13, R14 (provider), R16, R20, R21 (server side). Invariants I01, I03, I05 and I06 hold.
- **Partial MUSTs:**
  - R03: no "service later", and DND is not cleared on checkout.
  - R04: separate policy; ignores observed occupancy.
  - R05: forward plan, cadence, sampling and deep clean missing.
  - R06: late checkout missing, no time-based rescoring.
  - R07: no device notification, no shift.
  - R08: API only, no minibar (SHOULD).
  - R09: no next-best units.
  - R10: partial board.
  - R11: kinds vocabulary differs, no task checklist.
  - R12: no per-priority rules, wrong anchor.
  - R15: no verification policy.
  - R17: fake inventory only; with the real one, a permission and standalone mismatch.
  - R18 and I02: configurable, bypassable, zombie mirror.
  - R22: (c) missing; (a) and (b) broken by P0-1.
  - I04: violated (P0-1).
- **Not built (README admits):** R23 client labelling (server gives `serverTime`); minibar.
- **Spec §6 proposals not built:** `getArrivalReadiness`, `createWorkOrder` provider, `listExceptions`.
- **Spec §7 consumers not built:** `platform.dataAuthority.changed`.

## Scenario and parity claims

| Scenario | Assessment |
|---|---|
| **S07** (`scenario-s07-failed-inspection.test.ts`) | Good demonstration of re-clean to the same attendant, the event with arrival and ETA, not-ready with reasons and an estimate, and history. **Missing:** "desk alerted with alternatives" (P1-10). |
| **S08** | Demonstrates blocks, resolution items, gated return and relaxed policy against a **fake** inventory that never refuses. With the real inventory it fails at the permission (R1). In standalone mode it fails entirely (R2). Return to service then zombies (R5). At most R3 for "operations logic with a fake", not end to end. |
| **S13** | Good coverage of chains, dedupe, the concurrent duplicate and pagination. **But** P0-1 shows the "never silently overwritten" claim is false for no-change chains. "6 units, 5 apply, 1 conflict" is not literally exercised. `delayed` labelling is client-side (R1). |
| **A03** (spec §10) | Not demonstrated (P1-5). |
| **Parity rows** | See P2-20. EC-OPS-021, 020 and 017, and the cancellation part of PAR-OPS-093, are false claims. |

**Important rows missing from the parity matrix:**

Capabilities:
- Supervisor resolution of offline sync conflicts with both values (P0).
- Make-up-room (MUR) request flag from guest, portal or in-room panel, distinct from DND (P1).
- Expected departure time and late check-out per stay driving departure-clean timing and priority (P1).
- Escalation delivery and on-shift routing (push or WhatsApp, quiet hours) (P1).
- Room-status and minibar updates by telephone/PBX codes, as OPERA does through its property interface (P1/P2).
- OOO/OOS statistics by reason (days lost) (P2).
- IoT or occupancy sensors feeding discrepancies (P2).
- Health & safety incident log (P2).

Edge cases:
- Late or out-of-order delivery of stay and block events (P0).
- An offline chain whose first change is already true on the server (P0).
- A block released directly in inventory, bypassing return to service (P0).
- Booking modified during an in-house stay (P0).
- A sync batch from a user without permission or for another property (P0).
- Guest leaves DND on at checkout (P1).
- Second fault on an already-blocked unit (P1).
- Composite or connecting unit stays (P1).
- Future-dated tasks must not escalate before their service date (P1).
- Authority switch with pending forwards (P1).
- A unit inactivated or retired in inventory while it has open tasks (P2).

## Cross-module notes for the orchestrator

1. **Inventory contract (P1-3, P1-8, P1-12, P2-12).** Decide:
   - (a) how operations' authority to block is expressed: delegated permission, or inventory trusting an operations origin;
   - (b) whether inventory or operations forwards OOO when availability is external;
   - (c) how to handle overlapping blocks from several work orders;
   - (d) the composite model;
   - (e) who owns "stays affected by a block";
   - (f) that inventory refuses releasing work-order-owned blocks.

   Write the adapter in composition (shape mapping as in `test/review-real-inventory.test.ts`) and run S08 against the real inventory.
2. **Reservations.** Agree the booking event payload, but **only after P1-2 is fixed**: status must never be defaulted on modification. Also agree:
   - one readiness policy key (P2-9);
   - the waiting-guest provider (`setGuestWaiting`);
   - the `createTask` kind vocabulary, since reservations' port uses `kind: string` (P2-17).
3. **Integration.** Operations needs an operations-owned inbound stay and room-status contract and CR-6 handling (P1-5, P1-6) before "housekeeping alongside a PMS" can be offered. The integration worktree must deliver `operations.statusForward.requested` and call `acknowledgeForward`, including for work orders (P1-4).
4. **Event ordering is a platform-wide problem.** `core.claim_deliveries` gives no per-aggregate order, and failed deliveries retry later. Every consumer that projects state (operations stays and blocks, and likely others) must be order-tolerant. Consider adding an `occurred_at`/aggregate-version guard helper in `@portico/db`.
5. **Shared code.** After merging main:
   - Replace `localTimeToInstant` with kernel `zonedTimeToInstant`.
   - Replace `pgUniqueViolation` and the raw savepoints with `pgCode`/`withSavepoint`.
   - Converge on one job-routing approach (operations' `property_directory` vs inventory's `tenants_with_due_expiries`).
6. **Identity templates** should add `operations.task.read`. Engineers will also need `inventory.block.manage` unless P1-3(a) is decided otherwise.
7. **Merge mechanics.** Rebase onto current main. The `apps/api/src/composition.ts` conflict comes from the guests merge.

Evidence files (scratch copy, not committed):
- `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-operations-copy/modules/operations/test/review-experiments.test.ts`: E1 to E9, E2b
- `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-operations-copy/modules/operations/test/review-real-inventory.test.ts`: R1 to R5; the inventory branch module was copied in as a workspace package
- `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-operations-copy/modules/operations/test/review-port-check.ts` and `tsconfig.review.json`: the port type check
