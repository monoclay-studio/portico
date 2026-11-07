# Parity matrix and edge cases: operations

Module: `operations` (housekeeping, unit condition, tasks, service requests, maintenance, lost & found, staff mobile).
Spec: `docs/specs/operations.md` (Draft v1); related specs written since: `guest-services.md` (cases, luggage,
minibar), `workforce.md` (labour standards, rosters), `utilities.md` (meters), `guest-experience.md` (lost-item
claims). Researched 2026-11-07 by the parity-ops researcher; **statuses updated 2026-11-07 against `modules/operations`
on `main`** (README checkpoint: complete per the original brief plus steward review fixes; no known failing tests).

**Test column:** paths are relative to `modules/operations/` unless they start with `apps/` or `modules/`. A row is
`tested` only when a named test on `main` proves the behavior in the row; `building` means part of the row is built and
tested and the "partial:" note says what is still missing; `built` means implemented without a test that proves it.
Everything here is at most readiness R3 (implemented and tested internally): no staff validation, no external system
exercised, staff app UI not built.

**Baseline:** OPERA Cloud 26.3 User Guide (Room Management, Task Sheets, Miscellaneous, Inventory Administration).
**Modern additions:** Mews (Operations app, space status), Stayntouch (mobile housekeeping, auto-assign). Market terms
appear in the evidence column; Portico terms (glossary) in the capability column — e.g. OPERA *room status* = Portico
*unit condition*, OPERA *task sheet* = Portico *housekeeping assignment*, OPERA *Track It* = Portico *lost & found /
item tracking*, OPERA *Log It* = Portico *handover*.

**Reading the status:** `specified` = the spec requirement named in the Spec column covers the row; `missing` = no
spec covers it (see `gaps-ops.md` for the change request); `different` = deliberately handled another way, reason in
the spec named. Priorities: P0 compete/pilot, P1 full-service/resort expectation, P2 differentiator/rare.
**Evidence:** links are listed under *Sources*; a source marked "search-located" was found by web search but its host
blocks direct fetches from this environment — facts resting only on such sources are unverified.

