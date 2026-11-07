# Spec: operations

Status: Draft v1 · 2026-11-07 · Wave 1 · Schema `operations` · Prefix `OPS`

## 1. Purpose

Operations makes the physical hotel legible and the work in it accountable: what condition each unit is in,
who is cleaning or fixing what, what is late, what the guest asked for and whether it was actually done. It runs
on phones in real working conditions — wet hands, bright sun, a weak signal on a water-villa jetty — and it is
the module many hotels will adopt first, alongside their existing PMS.

## 2. Scope and non-goals

**In scope:** unit condition, physical occupancy discrepancies, do-not-disturb, housekeeping tasks (departure,
stayover, turndown, inspection, deep clean), assignments and workload, inspections, generic tasks with escalation,
service requests, guest commitments (for handover), maintenance work orders with inventory impact, assets and
preventive schedules, lost and found, offline mobile sync semantics.

**Non-goals:** availability arithmetic and unit blocks (`inventory` — operations requests blocks); stays and
check-in (`reservations`); guest conversations (`comms` — a conversation can *create* a service request);
purchasing, stock and payroll (boundary: integrate with procurement/HR systems; brief §12); laundry/linen
inventory management (LATER, via integration).

## 3. Capabilities

### 3.1 Unit condition and occupancy

- **OPS-R01** [MUST] Unit condition ∈ `dirty`, `cleaning`, `clean`, `inspected`, `failed_inspection` (glossary),
  each change recorded with actor, device, time and source (`mobile`, `desk`, `system`, `integration`). Condition
  is separate from occupancy, stay status, availability and payment status everywhere.
- **OPS-R02** [MUST] Physical occupancy is derived (`vacant`/`occupied`) from in-house stays; housekeeping reports
  discrepancies: `skip` (system says occupied, room appears vacated) and `sleep` (system says vacant, room appears
  occupied) — each creates a front-desk exception with owner until resolved.
- **OPS-R03** [MUST] Do-not-disturb with time set, optional "service later at HH:MM", and policy for repeated DND
  (e.g. welfare check after 48 h → task to duty manager).
- **OPS-R04** [MUST] Unit **readiness for arrival** = condition meets `reservations.checkIn.requiredCondition` (default
  `inspected`) ∧ no active OOO/OOS block ∧ physically vacant; exposed with an **estimated ready time** derived from
  task status and expected durations.

### 3.2 Housekeeping planning and execution

- **OPS-R05** [MUST] Daily task generation (and forward plan for tomorrow) from mirrored or Portico stays:
  departure clean (on check-out or at expected departure), stayover service per policy (daily, every n days,
  on request), turndown (profile `resort`/`hotel` default on), inspection after clean (policy: all, VIP only,
  sampled %), deep clean from schedules. Tasks carry credits/points and expected minutes per unit type and task kind.
- **OPS-R06** [MUST] Priority: early arrivals (ETA), VIP, same-day arrival assigned, guest request, late check-out;
  arrival ETA changes re-prioritize (S12).
- **OPS-R07** [MUST] Assignment: by section/zone (location path), auto-balance by points across attendants on
  shift, supervisor drag-and-drop reassignment; assignment changes notify the attendant's device.
- **OPS-R08** [MUST] Attendant mobile flow: my list in route order → start → checklist (optional) → finish /
  report issue (photo, category → maintenance or lost & found) / DND / discrepancy / minibar consumption [SHOULD,
  posts charges via finance] — each in ≤ 2 taps from the list, large targets, no typing required.
- **OPS-R09** [MUST] **Inspection**: pass → `inspected`; fail → `failed_inspection` with reasons (checklist items,
  photos) and an automatic re-clean task with priority; if the unit is assigned to a same-day arrival, the desk
  gets an immediate alert with the arrival's ETA and the next-best ready units (S07).
- **OPS-R10** [MUST] Supervisor board: units × condition, attendants' progress, late tasks against expected
  completion, arrivals waiting on units, ready count vs needed by hour.

### 3.3 Tasks, service requests and escalation

- **OPS-R11** [MUST] Task (glossary): department, kind (`housekeeping`, `inspection`, `maintenance`, `service_request`,
  `guest_commitment`, `follow_up`, `custom`), title, ref (unit/stay/booking/guest/folio/conversation), priority,
  assignee (person or department queue), due time, status, escalation path, checklist, comments, attachments.
