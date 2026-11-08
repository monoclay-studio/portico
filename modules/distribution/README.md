# @portico/distribution — channel hub connectivity (Channex first)

Status: wave 2, increment 1 (`docs/strategy/modules/distribution.md` §5) — the owner's **Channex readiness** direction
(spec §3.2). Readiness: **R3 (implemented and tested internally, against a simulator)**. Nothing here has touched the
real Channex API: that is R4 and needs the owner's Channex staging key (§ "R4 staging plan" below). Steward review fix
round 1 (2026-11-08) is applied: P1-1, P1-2, P2-1…P2-8, G-1 and P3-1…P3-9 (`docs/orchestration/reviews/review-distribution.md`).

## What is built, by owner requirement

| Owner requirement (verbatim) | What exists | Proof (test file → test) |
|---|---|---|
| **1. ARI Engine** — "track and batch availability, rate, and restriction (ARI) changes (no heavy database polling loops)" | Outbox consumer `distribution.ari.capture` on `inventory.availability.changed`, `rates.prices.changed`, `rates.restrictions.changed` (and `platform.dataAuthority.changed`) marks **which cells changed** in a dirty set — never values — per (connection, kind, unit type, rate plan), as merged half-open ranges (overlapping AND adjacent ranges merge). Values are read from inventory (`sellable`) and rates (price + effective restrictions) only when a message is built, so only the latest state per night is ever sent. Full resync on connect, daily at the property's quiet hour (03:00 local by default; 400 nights) and on demand (date range, kinds) — non-destructive: values are re-sent, nothing is unlisted. An event Portico cannot read raises an urgent exception and re-sends the whole kind (never a silent drop). No polling: see below. Last-acknowledged state per cell (`channel_state`) beside Portico's value; the discrepancy check turns unexplained differences into discrepancies and re-pushes them. | `ari-engine.test.ts` "fifty price edits in a minute become ONE message…", "connect → full resync…"; `lifecycle.test.ts` "range resync re-sends only that range…", "a difference no queued work explains becomes a discrepancy…"; `no-polling.test.ts` (A1/A2 inverted and siblings); `change-capture.test.ts` |
| **2. Outbox & Queue** — "batches updates into Channex API calls while respecting their 20 ARI/minute rate limits" | One **open message** per (connection, kind) with a stable, idempotent message id; while it waits (budget, backoff) newer changes are **absorbed** into it, so a burst becomes a few large calls. Per-connection **budget**: 10 availability + 10 restriction requests per minute by default (= the owner's 20 ARI/minute; Channex's published split, see below), configurable per connection, accounted on the **database clock** shared by every worker and counted from each request's completion plus a margin (below). Acceptance recorded per message only when the hub's answer positively confirms it; partial acceptance per value; an answer Portico does not recognise leaves the message **pending verification** (never "accepted"). Classification: payload error → never retried, exception with a plain-language fix, cells shown "not accepted"; transient → 5 s → 10 s → 20 s → 40 s → every minute, urgent after 30 min (retries continue, the exception closes itself on success); 429 → budget paused ≥ 60 s; 401/403 → this connection only stops, urgent exception (E04). Stop-sell protection (DST-R07) and manual stop-sell. No publication while another system is authoritative for availability (all ARI) or rates (rates/restrictions) — DST-I05. Environment safety: demo/trial/training → simulator, sandbox → Channex **staging**, live → production only with platform's live scope (refused on main). | `budget-clock.test.ts`; `hub-modes.test.ts` (ARI answer shapes, calendar-minute limits); `ari-engine.test.ts` "a burst far above the budget never exceeds 10 requests per minute per kind, and every change arrives", "20 concurrent reservations against a limit of 10 → exactly 10 succeed", "transient errors back off 5 → 10 → 20 s on the SAME message…", "a payload error is never retried…", "HTTP 429 pauses the connection budget for a minute", "a revoked key stops ARI for that connection only…", "nothing is published while an external system is authoritative…", "a sandbox organization reaches Channex STAGING only…"; `scenario-s20-hub-outage.test.ts` |
| **3. Webhook Endpoint** — "receive, parse, and durably save booking delivery revisions" | Public `POST /v1/distribution/webhooks/channex/:endpointId` (unguessable endpoint id → organization via a SECURITY DEFINER router). Limits are keyed on the **endpoint**, never on the sender's address (the hub sends every hotel's webhooks from a few addresses): a delivery that passes the token check is never limited; refused requests are counted on one aggregated row per connection and answered 429 past the limit, nothing written. Authentication is **pluggable**: `header_secret` (default — a 256-bit token Portico generates, configured in the Channex webhook `headers`; only its SHA-256 is compared, in constant time) or `hmac_sha256` (`t=…,v1=HMAC(secret,"t.body")`, ±300 s). Each revision is stored **immutably** keyed by (connection, channel booking id, revision id) before answering 200 (the only change ever allowed is the redaction of the guest's data — erasure or retention, below); redeliveries are logged `duplicate`, the same id with other content is a `conflict` (first stands, urgent exception). Notification-only webhooks (`send_data=false`) schedule an immediate pull. Per-property ordered processing (advisory lock) and, within a booking, the hub's order: hub time to the microsecond (zone-less read as UTC), then lifecycle (new < modified < cancelled), then arrival — never a hash; a revision ordered before an applied one is `stale` (decided by Portico, never sent to reservations); two changes the hub cannot separate are applied by arrival with a discrepancy; orphans (modification/cancellation of an unknown booking) are **parked**, re-processed when the creation arrives or a recovery pull finds it, urgent after 15 min, with "Apply as new" / "Dismiss" recovery. Recovery: pull of not-acknowledged revisions (on webhook gaps, on orphan, every 15 min as a safety net) and "re-request since T" reconciliation that also flags Portico bookings the hub does not list. Unmapped bookings are parked with a **provisional inventory hold** and an urgent alert (DST-R10/I03). | `inbound.test.ts` (all), `revision-order.test.ts`, `webhook-abuse.test.ts`, `hub-modes.test.ts` (timestamps, webhook payload, pagination), `scenario-s02-channel-ingestion.test.ts`, `isolation-permissions.test.ts` "…B's token never authenticates A's endpoint" |
| **4. Acknowledge Flow** — "sends back booking confirmations/acknowledgments to Channex once received" | The revision's outcome, the reservations change and the acknowledgement due date commit **in one transaction** (`reservations.ingestChannelBooking` runs in distribution's transaction, in a savepoint). Acks are claimed only in a later transaction and only for final outcomes (also a database CHECK: `ack_state = 'not_due' or state in (applied, duplicate, stale, rejected)`). Retried until accepted (same backoff, urgent after 30 min — Channex e-mails the hotel after 30 min unacknowledged). A revision that failed to apply is never acknowledged: retryable failures retry with backoff; refusals become an exception with Retry / Dismiss (a person's Dismiss is recorded, then acknowledged). Duplicates of a settled revision are acknowledged again, never applied twice. | `inbound.test.ts` "while the booking transaction is still open, no acknowledgement can be sent; after commit it is" (a genuinely concurrent probe), "a revision that failed to apply is never acknowledged…", "a revision the reservations module refuses is rejected…", "a lost acknowledgement makes the hub resend…", "10 concurrent deliveries and 5 concurrent processors…"; `regressions.test.ts` "an acknowledgement can never be due for a revision that is received, failed or parked (CHECK)" |

### Rate limit: why a sliding-window budget, not a classic token bucket

A continuous-refill bucket of capacity N refilled at N per minute allows N requests at second 0 and another N during
the next 59 seconds — up to **2N in one minute**, which a provider counting per minute answers with HTTP 429. The
budget here is a token bucket whose tokens each return 60 s (+ a margin, default 2 s) after use: at most N in **any**
60-second window, bursts of N allowed, N per minute sustained (`src/domain/budget.ts`, property tests in
`domain.test.ts`). It is reserved under a row lock before the call (`reserveBudget`), so concurrent dispatchers can
never exceed it, and since fix round 1 (P2-2):

- one clock: stamps are read from the **database** (`clock_timestamp()`, under the lock), so workers whose own clocks
  differ can neither erase each other's slots nor double-spend (tests simulate time with `budgetClock: 'transaction'`);
- stamps later than "now" are kept and counted; stamps are monotonic (a clock stepping back frees nothing);
- each request is **re-stamped at its completion** (the hub may receive it any time before), so latency jitter (a
  cold TLS handshake on request 1, a warm request 11) can never put 11 requests inside the hub's 60 s.

### No polling loops

Change capture is event-driven (outbox). Nothing scans inventory or rates tables. The only periodic thing is the
scheduler tick (`distribution.dueWork`, every 2 s) that claims organizations whose `next_due_at` has passed — an index
that writers pull **earlier** when they queue work (dirty cells, received revisions, due acks).

The due index holds **only instants at which work can progress** (fix round 1, P1-1): budget slot, backoff, lease
expiry, cool-down, nightly resync, 15-minute feed pull. Work that waits on a person or on another system contributes
nothing — hub work while the key is refused or not yet verified or the environment / live scope refuses the hub
(`hubBlocker`), ARI of a kind another system of record controls, ARI of a paused connection — and the transition that
removes the block pulls the schedule (Verify, authority back to Portico, resume). Health instants count only while in
the future (one wake when the oldest change crosses the freshness target). An organization therefore sleeps at most
until its 15-minute ceiling (which also re-checks conditions that change outside this module: the environment and the
live scope). Standing conditions (`publication_blocked`, `publication_refused`) are written once per state change, not
per pass. Proof: `test/no-polling.test.ts` follows the due index for an hour — a refused key or another system of
record with pending work wakes the organization ≤ 5 / ≤ 6 times (it woke 3 600 times before the fix).

## Channex: what is verified and what is not

`src/adapters/channex/wire.ts` is the **only** file that knows Channex paths, headers and field names; every fact has a
status in `WIRE_FACTS` (asserted by `src/adapters/channex/wire.test.ts`). Direct fetches of `docs.channex.io` are
blocked in this environment (as for research 04); on 2026-11-07 I read **search-engine excerpts** of the Channex docs:

| Status | Facts |
|---|---|
| **v2** (search excerpts, not the live API) | hosts `secure.channex.io` (production) and `staging.channex.io`, path `/api/v1`; header `user-api-key`; `POST /availability` and `POST /restrictions` with `{ values: [...] }` (availability values carry `property_id`, `room_type_id`, `availability`; restriction values `property_id`, `rate_plan_id`); **limits: 10 restriction/price + 10 availability requests per minute per property (20 ARI in total), HTTP 429 when exceeded, pause one minute after an error** (a "coming soon" page says 5 per minute — the limits are per-connection settings for that reason); batch per property every 30–60 s, no limit on values per message, a payload size cap, separate availability and restriction messages, a nightly full update; `GET /booking_revisions/feed` returns NOT acknowledged revisions with `filter[property_id]` and `order[inserted_at]=asc`; `POST /booking_revisions/:id/ack` (one third-party wrapper lists PUT); `GET /booking_revisions/:id`; unacknowledged revisions stay in the feed and after 30 minutes Channex e-mails a warning; revision status `new` / `modified` / `cancelled`; webhook config `callback_url`, `event_mask` (`booking`, or `*`), `headers` (for authentication), `send_data` (default false: then only `event`, `user_id`, `property_id`), `is_active`. |
| **unverified** | `date_from` / `date_to` field names and whether `date_to` is inclusive (assumed inclusive); restriction field names (`rate`, `min_stay_arrival`, `min_stay_through`, `max_stay`, `closed_to_arrival`, `closed_to_departure`, `stop_sell`) and the "no restriction" values (min stay 1, max stay 0); rate as a decimal string; the ARI answer shape and partial acceptance via `meta.warnings[].index`; `Retry-After` on 429; the revision JSON:API shape and attribute names (`booking_id`, `property_id`, `inserted_at`, `ota_name`, `ota_reservation_code`, `currency`, `customer{name,surname,mail,phone,country}`, `rooms[]{room_type_id,rate_plan_id,checkin_date,checkout_date,occupancy{adults,children,infants,ages},days{date: amount}}`, `notes`, `payment_collect`); acknowledging twice succeeds; `GET /bookings?filter[inserted_at][gte]=…` for "re-request since T"; webhook body with `send_data=true`; event names other than `booking_new`; `GET /properties/:id` as a credential test; **Channex webhooks are not signed** (no signature appears in the excerpts; only `headers`) — hence the pluggable verifier. |
| **owner** | 20 ARI requests per minute. |

Added in fix round 1 (all **unverified**): `revisions.ordering` (`inserted_at` precision and zone; no per-booking
ordinal known), `pagination.meta`, `property.title`, `revisions.get_missing` (404), `webhook.manage` (registration id,
`DELETE /webhooks/:id`), repeated acknowledgement answered 404/422 (`ACK_AGAIN_STATUSES`), and the cross-account
reading of `property.get`. Every Channex assumption that `client.ts` used to hold (Retry-After, property title,
pagination meta, 404 = no revision) now lives in `wire.ts`.

The simulator (`src/adapters/channex/simulator.ts`) uses its own literal field names (it does not reuse the adapter's
builders). By default it behaves as `wire.ts` assumes; for every assumption it would otherwise mirror, a **mode** makes
it behave the other plausible way (P2-4): timestamps equal / whole seconds / absent / zone-less µs; ARI answers with a
warning without index, `errors` inside a 200, or `{}`; webhook payload with ids only or different content; multi-page
lists; repeated acknowledgement refused (404/422); exclusive `date_to`; calendar-minute limits counting 429s, without
`Retry-After`. `test/hub-modes.test.ts` shows Portico stays truthful in each (one exception, below: exclusive `date_to`).

## R4 staging plan (once the owner provides a Channex staging key)

Run `sandbox` organization → connection target `staging` → `https://staging.channex.io/api/v1` (the transport allows
only the two Channex hosts). The staging run must check, and record in the readiness register:

0. **First, the facts whose wrong reading Portico cannot detect by itself:** (a) `date_to` inclusive vs exclusive — under
   an exclusive reading a multi-night run silently loses its last night (single-night values are refused and shown
   "not accepted"; `hub-modes.test.ts`); (b) `inserted_at` precision and zone, and whether two revisions of one booking
   can share it (create → modify → cancel within one second); (c) the 2xx ARI answer shape (until confirmed, any other
   shape leaves messages "pending verification"); (d) whether the `send_data` webhook payload equals the feed's
   revision — if not, set the connection setting `webhookPayload: 'notify'` (the feed becomes the only source).
1. **Credentials:** `GET /properties/:id` with `user-api-key` answers 200 for the staging property, 401 for a wrong key,
   and a key of ANOTHER Channex account cannot read this property (Verify is the proof of control that claims a
   production hub property — P2-6).
2. **Availability:** one `POST /availability` with two values (a 3-night run, a 1-night run) — confirm `date_from`/`date_to`
   names and inclusivity by reading back `GET /availability?filter[property_id]&filter[date][gte]&filter[date][lte]`.
3. **Restrictions:** `POST /restrictions` with `rate` as `"250.00"`, `min_stay_arrival`, `min_stay_through`, `max_stay`,
   `closed_to_arrival`, `closed_to_departure`, `stop_sell` — read back via `GET /restrictions`; confirm the clearing values
   (min stay 1, max stay 0) and whether `rate` may be omitted with `stop_sell=true`.
4. **Answer shape:** the 2xx body (`data[].id` task ids, `meta.warnings`), a deliberately invalid value (unknown
   `rate_plan_id`, negative availability) → is it a 422 for the whole request or a warning with an index (partial
   acceptance)? Adjust `parseAriSuccess` accordingly.
5. **Limits:** 11 availability requests inside 60 s → the 11th is 429? `Retry-After` present? Same for restrictions.
   Confirm the 10 + 10 split (or the "coming soon" 5/min) and set the per-connection defaults.
6. **Webhook:** `POST /webhooks` with `event_mask: "booking"`, `headers: { "x-portico-webhook-token": … }`,
   `send_data: true` — create a test booking from the Channex staging OTA tools; capture the real request (headers,
   body) and confirm event names, `payload` content (full revision or `booking_id`/`revision_id` only) and that our
   token header arrives. Check whether Channex offers any signature.
7. **Revisions:** `GET /booking_revisions/feed` and `GET /booking_revisions/:id` real JSON — confirm every attribute in
   `revisionAttributes` (especially `inserted_at` for ordering, `days` amounts, `occupancy.ages`, `payment_collect`)
   and that no card data reaches us without Channex PCI.
8. **Acknowledgement:** `POST /booking_revisions/:id/ack` (POST vs PUT), acknowledging twice (200, or 404/422 —
   Portico counts a refusal as acknowledged only when it holds an earlier 2xx), and that an acked revision leaves the feed.
8b. **Lists and webhooks:** more than one page of feed and bookings (`meta.limit`/`meta.total`); `POST /webhooks`
   answer carries the registration id; `DELETE /webhooks/:id` after a token rotation stops the old deliveries.
9. **Reorder and recovery:** create → modify → cancel quickly; deliver nothing for 15 min (webhook disabled) and
   confirm the 15-minute feed pull recovers all three in order; confirm `GET /bookings` filters for "since T".
10. **Certification:** run Channex's PMS certification checklist; R5 (submitted) and R6 (approved) are separate
    columns — passing staging calls is **not** certification.

## Capabilities vs spec (`docs/specs/distribution.md`)

| Spec | Status | Readiness | Where / proof |
|---|---|---|---|
| DST-R01 connection with workflows, OTA authorization as prerequisite | built: distribution-owned connection (hub, property ↔ hub property, target by environment, encrypted key via the integration secret store, webhook token, settings); per-workflow support levels are the `WIRE_FACTS` statuses. Not an integration-module connection yet (FR-3) | R3 | `connections.ts`; `lifecycle.test.ts` |
| DST-R02 mapping + completeness counter + go-live block | built and tested; occupancy/child-price compatibility checks **not built** | R3 | `lifecycle.test.ts` "counts sellable products, blocks activation until complete…" |
| DST-R03 allotment policy / holdbacks | shared pool (inventory `sellable`) built; per-channel caps **not built** | R3 / R1 | `ari-engine.test.ts` "connect → full resync…" |
| DST-R04 delta ARI, idempotent ids, acceptance, classification | built and tested; ≤ 60 s **target**: in the simulator a change is sent on the next tick (2 s) when budget is free — not measured against Channex | R3 | see requirement 1–2 |
| DST-R05 full resync on connect / nightly / on demand, non-destructive | built and tested | R3 | `lifecycle.test.ts` |
| DST-R06 last-acknowledged state per cell, discrepancies | built and tested | R3 | `lifecycle.test.ts`, `regressions.test.ts` |
| DST-R07 stop-sell protection | built and tested (threshold, cool-down, released automatically; manual stop-sell too) | R3 | `scenario-s20-hub-outage.test.ts`, `lifecycle.test.ts` |
| DST-R08 immutable revision log, per-property ordering, ack after commit | built and tested | R3 | `inbound.test.ts` |
| DST-R09 orphans parked, 15-min urgent | built and tested | R3 | `inbound.test.ts`, `scenario-s02…` |
| DST-R10 unmapped bookings: provisional hold + blocking alert | built and tested (hold on the best match: the mapped room's or rate's unit type; none → property total flagged) | R3 | `inbound.test.ts` "unmapped bookings hold inventory" |
| DST-R11 recovery ("since T") and reconciliation | built and tested (simulator) | R3 | `inbound.test.ts` |
| DST-R12 field-loss / price discrepancies listed | partial: reservations raises field-loss and price issues itself; distribution lists `needs_review` and fallback-rate mapping discrepancies | R3 (partial) | `processOne` |
| DST-R13 health console | built and tested (status, last push, last booking, oldest unconfirmed change, oldest unacknowledged revision, queue depth, budget use, 24 h error rate, mapping completeness, open exceptions/discrepancies, protection); push/SMS/e-mail alerts **not built** | R3 | `scenario-s20…`, `ari-engine.test.ts` |
| DST-R14 outage never shown as synced, banner | built and tested (`GET /v1/distribution/health?propertyId=`) | R3 | `scenario-s20…`, `lifecycle.test.ts` "pause and resume" |
| DST-R15 no dual control | built and tested (activation, resume and every send) | R3 | `ari-engine.test.ts` |
| DST-R16/R17 booking engine, Google | **not built** (increment 3) | R1 | — |

## Invariants and the tests that prove them

| Invariant | Test (each fails with its guard disabled — see "Self-check § 5") |
|---|---|
| DST-I01 one effect per revision (unique key + property lock + re-check after lock + reservations' own idempotency) | `inbound.test.ts` "10 concurrent deliveries and 5 concurrent processors…" |
| DST-I02 no ack before the reservations transaction committed (same transaction; claim later; CHECK) | `inbound.test.ts` "while the booking transaction is still open…", "…failed to apply is never acknowledged…"; `regressions.test.ts` CHECK |
| DST-I03 an unmapped booking has a provisional hold or an open blocking alert | `inbound.test.ts` "parks with a provisional hold and an urgent alert…", "…property total may be overbooked" |
| DST-I04 channel_state = last accepted payload (lease token; sequence guard) | `ari-engine.test.ts` "connect → full resync…", `delivery-edges.test.ts` "a late answer…", `regressions.test.ts` "OLDER message" |
| DST-I05 no ARI while availability (or, for rates, rates) is external | `ari-engine.test.ts` "nothing is published while an external system is authoritative…" |
| ≤ limit requests in any 60 s per connection and kind (atomic reservation) | `ari-engine.test.ts` burst and "20 concurrent reservations"; `domain.test.ts` property test |
| A refused key on any path (ARI, ack, feed, verify, "re-request since T") pauses this connection only, with an urgent exception | `ari-engine.test.ts` "a revoked key…"; `inbound.test.ts` "\"re-request since T\" ingests…" |
| The environment decides the hub at every call (target re-checked) | `isolation-permissions.test.ts` "…never reaches a hub its organization's environment does not allow" |
| Secrets never in responses, idempotency records, audit or the simulator view | `apps/api/test/distribution.test.ts` "permissions, isolation, idempotent create…", "…publishes its calendar" |
| Tenant isolation and permission at the record's property | `isolation-permissions.test.ts` |
| A dismissed revision (a person's decision, acknowledged) is never re-opened by Retry | `inbound.test.ts` "an orphan never matched escalates after 15 minutes; staff can dismiss it…" |
| A production hub property is claimed only by proof (first successful Verify); an unproven connection blocks no one; one proven claim per hub property across all organizations | `hub-claim.test.ts` (B7 inverted, race, release on disconnect) |
| Blocked work contributes no due instant; standing exceptions written once per state change (P1-1) | `no-polling.test.ts` |
| Revision order within a booking: hub µs time, lifecycle, arrival; a creation never waits behind its parked orphan; a revision waits for an earlier unsettled one (P1-2, P2-1) | `revision-order.test.ts`; `domain.test.ts` comparator |
| Budget on one shared clock, future stamps kept, re-stamped at completion (P2-2) | `budget-clock.test.ts`; `domain.test.ts` B5 inverted |
| An unrecognised ARI answer is never "accepted" (P2-3) | `wire.test.ts` B4 inverted; `hub-modes.test.ts` ari.response |
| Webhook limits per endpoint; refused requests cost one aggregated row (P2-5) | `webhook-abuse.test.ts` |
| A revision can only ever be redacted (guest data), never otherwise changed or deleted (P2-7) | `guest-data.test.ts` |
| An unreadable change event raises an exception and re-sends the kind (P2-8) | `change-capture.test.ts` |

## Scenarios

| Test | Demonstrates | Binding |
|---|---|---|
| `test/scenario-s02-channel-ingestion.test.ts` | S02 distribution part + E02 (duplicate, modify, cancel; cancel-before-create parked then applied; older modification stale; acks after commit; redelivery harmless) | platform, inventory, rates, secrets real; hub simulator; **reservations strict fake** (`test/fakes/reservations.ts`) — Money/Inventory lines `.todo` |
| `test/scenario-s20-hub-outage.test.ts` | S20 distribution part: 45-min outage, banner, protection, coalesced queue within the budget, resend and recovery pull (one conflict) on recovery, protection released after the cool-down | same |
| `apps/api/test/distribution.test.ts` | the composition root with the **real reservations provider**: the booking is stored and NOT acknowledged because reservations' rates port is unbound on main (`blocked-by-binding: reservations.rates.termsFromChannelPrices`) | all real |

## Permissions (spec §8)

`distribution.channel.read` · `distribution.connection.manage` ⚑ · `distribution.mapping.manage` ·
`distribution.ari.resync` · `distribution.reservation.recover` · `distribution.discrepancy.resolve` ·
`distribution.stopSell.manage` · `distribution.guestData.erase` ⚑ · `distribution.simulator.control` (organization; never effective in live).
`distribution.bookingEngine.manage` is not registered until the booking engine exists. Role templates (identity):
revenue manager and general manager hold `distribution.*`; the reservations agent now holds `distribution.channel.read`
and `distribution.reservation.recover` (`test/compat/contracts.test.ts`).

## Events

Emitted (payloads are ids and counts only — never guest data; schemas in `contracts.ts`): `distribution.ari.accepted|rejected`,
`distribution.booking.received|parked|recovered`, `distribution.discrepancy.detected|resolved`,
`distribution.channel.degraded|restored`, `distribution.stopSell.applied|released`.
Consumed: `inventory.availability.changed`, `rates.prices.changed`, `rates.restrictions.changed`,
`platform.dataAuthority.changed`; `guests.profile.anonymized` only when the guest-erasure lookup port is bound (FR-7,
not bound on main). An event Portico cannot read raises `change_event_unreadable` and re-sends the kind. The consumer only marks cells dirty, so a late, repeated or reordered event can at
most cause one redundant send of CURRENT values (idempotent by design; no `aggregateVersion` needed).

## Ports and binding status (`apps/api/src/composition.ts`)

| Port | Bound to | Status |
|---|---|---|
| `platform` (property facts, data authority) | `@portico/platform` (system scope) | bound |
| `inventory` (unit types, `sellable`, provisional holds; the hold's property is verified on release) | `@portico/inventory` | bound |
| `rates` (rate plans with channel eligibility; price + effective restrictions; the plan's property is verified) | `@portico/rates` | bound |
| `reservations.ingestChannelBooking` | `@portico/reservations` (system scope, ADR-0015) | bound — but on main reservations' own `rates` port is a stub, so ingestion answers 503 and nothing is acknowledged; real ingestion needs `termsFromChannelPrices` (integration step / rates) |
| `secrets` | integration's `localSecretStore` (the composition's instance; AWS store: integration FR-4) | bound |
| `liveScope` | stub refusing every live channel (platform activation scope G-04 not on main) | **bind with platform activation scope** |
| `guestErasure` (optional: anonymized guest → channel bookings) | **not bound** (reservations has no such lookup — FR-7); tests bind a strict fake | erasure from guests' anonymization waits for FR-7; staff action and retention work now |
| hub transport | `fixedHostHttpTransport` (Channex hosts only) and the persisted simulator | bound |

Provider functions other modules expect from distribution: rates' `channelForApiClient` (wave 2) — **not built**.

## Contract changes

1. Domain map: distribution owns its connections for now (not integration connections) — FR-3 proposes the merge.
2. Identity role templates: reservations agent gains `distribution.channel.read`, `distribution.reservation.recover`.
3. No change to other modules' provider signatures.

## Adoption modes

Wave 2 requires Portico authority for `availability`, `rates` and `reservations` (spec §14): activation and resume
refuse otherwise; publication stops at a switch to external (all ARI when availability is external) and a switch
back re-sends everything. Trial/demo/training: simulator only (a real hub property or key is refused).
Data-authority domains owned: none.

## Known gaps (honest)

- **Real channel ingestion is blocked on main** (reservations → rates `termsFromChannelPrices`); module tests use a
  strict fake. S02 Money and Inventory lines are `.todo`.
- Not an integration-module connection: exceptions and the exchange log are distribution's own tables (FR-3).
- Guest data in stored revisions: redaction by staff action (`distribution.guestData.erase`) and daily retention
  (`guestDataRetentionDays`, default 90 after the stay) are built; erasure triggered by guests' anonymization needs
  reservations' guest → channel booking lookup (FR-7). `reservations.channel_revisions.payload` (other module) holds
  the same data. Card data is never read or stored.
- Under an exclusive reading of `date_to` (unverified) a multi-night run would silently lose its last night; only a
  read-back at R4 can tell (R4 item 0a). Unrecognised ARI answers stay "pending verification" until R4 confirms the
  shape (no automatic read-back: the read endpoint's shape is unverified too).
- Disconnect does not remove the webhook registration at the hub (deliveries then answer 404); a token rotation does
  (Verify removes the old registration first).
- Occupancy-based pricing: only the base-occupancy price is published; child/extra-adult prices and per-occupancy
  Channex rates are not (unverified field shapes).
- Not published: `minAdvanceDays`, `maxAdvanceDays`, `salesLimit` (listed, never silently dropped).
- Per-channel caps/holdbacks, per-OTA restrictions behind the hub, VCC intake (Channex PCI), tax-inclusive/exclusive
  per OTA (one setting per connection), urgent push/SMS/e-mail notifications, the booking engine and Google: not built.
- A cancellation arriving for a booking parked as unmapped waits behind it (the hold stays until staff map or dismiss).
- Simulator fault and outage controls are test tools and not idempotent (their counts add up).
- The ≤ 60 s delivery target is not measured against Channex (simulator only).

## Open questions for the owner

None new: the Channex contract, staging key and certification are tracked as X5/Q23 in the dependency register.