## Capabilities

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-OPS-001 | Unit condition states (dirty, cleaning, clean, inspected, failed inspection) kept separate from occupancy, stay status and availability | OPERA [room status codes][op-rm] · Mews [space status report][mews-spacestatus] · verified 2026-11-07 | P0 | tested | operations.md OPS-R01, OPS-I06 | src/domain/conditions.test.ts (manual changes, readiness); test/housekeeping.test.ts (board counts by condition and occupancy, never merged) |
| PAR-OPS-002 | Optional "touch-up / pickup" condition between dirty and clean for quick refresh of a vacant clean unit | OPERA [pickup status][op-rm] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-OPS-003 | Policy: which condition makes a unit ready for check-in (clean vs inspected), per property | OPERA [inspected status control][op-rm] · Mews [inspect before check-in][mews-changestatus] · verified 2026-11-07 | P0 | tested | operations.md OPS-R04; reservations.md RES-R24 | src/domain/conditions.test.ts "clean is enough when the property requires only clean"; reservations' `reservations.checkIn.requiredCondition` wins when set (README P2-9) |
| PAR-OPS-004 | Every condition change recorded with actor, device, source and time; history viewable per unit | OPERA [status change log][op-vacantrules] · Mews [reason on status change][mews-changestatus] · verified 2026-11-07 | P0 | tested | operations.md OPS-R01, OPS-I01 | test/scenario-s07-failed-inspection.test.ts (audit trail per unit); test/scenario-s13-offline-sync.test.ts (unit_status_log, device id, client time) |
| PAR-OPS-005 | Supervisor override of condition with mandatory reason and separate permission | Mews [change status with reason][mews-changestatus] · verified 2026-11-07 | P1 | tested | operations.md §4 (any → dirty with reason), §8 overrideCondition | test/review-regressions.test.ts "leaving an inspection result directly needs inspect/override permission and a reason" |
| PAR-OPS-006 | Bulk condition change for many units at once (multi-select on board and mobile) | Mews [bulk status change][mews-changestatus] · OPERA [Housekeeping Board][op-hkboard] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-OPS-007 | Skip and sleep discrepancies reported by housekeeping, each an exception the desk must resolve | OPERA [room discrepancies][op-discrep] · verified 2026-11-07 | P0 | tested | operations.md OPS-R02 | test/housekeeping.test.ts "housekeeping-reported discrepancies become a front-office exception with an owner"; src/domain/conditions.test.ts (sleep → not ready) |
| PAR-OPS-008 | Person discrepancy: occupant count found differs from the stay (affects per-person taxes such as Green Tax) | OPERA [person discrepancy][op-discrep] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-OPS-009 | Do-not-disturb with time set, "service later at" time and repeated-DND welfare check | OPERA [DND in task priority][op-autoprio] · verified 2026-11-07 | P0 | building | operations.md OPS-R03 | test/escalation.test.ts (DND welfare check); test/housekeeping.test.ts (DND blocks in-room service) — partial: no "service later at" time |
| PAR-OPS-010 | Arrival readiness per unit with estimated ready time, shared with the front desk | OPERA [ETA-based priority][op-autoprio] · Stayntouch [early-arrival priority][snt-hk] · verified 2026-11-07 (Stayntouch search-located, unverified) | P0 | tested | operations.md OPS-R04 | test/scenario-s07-failed-inspection.test.ts (arrival readiness with ETA, reasons, alternatives); src/domain/conditions.test.ts (estimates) |
| PAR-OPS-011 | Overnight occupied units become due for stayover service once per night (business-date driven, idempotent) | OPERA [end-of-day room status update][op-vacantrules] · verified 2026-11-07 | P0 | specified | operations.md §4 unit condition transitions | — |
| PAR-OPS-012 | Vacant-unit decay rules (vacant N days → dirty/touch-up; water-flush tasks against Legionella) | OPERA [vacant room status rules][op-vacantrules] · Mews [Legionella status][mews-spacestatus] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-OPS-013 | Unit hold flags independent of condition (hold for VIP, show unit, renovation pending) | OPERA [room conditions][op-roomcond] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-OPS-014 | Site map / floor plan view of unit condition (villas along beaches and jetties) | OPERA [floor plans][op-floorplan] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-OPS-015 | Housekeeping status report, printable and exportable, by condition, section, floor | OPERA [hk_allstatus report][op-hkreport] · Mews [space status report][mews-spacestatus] · verified 2026-11-07 | P1 | specified | analytics.md ANL-R05; operations.md OPS-R10 | — |
| PAR-OPS-016 | Daily generation of departure, stayover, turndown, inspection and deep-clean tasks | OPERA [generate task sheets][op-gentask] · Stayntouch [task sheets][snt-tasksheets] · verified 2026-11-07 (Stayntouch search-located, unverified) | P0 | building | operations.md OPS-R05 | src/domain/planning.test.ts; test/housekeeping.test.ts (departure, stayover, vacant, turndown, arrival inspection) — partial: no deep-clean generation from schedules |
| PAR-OPS-017 | Stayover frequency policy (daily, every n days, on request) and linen/towel change cadence per unit type | OPERA [housekeeping task scheduling][op-hktasksched] · verified 2026-11-07 | P0 | specified | operations.md OPS-R05 (cadence per unit type to add — see gaps) | — |
| PAR-OPS-018 | Guest-preferred cleaning time and room instructions per stay or per day, shown on the attendant's list | OPERA [reservation housekeeping schedule][op-hksched] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-OPS-019 | Turndown included/excluded per stay (not only per property profile) | OPERA [turndown per reservation][op-hksched] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-OPS-020 | Workload credits/points per task kind and unit type, with credit rules | OPERA [scheduled task credit rules][op-taskcredit] · Stayntouch [points][snt-hk] · verified 2026-11-07 (Stayntouch search-located, unverified) | P0 | tested | operations.md OPS-R05 | src/domain/workload.test.ts (credit load per attendant); test/housekeeping.test.ts (credits per kind and unit type in suggestions) |
| PAR-OPS-021 | Supplies/amenity list per task kind (what to bring to the unit) | OPERA [task supplies][op-tasksupplies] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-OPS-022 | Forward plan for tomorrow's departures and stayovers | OPERA [forecasting housekeeping][op-hkforecast] · Stayntouch [forward assignment][snt-hk] · verified 2026-11-07 (Stayntouch search-located, unverified) | P0 | building | operations.md OPS-R05 | — partial: `generateDayPlan` accepts a `date`, no forward view or test for tomorrow |
| PAR-OPS-023 | Labour forecast: credits and attendants needed per day for the next 7–14 days | OPERA [forecasting housekeeping][op-hkforecast] · verified 2026-11-07 | P1 | specified | workforce.md WFM-R04 (labour standards → attendant hours, labelled estimate) | — |
| PAR-OPS-024 | Sections and section groups (location path: island → beach/jetty → villa) | OPERA [housekeeping sections][op-hksections] · verified 2026-11-07 | P0 | tested | operations.md OPS-R07 | test/housekeeping.test.ts (seeded sections SUNRISE/SUNSET/LAGOON/JETTY); src/domain/workload.test.ts (island zones) |
| PAR-OPS-025 | Attendant profile: default section, shift, maximum credits, skills (e.g. turndown only) | OPERA [attendant information][op-attendants] · verified 2026-11-07 | P1 | building | operations.md OPS-R07 (home sections, capacity); workforce.md WFM-R05, WFM-R16 (rosters, qualifications) | src/domain/workload.test.ts (home section, daily credit capacity, nobody on duty) — partial: no shift or skills on the attendant |
| PAR-OPS-026 | Auto-assignment balancing credits across attendants on shift by section | OPERA [generate task sheets][op-gentask] · Stayntouch [auto-assign settings][snt-hkcfg] · verified 2026-11-07 (Stayntouch search-located, unverified) | P0 | tested | operations.md OPS-R07 | src/domain/workload.test.ts (balance, capacity, priority first, deterministic); test/housekeeping.test.ts (suggest + apply, stale suggestion → conflict) |
| PAR-OPS-027 | Supervisor drag-and-drop reassignment with instant notification to the attendant's device | Mews [assign spaces][mews-assignhk] · verified 2026-11-07 | P0 | building | operations.md OPS-R07 | test/housekeeping.test.ts (reassign with reason, history) — partial: no device push notification; board UI not built |
| PAR-OPS-028 | Re-running generation preserves manual changes and completed work (never silently overwrites a plan) | OPERA [re-generation overrides previous set][op-gentask] (anti-pattern) · verified 2026-11-07 | P1 | built | — | test/housekeeping.test.ts (re-running the plan creates nothing new; tasks unique by business key) — not yet tested after manual reassignments |
| PAR-OPS-029 | Saved generation templates (e.g. "low season, 4 attendants") | OPERA [task sheet templates][op-gentask] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-OPS-030 | Automatic priority order: waiting guest, VIP + ETA within the hour, arrivals, stayovers, due-outs, DND last | OPERA [task companion auto-priority][op-autoprio] · verified 2026-11-07 | P0 | tested | operations.md OPS-R06 | src/domain/workload.test.ts "housekeeping priority" (arrival due soon, VIP, early check-in, waiting guest); DND tasks blocked (test/housekeeping.test.ts) |
| PAR-OPS-031 | Waiting-guest queue: a guest waiting for a unit raises its priority and alerts the attendant and supervisor | OPERA [reservation queue][op-queue] · verified 2026-11-07 | P0 | building | operations.md OPS-R06, OPS-R10 | test/scenario-s07-failed-inspection.test.ts (waiting guest → urgent, no version bump; `operations.arrival.guestWaiting` event) — partial: no alert delivered to attendant or supervisor devices |
| PAR-OPS-032 | Guest automatically told (SMS/WhatsApp/portal) when their unit becomes ready | Mews [guest portal][mews-portal] · assumption for "room ready" message · verified 2026-11-07 | P1 | missing | — | — |
| PAR-OPS-033 | Route-ordered work list by location (bicycle/buggy routes along jetties) | assumption (Maldives island layout) | P1 | building | operations.md OPS-R08, §11 | src/domain/workload.test.ts "uses island zones and route compactness" — partial: no route-ordered list in the staff app |
| PAR-OPS-034 | Composite and connecting units cleaned as one assignment with per-component condition | assumption (follows INV composite units) | P1 | missing | — | — |
| PAR-OPS-035 | Paper fallback: printable task sheets per attendant for outages and paper-based teams | OPERA [task sheet reports][op-taskrep] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-OPS-036 | Attendant mobile list: start, finish, report issue, DND, discrepancy in ≤ 2 taps, no typing | OPERA [task sheet companion][op-taskcomp] · Mews [Operations app][mews-opsapp] · Stayntouch [task management][snt-hktask] · verified 2026-11-07 (Stayntouch search-located, unverified) | P0 | building | operations.md OPS-R08 | test/scenario-s13-offline-sync.test.ts (start/finish/block/comment/photo API) — partial: staff app UI not built (R1) |
| PAR-OPS-037 | Optional checklist per task kind with photo evidence on selected items | Stayntouch [task management][snt-hktask] · search-located 2026-11-07, unverified | P1 | building | operations.md OPS-R08, OPS-R11 | src/domain/inspection.test.ts (inspection checklists with photo refs) — partial: no checklists on other task kinds |
| PAR-OPS-038 | Time per unit captured (start/finish) and compared with expected minutes | OPERA [attendant console][op-attcon] · verified 2026-11-07 | P1 | building | operations.md OPS-R05, OPS-R10 | src/domain/conditions.test.ts (remaining-minutes estimate from start time) — partial: no actual-vs-expected report |
| PAR-OPS-039 | Attendant progress console: % complete, credits done, late tasks | OPERA [attendant console][op-attcon] · verified 2026-11-07 | P1 | specified | operations.md OPS-R10 | — |
| PAR-OPS-040 | Report a fault or found item from the unit with photo, routed to maintenance or lost & found | OPERA [mobile maintenance][op-maint] · verified 2026-11-07 | P0 | building | operations.md OPS-R08 | test/isolation-permissions.test.ts (attendant logs a lost item); test/scenario-s13-offline-sync.test.ts (attachments) — partial: no one-step "report fault from this unit" flow tested |
| PAR-OPS-041 | Minibar consumption posted from the attendant's phone to the stay's folio | Stayntouch [mobile minibar posting][snt-hk] · search-located 2026-11-07, unverified | P1 | specified | operations.md OPS-R08 [SHOULD]; guest-services.md GSV-R21 (journey SCR-32 moves posting there) | — |
| PAR-OPS-042 | Offline-first staff app with queued actions, per-item sync state and `delayed` freshness labels | Mews [Operations app][mews-opsapp] (online) · Stayntouch [mobile HK][snt-hk] (online) · verified 2026-11-07 (Stayntouch search-located, unverified) | P0 | building | operations.md OPS-R21–R23 | test/scenario-s13-offline-sync.test.ts; test/review-regressions.test.ts E1/E1b/E2 (server side of queued actions) — partial: offline staff app and `delayed` labels not built |
| PAR-OPS-043 | Staff app in the attendant's own language (Bengali, Nepali, Sinhala, Tamil, Hindi, Dhivehi RTL) | assumption (Maldives resort workforce) | P1 | missing | ux-principles.md §14 (English first) | — |
| PAR-OPS-044 | Inspection pass/fail with checklist reasons and photos; failure creates a priority re-clean | Mews [inspected status][mews-changestatus] · OPERA [inspected status][op-rm] · verified 2026-11-07 | P0 | tested | operations.md OPS-R09 | test/scenario-s07-failed-inspection.test.ts; src/domain/inspection.test.ts |
| PAR-OPS-045 | Inspection policy: all units, VIP only, or sampled percentage | assumption | P1 | building | operations.md OPS-R05 | test/scenario-s08-maintenance-outage.test.ts (inspection policy by configuration) — partial: no VIP-only or sampled inspection policy |
| PAR-OPS-046 | Quality scores per attendant from inspections over time | assumption | P2 | missing | — | — |
| PAR-OPS-047 | Supervisor board: units × condition, attendant progress, arrivals waiting, ready vs needed by hour | OPERA [Housekeeping Board][op-hkboard] · verified 2026-11-07 | P0 | building | operations.md OPS-R10 | test/housekeeping.test.ts; apps/api/test/operations.test.ts (board API) — partial: API only; no "ready vs needed by hour" |
| PAR-OPS-048 | Guesthouse mode: owner does cleaning, inspection off, one-screen list | assumption (Maldives guesthouses) | P0 | tested | operations.md §11 | test/housekeeping.test.ts "demo seed … for a resort and a guesthouse"; test/scenario-s08-maintenance-outage.test.ts (guesthouse relaxed policy) |
| PAR-OPS-049 | Public-area and back-of-house cleaning rounds (lobby, pool, jetty, restaurant) scheduled like unit tasks | assumption | P1 | missing | — | — |
| PAR-OPS-050 | Linen and laundry par levels and counts | assumption | P2 | deferred | operations.md §2 (LATER via integration / stock module, D12) | — |
| PAR-OPS-051 | Linen-reuse opt-in (guest declines stayover service) reducing tasks, recorded per stay | assumption (sustainability) | P2 | missing | — | — |
| PAR-OPS-052 | Generic task: department, kind, reference, priority, assignee or queue, due, checklist, comments, attachments | OPERA [traces][op-traces] · Mews [tasks][mews-opsapp] · verified 2026-11-07 | P0 | tested | operations.md OPS-R11 | src/domain/tasks.test.ts; test/isolation-permissions.test.ts; apps/api/test/operations.test.ts |
| PAR-OPS-053 | Task linked to any record (unit, stay, booking, guest, folio, conversation) and visible on it | OPERA [traces][op-traces] · verified 2026-11-07 | P0 | building | operations.md OPS-R11 | test/maintenance-lostfound.test.ts (links on records) — partial: links shown on the task, not yet on every referenced record |
| PAR-OPS-054 | Future-dated and recurring tasks (daily pool chemistry, weekly generator test, monthly fire drill) | OPERA [future-dated Log It entries][op-logit] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-OPS-055 | Escalation rules per department and priority (not acknowledged → supervisor; overdue → manager) | assumption | P0 | building | operations.md OPS-R12, OPS-I05 | src/domain/escalation.test.ts; test/escalation.test.ts (per department, fixed clock) — partial: not configurable per priority |
| PAR-OPS-056 | Service request with code, priority, origin (desk, phone, conversation, portal); done only when the task is done | OPERA [service requests][op-svcreq] · [request codes][op-svcreqcodes] · [priorities][op-svcprio] · verified 2026-11-07 | P0 | tested | operations.md OPS-R13, OPS-I03 | test/escalation.test.ts "a service request is fulfilled only when its task is done"; apps/api/test/operations.test.ts (idempotent create, search, history) |
| PAR-OPS-057 | Request catalogue (extra towels, pillow menu, baby cot) with default department, expected time and guest-visible name | OPERA [service request codes][op-svcreqcodes] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-OPS-058 | Resolved → followed-up → closed lifecycle for incidents and complaints | OPERA [service requests follow-up][op-svcreq] · verified 2026-11-07 | P1 | building | operations.md OPS-R13, OPS-R15 | src/domain/tasks.test.ts (`verified` state, reasons for reopen) — partial: no follow-up/closed stage for incidents and complaints |
| PAR-OPS-059 | Complaint and service-recovery record with compensation (linked folio adjustment) and follow-up owner | OPERA [service requests: complaints][op-svcreq] · [profile service requests][op-profsvc] · verified 2026-11-07 | P1 | specified | guest-services.md GSV-R08, GSV-R09 (cases and compensation) | — |
| PAR-OPS-060 | Guest commitments (wake-up call, cake on day 3, transfer rebooking) with due time feeding handover | OPERA [reservation traces][op-traces] · verified 2026-11-07 | P0 | built | operations.md OPS-R14 | — provider `createTask` (kind `guest_commitment`) built; no dedicated test; handover feed is reservations' (RES-R37) |
| PAR-OPS-061 | Department log book and shift handover with acknowledgement | OPERA [Log It][op-logit] · verified 2026-11-07 | P0 | building | reservations.md RES-R37 | modules/reservations/test/front-desk-handover.test.ts (front-office handover publish/acknowledge/persist) — partial: no department log book for housekeeping or engineering |
| PAR-OPS-062 | Second-person verification for selected task kinds | assumption | P1 | tested | operations.md OPS-R15 | test/isolation-permissions.test.ts "attendants work their own tasks; supervisors verify, inspect and reassign"; src/domain/tasks.test.ts |
| PAR-OPS-063 | Department task inbox with SLA badges and saved views ("unassigned", "overdue") | assumption | P0 | building | operations.md §9 | test/housekeeping.test.ts, test/maintenance-lostfound.test.ts (`listMyWork` per department); src/domain/escalation.test.ts (SLA state) — partial: no saved views |
| PAR-OPS-064 | Work order: location or asset, category, urgency, photos, reporter, assignee, target time | OPERA [maintenance requests][op-maint] · [maintenance codes][op-maintcodes] · verified 2026-11-07 | P0 | tested | operations.md OPS-R16 | test/scenario-s08-maintenance-outage.test.ts |
| PAR-OPS-065 | Assign work orders by trade/skill (AC, plumbing, electrical, carpentry, marine) | OPERA [assign by skills][op-maint] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-OPS-066 | Work order sets out-of-order/out-of-service with dates and reasons; affected stays handed to relocation | OPERA [out of order][op-ooo] · [out of service][op-oos] · [reasons][op-oooreasons] · verified 2026-11-07 | P0 | tested | operations.md OPS-R17 | test/scenario-s08-maintenance-outage.test.ts; test/real-inventory.test.ts (real inventory provider: block, refusal, forward) |
| PAR-OPS-067 | Return to sale only after completion (and verification) plus clean + inspection | OPERA [out of order return status][op-ooo] · verified 2026-11-07 | P0 | tested | operations.md OPS-R18, OPS-I02 | test/scenario-s08-maintenance-outage.test.ts; src/domain/inspection.test.ts; test/review-regressions.test.ts E8 |
| PAR-OPS-068 | Bulk out-of-order by location (whole jetty or wing) as one previewed action | assumption (Maldives jetty closures) | P1 | missing | operations.md §11 (mentions, no requirement) | — |
| PAR-OPS-069 | Parts used and cost notes per work order | OPERA [maintenance requests][op-maint] · verified 2026-11-07 | P1 | tested | operations.md OPS-R16 | test/scenario-s08-maintenance-outage.test.ts (parts on the work order) |
| PAR-OPS-070 | External contractor work orders (vendor, quote, cost, warranty claim) | assumption | P2 | missing | — | — |
| PAR-OPS-071 | Asset register (location, model, serial, warranty) with history per asset and per unit | assumption | P1 | tested | operations.md OPS-R19 [SHOULD] | test/maintenance-lostfound.test.ts "generates due work orders once per asset … asset history" |
| PAR-OPS-072 | Preventive maintenance schedules by interval or meter reading (generator hours, desalination plant) | assumption | P1 | building | operations.md OPS-R19 [SHOULD]; utilities.md UTL-R01–R03 (meters, generator run hours) | src/domain/planning.test.ts; test/maintenance-lostfound.test.ts (interval schedules, lead days, idempotent) — partial: no meter-based triggers |
| PAR-OPS-073 | Repeat-fault detection per unit/asset (same category within N days) | assumption | P2 | missing | — | — |
| PAR-OPS-074 | Maintenance performance report (open by urgency, time to fix, repeat faults) | assumption | P1 | specified | analytics.md ANL-R05 | — |
| PAR-OPS-075 | Spare parts stock and purchasing | assumption | P2 | different | operations.md §2 (boundary: stock/procurement modules or integration) | — |
| PAR-OPS-076 | Lost item log: description, photos, location, finder, storage location, value class | OPERA [Track It][op-trackit] · verified 2026-11-07 | P0 | tested | operations.md OPS-R20 | test/maintenance-lostfound.test.ts; src/domain/planning.test.ts (lost & found lifecycle) |
| PAR-OPS-077 | Match found items to stays/guests and contact the guest through comms | OPERA [Track It linked to reservation][op-trackit] · verified 2026-11-07 | P1 | building | operations.md OPS-R20 | test/maintenance-lostfound.test.ts (match to stay link) — partial: no guest contact through comms |
| PAR-OPS-078 | Retention and disposal (donate, destroy, return to finder) with audit | OPERA [Track It purge][op-trackit] · verified 2026-11-07 | P1 | tested | operations.md OPS-R20 | test/maintenance-lostfound.test.ts "enforces retention before disposal"; src/domain/planning.test.ts (high-value retention, early disposal needs a reason) |
| PAR-OPS-079 | Guest-reported lost item (inquiry) matched against the found log | assumption | P1 | specified | guest-experience.md GXP-R29 (post-stay lost-item claim → operations enquiry) | — |
| PAR-OPS-080 | High-value items and identity documents: restricted access and chain-of-custody log | assumption | P1 | missing | — | — |
| PAR-OPS-081 | Shipping a found item abroad with courier reference and shipping fee via payment request | assumption | P2 | building | operations.md §4 (`shipped`); guest-experience.md GXP-R29 (shipping consent) | test/maintenance-lostfound.test.ts (ships with tracking and courier receipt) — partial: no shipping-fee payment request |
| PAR-OPS-082 | Luggage storage and parcel tickets (left luggage, deliveries for in-house guests) | OPERA [Track It types and locations][op-trackitcfg] · verified 2026-11-07 | P1 | specified | guest-services.md GSV-R26 (luggage); GSV-R31 parcels [LATER] | — |
| PAR-OPS-083 | Housekeeping productivity report (units and credits per attendant, minutes vs expected) | OPERA [attendant console][op-attcon] · verified 2026-11-07 | P1 | specified | analytics.md ANL-R02, ANL-R05 | — |
| PAR-OPS-084 | Configuration: task kinds, expected minutes per unit type, sections, inspection policy, escalation rules | OPERA [housekeeping task scheduling][op-hktasksched] · verified 2026-11-07 | P0 | tested | operations.md OPS-R05, OPS-R12 | src/domain/escalation.test.ts (per-department paths, settings merge); test/scenario-s08-maintenance-outage.test.ts (policy by configuration) |
| PAR-OPS-085 | Granular permissions (assign, inspect, override condition, set inventory impact, resolve sync conflicts) | OPERA [role tasks][op-roletasks] · verified 2026-11-07 | P0 | tested | operations.md §8 | test/isolation-permissions.test.ts; test/scenario-s08-maintenance-outage.test.ts (only maintenance managers set inventory impact); test/review-regressions.test.ts (override permission, sync authorization) |
| PAR-OPS-086 | Housekeeping alongside an external PMS: arrivals mirrored, unit condition pushed back, OOO forwarded | Mews [Connector API housekeeping][mews-hkapi] · OPERA [interface room status][op-pifc] · verified 2026-11-07 | P0 | building | operations.md §14 | test/connected-mode.test.ts (forward pending until acknowledged; read-only refusal; maintenance forward) — partial: automatic PMS loop not end to end (README Adoption modes, R1) |
| PAR-OPS-087 | Resynchronise room status with the PMS on demand | OPERA [synchronizing room status][op-syncrs] · verified 2026-11-07 | P1 | specified | integration.md INT-R17 | — |
| PAR-OPS-088 | Business events / webhooks on condition and work-order changes for partners | OPERA [business events — housekeeping][op-busevents] · verified 2026-11-07 | P1 | building | operations.md §7; integration.md INT-R26 | modules/integration/test/webhooks.test.ts (fan-out); `operations.unit.conditionChanged` is a public webhook type — partial: work-order events not public |
| PAR-OPS-089 | Import of operations configuration and open items (sections, assets, lost items) during migration | OPERA [data import: rooms management, Track It][op-dataimport] · verified 2026-11-07 | P2 | missing | integration.md INT-R30 (guests, units, reservations, balances only) | — |
| PAR-OPS-090 | Shared desk/mobile devices with personal PIN quick switch for attribution | assumption | P1 | specified | identity.md IDN-R04 | — |
| PAR-OPS-091 | Color-blind-safe statuses with text and icons | assumption (Mews feedback, research R02 §2.6) | P1 | specified | operations.md §9 | — |
| PAR-OPS-092 | Operations exceptions (open discrepancies, overdue critical tasks, OOO without work order) in Day Close and handover | assumption | P0 | specified | operations.md §6 listExceptions | — |
| PAR-OPS-093 | Check-out, room move, extension, shortening and cancellation automatically re-plan tasks | OPERA [task sheets][op-tasksheets] · verified 2026-11-07 | P0 | building | operations.md §7 | test/housekeeping.test.ts (checkout, move, extension); test/review-regressions.test.ts (cancellation) — partial: shortening and no-show not covered by a test |
| PAR-OPS-094 | Global search and command palette find units, tasks, work orders and lost items | assumption | P1 | building | domain-map § Universal record contract | apps/api/test/operations.test.ts (service request found by number in `/v1/search`) — partial: units, work orders and lost items not tested |
| PAR-OPS-095 | Bulk task creation for a zone after weather (sand, storm debris) | assumption (Maldives monsoon) | P2 | missing | — | — |
| PAR-OPS-096 | Housekeeping rules for owner-occupied and house-use units (no charge, owner preferences) | assumption (condo-hotel villas) | P2 | missing | — | — |
| PAR-OPS-097 | Credits/rooms-cleaned export to workforce/payroll (piece-rate or incentive schemes) | assumption | P2 | missing | — | — |
| PAR-OPS-098 | Mobile operations app for management on the go (tasks, service requests, maintenance) | OPERA [Mobile PWA tasks][op-mobilepwa] · verified 2026-11-07 | P0 | specified | operations.md §9 (staff app) | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-OPS-001 | Inspection fails 20 minutes before the assigned arrival's ETA | Unit → `failed_inspection`; priority re-clean task to the nearest attendant; desk alerted immediately with ETA, reasons, photos and next-best ready units; waiting-guest ETA updated (S07) | P0 | tested | test/scenario-s07-failed-inspection.test.ts |
| EC-OPS-002 | Two supervisors change the same unit's condition within the same second | First write wins; second gets 409 with the current condition and who set it; nothing silently overwritten (OPS-I01, architecture rule 8) | P0 | building | test/isolation-permissions.test.ts; apps/api/test/operations.test.ts (stale If-Match → 409 with current version) — partial: problem body does not name who made the winning change |
| EC-OPS-003 | Attendant offline for 25 minutes updates 6 units; the supervisor changed one meanwhile | On reconnect 5 apply in client order; 1 becomes a sync conflict shown to both with both values; lists were labelled `delayed` while offline (S13/E10) | P0 | building | test/scenario-s13-offline-sync.test.ts (applies valid changes once, conflicts explained) — partial: `delayed` labelling is client-side and not built |
| EC-OPS-004 | Offline "clean" arrives for a unit that was checked into (dirty, by desk override) while offline | Change applies (it is true) and raises a discrepancy/exception for the desk; readiness history shows the order of events (OPS-R22c) | P0 | tested | test/review-regressions.test.ts "P1-9 OPS-R22(c)" |
| EC-OPS-005 | The same offline queue is submitted twice (app retry after a timeout) | Each action applied at most once by idempotency key; second submission reports `duplicate` (OPS-I04) | P0 | tested | test/scenario-s13-offline-sync.test.ts (retry ⇒ duplicates only; concurrent duplicate submissions) |
| EC-OPS-006 | A device clock is 3 hours wrong | Ordering per unit uses the device's sequence number and server receipt time; client time is shown as "reported at" but never decides precedence over newer server changes | P1 | tested | src/domain/sync.test.ts "clamps device clocks running in the future"; test/scenario-s13-offline-sync.test.ts (stale version never applied) |
| EC-OPS-007 | One attendant uses two devices (phone died, borrowed tablet) | Both queues merge by idempotency key; per-unit order preserved; no duplicate completions | P1 | building | test/scenario-s13-offline-sync.test.ts (concurrent duplicate submission from one device) — partial: two devices of one attendant not tested |
| EC-OPS-008 | Check-out at 23:58; Day Close advances the business date at 00:30 | Departure clean task belongs to the check-out business date and stays open after the date advance; it is never auto-closed or dropped | P0 | missing | — |
| EC-OPS-009 | Day Close runs twice (resume after failure) | Stayover "dirty" transition and next-day task generation run once per unit per night (keyed `stayover:{unitId}:{night}`) | P0 | building | test/housekeeping.test.ts (re-run of the day plan creates nothing new) — partial: overnight stayover transition at Day Close not built (PAR-OPS-011) |
| EC-OPS-010 | Property in a DST zone (group outside the Maldives): a task due at 02:30 on the spring-forward night | Due time normalised to the next valid local time with a visible note; escalation timers count real elapsed minutes (UTC) | P2 | missing | — |
| EC-OPS-011 | Supervisor's browser is in a different time zone from the property | All due times and history shown in property time with the zone label; no shifted deadlines | P1 | missing | — |
| EC-OPS-012 | Housekeeping finds a "sleep": unit vacant in the system but clearly occupied | Sleep discrepancy exception to the desk with owner; unit not offered for assignment until resolved; no automatic check-in | P0 | tested | test/housekeeping.test.ts (discrepancy → front-office exception); src/domain/conditions.test.ts (sleep → not ready) |
| EC-OPS-013 | Housekeeping finds a "skip": in-house stay but unit vacated, keys left | Skip discrepancy exception; desk decides early departure (with folio/balance check); never an automatic check-out | P0 | tested | test/housekeeping.test.ts (skip discrepancy → exception, no automatic check-out) |
| EC-OPS-014 | Attendant finds 3 adults in a stay registered for 2 | Person discrepancy exception to the desk (occupancy change re-prices per-person taxes such as Green Tax via reservations); not edited by housekeeping | P1 | missing | — |
| EC-OPS-015 | DND has been on for 48 hours | Welfare-check task to the duty manager with escalation; the entry and outcome are recorded; DND not silently cleared | P0 | tested | test/escalation.test.ts "do-not-disturb beyond the policy limit creates one welfare check"; test/review-regressions.test.ts E5 |
| EC-OPS-016 | DND on, but the guest asked for service at 14:00 | "Service later" task scheduled at 14:00 and prioritised then; morning skip is not counted as missed | P1 | specified | — |
| EC-OPS-017 | Stay moved to another unit while the old unit is being cleaned | In-progress task stays with the old unit (now a departure clean); new unit gets a readiness check; attendant notified of the change; nothing deleted | P0 | building | test/housekeeping.test.ts (room move) — implementation moves in-progress service tasks with the guest to the new unit; this row expects them to stay with the old unit (decision in gaps-ops.md) |
| EC-OPS-018 | Arrival cancelled after its unit's preparation task was planned | Planned (not started) preparation tasks are cancelled with reason; started tasks remain and complete normally | P1 | building | test/review-regressions.test.ts "a cancelled booking cancels the planned in-room service" — partial: started tasks remaining open not tested |
| EC-OPS-019 | Work order sets out-of-order on 4 units with assigned arrivals (AC outage) | Blocks created through inventory; 4 affected stays handed to relocation; engineer sees "4 stays affected — front office notified" (S08) | P0 | tested | test/scenario-s08-maintenance-outage.test.ts; test/real-inventory.test.ts |
| EC-OPS-020 | Out-of-order requested for a unit with an in-house guest | Preview lists the in-house stay; out-of-order applies only together with a relocation case for the front office (never leaves a guest in an out-of-order unit silently); out-of-service offered as the alternative | P0 | building | test/scenario-s08-maintenance-outage.test.ts (affected stays become resolution items) — partial: in-house stays not covered by a test |
| EC-OPS-021 | Inventory block call fails (partial outage) when a work order sets out-of-order | Work order saved with impact "pending"; unit not shown as out of order until inventory confirms; retried with the same key; an exception names the unit if still pending after the SLA | P0 | building | test/review-regressions.test.ts R3; test/real-inventory.test.ts R1/R3 (refusal keeps the work order with reason and next step) — partial: no retry with the same key and no SLA exception |
| EC-OPS-022 | Return to sale requested before the post-repair clean and inspection | Blocked with "Ready for return — awaiting inspection" and the owner; inspection pass releases the block once (OPS-R18) | P0 | tested | test/scenario-s08-maintenance-outage.test.ts; test/review-regressions.test.ts E8 |
| EC-OPS-023 | Same fault recurs 5 days after completion | New work order linked to the previous one with a repeat-fault flag; optional reopen of the original (verified status not rewritten) | P2 | missing | — |
| EC-OPS-024 | Jetty closed by storm: 30 water villas out of order at once | One previewed bulk action listing affected stays per night; single transaction (all or nothing); relocation cases created; one operational alert instead of 30 | P1 | missing | — |
| EC-OPS-025 | Resort-wide power or desalination outage for 4 hours | Units marked out of service (still counted) not out of order; guest-facing tasks queue; no availability change unless a manager chooses out-of-order with preview | P1 | missing | — |
| EC-OPS-026 | Connected mode: pushing a condition change to the external PMS fails | Integration exception "PMS still shows 214 dirty — desk may not check in"; Portico shows push pending; retries with the same key; desk told which system to trust (OPS §14) | P0 | building | test/connected-mode.test.ts (pending until acknowledged; rejection leaves the unit unchanged) — partial: delivery, retries and integration exception not built |
| EC-OPS-027 | Connected mode with Portico authoritative: the PMS sends a different room status | Inbound value not applied; recorded as a discrepancy for review; no ping-pong loop | P0 | building | — `applyExternalRoomStatus` refuses with `not_system_of_record`; discrepancy recording (CR-6) not built |
| EC-OPS-028 | Mirrored reservation feed is delayed beyond its SLA during the morning | Lists show `delayed` with age; departure tasks continue from last known data and are flagged; supervisor sees "check desk before cleaning due-outs" | P0 | specified | — |
| EC-OPS-029 | Attendant reassigned to other units while offline, completes the old task | Completion on reconnect becomes a conflict for the supervisor (OPS-R22b) with both facts; condition change still recorded if valid | P1 | tested | test/scenario-s13-offline-sync.test.ts (`task_reassigned`); test/review-regressions.test.ts E1b |
| EC-OPS-030 | Attendant's shift ends with unfinished tasks | Tasks return to the section queue at shift end and appear in the handover with owner; nothing silently disappears | P1 | missing | — |
| EC-OPS-031 | Unit marked clean by mistake | Correction with reason restores the right condition; history keeps both; readiness recalculated; desk warned if a check-in used the wrong state (E15) | P0 | building | test/review-regressions.test.ts (override with reason) — partial: no warning to the desk when a check-in used the wrong state |
| EC-OPS-032 | Staff replies "done" to a guest request in the inbox but the task is still open | Request stays open; the conversation shows the real task status (OPS-I03) | P0 | tested | test/escalation.test.ts "a 'done' message changes nothing" |
| EC-OPS-033 | Service request logged against the wrong stay | Re-pointed with reason and audit; the wrong guest never receives a completion message | P1 | missing | — |
| EC-OPS-034 | Escalation job down for 30 minutes | On recovery escalation levels are computed from task age (OPS-I05); one notification per level, not a burst of duplicates | P0 | tested | src/domain/escalation.test.ts "after scheduler downtime all overdue steps fire together, in order", "each step fires once" |
| EC-OPS-035 | Escalation target has nobody on shift (night, small property) | Escalates to the next level / duty manager role; never dropped; the handover lists it | P1 | missing | — |
| EC-OPS-036 | Found passport or jewellery | Restricted high-value record with two-person custody; passport handled per policy (return, police/embassy); document number never in the general log or photos | P1 | missing | — |
| EC-OPS-037 | Someone other than the guest claims a found item | Identity check step recorded before release; release signed and audited | P1 | missing | — |
| EC-OPS-038 | Retention date reached while a guest inquiry for the item is open | Disposal blocked until the inquiry is closed | P2 | missing | — |
| EC-OPS-039 | Found item to be shipped abroad; courier fee unpaid | Status stays `stored` with a payment request; never `shipped` until fee paid or waived with permission | P2 | missing | — |
| EC-OPS-040 | Photo upload on a 2G jetty connection | Task completion syncs first; photos queue and upload later with progress; completion never waits on the photo | P1 | missing | — |
| EC-OPS-041 | Minibar posted offline after the guest already checked out | Posts as a late charge per finance rules on the departed stay's folio; not lost; desk follow-up list shows it | P1 | specified | — |
| EC-OPS-042 | Attendant suspended mid-shift with queued offline actions | Actions arrive unauthenticated: not applied, preserved for supervisor review with attribution | P1 | missing | — |
| EC-OPS-043 | "Inspection required" policy switched on at 11:00 | Units already `clean` are shown "needs inspection" with the policy-change note; no silent readiness change for already checked-in stays | P1 | missing | — |
| EC-OPS-044 | Unit renumbered or changes unit type while tasks are open | Tasks follow the unit id; lists show the new number with "formerly 214" for the day | P2 | missing | — |
| EC-OPS-045 | Seaplane lands 12 arrivals 3 hours early | Arrivals re-prioritised by new ETA; ready-by gap per villa shown; supervisor offered re-sequencing; desk sees which villas will be late | P0 | building | src/domain/workload.test.ts (ETA-based priority) — partial: booking events do not yet carry ETA to operations (README contract gap) |
| EC-OPS-046 | Back-to-back group departure and arrival: credits needed exceed attendants on shift | Overload warning with shortfall in credits and minutes; suggested extra staff or delayed stayovers; never silently unassigned | P1 | missing | — |
| EC-OPS-047 | A unit vacant for 14 days in low season | Water-flush/touch-up task generated by rule; condition changes to touch-up if configured; history shows the rule | P1 | missing | — |
| EC-OPS-048 | Task regeneration re-run at 10:00 after manual reassignments | Manual reassignments and completed tasks preserved; only new work is added; preview of changes before applying | P1 | built | test/housekeeping.test.ts (re-run adds nothing) — not tested after manual reassignments; no preview |

