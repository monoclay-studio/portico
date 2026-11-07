# Spec: reservations

Status: Draft v1 · 2026-11-07 · Wave 1 · Schema `reservations` · Prefix `RES`

## 1. Purpose

Reservations is where commercial commitments (bookings) and physical stays meet: it captures what a booker
asked for, what the hotel agreed, who is staying, where they sleep, and how each stay moves from expected to
departed. It orchestrates inventory, rates, guests, finance and payments inside one transaction per command,
shows every consequence **before** a change is committed, and gives the front desk an operational picture
where booking status, occupancy, unit condition, availability and payment status are never confused.

## 2. Scope and non-goals

**In scope:** bookings, stays, stay segments, occupants, booking and stay lifecycles, guarantees, sources and
market segments, agreed-terms persistence, change previews, multi-stay bookings, split stays, room moves,
extensions, shortenings, early arrival/late departure, waitlist, complimentary and house-use stays, no-shows,
check-in and check-out workflows (checklists), arrival details, channel booking ingestion entry point,
relocation workflow, front-desk views (arrivals, departures, in-house, waiting guests, Timeline), shift handover.

**Non-goals:** availability arithmetic (`inventory`), prices/taxes (`rates`), profiles (`guests`), folios and
postings (`finance`), payment execution and collection plans (`payments`), unit condition and tasks
(`operations`), channel message transport, mapping and acknowledgements (`distribution`), block contracts and
rooming lists (`groups`), transfers/activities (`resort`), Day Close orchestration (`day-close`).

## 3. Capabilities

### 3.1 Bookings and stays

- **RES-R01** [MUST] Booking: confirmation code (8 characters, Crockford base32 without ambiguous characters,
  unique per organization), property, booker (profile | company | agency | channel), source (`direct_phone`,
  `direct_email`, `walk_in`, `booking_engine`, `channel`, `agency`, `company`, `group`, `import`), channel
  connection and external references (channel booking id, agency voucher number), market segment, guarantee,
  status, notes, special requests, arrival details, tags, owner (responsible staff/team), version.
- **RES-R02** [MUST] Stay: one unit of a unit type for a night range, with occupants (profiles, age at arrival
  for children, primary occupant), segments, commercial type (`standard | complimentary | house_use`),
  status, assignment (via inventory), billing arrangement (default payer, billing rules — stored in finance),
  ETA/ETD, early check-in / late check-out requests and approvals.
- **RES-R03** [MUST] Stay segments partition a stay's nights: each segment has unit type, rate plan, occupancy,
  agreed terms (snapshot id) and assigned unit (optional before arrival). Split stays (different type/rate per
  range) and room moves create segments; a stay's nights are always exactly covered.
- **RES-R04** [MUST] Multi-stay bookings (family, small group without block): add/remove stays with one change
  preview; booking totals and payment schedule aggregate stays. Each stay keeps its own terms and status.
- **RES-R05** [MUST] Complimentary stays require `reservations.stay.complimentary` ⚑ (or an approval) with
  reason; house-use stays require `reservations.stay.houseUse` ⚑; both consume inventory, post zero room
  revenue and are reported separately in statistics.
- **RES-R06** [MUST] Guarantee kinds per glossary; non-guaranteed stays have a release time (from rates policy);
  at release time an expected non-guaranteed arrival becomes an exception for a decision (auto-cancel only if
  property policy `reservations.nonGuaranteed.autoRelease` is on).

### 3.2 Lifecycle (see §4 for transition tables)

- **RES-R07** [MUST] Booking status and stay status are **separate fields** and never merged into one; neither
  encodes occupancy, unit condition, availability or payment status (brief §6). The UI renders each with its
  own vocabulary (`docs/product/ux-principles.md` §4).
- **RES-R08** [MUST] Inventory effect by booking status: `inquiry`, `quoted` → none · `held` → inventory hold
  (expiring) · `tentative`, `confirmed` → consumption · `cancelled`, `declined`, `expired` → released. Waitlisted
  stays never consume. All changes happen in the same transaction as the status change.
- **RES-R09** [MUST] Tentative bookings carry an **option date**; at the option date the booking appears in the
  exceptions list; auto-expiry only if policy says so; a reminder task is created for the owner.
