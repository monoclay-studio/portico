# Source-of-truth responsibility matrix

> Deliverable 3 (adoption brief §2, §8; operational-readiness brief §6, §18). Status date: 2026-11-07.
> Builds on the implemented `platform.data_authority` table and `assertWritable`
> (`modules/platform/src/service.ts`). Proposed changes to that model are G-01, G-02, G-06, G-07 in
> [gap-assessment.md](gap-assessment.md).

## 1. The rule

For each property and each governed domain, **exactly one system is the system of record**. Every other system
holds, at most, a labeled copy. A change to governed information is made in the system of record, or sent to
it and counted only once it confirms. No two systems independently modify the same information.

## 2. Governed domains (what each one covers)

| Domain (`data_authority.domain`) | Covers | Does not cover |
|---|---|---|
| `reservations` | Bookings, stays, stay status, occupants, stay dates, unit assignment, booking source, agreed terms, group pickup | Group sales pipeline (Portico-owned in SM-07) |
| `availability` | Unit-type inventory per night, holds, blocks/allotments, out-of-order/out-of-service effect on sellable inventory, authorized overbooking, what is published to channels | Unit condition (that is `roomStatus`) |
| `rates` | Rate plans, prices, restrictions, packages and inclusions, tax and fee rules used for pricing | Taxes on already-posted charges (follow `charges`) |
| `guestProfiles` | Guest profiles, companies, agencies, contact details, preferences, consent flags, merges | Conversation history (Portico-owned, see `guestCommunications`) |
| `charges` | Folios, postings, charge codes, billing rules, deposits held, guest invoices and credit notes, receivables accounts (city ledger) and their aging | General ledger and statutory books (`accounting`) |
| `payments` | Payment accounts, payment methods (tokens), authorizations, captures, refunds, disputes, payouts, payment requests; **which system initiates charges for a reservation** | Recording a payment made outside any connected system (a `charges` posting with an external reference) |
| `roomStatus` | Unit condition (dirty, cleaning, clean, inspected, failed inspection), occupancy discrepancies, DND | Out-of-order (that is `maintenance` + `availability`) |
| `maintenance` | Work orders, assets, preventive schedules, the decision that a unit is out of order/service | The inventory effect itself (follows `availability`) |
| `accounting` | General ledger, statutory financial statements, accounts payable, bank reconciliation, fixed assets | Guest-side ledger, which stays with `charges` |
| `guestCommunications` *(proposed, G-06)* | Which system sends automated and conversational guest messages for the property (pre-arrival, in-stay, post-stay, campaigns); the per-message-type sender register | Booking confirmations sent by an OTA; fiscal documents sent by the `charges` system of record |

Information that belongs to no governed domain is owned by the system that creates it: POS checks belong to the
POS, spa appointments to the spa system, key validity to the lock system, transfer manifests to Portico when
SM-06 is used. When such a system sends money to a folio it is a **source** of charges, not an authority (§3, CR-4).

## 3. Write modes and coordination rules

| authority | write_mode | What staff can do in Portico | Shown as |
|---|---|---|---|
| portico | exclusive | Change it in Portico (subject to permissions and business rules) | `live` |
| external | read_only | See it; no change action is shown; an explanation names the system where changes are made | `external` with last-sync time; `delayed` past the freshness target |
| external | forward | Request a change; it is sent and shows **pending** until the other system confirms; a rejection shows the other system's reason | `external`; the pending change is visually distinct |
| external | exclusive | **Not allowed** (G-01) | — |

Forward mode on a domain enables only the forward actions that a module defines for connected mode (e.g. out-of-order
blocks for `availability`, room-status changes for `roomStatus`). It never exposes the module's other write actions
for that domain.

Coordination rules (each is testable; tests in §8):

- **CR-1 Single writer.** Every write in a governed domain calls `platform.assertWritable` first. No module bypasses it,
  including importers and support tools.
- **CR-2 Forward means pending.** A forwarded change is stored as an outbound operation with an idempotency key. The
  record keeps its confirmed value; the requested value is shown alongside as pending. Only the external
  system's acknowledgement (or a later read showing the change) makes it effective. A timeout makes it
  **pending verification**, resolved by reading the external system, never by assuming success.
- **CR-3 Precondition on forward.** Where the external API supports a version or timestamp precondition, Portico
  sends it. Where it does not, Portico reads the current external value immediately before sending and aborts
  with a conflict if it differs from what the user saw. Conflicts show both values; nothing is silently overwritten.
- **CR-4 Sources are not authorities.** A POS, spa or activity system posting a charge into Portico uses an idempotent
  business key (e.g. `pos:{outletId}:{checkId}:{revision}`) and must pass room-charge eligibility. It cannot edit or
  delete postings; corrections arrive as linked reversals (CLAUDE.md §5).
