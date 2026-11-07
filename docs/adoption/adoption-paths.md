# Adoption paths and the standalone module catalogue

> Deliverable 2 (adoption brief §2). Status date: 2026-11-07. Every module is at readiness **R1 (planned)**
> unless stated. Who controls each kind of information on each path is in
> [source-of-truth-matrix.md](source-of-truth-matrix.md).

## 1. The three paths, defined by data authority

The paths are defined by **who is the system of record** (`platform.data_authority`), not by which screens a
hotel uses. This makes the path testable: read the authority rows for the property and you know the path.

| Path | Plain-English promise | Data authority rule | Typical first step |
|---|---|---|---|
| **A. Connect alongside** | Keep every system you have. Portico reads from them and adds capabilities. Anything Portico changes in your systems is sent there and only counts once your system accepts it. | Every governed domain is `external` (`read_only` or `forward`). Portico is authoritative only for information that has no home in the other system (conversations, transfer manifests, reports, inspections). | Trial with a read-only connection |
| **B. Replace selected capabilities** | Switch off one capability in your current setup (e.g. housekeeping, guest messaging) and run it in Portico. Everything else stays where it is. | One or more domains move to `portico` (e.g. `roomStatus`, `maintenance`, `guestCommunications`); the rest stay `external`. Each move is an authority transition with a cutover (see [source-of-truth-matrix.md](source-of-truth-matrix.md) §6). | Path A for 2–4 weeks, then transition the chosen domain |
| **C. Full migration** | Portico becomes your PMS. Keep compatible specialist tools (POS, accounting, spa, locks) connected. | `reservations`, `availability`, `rates`, `guestProfiles`, `charges`, `roomStatus`, `maintenance` are `portico`. `payments` is `portico` when the hotel uses a Portico payment adapter, otherwise payments are recorded (see §4.6). `accounting` is usually `external` + `forward` (journals sent to the hotel's accounting system). | Migration rehearsal ([migration-acceptance-criteria.md](migration-acceptance-criteria.md)) |

A property can move A → B → C over time. It can also stay on A or B permanently: that is a supported outcome,
not a failure to convert.

## 2. How "standalone" works technically (connected mode)

"Standalone" is a **commercial and user-experience** statement: the hotel uses one Portico capability without
using Portico as its PMS. Technically, the capability still needs the shared concepts (units, stays, guests).
Those are held by their owning modules in **connected mode**: the owning module stores a mirror of the external
record with `provenance = external`, the connection id, the external identifier and the last-sync time, and
refuses or forwards writes through `platform.assertWritable` (CLAUDE.md rule 15).

Consequences that every module spec must honour (`docs/specs/<module>.md`):

1. **Inventory, reservations and guests must support mirrored records** even for hotels that never use them as
   products. Housekeeping alongside OPERA needs stays from the reservations module in connected mode.
2. A mirrored record **never shows a write action that would fail**. In `read_only` the action is absent and an
   explanation says where to make the change ("Change this in OPERA Cloud"). In `forward` the action exists and
   its result shows **pending** until acknowledged.
3. A mirrored record shows its age. Past the workflow's freshness target it is labeled `delayed`.
4. Portico-owned records attached to mirrored records (an inspection on a mirrored unit, a conversation on a
   mirrored stay) keep the external identifier so they survive a re-sync, a re-mapping, or a later migration.

## 3. Module-by-module analysis

Legend for "Standalone": **Yes** = offered alongside an external PMS; **Conditional** = offered only with a
provider whose required workflows are verified at R4 or above; **No** = not offered without the Portico PMS
core (reasons in §5).

| Module (domain-map name) | Standalone | Hard Portico dependencies (connected mode) | Data needed from the external system of record | What it writes or forwards back | Governed domains it touches |
|---|---|---|---|---|---|
| Inventory (`inventory`) | **No** (sold as part of PMS core) | platform | n/a (as standalone). In connected mode it mirrors unit types, units, out-of-order blocks | Out-of-order/out-of-service blocks forwarded when `availability` is external + forward | `availability` |
| Rates (`rates`) | **No** | inventory, platform | n/a | n/a | `rates` |
| Reservations (`reservations`) | **No** as a product; **mirror mode required** for SM-01..SM-06 | inventory, rates, guests, platform | Bookings, stays, status, assigned unit, occupants, arrival/departure, ETA, notes | Only via forward actions defined by other modules (e.g. a room move is never forwarded by housekeeping) | `reservations` |
| Guests (`guests`) | **Conditional** (SM-08, later) | platform | Profiles, contact channels, consent flags, company/agency | Profile corrections forwarded only where the PMS accepts them; otherwise discrepancy | `guestProfiles` |
| Finance (`finance`) | **No** | platform, rates (tax engine) | n/a | n/a | `charges`, `accounting` |
| Payments (`payments`) | **No** at launch; Conditional later (SM-09) | finance, platform | Folio balance, payer, stay reference | Payment recorded on the external folio (forward) — not offered until a provider's payment-posting workflow is verified | `payments`, `charges` |
| Operations — housekeeping (`operations`) | **Yes** (SM-01) | inventory (mirror), reservations (mirror), platform, identity | Units, unit types, stays (arrivals, departures, in-house, assigned unit, occupants), current room status, out-of-order blocks | Room status changes (forward to PMS, or Portico-authoritative and copied to the PMS on Path B) | `roomStatus` |
| Operations — maintenance (`operations`) | **Yes** (SM-02) | inventory (mirror), reservations (mirror) | Units, locations, stays assigned to affected units | Out-of-order/out-of-service blocks (forward to PMS because `availability` stays external); work orders are Portico-owned | `maintenance`, `availability` |
| Operations — tasks and service requests (`operations`) | **Yes** (SM-03, bundled with SM-01, SM-02 or SM-04) | reservations (mirror), guests (mirror) | Stay and guest for context | Optional note/trace on the PMS reservation where supported | none (Portico-owned) |
| Comms (`comms`) | **Yes** (SM-04) | guests (mirror), reservations (mirror), operations (tasks) | Guest contact details, consent, language, stay dates, unit, booking source | Conversation summaries as PMS notes where supported; service requests become Portico tasks | `guestCommunications` (proposed, G-06) |
| Analytics and reporting (`analytics`) | **Yes** (SM-05) | reads mirrors from reservations, inventory, rates, finance (in connected mode: read-only revenue facts) | Stays, room nights, revenue postings by charge category, rate plan, source/channel, cancellations, out-of-order | Nothing. Reports and discrepancy lists only | none (reads only) |
| Distribution (`distribution`) | **No** at launch | inventory, rates, reservations | n/a | n/a | `availability`, `rates`, `reservations` |
| Groups (`groups`) | **Conditional** (SM-07: sales pipeline and function space only) | guests (mirror), reservations (mirror) | Company/agency accounts; for room blocks: block inventory (not offered standalone) | Room blocks are **not** forwarded at launch | `reservations`, `availability` (blocks only) |
| Resort — transfers and manifests (`resort`) | **Yes** (SM-06) | reservations (mirror), guests (mirror) | Arrivals/departures, occupants (names, ages where needed for manifests), flight details where held in the PMS | Transfer charges forwarded to the PMS folio only with a verified posting workflow; otherwise exported for manual posting | `charges` (only if posting enabled) |
| Resort — activities and spa (`resort`) | **Conditional** (SM-10, later) | reservations (mirror), guests (mirror) | Stays, guests, folio routing for room charges | Activity charges forwarded to the PMS folio (same as a POS) | `charges` |
| Resort — meal-plan entitlements and outlet charge intake (`resort`) | **No** | rates (packages, allowances), finance, reservations | n/a | n/a | `charges` |
| Day Close (`day-close`) | **No** | reservations, finance, payments, inventory, operations | n/a | n/a | `charges`, `accounting` |
| Integration (`integration`) | Always present (foundation for every path) | platform, identity | Per connection | Per workflow | all |
| AI (`ai`) | **No** (a layer over active modules, not a product on its own) | whichever modules are active | Whatever the user may see | Only action proposals that a user approves; actions on external data go through forward workflows | as the underlying action |

## 4. Standalone module catalogue

Each entry states what the hotel gets, the minimum data contract with the external system, the write-back, and
what happens when the external system cannot support an action. Provider coverage and priority tiers are in
[integration-coverage-matrix.md](integration-coverage-matrix.md).

### SM-01 Housekeeping and room readiness (alongside a PMS)

- **What the hotel gets:** cleaning assignments by workload, arrivals/departures priority, mobile updates
  (offline-capable PWA, `apps/staff`), inspections, DND, room discrepancies, lost and found, supervisor board,
  room-readiness view for reception.
- **Example setups:** alongside OPERA Cloud (RS-3), Mews, Cloudbeds, Apaleo. OPERA 5.x on-premise only with a
  local connector (see [rollout-requirements.md](rollout-requirements.md) §5).
- **Minimum inbound data (read):** units with unit type and location; stays with arrival and departure dates,
  stay status, assigned unit, occupant counts, ETA if held; current room status; out-of-order blocks.
  **Receive-changes required:** check-in, check-out, room move, assignment change, extension, cancellation.
  If the PMS only supports periodic reads, the board is labeled with its refresh interval and `delayed` past
  the freshness target.
- **Write-back:** room status (clean, dirty, inspected where the PMS has it).
  - *Path A (default):* `roomStatus` = external + forward. Each update shows "sent to <PMS>, waiting for
    confirmation" until acknowledged; front desk keeps assigning rooms in the PMS.
  - *Path B:* `roomStatus` = Portico. Portico copies status to the PMS so reception sees it there, and applies
    the **safe-direction rule** to edits made in the PMS (CR-6 in [source-of-truth-matrix.md](source-of-truth-matrix.md) §3).
- **When the PMS lacks a status:** if the PMS has no "inspected" state, inspection stays a Portico record and
  Portico sends "clean" only after inspection passes (when the property requires inspection). This mapping is
  shown during setup, never applied silently.
- **Not included:** room assignment, check-in and check-out (they stay in the PMS).

### SM-02 Maintenance and work orders (alongside a PMS)

- **What the hotel gets:** faults, assets and locations, urgency, photos, ownership, preventive schedules, work
  history, and the inventory impact of a fault.
- **Minimum inbound data:** units and locations; stays assigned to the affected unit and dates (to show who is
  affected).
- **Write-back:** out-of-order or out-of-service blocks are **availability** changes. Because `availability`
  remains external, Portico forwards the block to the PMS; the room counts as blocked **only after** the PMS
  confirms. Until then the work order shows "block pending in <PMS>" and an urgent exception is raised if the
  block is for tonight and is not confirmed within the workflow's target time.
- **When the PMS cannot receive blocks:** the work order shows "set out of order in <PMS> manually" as a task
  with an owner; Portico checks the next inbound room-status/blocks read and closes the task only when the
  block appears.

### SM-03 Service requests and tasks

- Bundled with SM-01, SM-02 or SM-04. Guest requests and internal tasks with department ownership, due time,
  escalation and handover. Portico-owned; needs mirrored stay and guest for context. "Done" means the task is
  done, not that a message was sent (brief §8).

### SM-04 Guest messaging and communications workspace (alongside any PMS)

- **What the hotel gets:** unified inbox (email, WhatsApp, SMS where approved), templates, pre-arrival and
  in-stay automations, translation preserving the original, ownership by department, request-to-task.
- **Minimum inbound data:** guest name, contact channels, language, consent/opt-out, stay dates, booking
  source (OTA-collected guests may carry relay email addresses), assigned unit when known.
- **Write-back:** optional conversation summary as a PMS note (where supported). Nothing financial.
- **Coordination:** the hotel must name, per automated message type, the one system that sends it
  (`guestCommunications` authority, proposed G-06). Setup lists automations found in the old tool (where
  readable) and blocks activation of a Portico automation that duplicates one the old system still sends,
  unless the hotel confirms it has switched that one off.
- **Not included at launch:** payment links (requires SM-09) and booking changes (requires forward workflows to
  the PMS reservation, not offered standalone).

### SM-05 Reporting and analytics over an external PMS

- **What the hotel gets:** occupancy, ADR, RevPAR, pickup, cancellations, channel mix, operational metrics
  (from SM-01..SM-04 if used), multi-property consolidation with metric definitions, and **discrepancy reports**
  comparing Portico's figures with the PMS's own reports.
- **Minimum inbound data:** stays and room nights, revenue postings by category (or the PMS's daily revenue
  summary where postings are not available), rate plan, source/channel, cancellations/no-shows, out-of-order
  counts. Each report states which inputs were available; missing inputs make the report `incomplete`, never a
  silently partial number.
- **Write-back:** none.
- **Limitation stated to the hotel:** figures are computed from the data the connection supplies. Where Portico
  and the PMS disagree, both numbers and the records behind the difference are shown; Portico does not declare
  itself correct (brief §4).

### SM-06 Transfers and arrival coordination (Maldives resorts)

- **What the hotel gets:** seaplane, speedboat and domestic-flight legs with manifests, capacity, luggage,
  status, disruptions, and the knock-on effect on check-in, dining and activities (scenario 12).
- **Minimum inbound data:** arrivals and departures with occupants; international flight number and time when
  the PMS holds them (often in free-text notes — mapping must say which field is used and how reliable it is).
- **Write-back:** transfer status visible in Portico; transfer charges either forwarded to the PMS folio (only
  with a verified posting workflow) or exported as a daily posting list for manual entry, labeled as such.
- **External transport operators:** manifests exchanged by file or email unless an operator offers an API
  (unconfirmed for Maldivian operators; see coverage matrix).

### SM-07 Group sales and function space (Conditional, P2)

- Inquiry → proposal → contract pipeline and function-space/event orders, without room blocks. Room blocks stay
  in the PMS until a provider's block workflow is verified for forward mode.

### SM-08 Guest recognition across properties (Conditional, P2)

- Read-only unification of guest profiles from several external PMS instances (duplicates, history across
  properties) within the organization's sharing policy. Profile corrections forwarded only where supported.

### SM-09 Payment links posting to an external folio (Conditional, P2)

- Only after a provider's payment-posting workflow and the payment adapter for the hotel's acquirer are both
  verified. Risk to manage: double charging when the PMS also runs payment automation; the setup must prove
  which system charges which reservation before activation (operational-readiness brief §7).

### SM-10 Activities and spa booking with room charging (Conditional, P2)

- For resorts without a specialist system. Behaves like a POS towards the external PMS (charge posting with
  eligibility check). Not for resorts that already run Book4Time or a similar system.

## 5. Not offered standalone, and why

| Capability | Why not standalone | What we offer instead |
|---|---|---|
| Inventory, rates, reservations individually | They form one consistency boundary: selling the last unit, pricing and booking must commit together (scenario 1). Splitting them across two systems recreates the dual-system overbooking risk the research documents (Cloudbeds warns that running alongside a second PMS can cause overbookings — research 03, [Cloudbeds help](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/30906094566427-Channel-Manager-Integrations), verified 2026-11-07 via search extract) | Full PMS core (Path C) |
| Finance (folios, ledger) | The folio ledger must live where charges are authoritative; a second ledger alongside the PMS's ledger guarantees reconciliation differences | Analytics discrepancy reports (SM-05) |
| Payments (at launch) | A payment must land on the authoritative folio; doing that in someone else's PMS needs a verified posting workflow, and double-charge prevention with the PMS's own payment automation | SM-09 later, provider by provider |
| Distribution (channel manager, booking engine) | Running Portico's channel manager in front of another PMS adds a PMS-to-channel-manager hop with its own certification per PMS (SiteMinder pmsXchange is a separate certified build — research 03/04) and splits inventory ownership. Channex certification must validate real PMS workflows (owner brief §5) | Distribution only with Portico PMS core |
| Day Close | It closes Portico's business date and ledger; meaningless while charges are authoritative elsewhere | — |
| Group room blocks | Blocks consume availability in the PMS; forward-mode block management is complex and unverified for every provider | SM-07 without blocks |
| Meal-plan entitlements, outlet charge intake | Need packages, allowances and the folio in one system | Full PMS core |
| AI as a product | AI is a helper over the hotel's own records and permissions (brief §14); on its own it has nothing to act on | AI inside each active module |

## 6. Representative setups

These are the setups the roadmap completes **before** adding breadth (brief §15). Authority detail per setup is
in [source-of-truth-matrix.md](source-of-truth-matrix.md) §5.

| ID | Setup | Path | Portico modules | External systems kept | Why it is representative |
|---|---|---|---|---|---|
| RS-1 | **12-room guesthouse on a Maldivian inhabited island, fully on Portico** | C | Full PMS core, distribution (via hub), comms, operations, Day Close, analytics | OTAs through a channel hub; payment acquirer or bank transfer/cash; spreadsheet or small-business accounting | Largest count of Maldivian properties are small guesthouses [Assumption — verify with discovery, Q64]; simplest full path |
| RS-2 | **120-villa resort, Portico PMS, keeping its POS, accounting/ERP and spa system** | C (with connected specialist tools) | Full PMS core, distribution, comms, operations, resort (transfers, meal plans, activities), groups, Day Close, analytics | POS (posts charges into Portico), accounting/ERP (receives journals), spa system, door locks (local connector), seaplane operator (manifests) | Matches the D8 sample resort and the brief's resort requirements (§12) |
| RS-3 | **3-property group keeping OPERA Cloud, adopting Portico housekeeping and guest messaging, plus group reporting** | A (housekeeping forward) → optionally B (`roomStatus` to Portico) | SM-01, SM-03, SM-04, SM-05 | OPERA Cloud (system of record for everything else) | Tests connected mode against the market's de-facto enterprise PMS (research 01) |
| RS-4 | **Guesthouse on eZee Absolute or Cloudbeds trying Portico messaging and reporting before migrating** | A → C | SM-04, SM-05; later full migration | Existing all-in-one PMS | The "value before migration" path for small properties |

## 7. Choosing a path (the questions setup asks)

1. Which system do reception staff use to check guests in today, and will they keep using it? (If yes → A or B.)
2. Which capability do you want to change first? (Housekeeping, messaging, reporting → A/B; everything → C.)
3. Does your current system allow another system to read its data, and do you have permission from the vendor
   and your contract? (If unknown → start with a trial using an exported copy.)
4. For the capability you are moving: can you switch it off in the old system on a given date? (Required for B.)
5. Are payments, accounting and door keys handled by systems you will keep? (Shapes C.)

Setup answers these with the hotel and records the result as the proposed authority rows, which are shown for
approval before anything activates.

## 8. Gate for offering a module standalone

A module may be listed as standalone (Yes or Conditional) for a given provider only when all of these hold,
with evidence recorded in `docs/readiness/readiness-register.md`:

1. Its connected-mode dependencies are documented in its spec (`docs/specs/<module>.md`), per CLAUDE.md rule 15.
2. The minimum inbound data contract above is satisfied by that provider's workflows at **R4 or higher**, with
   the sync mode stated (immediate, periodic, manual or file).
3. Every write-back is either `forward` with acknowledgement handling, or explicitly absent with a manual
   alternative and an owner.
4. Integration tests cover delayed, duplicate, out-of-order and missing messages for its inbound workflows
   ([connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md) §8).
5. Staff validation with representative users is recorded separately from automated tests (CLAUDE.md §7).
6. The marketplace/catalogue entry lists limitations in plain English ([ecosystem-and-developer-experience.md](ecosystem-and-developer-experience.md) §9).