- **RES-R10** [MUST] Reinstatement transitions (cancelled → confirmed, no_show → expected, departed → in_house,
  in_house → expected) are explicit commands with reason and windows (§4.3), re-check inventory, and reverse
  any penalties by linked adjustments in finance (never by deletion).

### 3.3 Change previews and concurrency

- **RES-R11** [MUST] Every change to dates, stays, unit type, rate plan, occupancy, guarantee, billing payer or
  status that has inventory, price, tax, inclusion, deposit, payment-schedule or balance effects is a two-step
  command: `preview(change)` → `ChangePreview` → `commit(previewToken)`. The preview shows per night: availability
  (with "why" for shortfalls), price before/after (agreed nights kept), taxes and fees, inclusions/allowances,
  penalties, deposit and payment schedule changes, projected balance per folio, assignment effects and channel
  effects. (Glossary: Change preview.)
- **RES-R12** [MUST] `previewToken` binds the booking version, inventory ledger versions of affected cells
  (or a ledger snapshot hash) and the rates config vector. Commit re-validates: if anything changed it returns
  `409 preview_stale` with a fresh preview and the differences highlighted; inventory is re-checked under lock
  in the commit transaction regardless.
- **RES-R13** [MUST] Booking aggregate optimistic concurrency (architecture rule 8): every write needs `If-Match`;
  mismatch → `409 version_conflict` with current version, a field-level diff since the caller's version, and who
  changed it (S14). Non-overlapping concurrent changes are **not** auto-merged in wave 1 (the user re-applies
  on the new version with their edits preserved in the form).
- **RES-R14** [MUST] Channel-owned bookings: fields owned by the channel (dates, unit type, price, occupancy,
  cancellation) cannot be changed by staff without choosing *"changed at channel — await modification"* or
  *"override locally"* (permission, creates a distribution discrepancy so the mismatch is visible).

### 3.4 Stay changes

- **RES-R15** [MUST] **Extension** (add nights at end or start): preview checks type-level availability and the
  assigned unit; if the assigned unit is taken on new nights, the preview offers (a) another unit for the new
  nights only (split with move), (b) move the whole stay to a unit free for the full period, (c) another unit type
  (upgrade/downgrade, chargeable or complimentary), (d) waitlist the extension. Each option is a fully previewed
  alternative (S03).
- **RES-R16** [MUST] **Shortening / early departure**: releases nights from the departure business date;
  early-departure penalty per agreed terms; posted via finance at checkout.
- **RES-R17** [MUST] **Room move** (from a night, default the current business date for in-house stays): new
  unit, same or different type, reason (guest request, maintenance, upgrade, relocation), chargeable flag and
  price effect per `reservations.repricing.typeChange`; respects locked assignments; emits
  `reservations.stay.moved` so operations updates condition and tasks (old unit dirty if occupied that day).
- **RES-R18** [MUST] **Early check-in / late check-out**: request → approve/decline with fee per policy (fee
  posted as charge with charge code); approval considers unit availability for the time window (unit condition
  from operations, next arrival assignment); visible on arrivals/departures and to housekeeping.
- **RES-R19** [MUST] **Occupancy change** (add/remove occupant, child age correction): reprice per agreed plan
  rules, recompute per-person taxes (Green Tax), preview.
- **RES-R20** [MUST] **Cancellation**: preview penalty per agreed cancellation policy evaluated at the property's
  local time; options to waive (permission + reason) or apply; deposit treatment (forfeit/refund/transfer to
  credit) per policy, executed by finance/payments after commit.

### 3.5 Waitlist, upgrades and walk-ins

- **RES-R21** [MUST] Waitlisted stays with priority and expiry; when availability for the requested type and
  nights appears (`inventory.availability.changed`), the owner gets a task; confirmation is a normal previewed
  command.
- **RES-R22** [MUST] Walk-in booking in ≤ 3 screens from the Timeline or command palette: dates prefilled
  (tonight), quote, assign unit, guest details, guarantee, check-in.
- **RES-R23** [SHOULD] Upgrade offers: staff-offered (check-in) and guest-offered (pre-arrival via comms/guest
  portal): eligible higher-rank types with price difference per night; acceptance is a previewed change with
  the guest's acceptance captured as evidence.

### 3.6 Check-in and check-out workflows