- **CR-5 Copies are never read back as truth.** When Portico is the authority and copies information to another
  system (e.g. room status copied to the PMS on Path B), a later read of that copy is compared, not imported.
- **CR-6 Safe-direction acceptance.** When Portico is the authority but the other system still allows staff to edit
  its copy, inbound edits are handled by direction:
  - Changes that make a unit *less* ready or *less* sellable (clean → dirty, set out of order) are accepted as a
    **request** in Portico (a task or a proposed block), logged with the external user if known.
  - Changes that make a unit *more* ready or *more* sellable (dirty → clean/inspected, remove out of order) are
    **rejected**: Portico raises a discrepancy for the responsible supervisor and re-sends its own value.
- **CR-7 One publisher of availability.** Exactly one system publishes availability and rates to each channel. A
  channel mapping can be active in one system only; activation in Portico requires evidence that the other
  publisher for that channel has been switched off (operational-readiness brief §6).
- **CR-8 One charging system per reservation.** For each reservation exactly one system may initiate payment
  collection (automatic or manual). The `payments` authority states which. Portico refuses to schedule automatic
  charges for a reservation whose payment authority is external (prevents the double-charge pattern documented for
  Mews in research 02 §2.5).
- **CR-9 One sender per guest message type.** The `guestCommunications` sender register lists each automated message
  type (pre-arrival, check-in instructions, in-stay check, post-stay) with exactly one sending system. Portico will
  not activate an automation for a message type registered to another system.
- **CR-10 Authority changes are controlled.** Changing authority requires `platform.dataAuthority.manage`, shows a
  preview of affected workflows and screens, and, for `charges`, `payments`, `accounting` and `availability`,
  requires approval by a second person (separation of duties; RR-05 in [rollout-requirements.md](rollout-requirements.md) §3).

## 4. Matrix by adoption path

### 4.1 General pattern

| Domain | Path A — connect alongside | Path B — replace selected capabilities | Path C — full migration |
|---|---|---|---|
| reservations | external · read_only | external · read_only | **portico** · exclusive |
| availability | external · read_only; external · forward when SM-02 sends out-of-order blocks | external · read_only, or forward (blocks) | **portico** · exclusive |
| rates | external · read_only | external · read_only | **portico** · exclusive |
| guestProfiles | external · read_only | external · read_only (forward for corrections where supported) | **portico** · exclusive |
| charges | external · read_only (read for reporting) | external · read_only, or forward when SM-06/SM-10 post charges through a verified workflow | **portico** · exclusive; POS/spa are sources (CR-4) |
| payments | external · read_only or not read | external · read_only or not read | **portico** · exclusive if a Portico payment adapter is used; otherwise portico · exclusive with payments **recorded** from external terminals/transfers |
| roomStatus | external · forward (SM-01 default) | **portico** · exclusive (copied to PMS; CR-5, CR-6) | **portico** · exclusive |
| maintenance | external · read_only, or portico if SM-02 used (work orders) | **portico** · exclusive | **portico** · exclusive |
| accounting | not connected, or external · read_only | not connected, or external · read_only | external · forward (journals) — or portico when the hotel has no separate books (§5, RS-1) |
| guestCommunications | **portico** for message types moved to SM-04; others external | **portico** | **portico** |

### 4.2 Why roomStatus defaults to forward on Path A

Front desk keeps assigning rooms in the PMS, so the PMS must hold the status reception relies on. Forward mode
gives Portico's housekeeping app the job of capturing changes while the PMS stays the single record. The cost is
a short "pending" period per update; the workflow target is p95 ≤ 30 seconds from tap to confirmation when
connected ([success-metrics.md](success-metrics.md) M-09). Path B is offered when the hotel wants Portico to own
status, can restrict status edits in the PMS (vendor setting where it exists) and accepts CR-6.

## 5. Matrix by representative setup

`P` = Portico, `X` = external. System names for external providers are examples pending discovery (Q64).

