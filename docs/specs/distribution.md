# Spec: distribution

Status: Draft v1 · 2026-11-07 · Wave 2 · Schema `distribution` · Prefix `DST`
Entitlements: `distribution.channelManager`, `distribution.bookingEngine` (all editions); `distribution.gds`
(LATER, add-on); `distribution.aggregatedChannels` (LATER).

## 1. Purpose

Sell the same inventory everywhere without pretending distribution is perfect. Distribution publishes
availability, rates and restrictions to channels quickly and provably, ingests channel bookings exactly once and
losslessly, shows staff what Portico knows versus what each channel last acknowledged, detects and resolves
discrepancies, and powers Portico's own direct booking engine and Google free booking links. Decision D7: hub first
(white-label channel API such as Channex), own channel-manager core, OTA simulator; direct certifications later.

## 2. Scope and non-goals

**In scope:** channels, channel connections (built on `integration` connections), product mapping (unit types and
rate plans ↔ channel room/rate codes), ARI outbound queue (delta + periodic full resync), inbound reservation
revision log and acknowledgements, parking of orphan/unmapped messages, discrepancies, distribution health,
allotment policy and channel holdbacks, stop-sell protection, booking-engine API and checkout, Google ARI/free
booking links, VCC metadata intake via the hub's PCI service.
**Non-goals:** availability arithmetic (`inventory`), prices (`rates`), booking state (`reservations`), payment
execution (`payments`), content/photos management and reviews (LATER), OTA contracting (the hotel's), demand-side
travel-selling APIs (not a PMS concern — research 04 §A3).

## 3. Capabilities

### 3.1 Connections and mapping

- **DST-R01** [MUST] Channel connection = integration connection with distribution workflows (`availability`,
  `rates`, `restrictions`, `reservations`) declared per channel with support level (supported/limited/unsupported/
  unverified — readiness §4 capability matrix); the hotel's OTA-side authorization is a tracked prerequisite.
- **DST-R02** [MUST] Mapping of Portico unit types × rate plans to channel room × rate codes; a **completeness
  counter** ("9 of 10 sellable products mapped"); **go-live blocked** while a sellable product is unmapped or a
  channel-required attribute is invalid (e.g. max occupancy below the channel's adults); occupancy and child-price
  compatibility checks.
- **DST-R03** [MUST] Allotment policy per property: `shared_pool` (all channels sell the same availability — default,
  "last unit available") or per-channel caps/holdbacks; staff-only and direct-only units excluded from channels.

### 3.2 ARI outbound

> **Channex readiness (owner direction 2026-11-07):** the first hub adapter is Channex. Owner-stated requirements:
> - an ARI engine that tracks and batches changes from events, with no database polling loops;
> - an outbox queue that batches into Channex API calls within the **20 ARI requests per minute** limit (owner-provided;
>   verify against Channex docs and keep it as configuration per connection);
> - a live webhook endpoint that receives, parses and durably stores booking revisions;
> - an acknowledgement flow back to Channex after each revision is saved.
>
> DST-R04/R05/R08/R09 below and the integration framework (inbound exchange log, ack-after-commit, outbound queue)
> are the design. The rate limit is a token bucket per connection; coalescing merges pending deltas per (room, rate,
> date range) while waiting for budget, so a burst of changes becomes a few large calls, never a backlog of small ones.

- **DST-R04** [MUST] `inventory.availability.changed`, `rates.prices.changed`, `rates.restrictions.changed` →
  coalesced deltas per (channel, room, rate, date range) → sent with idempotent message ids; **target** ≤ 60 s from
  commit to channel acceptance (TARGET, measured); acceptance recorded per message; rejection classified
  (payload error → no retry, exception with plain-language fix; transient → backoff 5 s → 10 s → 20 s → 40 s → every
  1 min for ≥ 30 min, then urgent exception).
- **DST-R05** [MUST] Full ARI resync windows: on connection, nightly (400 days) and on demand for a date range
  ("re-push") — non-destructive (never unlist/relist).
- **DST-R06** [MUST] **Last-known channel state** per cell (what the channel last acknowledged) beside Portico's
  current state; differences older than the freshness SLA are discrepancies.
- **DST-R07** [SHOULD] **Stop-sell protection**: when availability for a unit type falls to ≤ N (policy) or a channel
  is degraded, close that unit type on slow/degraded channels automatically, with the action logged and visible.

### 3.3 Reservations inbound

- **DST-R08** [MUST] Inbound revision log: each message stored immutably keyed by `(connection, channelBookingId,
  revision | hash)`; per-property ordered processing; ack to the hub/channel **only after** the reservations
  transaction commits (`reservations.ingestChannelBooking`).
- **DST-R09** [MUST] Out-of-order handling: a modification or cancellation for an unknown booking is **parked**
  (state `orphan`) and re-processed when the create arrives or by a recovery pull; parked > 15 min → urgent exception.
- **DST-R10** [MUST] **Unmapped bookings** are accepted, a **provisional hold** is placed on the best-matching unit
  type (or flagged on the property total when no match), and a blocking alert is raised — never "accepted without
  decrementing inventory" (research 03 §4.6).
- **DST-R11** [MUST] **Recovery**: "re-request reservations since T" and scheduled reconciliation pulls compare the
  hub/channel's booking list for the window with Portico; missing bookings are ingested, extra Portico bookings are
  flagged (E03).
- **DST-R12** [MUST] Field-loss and price discrepancies from reservations (RES-R30/R33) are shown in the
  distribution discrepancy list with resolution actions.

### 3.4 Health and incidents

- **DST-R13** [MUST] Distribution health console per channel: status (connected / degraded / failing / credentials
  invalid / paused), last successful ARI push, last reservation received, oldest unacknowledged message, queue depth,
  24 h error rate, mapping completeness, open discrepancies, plain-language error feed with one-click fixes, replay
  tools; urgent alerts (push/SMS/email) for delivery timeouts, overbookings and channel incidents, each with
  recommended actions (e.g. relocation shortlist from reservations).
- **DST-R14** [MUST] A channel outage never appears as synced: the property banner states what is stale since when,
  which bookings may be affected, and what to do (S20).
- **DST-R15** [MUST] **No dual control**: if `availability` authority for a property is external, distribution
  connections for that property cannot publish ARI (prevents two systems controlling live inventory — readiness §6).

### 3.5 Direct booking and Google

- **DST-R16** [MUST] Booking-engine API: search (quote + availability), offers with all-in total and transparent
  policies, extras (packages/add-ons), guest details, hosted payment fields (3DS where applicable), booking via
  reservations with the same idempotency semantics; accessibility WCAG 2.2 AA; multilingual; property branding.
- **DST-R17** [SHOULD] Google free booking links/ARI direct integration using the same price computation as the
  booking engine (price accuracy is a launch requirement — research 04 §A5).
- **DST-R18** [LATER] Content/photos API publishing, guest messaging and reviews via hub, aggregated channel
  contracting (single contract/invoice), GDS via CRS, AI-agent booking channels.

## 4. Entities and states

`channel(id, code, name, kind ota|gds|wholesale|metasearch|booking_engine)` · `channel_connection(id,
integration_connection_id, channel_id, property_id, status, settings)` · `product_mapping(connection_id,
unit_type_id, rate_plan_id, channel_room, channel_rate, status)` · `ari_message(id, connection_id, cells, payload_ref,
status, attempts, accepted_at?)` · `channel_state(connection_id, unit_type_id, rate_plan_id, date, last_acked jsonb,
acked_at)` · `inbound_revision(connection_id, channel_booking_id, revision, payload_ref, status, outcome, booking_id?)` ·
`discrepancy(id, kind availability|rate|reservation|mapping|field_loss|price, refs, status, owner)`.

**ARI message:** `queued → sent → accepted | rejected | failed_transient → sent` (retry) · `queued → superseded`
(coalesced by newer state). **Inbound revision:** `received → applied | duplicate | stale | parked | rejected` ·
`parked → applied | rejected`. **Discrepancy:** `open → investigating → resolved | accepted (explained)`.

## 5. Invariants

- **DST-I01** A channel booking revision produces at most one effect (INT-I01, RES-I06).
- **DST-I02** An ack is never sent before the corresponding reservations transaction committed.
- **DST-I03** An unmapped booking always has a provisional hold or an open blocking alert.
- **DST-I04** For each acknowledged ARI cell, `channel_state` equals the last accepted payload.
- **DST-I05** No ARI publication for a property whose `availability` authority is external.

## 6. Cross-module interactions

Calls `reservations.ingestChannelBooking`, `inventory.getAvailability`/holds, `rates` (feeds, quotes for booking
engine), `payments` (VCC registration, booking-engine payments), `integration` (connections, exchange log,
exceptions), `platform` (authority). Consumes inventory/rates change events.

## 7. Events

Emitted: `distribution.ari.accepted|rejected`, `distribution.booking.received|parked|recovered`,
`distribution.discrepancy.detected|resolved`, `distribution.channel.degraded|restored`, `distribution.stopSell.applied`.
Consumed: `inventory.availability.changed`, `rates.prices.changed`, `rates.restrictions.changed`,
`reservations.booking.modified|cancelled` (for direct-channel confirmations), `platform.dataAuthority.changed`.

## 8. Permissions

`distribution.channel.read` · `distribution.connection.manage` ⚑ · `distribution.mapping.manage` ·
`distribution.ari.resync` · `distribution.reservation.recover` · `distribution.discrepancy.resolve` ·
`distribution.stopSell.manage` · `distribution.bookingEngine.manage`.

## 9. UX surfaces

Distribution health console, mapping editor with completeness counter, discrepancy list, channel calendar showing
Portico vs last-acknowledged values, booking-engine configuration and preview, incident banner.

## 10. Proof scenarios and evidence

| ID | Distribution must demonstrate |
|---|---|
| S02 / E02 | Duplicate delivery, modification and cancellation via simulator; reordered cancel-before-create parked then applied; one booking, one cancellation fee, correct inventory. |
| S20 | Hub outage at peak: banner, stop-sell protection on degraded channel, queued ARI resent on recovery, recovery pull finds 2 missing bookings. |
| E03 | Missing bookings recovered after outage, no duplicates. |
| E04 | Channel credentials revoked by the hotel at the OTA: urgent exception, ARI paused for that channel only. |
| S01 (supporting) | A channel booking for the last unit racing a desk sale results in a recorded conflict and relocation workflow, never a silent oversell. |

## 11. Maldives specifics

Resorts rely heavily on wholesalers/tour operators (net rates, allotments — `groups.allotments`) alongside OTAs;
guesthouses rely on Booking.com/Agoda/Airbnb-type channels via the hub. USD pricing; meal-plan rate plans map to
separate channel rate codes; child pricing compatibility is a frequent mapping issue. Hub pricing baseline in
readiness brief §5 (Channex: $130/month + $7/property, dated) — no live connection without owner authorization.

## 12. Competitive inspirations

SiteMinder message semantics, deltas, ack-or-resend, backoff, unmapped handling, mapping counters (research 03 §4.3,
§9); Cloudbeds one inventory and allotment policy (research 03 §3.2); Guesty incident notices and destructive resync
as anti-pattern (research 03 §6.3); hub-first economics and Google direct (research 04 §A5, §A8).

## 13. Open questions

None new. Connectivity contracts and hub selection are tracked in the dependency register (readiness §3–5, D7).

## 14. Adoption modes

- **Standalone alongside an external PMS:** LATER (channel manager or booking engine fed by an external PMS requires
  reading availability/rates from it and forwarding bookings — offered only once a PMS connector declares
  `availability: read` and `reservations: create`). In wave 2 distribution requires Portico authority for
  `availability`, `rates` and `reservations`.
- **Hard dependencies:** `inventory`, `rates`, `reservations`, `payments`, `integration`, `platform`.
- **Connected mode:** publication disabled when `availability` is external (DST-R15); channel booking data may be
  mirrored read-only from the external system for analytics and messaging.
- **Data-authority domains:** respects `availability`, `rates`, `reservations`; owns none (it is a channel to them).
- **Trial:** OTA simulator only; read-only comparison of the hotel's channel mappings imported from its current
  channel manager, listed for review.