<!-- sources (generated from a verified registry; do not edit by hand) -->

## Sources

Registry checked 2026-11-07. **Opened** = the page was fetched from this environment. **Search-located** = found by web search; the host blocks direct fetches here, so the fact is unverified until re-checked. Press releases and trade press are vendor claims, not verified behaviour.

- [Mews — Assign spaces to employees for housekeeping (Mews app)][mews-assignhk] (opened)
- [Mews — Connector API — Housekeeping use case][mews-hkapi] (opened)
- [Mews — How to change the status of a space][mews-changestatus] (opened)
- [Mews — Space status report][mews-spacestatus] (opened)
- [Mews — The Mews app: an overview][mews-opsapp] (opened)
- [Mews — Understanding the Guest Portal][mews-portal] (opened)
- [OPERA Cloud 26.3 — About Data Import (profiles, reservations, rooms management, Track It, ledgers)][op-dataimport] (opened)
- [OPERA Cloud 26.3 — Assigning Tasks to a Role][op-roletasks] (opened)
- [OPERA Cloud 26.3 — Configuring Business Events][op-busevents] (opened)
- [OPERA Cloud 26.3 — Configuring Housekeeping Attendant Information][op-attendants] (opened)
- [OPERA Cloud 26.3 — Configuring Out of Order and Out of Service Reasons][op-oooreasons] (opened)
- [OPERA Cloud 26.3 — Configuring Property Interface (rights, postings, room status, encoder workstations)][op-pifc] (opened)
- [OPERA Cloud 26.3 — Configuring Room Maintenance Codes][op-maintcodes] (opened)
- [OPERA Cloud 26.3 — Configuring Scheduled Task Credit Rules][op-taskcredit] (opened)
- [OPERA Cloud 26.3 — Configuring Scheduled Task Supplies][op-tasksupplies] (opened)
- [OPERA Cloud 26.3 — Configuring Service Request Codes][op-svcreqcodes] (opened)
- [OPERA Cloud 26.3 — Configuring Service Request Priorities][op-svcprio] (opened)
- [OPERA Cloud 26.3 — Configuring Track It][op-trackitcfg] (opened)
- [OPERA Cloud 26.3 — Configuring Vacant Room Status Update Rules][op-vacantrules] (opened)
- [OPERA Cloud 26.3 — Forecasting Housekeeping Services][op-hkforecast] (opened)
- [OPERA Cloud 26.3 — Generating Task Sheet Reports][op-taskrep] (opened)
- [OPERA Cloud 26.3 — Generating Task Sheets][op-gentask] (opened)
- [OPERA Cloud 26.3 — Housekeeping Section Groups and Sections][op-hksections] (opened)
- [OPERA Cloud 26.3 — Housekeeping Status Report (hk_allstatus)][op-hkreport] (opened)
- [OPERA Cloud 26.3 — Housekeeping Task Scheduling (admin)][op-hktasksched] (opened)
- [OPERA Cloud 26.3 — Managing Log It (department log book)][op-logit] (opened)
- [OPERA Cloud 26.3 — Managing Out of Order Rooms][op-ooo] (opened)
- [OPERA Cloud 26.3 — Managing Out of Service Rooms][op-oos] (opened)
- [OPERA Cloud 26.3 — Managing Profile Service Requests][op-profsvc] (opened)
- [OPERA Cloud 26.3 — Managing Reservation Queue Status][op-queue] (opened)
- [OPERA Cloud 26.3 — Managing Reservation Traces][op-traces] (opened)
- [OPERA Cloud 26.3 — Managing Room Conditions][op-roomcond] (opened)
- [OPERA Cloud 26.3 — Managing Room Discrepancies][op-discrep] (opened)
- [OPERA Cloud 26.3 — Managing Room Maintenance Requests][op-maint] (opened)
- [OPERA Cloud 26.3 — Managing Service Requests][op-svcreq] (opened)
- [OPERA Cloud 26.3 — OPERA Cloud Tasks — OPERA Cloud Mobile PWA][op-mobilepwa] (opened)
- [OPERA Cloud 26.3 — Reservation Housekeeping and Task Schedule][op-hksched] (opened)
- [OPERA Cloud 26.3 — Room Management (room status codes)][op-rm] (opened)
- [OPERA Cloud 26.3 — Synchronizing Room Status][op-syncrs] (opened)
- [OPERA Cloud 26.3 — Task Companion Auto-Priority][op-autoprio] (opened)
- [OPERA Cloud 26.3 — Task Sheets][op-tasksheets] (opened)
- [OPERA Cloud 26.3 — Track It (luggage, parcels, valet, lost items)][op-trackit] (opened)
- [OPERA Cloud 26.3 — Using Floor Plans][op-floorplan] (opened)
- [OPERA Cloud 26.3 — Using the Attendant Console][op-attcon] (opened)
- [OPERA Cloud 26.3 — Using the Housekeeping Board][op-hkboard] (opened)
- [OPERA Cloud 26.3 — Using the Task Sheet Companion][op-taskcomp] (opened)
- [Stayntouch — Housekeeping (product page)][snt-hk] (search-located)
- [Stayntouch — Housekeeping Configuration (auto-assign)][snt-hkcfg] (search-located)
- [Stayntouch — Housekeeping Task Management][snt-hktask] (search-located)
- [Stayntouch — Housekeeping Task Sheets][snt-tasksheets] (search-located)

