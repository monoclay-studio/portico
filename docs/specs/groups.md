# Spec: groups

Status: Draft v1 · 2026-11-07 · Wave 2 · Schema `groups` · Prefix `GRP`
Entitlements: `groups.blocks`, `groups.allotments`, `groups.salesPipeline`, `groups.events` (Professional, Resort,
Enterprise — see `docs/product/editions.md`). Multi-stay family bookings without a block are core (`reservations`).

## 1. Purpose

Run group and contracted business from inquiry to settlement with OPERA-level depth and sensible defaults: sales
pipeline, room blocks with original/current/pickup grids, cut-off and release, rooming lists, group billing,
attrition, agency allotments, and function space with event orders that every affected department can see.

## 2. Scope and non-goals

**In scope:** group accounts, sales pipeline (inquiry → proposal → contract), blocks and grids, block statuses and
inventory treatment, cut-off/release, elastic sell limits, rooming lists, pickup, group folio and billing defaults,
deposits schedules, attrition and wash, agency/channel allotments, function spaces, events, event orders, catering
packages, weather alternates.
**Non-goals:** inventory arithmetic (`inventory`), prices (`rates` — group rate plans live there), stays
(`reservations`), folios (`finance`), payment collection (`payments`), CRM marketing (integrate).

## 3. Capabilities

- **GRP-R01** [MUST] Group account: name, kind (wedding, tour series, MICE, incentive, sports, other), contacts
  (guests/companies/agencies), owner (sales manager), market segment, source, dates, status, notes, documents.
- **GRP-R02** [MUST] **Sales pipeline** (`groups.salesPipeline`): stages inquiry → proposal (generated from block +
  events + quote, versioned, sent via comms) → contract (terms snapshot: rates, cut-off, attrition, deposits,
  cancellation, inclusions) → definite; lost/refused with mandatory reason; activity log and next-step dates.
- **GRP-R03** [MUST] **Block** (`groups.blocks`) per group: grid per unit type × night with `original` (contracted;
  frozen when the block is first opened for pickup), `current`, `picked_up`, and `rate` (group rate plan reference
  per night/type); status (glossary): `inquiry`, `tentative`, `definite`, `released`, `cancelled`, `lost`.
- **GRP-R04** [MUST] Inventory treatment by status (defaults, configurable per property): `inquiry` → none;
  `tentative` → none, or an inventory **hold** with an option date if the user chooses "hold space"; `definite` →
  `inventory.consume` with ref `{block}` for the current grid (minus pickup); `released`/`cancelled`/`lost` → release
  of unpicked allocation. Status transitions are a pre-built flow (§4) with mandatory reasons for `cancelled`/`lost`.
- **GRP-R05** [MUST] **Pickup**: stays created from the block (`reservations.createStayFromBlock`) transfer
  consumption from the block to the stay (`inventory.transferConsumption`) — availability unchanged; pickup beyond
  the block is allowed up to the **elastic sell limit** per type/night, otherwise rejected with explanation.
- **GRP-R06** [MUST] **Cut-off**: by date (release unpicked rooms for all nights on that date) or rolling days (each
  night releases N days before it); executed by a scheduled job (and Day Close preflight) idempotently
  (`cutoff:{blockId}:{night}`); preview of upcoming releases on the block and in the sales manager workspace.
- **GRP-R07** [MUST] **Grid changes after contract** (S11): reducing the block after a contractual deadline shows a
  change preview: inventory released per night, pickup unaffected, attrition calculation per contract terms
  (allowed % reduction, penalty per room-night or % of revenue), deposit effects; committing posts the attrition
  charge to the group folio (finance, keyed `attrition:{blockId}:{changeId}`) or records a waiver with permission and
  reason; contract snapshot unchanged; audit shows before/after grids.
- **GRP-R08** [MUST] **Rooming lists**: CSV/XLSX import with column mapping and validation, matching to guest
  profiles (guests duplicates), share-with relationships, per-stay arrival details; errors listed per row; partial
  import allowed; re-import diffs against existing stays.
- **GRP-R09** [MUST] **Group billing**: group folio (master) + default billing rules applied to picked-up stays
  (e.g. group pays room & tax, guests pay incidentals) with "who pays for what" preview (finance FIN-R13–R17);
  deposits via payments collection plan; settlement to receivables.
- **GRP-R10** [MUST] Reports: block pickup by night and type vs original/current, attrition and wash, forecast by
  status (definite/tentative), cut-off calendar, group revenue (rooms + events).
- **GRP-R11** [MUST] **Allotments** (`groups.allotments`): contracts with agencies/channels (tour operators) per unit
  type × night with release days, pickup tracking via agency bookings (agency id on booking), allotment statements,
  automatic release; distribution sees allotment caps where the channel supports them.