| Domain | RS-1 Guesthouse, fully on Portico | RS-2 120-villa resort, keeps POS + accounting + spa | RS-3 3-property group on OPERA Cloud + Portico housekeeping & messaging | RS-4 Guesthouse on eZee/Cloudbeds trying Portico |
|---|---|---|---|---|
| reservations | P · exclusive | P · exclusive | X (OPERA Cloud) · read_only | X · read_only |
| availability | P · exclusive (published via channel hub) | P · exclusive (published via channel hub) | X · read_only; X · forward at properties using SM-02 (out-of-order blocks only) | X · read_only |
| rates | P · exclusive | P · exclusive | X · read_only | X · read_only (only if reporting needs it) |
| guestProfiles | P · exclusive | P · exclusive | X · read_only | X · read_only |
| charges | P · exclusive | P · exclusive; POS, spa and transfer desk post as sources | X · read_only (revenue for SM-05) | X · read_only (revenue for SM-05) |
| payments | P · exclusive with a Portico adapter for the hotel's acquirer **if available (Q2)**; otherwise P with recorded external-terminal, bank-transfer and cash payments | P · exclusive (same caveat); OTA virtual cards via the hub's PCI service | X · not read | X · not read |
| roomStatus | P · exclusive | P · exclusive | X · **forward** (Path A); optional move to P (Path B) per property | X · read_only |
| maintenance | P · exclusive | P · exclusive | P (if SM-02 adopted; blocks forwarded to OPERA) or X · read_only | X · read_only |
| accounting | P (books kept from Portico exports) **or** X · forward via file connection to the accountant (manual acknowledgement) | X (ERP) · forward: daily journals, AR invoices summary, deposit movements | not connected | not connected |
| guestCommunications | P | P | P for pre-arrival and in-stay messages; OPERA confirmation letters remain with OPERA (listed in the sender register) | P for message types moved; the PMS's own automations switched off per type |

Notes:

- **RS-1 accounting by file:** a file export is a manual connection (sync mode `file`). It is never labeled as a
  live connection. The journal batch shows "exported, not yet confirmed imported" until a user records that the
  accountant imported it.
- **RS-2 door keys:** the lock system is authoritative for key validity. Portico requests keys (`access.key`
  effect) through the local connector; if the request cannot be confirmed, the front desk is told to encode in the
  lock vendor's own software and the stay records "key issued outside Portico" ([rollout-requirements.md](rollout-requirements.md) §6).
- **RS-3 per-property choice:** each property can be on a different path. A move to Path B at one property does not
  move the others (rollout requirement RR-10).

## 6. Moving authority (transition protocol)

Every change of authority for a domain at a property is an **authority transition** with states
`planned → frozen → effective` (or `cancelled`). This needs model change G-02. The protocol applies to
single-domain moves (Path A → B) and full cutovers (Path C).

### 6.1 Steps

| Step | When | What happens | Who |
|---|---|---|---|
| T-1 Plan | Days before | Create the transition with domains, target time, freeze length, rollback criteria and approvers. Preview lists affected workflows, screens, automations, channels and staff roles | Hotel project owner + Portico onboarding lead |
| T-2 Rehearse | Before freeze | For data-carrying moves, at least one accepted rehearsal ([migration-acceptance-criteria.md](migration-acceptance-criteria.md) §5) | Onboarding lead |
| T-3 Prepare switches | Before freeze | Channel mappings prepared in the hub but inactive; POS/spa interface target prepared; automations in Portico prepared but disabled | Onboarding lead + vendors |
| T-4 Final change capture | Start of freeze | Read or export everything changed in the source since the last capture; record the capture timestamp | System |
| T-5 Freeze | Agreed window (target ≤ 60 min for RS-1, ≤ 3 h for RS-2) | `assertWritable` returns `authority_transition_in_progress` for the frozen domains in Portico; staff use the paper/offline log in the runbook for walk-ins and phone bookings; inbound channel messages are received and **queued**, not applied | System + front desk |
| T-6 Switch | End of freeze | In one transaction per property: authority rows updated, history row written, event `platform.dataAuthority.changed` emitted. Then: full availability and rates published (state, not deltas), channel mappings activated, sources re-pointed | System + vendors |
| T-7 Apply queued and late changes | Immediately after switch, then sweep | Queued inbound changes applied in order (idempotent). A **post-capture sweep** re-reads the old system for anything created or modified after the capture timestamp, every 15 minutes for 72 hours (target) | System |
| T-8 Verify | First hours | Reconciliation checks ([migration-acceptance-criteria.md](migration-acceptance-criteria.md) §6); discrepancies become exceptions with owners | Onboarding lead + hotel |
| T-9 Close or roll back | End of rollback window | Old system set to read-only/archive, or rollback per the migration runbook (§9 there) | Hotel decision-maker |

### 6.2 In-flight business during a cutover