- **OPS-R12** [MUST] Escalation rules per department and priority: not acknowledged within *a* minutes → notify
  supervisor; not done by due + *b* → escalate to manager; each escalation is an event and visible on the task.
- **OPS-R13** [MUST] **Service request**: from desk, phone, comms conversation or guest portal; creates a task for the
  responsible department; the conversation shows the task status; **"done" means the task is done** (a reply
  saying "done" does not close it); optional guest confirmation message on completion (comms).
- **OPS-R14** [MUST] **Guest commitment** tasks (promises with a due time: wake-up call, transfer rebooking,
  birthday cake) feed the shift handover until done (RES-R37).
- **OPS-R15** [MUST] `verified` status for tasks needing a second person (inspection of a guest-request fix,
  supervisor verification); policies decide which kinds require verification.

### 3.4 Maintenance

- **OPS-R16** [MUST] Work order: location (unit or area), asset (optional), category, urgency `P1..P4`, description,
  photos, reporter, assignee/team, parts notes, target time by urgency, status (§4), cost notes [SHOULD].
- **OPS-R17** [MUST] **Inventory impact**: `none | out_of_service | out_of_order` with date range; setting OOS/OOO
  calls `inventory.blockUnit` and receives affected assignments/conflicts, which are handed to reservations as
  relocation cases (S08) — the engineer sees "3 stays affected — front office notified".
- **OPS-R18** [MUST] **Return to sale** requires: work order `completed` (and `verified` if policy), and for OOO a
  housekeeping clean + inspection pass (policy `operations.returnToSale.requireInspection`, default on) before
  `inventory.releaseBlock`; the unit shows "Ready for return — awaiting inspection" until then.
- **OPS-R19** [SHOULD] Assets and preventive schedules (`operations.assets`): asset register with location, model,
  warranty; schedules by interval/usage generating work orders; history per asset and per unit.

### 3.5 Lost and found

- **OPS-R20** [MUST] Item log (description, photos, found location/unit, finder, storage location, value class),
  matching to stays/guests, guest contact via comms, status (§4), retention/disposal policy with audit.

### 3.6 Offline and sync (staff app)

- **OPS-R21** [MUST] The staff PWA keeps the attendant's/engineer's assigned work and the units they need offline;
  actions are queued with client time, device id, base versions and an idempotency key; queued actions show a
  per-item sync state and a global "n updates waiting · last synced 14:02" indicator.
- **OPS-R22** [MUST] Server applies queued actions in client order per unit, validating each against current state
  with explicit rules: (a) condition updates apply if the unit's condition has not been changed by someone else since
  the base version; otherwise the action becomes a **sync conflict** shown to the attendant and supervisor with both
  values (never silently overwritten); (b) task completion applies if the task is not cancelled/reassigned, else
  conflict; (c) a `clean` reported for a unit that became occupied meanwhile applies but raises a discrepancy;
  (d) photos/comments always apply.
- **OPS-R23** [MUST] Lists older than the freshness threshold (policy, default 5 min while offline) are labelled
  `delayed` with their age; the app never presents offline data as current (brief §16; S13, E10).

## 4. Entities and states

`unit_condition(unit_id, condition, changed_at, changed_by, source, version)` · `condition_event(...)` (append-only) ·
`dnd(unit_id, set_at, until?, service_at?)` · `discrepancy(id, unit_id, kind skip|sleep, status, resolution)` ·
`task(id, property_id, department_id, kind, ref, priority, assignee_user_id?, queue?, due_at?, status, points?,
expected_minutes?, escalation_level, version)` · `task_event(...)` · `inspection(id, unit_id, task_id, result,
reasons jsonb, photos[])` · `work_order(id, location_ref, asset_id?, category, urgency, status, impact jsonb,
block_id?, version)` · `asset(id, location_ref, kind, model, warranty_until?)` · `pm_schedule(id, asset_id,
interval, next_due)` · `lost_item(id, found_at, unit_id?, status, storage_location, retention_until)` ·
`sync_conflict(id, device_id, action jsonb, server_state jsonb, status)`.