- **RES-R24** [MUST] **Check-in checklist**, steps configurable by policy `reservations.checkIn.steps`:
  `registration` (required fields per policy, e-signed registration card [SHOULD]), `documents` (identity
  document capture; Q43), `guarantee` (authorization/deposit/payment per terms via payments), `unit` (assigned,
  condition meets `reservations.checkIn.requiredCondition` default `inspected`, overridable with permission),
  `access` (key issue via integration or manual key log), `confirm` (status → `in_house`).
- **RES-R25** [MUST] Each step result is persisted: `done | failed | skipped (permission + reason) | pending`
  (e.g. payment `pending_verification`). An interrupted check-in shows exactly which steps succeeded and which
  remain; resuming never repeats a succeeded external step (idempotency keys from payments/integration).
- **RES-R26** [MUST] `in_house` requires all *mandatory* steps `done` or `skipped` with permission; a `pending`
  payment step allows check-in only if policy permits and creates a follow-up exception with owner.
- **RES-R27** [MUST] **Check-out checklist**: `charges` (warn about pending outlet charges or unposted
  allowance usage), `settle` per folio (payment, transfer to receivables account, transfer to another folio, or
  leave open with permission `reservations.stay.checkoutWithBalance` ⚑), `invoice` (issue fiscal documents per
  policy), `access` (deactivate keys), `confirm` (status → `departed`). Same persistence and resume semantics.
- **RES-R28** [MUST] Late charges after check-out are accepted by finance on the stay's folios (see finance §3.6)
  and appear on the stay record and departures follow-up list.
- **RES-R29** [MUST] **No-show**: `markNoShow(stayId, idempotencyKey)` (Day Close or manual after the arrival
  business date): applies the no-show penalty from agreed terms (charge via payments MIT where guaranteed by
  card; posting via finance), releases inventory per policy `reservations.noShow.releaseNights`
  (`all` default | `keep_first_night`), emits `reservations.stay.noShow`.

### 3.7 Channel ingestion

- **RES-R30** [MUST] `ingestChannelBooking(connectionId, externalId, revision, payload: CanonicalChannelBooking)`
  is idempotent on `(connectionId, externalId, revision)` and returns `created | modified | cancelled |
  duplicate | conflict | stale`. Modifications are full replacements (the payload is the whole booking): the
  module computes a diff against the last applied revision, stores both, and flags **field losses** (e.g. a
  special request or occupant disappeared) for review.
- **RES-R31** [MUST] A revision older than the last applied one is stored as `stale` and not applied. Ordering
  and parking of orphan modifications are handled by `distribution` before calling ingest.
- **RES-R32** [MUST] When inventory is short, ingestion **commits** the booking (`onShortfall:
  'record_conflict'`) because the channel has already confirmed it to the guest, raises an inventory conflict
  and `reservations.stay.relocationRequired`, and returns `conflict`.
- **RES-R33** [MUST] Channel prices are snapshotted as received (`priceSource: 'channel'`); if they differ from
  Portico's quote beyond tolerance, a rate discrepancy is recorded (distribution) — the agreed price is the
  channel's.

### 3.8 Relocation

- **RES-R34** [MUST] A **relocation case** (proposed glossary term *Relocation*) is created for every stay
  affected by an inventory conflict or an out-of-order block: affected nights, options ranked (other unit same
  type; upgrade; other dates; sister property if `portfolio.centralReservations`; external hotel), cost
  responsibility (house account postings for relocation costs), guest communication task (comms), owner, and
  status `open → option_selected → completed | cancelled`. Completing it performs the chosen previewed change.

### 3.9 Front-desk views and handover

- **RES-R35** [MUST] Operational lists with saved views and counts: arrivals (readiness: assigned unit,
  condition, payment/guarantee status, documents, ETA and transfer, alerts, requests), departures (balance per
  folio, late check-out, pending charges), in-house, **waiting guests** (arrived, unit not ready: elapsed time,
  estimated readiness from operations), unresolved issues (exceptions).
- **RES-R36** [MUST] **Timeline** (primary reservation view; `docs/product/ux-principles.md` §9): units grouped by
  type/location × nights; stays as bars showing stay status, lock, alerts; drag to move/extend/shorten producing a
  **change preview** (never a silent commit); unit blocks and conflicts visible; hours/days/months zoom; density
  modes; keyboard operable.