| Situation | Handling |
|---|---|
| OTA booking delivered to the old system after final capture | Found by the post-capture sweep or re-delivered by the hub; imported with its source identifier; duplicate check by channel booking id and revision; if the night is now full in Portico, an **inventory conflict** is raised for relocation handling (brief §4). Never silently dropped. |
| OTA modification/cancellation of a migrated booking | Matched by channel booking id; applied as a revision; if the booking is missing in Portico, held as "awaiting predecessor" and fetched |
| Phone or walk-in booking during freeze | Recorded on the runbook's freeze log; entered after switch with the original timestamp in notes |
| Authorization held in the old system with a non-portable token | Listed before cutover; the stay gets a task "re-authorize at check-in"; the old authorization is released or lapses by the old system's rules (never re-captured from Portico) |
| Deposit received in the old system | Migrated as a deposit liability with the source payment reference; reconciled to the minor unit |
| Guest in house during cutover | Open folio migrated as opening balance lines with source references; new charges post in Portico after switch |
| Room status at switch | Snapshot imported; a task "verify all room statuses" is created for the first housekeeping shift |
| POS check open at switch | POS posts to the old system until the POS interface is re-pointed; checks posted after re-pointing go to Portico; the gap is covered by a posting list reconciled at T-8 |
| Payment taken during freeze on a standalone terminal | Recorded after switch as an external-terminal payment with terminal reference; matched in the next payout reconciliation |

### 6.3 Path A → B for a single domain (example: `roomStatus` in RS-3)

1. Plan (T-1) with the housekeeping supervisor; confirm whether OPERA can restrict status edits to selected roles
   (vendor setting — unconfirmed; CR-6 applies either way).
2. Freeze of a few minutes: pending forwarded updates must be confirmed or rejected first (a transition cannot
   become effective with unresolved pending operations).
3. Switch: authority `portico`; Portico reads the current status from OPERA as the starting value; from now on
   Portico copies status to OPERA.
4. Verify for one week: count of CR-6 discrepancies per day; target zero after day 3 (staff habits).

### 6.4 Replacing a provider while staying external

Example: a group moves from one channel hub to another, or a resort replaces its POS. The new connection is set
up and validated in parallel; authority (or source registration) moves from connection A to connection B through
the same `planned → frozen → effective` protocol. Connection A is **paused, not deleted**, until reconciliation
passes, so its exchange log remains available for investigation.

## 7. What the user sees

- On every governed record: the system of record, the write mode and the last successful exchange
  ("Room status is managed in OPERA Cloud. Last updated 40 s ago.").
- On the property's **Systems of record** page: the matrix rows for that property, pending transitions, and who
  approved each change, with history.
- On a blocked action: problem, impact, where to do it instead, who can change the arrangement (error standard
  in [connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md) §10).

## 8. Acceptance tests

| # | Given | When | Then |
|---|---|---|---|
| ST-01 | `roomStatus` = external · read_only | A housekeeper opens a unit | No status-change control is shown; text names the system of record; no write reaches the database (verified by audit) |
| ST-02 | `roomStatus` = external · forward | A housekeeper marks a unit clean | An outbound operation is stored with an idempotency key; the unit shows confirmed value + pending value; after acknowledgement the unit shows clean with provenance `external` |
| ST-03 | Same, provider times out | The outbound call has no response | Status shows **pending verification**; the next read of the provider resolves it; no second send happens before that read |
| ST-04 | Same, provider rejects (e.g. unit occupied) | Acknowledgement is a rejection | Pending value removed; the reason is shown in plain English; an exception is created only if the rejection blocks an arrival today |
| ST-05 | `roomStatus` = portico, PMS still editable | A PMS user sets a unit from dirty to clean | Portico does not change its value, raises a discrepancy to the housekeeping supervisor and re-sends its value (CR-6) |
| ST-06 | Same | A PMS user sets a unit from clean to dirty | Portico creates a re-clean request linked to the external change; status becomes dirty only through Portico's own update |
| ST-07 | A transition for `reservations` is `frozen` | Any user or API client tries to create a booking | `authority_transition_in_progress` with expected end time; inbound channel messages are queued and applied after `effective` |
| ST-08 | A transition has unresolved pending forward operations | Someone tries to make it effective | Refused with a list of the pending operations |
| ST-09 | `payments` authority is external for a reservation | A user or automation schedules an automatic charge | Refused (CR-8) with an explanation naming the charging system |
| ST-10 | Channel X is active in another publisher | A user activates channel X mapping in Portico | Refused until the other publisher's deactivation is evidenced (CR-7) |
| ST-11 | Change of `charges` authority requested by user A | User A tries to approve it | Refused; a different user with approval permission must approve (CR-10) |
| ST-12 | `external` + `exclusive` requested | `setDataAuthority` is called | Validation error (G-01) |
| ST-13 | Any authority change | It becomes effective | A history row exists with both versions, approver and reason; the event `platform.dataAuthority.changed` is emitted once |