[mews-assignhk]: https://help.mews.com/s/article/How-to-assign-spaces-to-employees-for-housekeeping-using-the-Mews-app
[mews-changestatus]: https://help.mews.com/s/article/change-a-space-s-status
[mews-hkapi]: https://docs.mews.com/connector-api/use-cases/housekeeping
[mews-opsapp]: https://help.mews.com/s/article/the-mews-operations-app-an-overview
[mews-portal]: https://help.mews.com/s/article/what-is-online-guest-services
[mews-spacestatus]: https://help.mews.com/s/article/space-status-report
[op-attcon]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_attendant_console.htm
[op-attendants]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_configuration_housekeeping_managing_attendants.htm
[op-autoprio]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_task_companion_auto_priority.htm
[op-busevents]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_configuring_business_events.htm
[op-dataimport]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_system_setup-importing_data.htm
[op-discrep]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_housekeeping_viewing_room_discrepancies.htm
[op-floorplan]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_getting_started_viewing_floor_plans.htm
[op-gentask]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_tasksheets_generating_task_sheets.htm
[op-hkboard]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_housekeeping_using_the_housekeeping_board.htm
[op-hkforecast]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_tasksheets_forecasting_housekeeping_services.htm
[op-hkreport]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_reports_housekeeping_status_hk_allstatus.htm
[op-hksched]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_managing_reservations_facility_schedule.htm
[op-hksections]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_housekeeping_housekeeping_sections.htm
[op-hktasksched]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_housekeeping_task_scheduling.htm
[op-logit]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_logging_it.htm
[op-maint]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_maintenance_managing_maintenance_requests.htm
[op-maintcodes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_rooms_managing_room_maintenance_codes.htm
[op-mobilepwa]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/r_opera_tasks_opera_mobile_pwa.htm
[op-ooo]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_housekeeping_out_of_order.htm
[op-oooreasons]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_configuration_codes_out_of_order_out_of_service.htm
[op-oos]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_housekeeping_out_of_service.htm
[op-pifc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_configuring_property_interfaces.htm
[op-profsvc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profiles_service_requests.htm
[op-queue]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_arrivals_in-house_adding_reservation_to_queue.htm
[op-rm]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_housekeeping_room_management.htm
[op-roletasks]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_manage_property_roles_assigning_tasks_to_roles.htm
[op-roomcond]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_housekeeping_setting_room_conditions.htm
[op-svcprio]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_configuring_service_request_priorities.htm
[op-svcreq]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_service_requests.htm
[op-svcreqcodes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_configuring_service_request_codes.htm
[op-syncrs]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_toolbox_synchronizing_room_status.htm
[op-taskcomp]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_tasksheets_servicing_room_tasksheet_companion.htm
[op-taskcredit]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_inventory_configuring_scheduled_task_credit_rules.htm
[op-taskrep]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_tasksheets_generating_task_sheet_reports.htm
[op-tasksheets]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_tasksheets_task_sheets.htm
[op-tasksupplies]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_inventory_configuring_task_supplies.htm
[op-traces]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_reservations_adding_traces_to_reservations.htm
[op-trackit]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_managing_reservations_track_it.htm
[op-trackitcfg]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_admin_track_it_managing_track_it.htm
[op-vacantrules]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_inventory_configuring_vacant_room_status_update_rules.htm
[snt-hk]: https://www.stayntouch.com/housekeeping/
[snt-hkcfg]: https://stayntouch.freshdesk.com/support/solutions/articles/24000067861-housekeeping-configuration
[snt-hktask]: https://stayntouch.freshdesk.com/support/solutions/articles/24000077495-housekeeping-task-management
[snt-tasksheets]: https://stayntouch.freshdesk.com/support/solutions/articles/24000097000-housekeeping-task-sheets