- **RES-R37** [MUST] **Shift handover** per department and shift: composed automatically from open tasks due or
  overdue (operations), exceptions (all modules), financial exceptions (pending verification payments, open
  cashier sessions, departed stays with balance), guest commitments (tasks of kind `guest_commitment`), plus
  free-text notes; every item has an owner; incoming shift acknowledges; unacknowledged handovers escalate.
  Items persist until resolved — never lost at shift change.
- **RES-R38** [MUST] `listExceptions(propertyId, businessDate)` contributes reservations exceptions to Day Close
  and dashboards: arrivals not checked in, departures not checked out, overstays, incomplete check-ins/outs,
  expiring options, unguaranteed past release time, unresolved relocations, channel field-loss reviews.

### 3.10 Arrival details

- **RES-R39** [MUST] Arrival/departure details per stay: transport mode, carrier and flight/vessel number,
  scheduled and estimated times, arrival point (e.g. Velana International Airport), transfer requested (links to
  `resort.transfers` when entitled; otherwise free-text logistics visible to the desk).

## 4. Entities and states

### 4.1 Entities

`booking(id, property_id, code, status, booker_ref, source, channel_connection_id?, external_refs jsonb,
market_segment, guarantee jsonb, option_date?, owner_id?, notes, version)` · `stay(id, booking_id, status,
commercial_type, arrival, departure, eta?, etd?, arrival_details jsonb, requests jsonb, version)` ·
`stay_segment(id, stay_id, nights daterange, unit_type_id, rate_plan_id, occupancy jsonb, terms_snapshot_id,
assigned_unit_id?)` · `occupant(stay_id, profile_id, kind adult|child, age_at_arrival?, primary)` ·
`terms_snapshot(id, stay_id, version, document jsonb, hash, accepted_via, accepted_at, supersedes_id?)` ·
`workflow_run(id, stay_id, kind check_in|check_out, steps jsonb, status, started_by, updated_at)` ·
`channel_revision(connection_id, external_id, revision, payload_hash, outcome, applied_at, diff jsonb)` ·
`relocation_case(...)` · `handover(id, property_id, department_id, shift_start, items jsonb, acknowledged_by?,
acknowledged_at?)` · `change_preview(token, booking_id, booking_version, inventory_hash, config_vector, payload,
expires_at)` (short TTL).

### 4.2 Booking status transitions

| from → to | inquiry | quoted | held | tentative | confirmed | cancelled | declined | expired | completed |
|---|---|---|---|---|---|---|---|---|---|
| inquiry | | ✓ | | | | | ✓ | ✓ | |
| quoted | | ✓ re-quote | ✓ | ✓ | ✓ | | ✓ | ✓ | |
| held | | | | ✓ | ✓ | ✓ | | ✓ hold expired | |
| tentative | | | | | ✓ | ✓ | | ✓ option passed + policy | |
| confirmed | | | | | | ✓ | | | ✓ all stays terminal |
| cancelled | | | | | ✓ reinstate | | | | |

`declined`, `expired`, `completed` are terminal. `completed` does not close folios (late charges remain possible).

### 4.3 Stay status transitions

| from → to | expected | in_house | departed | cancelled | no_show | waitlisted |
|---|---|---|---|---|---|---|
| waitlisted | ✓ (inventory consumed) | | | ✓ | | |
| expected | | ✓ check-in | | ✓ | ✓ (business date ≥ arrival) | ✓ (releases) |
| in_house | ✓ reverse check-in (same business date, no room/package postings yet) | | ✓ check-out | | | |
| departed | | ✓ reinstate (before Day Close of departure business date) | | | | |
| cancelled | ✓ reinstate (booking reinstated, availability) | | | | | |
| no_show | ✓ reinstate (before ledger close of the arrival business date; availability for remaining nights) | | | | | |

Derived (never stored): *arriving today*, *departing today*, *early departure*, *overstay* (in_house and business
date ≥ departure), *late arrival* (ETA passed), *waiting* (checked-in-pending unit readiness flag on arrival).

### 4.4 Workflow run

`not_started → in_progress → completed | abandoned`; steps `pending → done | failed | skipped`, `failed → done`
(retry). `abandoned` keeps step results; restarting creates a new run that imports `done` steps.

## 5. Invariants