**Unit condition:** `dirty → cleaning → clean → inspected` · `clean → failed_inspection` · `inspected →
failed_inspection` (re-inspection) · `failed_inspection → cleaning` · `clean|inspected → dirty` (occupied night
passes per policy, check-out, room move out, guest use) · `dirty → clean` (skip "cleaning" when reported directly;
allowed) · any → `dirty` by supervisor with reason.

**Task:** `open → in_progress → done → verified` · `open|in_progress → blocked → in_progress` ·
`open|in_progress|blocked → cancelled` · `done → in_progress` (reopened with reason). `verified`/`cancelled` terminal.

**Work order:** `reported → triaged → scheduled → in_progress → completed → verified` · `in_progress ⇄ on_hold`
(parts/vendor) · `reported|triaged|scheduled → cancelled`. Inventory impact may be set from `triaged` onward and is
released only via OPS-R18.

**Lost item:** `logged → stored → matched → returned | shipped` · `stored → disposed` (after retention, audited).

## 5. Invariants

- **OPS-I01** Exactly one current condition per unit; every change has a condition event (actor, source, time).
- **OPS-I02** A unit with an active OOO block from a work order is not released (`inventory.releaseBlock`) unless the
  work order is `completed` (and inspection passed when policy requires).
- **OPS-I03** A service request's status equals its task's status; it is never `done` while the task is open.
- **OPS-I04** A queued offline action is applied at most once (idempotency key) and never overwrites a newer server
  change without producing a sync conflict.
- **OPS-I05** Every overdue task with an escalation rule has escalation level ≥ the level its age requires (escalation
  job check).
- **OPS-I06** Condition, occupancy, stay status, availability and payment status are distinct fields in every API
  response that shows more than one of them.

## 6. Cross-module interactions