- **GRP-R12** [MUST] **Function space and events** (`groups.events`): spaces (capacity by setup style, combinable
  spaces, indoor/outdoor), diary (day/week views), events with times, setups, attendance (expected/guaranteed/actual),
  resources and equipment, catering packages (per person/flat), **weather alternate** space, event orders (BEO-like
  documents) versioned and distributed to departments as tasks with change notifications ("changed since you
  acknowledged"), event revenue posted to the group folio, shared vs exclusive space, waitlist with auto-promotion
  suggestion.

## 4. Entities and states

`group(id, property_id, name, kind, owner_user_id, status, version)` · `proposal(id, group_id, version, content,
sent_at?)` · `contract(id, group_id, terms_snapshot jsonb, signed_at?)` · `block(id, group_id, status, cutoff jsonb,
elastic_limits jsonb, opened_for_pickup_at?, version)` · `grid_cell(block_id, unit_type_id, night, original, current,
picked_up, rate_plan_id)` · `allotment(id, agency_company_id, contract jsonb, status)` · `allotment_cell(...)` ·
`space(id, property_id, name, capacities jsonb, combinable_with[])` · `event(id, group_id?, space_id, alternate_space_id?,
starts_at, ends_at, setup, attendance jsonb, status, version)` · `event_order(id, event_id, version, content, distributed_at)`.

**Block status:** `inquiry → tentative → definite` · `inquiry|tentative → lost` (reason) · `tentative → inquiry` ·
`definite → cancelled` (reason; cancellation terms preview; not allowed while picked-up stays are in house) ·
`definite → released` (all unpicked released at final cut-off; picked-up stays continue). Terminal: `lost`,
`cancelled`, `released`.
**Group (pipeline):** `inquiry → proposal_sent → negotiating → contracted → definite → completed` · any before
`definite` → `lost` (reason).
**Event:** `tentative → definite → in_progress → completed` · `tentative|definite → cancelled` (reason, charges per
contract).

## 5. Invariants

- **GRP-I01** For a `definite` block, inventory consumption with ref `{block}` for each (type, night) equals
  `current − picked_up` (≥ 0), after every command and release job.
- **GRP-I02** `original` grid is immutable once the block is opened for pickup.
- **GRP-I03** Release for a (block, night) happens at most once (idempotency key); pickup never exceeds
  `current + elastic limit`.
- **GRP-I04** Lost/cancelled blocks always carry a reason; their unpicked inventory is fully released.
- **GRP-I05** An attrition charge corresponds to exactly one grid change and is reproducible from the contract snapshot.

## 6. Cross-module interactions

Calls `inventory` (consume/hold/release/transferConsumption), `rates` (group rate plans, quotes), `reservations`
(createStayFromBlock, stays), `finance` (group folio, billing rules, attrition postings), `payments` (deposit
schedules), `guests`, `comms` (proposals, rooming-list requests), `operations` (event order tasks). Domain map arrow
`groups ─► inventory, rates, reservations, finance` plus payments/guests/comms/operations via ports (proposed).

## 7. Events

`groups.block.statusChanged`, `groups.block.gridChanged`, `groups.block.released`, `groups.pickup.changed`,
`groups.event.changed`, `groups.eventOrder.distributed`, `groups.allotment.released`.
Consumed: `reservations.booking.cancelled|modified` (pickup), `platform.property.businessDateAdvanced` (cut-off).

## 8. Permissions

`groups.group.read` · `groups.group.manage` · `groups.block.manage` · `groups.block.changeAfterCutoff` ⚑ ·
`groups.attrition.waive` ⚑ · `groups.roomingList.import` · `groups.allotment.manage` · `groups.event.manage` ·
`groups.space.manage` · `groups.contract.approve` ⚑.

## 9. UX surfaces

Sales pipeline board; group record (header with status, pickup %, next cut-off, balance, owner, next actions);
grid editor (original/current/pickup side by side, heat of pickup); rooming-list import wizard; function diary;
event order editor with department acknowledgements.

## 10. Proof scenarios and evidence

| ID | Groups must demonstrate |
|---|---|
| S11 | Block reduced after the attrition deadline: preview shows released nights, attrition fee per contract, deposit effect; commit posts fee to group folio (or waiver with reason); inventory and grids consistent; audit trail. |
| S04 (supporting) | Group default billing rules applied to picked-up stays. |
| S01 (supporting) | Pickup within block never competes with house availability; beyond elastic limit fails explicitly. |

## 11. Maldives specifics

Weddings and honeymoon groups on beaches/sandbanks need **weather alternates**; incentive groups and dive groups;
tour-operator **allotments** with release days are a core resort commercial model (`groups.allotments`); multi-island
transfers for groups are coordinated with `resort.transfers` manifests.

## 12. Competitive inspirations

OPERA typed block statuses and flows, original/current/pickup grids, cut-off by date and rolling days, elastic sell
limits, posting master, S&EM diary, weather space and event waitlist (research 01 §2.5, §3.4–3.5); defaults pre-built
so properties don't configure everything (research 01 §9 item 6); Mews availability blocks cannot be exceeded and
events are basic (research 02 §2.4, §2.6); Stayntouch group workflow complaints (research 02 §4.4).

## 13. Open questions

None for the owner.

## 14. Adoption modes

- **Standalone alongside an external PMS:** partially — **sales pipeline and function space/events** can run
  standalone (SHOULD) because they do not consume room inventory; blocks and allotments require Portico authority for
  `availability` and `reservations` (forwarding blocks to an external PMS is LATER, only where a connector declares it).
- **Hard dependencies:** blocks — `inventory`, `rates`, `reservations`, `finance`; events — `platform`, `guests`,
  `operations` (event-order tasks).
- **Connected mode:** pipeline/events active; block creation disabled with the system name; group revenue from the
  external PMS may be mirrored read-only for reports.
- **Data-authority domains:** respects `availability`, `reservations`, `rates`, `charges`; owns none.
- **Trial:** copied blocks from the source PMS displayed with pickup comparison; differences listed.