- **RES-I01** A stay's segments are non-overlapping, contiguous and exactly cover `[arrival, departure)`.
- **RES-I02** For a booking in `tentative`/`confirmed`, every stay in `expected`/`in_house` has inventory
  consumption with ref `{stay}` for each of its nights on the segment's unit type; for any other status, none
  (cross-module consistency check after every scenario test).
- **RES-I03** An `in_house` stay has an assignment covering the current business date night.
- **RES-I04** Every `confirmed` stay segment references an immutable terms snapshot; a re-priced segment
  references a new snapshot that `supersedes` the old one and records acceptance evidence.
- **RES-I05** Status changes follow §4.2/§4.3 only; each emits exactly one event and one audit record.
- **RES-I06** Ingesting the same `(connection, externalId, revision)` any number of times produces one effect.
- **RES-I07** A committed change matches the preview the user saw: if any previewed amount, availability or
  penalty would differ, commit fails with `preview_stale` (no "surprise" totals).
- **RES-I08** Confirmation codes are unique per organization and never reused.
- **RES-I09** A check-in/out step that caused an external effect (payment authorization, key issue) is
  recorded with its idempotency key and never re-executed on resume.
- **RES-I10** Handover items are only removed by resolution of the underlying item, never by shift change.

## 6. Cross-module interactions

Calls (synchronous, same transaction): `inventory` (consume/release/changeConsumption/holds/assign/explain/
findAssignableUnits), `rates` (quote, priceChange, instantiatePaymentSchedule), `guests` (resolveProfile,
getProfile, getRecognitionSummary), `finance` (openFolio, billing rules, getFolioBalance, postCharge for
penalties/fees, applyDeposits at check-in), `payments` via port (createCollectionPlan, authorize, charge,
getPaymentStatus), `operations` (getUnitCondition, createTask for commitments and relocation follow-ups),
`platform`. Provider to `day-close`, `distribution` (ingest), `groups` (stays picked up from blocks), `resort`,
`comms`, `analytics`, `ai`.

### Proposed contract changes

1. New `previewChange(tx, { bookingId, change, expectedVersion }): ChangePreview` and
   `commitChange(tx, { previewToken })`.
2. `ingestChannelBooking` outcome adds `'stale'` and returns `{ fieldLosses?: FieldLoss[]; conflictIds? }`.
3. New `listExceptions(tx, { propertyId, businessDate })` returning the common exception shape
   (`{ code, severity, ref, ownerId?, blocking, message, actions[] }`) — the same shape is proposed for finance,
   payments, operations and distribution so Day Close and handover can aggregate them.
4. New `createStayFromBlock(tx, { blockId, ... })` used by groups (wraps inventory.transferConsumption).
5. `markNoShow` returns `{ penaltyPostingIds, releasedNights }`.
6. Port to payments: `createCollectionPlan(tx, { bookingId, items })`, `replaceCollectionPlan(...)` on changes.

## 7. Events

Emitted (domain map): `reservations.booking.confirmed|modified|cancelled`,
`reservations.stay.checkedIn|checkedOut|moved|extended|shortened|noShow`, `reservations.stay.relocationRequired`.
Proposed: `reservations.booking.created`, `reservations.booking.statusChanged {from,to}`,
`reservations.stay.reinstated`, `reservations.stay.occupancyChanged`, `reservations.stay.waitlistAvailable`,
`reservations.checkIn.stepFailed`, `reservations.handover.published|acknowledged`,
`reservations.channelRevision.fieldLoss`.
Consumed: `guests.profile.merged|unmerged` (re-point booker/occupant refs), `inventory.unit.blocked` (create
relocation cases for affected assignments), `inventory.conflict.detected`, `inventory.availability.changed`
(waitlist), `payments.payment.succeeded|pendingVerification|resolved` (update guarantee step results),
`operations.unit.conditionChanged` (arrival readiness, waiting guests), `operations.inspection.failed`.

## 8. Permissions