Provider contract (domain map): `getUnitCondition`, `listUnitConditions`, `createTask`. Calls `inventory`
(blockUnit, releaseBlock, unit catalog), `finance` (minibar postings, SHOULD), `platform`. Consumed by
`reservations` (readiness, waiting guests, commitments), `comms` (service request status), `resort`
(activity resources' maintenance), `day-close` (exceptions), `analytics`.

### Proposed contract changes

1. `createTask` input adds `kind`, `assignee?`, `checklist?`, `requiresVerification?`; new `updateTaskStatus`,
   `listTasks(tx, filters)`, `listExceptions` (common shape).
2. New `getArrivalReadiness(tx, { propertyId, unitIds })` returning condition, blocks, estimated ready time.
3. New `createWorkOrder(tx, {...})` with `inventoryImpact` for integration-sourced faults.

## 7. Events

Emitted (domain map): `operations.unit.conditionChanged`, `operations.inspection.failed`,
`operations.workOrder.created|completed`, `operations.task.escalated`. Proposed: `operations.task.created|completed|
verified|cancelled`, `operations.discrepancy.detected|resolved`, `operations.serviceRequest.completed`,
`operations.dnd.changed`, `operations.workOrder.inventoryImpactChanged`, `operations.unit.returnedToSale`,
`operations.sync.conflict`.
Consumed: `reservations.stay.checkedOut` (unit dirty + departure clean), `reservations.stay.checkedIn` (occupied;
stayover plan), `reservations.stay.moved` (old unit dirty/clean task, new unit check), `reservations.stay.extended|
shortened` (plan), `reservations.booking.cancelled` (remove planned tasks), `inventory.unit.blocked|unblocked`,
`platform.dataAuthority.changed` (`roomStatus`, `maintenance`).

## 8. Permissions

Implemented in role templates: `operations.unit.read` · `operations.housekeeping.update` · `operations.housekeeping.*` ·
`operations.task.update` · `operations.task.manage` · `operations.maintenance.*`. Defined here:
`operations.housekeeping.read` · `operations.housekeeping.update` (own tasks, condition of assigned units) ·
`operations.housekeeping.assign` · `operations.housekeeping.inspect` · `operations.housekeeping.overrideCondition` ⚑ ·
`operations.task.read` · `operations.task.update` · `operations.task.manage` · `operations.task.manageEscalation` ·
`operations.maintenance.read` · `operations.maintenance.report` · `operations.maintenance.manage` ·
`operations.maintenance.setInventoryImpact` ⚑ · `operations.maintenance.verify` · `operations.asset.manage` ·
`operations.lostFound.manage` · `operations.syncConflict.resolve`.

## 9. UX surfaces

Staff app: My work (route-ordered list with big status buttons), Unit sheet (condition, DND, issues, history),
Report issue (camera-first), Sync indicator. Back office: Housekeeping board (supervisor), Arrival readiness (shared
with front desk), Task inbox per department with escalation badges, Maintenance board (urgency × status, inventory
impact chips), Lost & found log. All color states also have text/icons (color-blind safe — research 02 §2.6).

## 10. Proof scenarios and evidence

| ID | Operations must demonstrate |
|---|---|
| S07 | Inspection fails 20 minutes before an assigned arrival's ETA: re-clean task prioritized, desk alerted with alternatives, waiting-guest ETA updated; history shows inspector, reasons, photos. |
| S08 | Work order sets OOO on 4 assigned units (AC outage): blocks created, affected stays handed to relocation; return to sale only after completion + inspection. |
| S12 (supporting) | ETA change re-prioritizes cleaning and turndown. |
| S13 / E10 | Attendant offline for 25 min updates 6 units; on reconnect 5 apply, 1 conflicts (supervisor changed it) and is shown to both; nothing silently lost or overwritten; lists were labelled `delayed`. |
| E15 | Wrong condition set by mistake corrected with history preserved. |
| A03 (adoption) | Housekeeping-only adoption alongside an external PMS: arrivals/departures mirrored; room status pushed to the PMS; a PMS outage leaves housekeeping working with `delayed` labels. |

## 11. Maldives specifics

Villas are spread across beaches and long water-villa jetties; attendants move by bicycle or buggy and connectivity
varies — offline-first is a MUST, and route order by location path matters. Resorts provide turndown; sand and salt
mean frequent deep cleans and corrosion-driven maintenance (air-conditioning, water/desalination, power). Jetty
closures put many units OOO at once. Guesthouse owners and family members do housekeeping themselves — the
guesthouse profile collapses roles (attendant + supervisor + inspector) and defaults inspection off. Lost items often
need shipping abroad (status `shipped`).

## 12. Competitive inspirations

- Mobile housekeeping with auto-assignment by section, points/workload, forward planning for tomorrow's departures,
  priority for early arrivals — Stayntouch (research 02 §4.3, §4.5).
- Mews feedback: assigning cleaners is "clunky"; color-blind-safe statuses requested (research 02 §2.6).
- Full tasks on mobile, not just status views; post-departure charges — Infor HMS (research 01 §4.2, §4.6).
- Work orders affecting sellable inventory and requiring resolution of affected reservations — owner brief §8.

## 13. Open questions

None for the owner. Product decisions: inspection required for return to sale by default; offline freshness
threshold 5 min; guesthouse profile defaults inspection off.

## 14. Adoption modes

- **Standalone alongside an external PMS:** **yes — a primary "replace selected capabilities" module**
  (housekeeping, maintenance, service requests, lost & found).
- **Hard dependencies:** `platform`, `identity`, `inventory` (unit catalog from mapping), `reservations` mirror
  (arrivals, departures, in-house, ETAs) via an `integration` PMS connector with workflow `reservations: read`
  (realtime or periodic). Without a reservation feed, operations still works for maintenance, tasks and manual
  housekeeping lists (degraded: no auto-generated departure cleans) — stated before activation.
- **Connected mode:**
  - `roomStatus` authority Portico (recommended): condition changes are written locally and pushed to the PMS by the
    connector's `roomStatus: update` workflow; push failures are integration exceptions ("PMS still shows 214 dirty —
    front desk may not check in"); the desk is told which system to trust.
  - `roomStatus` authority external with `forward`: changes are sent to the PMS and shown pending until acknowledged.
  - `maintenance` authority Portico but `availability` external: OOO/OOS from work orders are **forwarded** to the
    PMS (`inventory` forwards the block); until acknowledged the unit shows "OOO pending in <system>".
  - Minibar postings are forwarded as charges when `charges` is external.
- **Data-authority domains:** owns `roomStatus` and `maintenance` when authoritative; respects `availability`,
  `reservations`, `charges`.
- **Trial:** the hotel's yesterday replayed from copied data; attendants can try the app on copied units; nothing is
  pushed to the PMS (`integration.write` blocked in trial).