`reservations.booking.read` · `reservations.booking.create` · `reservations.booking.modify` ·
`reservations.booking.cancel` · `reservations.booking.waivePenalty` ⚑ · `reservations.booking.reinstate` ⚑ ·
`reservations.stay.checkIn` · `reservations.stay.checkOut` · `reservations.stay.checkoutWithBalance` ⚑ ·
`reservations.stay.reverseCheckIn` ⚑ · `reservations.stay.move` · `reservations.stay.complimentary` ⚑ ·
`reservations.stay.houseUse` ⚑ · `reservations.stay.overridePrice` ⚑ · `reservations.stay.skipCheckInStep` ⚑ ·
`reservations.stay.markNoShow` · `reservations.channelBooking.overrideLocally` ⚑ · `reservations.relocation.manage` ·
`reservations.handover.manage` · `reservations.waitlist.manage`.

## 9. UX surfaces

Timeline (primary), Arrivals, Departures, In-house, Waiting guests, Booking record (header: code, booking status,
stays with stay status, guarantee, balance by folio, source/channel with trust marker for channel-owned fields,
owner, outstanding issues, next actions), New booking (quote → stays → guests → guarantee → confirm), Change
preview sheet (per-night table + totals + consequences, "Commit" and "Back"), Check-in and check-out
checklists (step list with status icons and resume), Relocation case, Handover board, Exceptions list.
All follow `docs/product/ux-principles.md`.

## 10. Proof scenarios and evidence

| ID | Reservations must demonstrate |
|---|---|
| S01 / E01 | Two agents previewing the last unit both see it available; one commit succeeds; the other gets `preview_stale` with the explanation ("sold 4 seconds ago by Aishath, booking K7P2M9QX") and alternatives. |
| S02 / E02 | Duplicate delivery → `duplicate`; modification diffed with field-loss review; cancellation applies penalty per agreed terms; reordered revision → `stale`. |
| S03 | Extension preview offers the four alternatives; chosen option commits atomically. |
| S04 | One booking, 3 stays, company pays room & tax, adults pay incidentals (billing rules in finance); children ages drive pricing and Green Tax. |
| S05 (supporting) | Check-in `guarantee` step remains `pending` on timeout; resume reads authoritative status, never re-charges. |
| S07 | Failed inspection removes arrival readiness; desk is offered alternative units ranked by condition; waiting-guest timer visible. |
| S08 | OOO on assigned units creates relocation cases for each affected stay with options. |
| S12 | Delayed arrival updates ETA; arrival readiness and dependent itinerary items flagged (with resort). |
| S14 | Concurrent edits: second writer gets 409 with field diff and who changed it; no lost update. |
| S20 | During a channel outage, the desk keeps selling; bookings made locally are queued for channel ARI. |
| E15 | Wrong check-out reversed (reinstate) before Day Close; wrong room move reversed; all audited. |

## 11. Maldives specifics

- Most resort arrivals are via Velana International Airport (MLE) then seaplane, domestic flight or speedboat;
  arrival details are operationally critical (transfer planning, meet-and-greet). Seaplane operations are
  daylight-dependent [domain knowledge, verify per operator]: late international arrivals may require a
  transit night in Malé before the resort stay — modelled as an arrival-date shift (previewed change) or a
  separate booking at another property.
- Check-in often happens on arrival at the island jetty or in the villa (mobile check-in on tablet, RES-R24
  steps usable on touch devices).
- Guesthouse bookings are frequently made by agencies with vouchers (`external_refs.voucher`) and paid by
  bank transfer to the agency's receivables account.
- Green Tax depends on occupants and nights → occupancy changes must reprice taxes (RES-R19).
- Multi-island groups may sell split stays across sister resorts (LATER with `portfolio.centralReservations`).

## 12. Competitive inspirations

- Business-date-relative derived statuses (due in/out) and explicit reversals — OPERA (research 01 §3.2).
- Booking as container of single-unit stays; requested type vs assigned unit with lock — Apaleo/Mews
  (research 02 §3.3.5, §2.4, §6 takeaway a).
- Drag arrival/departure flags with safe server validation; auto-assign without locking the diary — Stayntouch
  (research 02 §4.5, §4.6).
- Channel modifications as full replacements with stable id; diff and field-loss detection — SiteMinder
  semantics (research 03 §4.3, §9.2 items 3–5).
- Interrupted workflow transparency and handover — owner brief §6; OPERA EOD's per-step status (research 01 §4.5).

## 13. Open questions

Q43 (registration requirements affect check-in steps). Product decisions: confirmation code format; no
auto-merge of concurrent edits in wave 1; non-guaranteed auto-release off by default.
