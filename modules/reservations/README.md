# @portico/reservations

## Checkpoint

- **Done (steward review round, @567dffe → now):** pre-merge fixes R-01, R-04, R-05/R-06, R-07/R-08/R-09, R-18,
  R-19 with regression tests; contract work R-10 (charge codes from policy, `reason`, fees when the service
  happens), R-11 (payments two-phase), R-12 (exported event payload schemas, v2 with `stays[]`, `aggregateVersion`),
  R-13 (inventory adapter bound to the REAL inventory module; S01/S03 run against both), R-14 (reservations
  authorizes; inventory called with system scope), R-15 (rate-plan sales limits), R-02/R-03 part 1 (penalties and
  complimentary terms come from rates). Strict fakes: finance, payments, inventory (`ref` on candidates).
  147 module tests and 33 API tests green; `pnpm lint`, `pnpm typecheck`, boundary check clean; main merged.
- **In progress:** nothing.
- **Next steps (integration step):** see "Known gaps → Next (integration)" below — chiefly binding the real rates
  module (canonical sealed `TermsSnapshot` view adapter), payments, finance, guests and operations ports.
- **Known failing tests:** none.

Bookings, stays and the front desk: where what a booker asked for (booking) meets where a guest sleeps (stay).
Schema `reservations`, spec `docs/specs/reservations.md`, contracts in `docs/architecture/domain-map.md`.
Reservations orchestrates inventory, rates, guests, finance, payments, operations and access through PORTS
(`src/ports.ts`) inside one transaction per command, shows every consequence before it is committed, and keeps
**booking status, stay status, occupancy, unit condition, availability and payment status distinct**.

## What is built (status per spec capability)

Readiness: everything listed as built is **R3 against fakes; provider integration unverified** (review R-28) —
except the inventory path, which is also proven against the REAL inventory module (S01, S03). Rates, finance,
payments, guests and operations are bound to fakes whose semantics follow each module's published contract; the
known differences are listed under "Known gaps → Next (integration)". Nothing here is R4+; the access/keys path has
only the environment-safe fallback adapter (no lock vendor), i.e. R1 for real door locks.

| Spec | Capability | Status |
|---|---|---|
| RES-R01/R02 | Booking (8-char confirmation code, booker profile/company/agency/channel, source, channel & external refs, market segment, commission, guarantee, deposit requirement, notes, requests, tags, owner, version) and stays (occupants with child ages, commercial type, ETA/ETD, arrival details, requests, block reference nullable) | Built |
| RES-R03 | Stay segments partition nights exactly (exclusion constraint + domain check); split stays and moves create segments | Built |
| RES-R04 | Multi-stay bookings; `add_stay` / `cancel_stay` as previewed changes; booking totals aggregate stays | Built |
| RES-R05 | Complimentary / house-use stays with permission + reason, consume inventory, zero room price and value-based taxes; quantity-based levies (Maldives Green Tax) still due and charged to a house folio (the stay's default folio); original totals kept | Built |
| RES-R06 | Guarantee kinds; non-guaranteed release time | Guarantee built; automatic release at release time **not built** (gap) |
| RES-R07/R08 | Separate booking/stay status machines; inventory follows status in the same tx (hold / consume / release) | Built |
| RES-R09 | Tentative option date; job `reservations.expireBookings` (every 60 s) expires lapsed holds and raises an option-date issue (auto-expire only by policy) | Built |
| RES-R10 | Reinstatement / reverse check-in | **Not built** (state machine allows the transitions; commands missing) |
| RES-R11/R12 | Two-step `previewChange` → `commitChange(previewToken)`; token binds booking version + fingerprint of every amount, availability and penalty; 409 `preview_stale` with fresh preview and diff | Built |
| RES-R13 | Optimistic concurrency with field-level diff and who changed it | Built |
| RES-R14 | Channel-owned fields lock | **Not built** (gap) |
| RES-R15 | Extension with the four previewed alternatives (other unit for extra nights, move whole stay, other type chargeable/complimentary, waitlist the extension) | Built (S03) |
| RES-R16 | Shortening / early departure (penalty from agreed terms; release from business date) | Built |
| RES-R17 | Room move from a night, same/different type, reason, chargeable, `reservations.stay.moved`, keys re-encoded | Built |
| RES-R18 | Early check-in / late check-out with fee policy and unit-availability warnings | Built (approval is the previewed commit) |
| RES-R19 | Occupancy change repricing incl. per-person levies | Built |
| RES-R20 | Cancellation penalty from agreed terms in property local time; waive with permission | Built. Deposit forfeit/refund execution belongs to finance/payments (event carries penalties + deposit held) |
| RES-R21 | Waitlist (priority, expiry, never consumes, availability consumer raises an owner issue, confirm consumes) | Built (issue instead of operations task) |
| RES-R22 | Walk-in (tonight prefilled, unit assigned, then check-in workflow) | Built |
| RES-R23 | Upgrade offers [SHOULD] | Not built |
| RES-R24..R27 | Check-in / check-out workflows with persisted steps, resumable, one transaction per step, external steps never repeated | Built |
| RES-R28 | Late charges after check-out | Finance's (folio stays open); departures list shows balances |
| RES-R29 | `markNoShow` idempotent, penalty, release per policy, event | Built |
| RES-R30..R33 | Channel ingestion: idempotent, full-replacement diff, field-loss review, stale revisions, conflicts commit + relocation, channel price agreed + discrepancy issue | Built (S02) |
| RES-R34 | Relocation cases with ranked options; resolution records the chosen option | Built (completion does not itself execute the change: commit the move preview, then resolve) |
| RES-R35 | Arrivals (readiness + single blocker), departures (balances), in-house (overstay flags) | Built; *waiting guests* list not built |
| RES-R36 | Timeline | UI (backoffice); API data available via lists/bookings |
| RES-R37 | Shift handover (owned items, persist until resolved, publish/acknowledge) | Built; escalation of unacknowledged handovers not built |
| RES-R38 | `listExceptions` | Built as `listIssues` (own shape, not yet the common exception shape) |
| RES-R39 | Arrival details | Built (stay `arrivalDetails`) |

Also: universal record contract (status families, server-computed `allowedActions` with plain-language reasons,
`issues`, `owner`, `links`, `provenance`) on bookings and stays; `recordTypes` in the manifest; `SearchProvider`
(confirmation code, channel id/voucher, guest name, unit number); demo seed step `reservationsDemoSeed(service)`.

## Invariants and the tests that prove them

| Invariant | Enforced by | Test |
|---|---|---|
| RES-I01 segments exactly cover the stay | `exclude using gist (stay_id, nights &&)` + `assertSegmentsCover` | `domain/segments.test.ts` |
| RES-I02 consuming bookings' active stays hold inventory, others none | same-tx inventory ops per status | `bookings.test.ts`, `scenario-s02`, `change-preview.test.ts` (cancel releases) |
| RES-I04 agreed terms immutable; re-priced segments supersede | append-only `terms_snapshots` + content hash | `bookings.test.ts` (update rejected), `change-preview.test.ts` (supersedes) |
| RES-I05 transitions per §4.2/§4.3 | `domain/status.ts` | `domain/status.test.ts` |
| RES-I06 same channel revision → one effect, also concurrently | unique `(connection, external_id, revision)` + advisory lock | `scenario-s02` |
| RES-I07 commit matches the preview | fingerprint recomputed under lock | `change-preview.test.ts`, `scenario-s01`, `scenario-s14`, `http.test.ts` |
| RES-I08 codes unique, never reused | unique `(tenant_id, code)` + check constraint | `domain/confirmation-code.test.ts` |
| RES-I09 external step never re-executed on resume | authoritative status read first; key changes only after a provider decline | `check-in-resume.test.ts` (found and fixed a double-authorization bug) |
| RES-I10 handover items removed only by resolution | items table independent of handovers | `front-desk-handover.test.ts` |
| Last unit sold once (S01) | inventory guarded counters under row locks (fake mirrors the specified real pattern) | `scenario-s01-last-unit.test.ts` (2 agents + 10-agent race) |
| No lost update (S14) | `version` + `If-Match`, row lock before work | `scenario-s14-concurrent-edits.test.ts`, `http.test.ts` |
| Tenant isolation (S17) | RLS on every table + property-scoped permissions | `isolation-permissions.test.ts` |

## Scenarios covered

| File | Demonstrates |
|---|---|
| `test/scenario-s01-last-unit.test.ts` (fake AND real inventory) | Both agents preview the last villa as available; exactly one commit wins; the other gets 409 `preview_stale` with a fresh preview, "sold N seconds ago by <name>, booking <code>", and previewed alternatives it can commit at once; 10-agent race on 3 units → exactly 3 |
| `test/scenario-s02-channel-ingestion.test.ts` | Duplicate (incl. concurrent) deliveries → `duplicate`; full-replacement modification with field-loss review; late older revision → `stale` with note; cancellation charges 100% of AGREED price (rates changed meanwhile) once; sold-out channel booking committed with inventory conflict + relocation case + `relocationRequired` event; channel price is the agreed price + discrepancy issue |
| `test/scenario-s03-extension-conflict.test.ts` (fake AND real inventory) | Extension into nights where the assigned villa is taken: preview shows the conflict and five fully previewed alternatives; option (a) commits atomically (segments, consumption, assignments, keys extended); complimentary upgrade; waitlisted extension |
| `test/scenario-s04-family-company.test.ts` | One booking, three stays, child ages drive price and Green Tax (infant exempt by rule data); billing instructions to finance: incidentals folio (default, occupant) + accommodation folio (company) + routing rule; add a stay with one preview |
| `test/scenario-s14-concurrent-edits.test.ts` | Second writer gets 409 with field diff and who changed it; re-apply keeps both edits; stale preview after a concurrent edit; concurrent commits on one booking serialize |
| `test/check-in-resume.test.ts` | Interrupted check-in → run shows succeeded/remaining; payments answers after commit (two-phase): pending verification stays pending, resume never authorizes twice; a non-retryable decline is not re-sent, another card gets a new key; arrivals board shows "pending verification" as the blocker; lock outage needs a recorded manual fallback; failed-inspection unit; skip needs permission; check-out with balance, early departure, keys cancelled |
| `test/change-preview.test.ts` | Stale on price change (agreed nights kept), expiry, replay refusal, split stay supersedes terms, cancellation tier in Malé time, no-show idempotency, room move emits event and re-encodes keys, key outage raises a manual-action issue |
| `test/front-desk-handover.test.ts` | Readiness with one blocker per arrival; departures with balances; Day Close feed from agreed terms; handover publish/acknowledge/persist; S08 relocation on unit block (idempotent consumer); waitlist availability consumer; global search |
| `test/plan-sales.test.ts` | Rate-plan sales limit: a full offer is refused atomically; shortening and cancellation give nights back |
| `test/isolation-permissions.test.ts`, `test/data-authority.test.ts`, `test/http.test.ts`, `test/bookings.test.ts` | S17 isolation (incl. raw SQL under RLS), deny-by-default, property scope, disabled actions with reasons; read_only / forward authority; HTTP ETag/If-Match/Idempotency-Key/problem+json; lifecycle |

### Integration notes (for the orchestrator)

- **Inventory is proven with the real module:** `startDb({ realInventory: true })` + `setupOrg(t, { inventory:
  'real' })` bind `InventoryPort` to `@portico/inventory` through `inventoryPortFrom` (`src/adapters/inventory.ts`).
  S01 (incl. the 10-agent race) and S03 run against both the fake and the real module.
- Reservations recognises inventory errors by **code**: `inventory_unavailable` with `details.shortNights`, and
  `unit_assignment_conflict` (instance `.conflicts` or `details.conflicts[].ref`).

## Ports (src/ports.ts) and binding status

| Port | Functions used | Binding in composition |
|---|---|---|
| `PlatformPort` | getProperty (read with system authorizer: time zone/currency for computation), getBusinessDate, assertWritable, getDataAuthority, resolvePolicy | **Real platform** |
| `InventoryPort` | consume (+`onShortfall`), release, changeConsumption, createHold, convertHold, assignUnit, unassignUnit, findAssignableUnits (+`ref`), getAvailability, explainAvailability (`sold[]`), getUnit, listUnits, listUnitTypes | **Real inventory** via `inventoryPortFrom(inventoryService, { scope: asSystem })` (structural adapter: unit `name ?? number`, candidate `exclusions` → `reason`/`conflictingRefs`, `score` → `fitScore`, `(tx, propertyId)` list signatures). ADR-0015: reservations authorizes the intent; inventory runs with system scope and still enforces integrity and data authority |
| `RatesPort` | quote, priceChange, termsFromChannelPrices, evaluateCancellationPenalty, complimentaryTerms, recordPlanSale, releasePlanSale, instantiatePaymentSchedule | **Real rates** via `ratesPortFrom(rates)` (`src/adapters/rates.ts`): rates' sealed TermsSnapshot v1 is stored verbatim as `providerDocument` inside reservations' view and passed back unchanged; quotes and price changes are evaluated "now" by rates (no backdating); deposits from `instantiatePaymentSchedule`; `termsFromChannelPrices` answers 503 `channel_terms_not_available` until rates builds channel terms. Proven in `apps/api/test/bindings.test.ts`, scenarios S01/S03/S14 |
| `GuestsPort` | resolveProfile (guests' `ProfileInput`: propertyId, givenName/familyName, contactPoints with `source: 'channel'` for OTA data), recordStayHistory (bookingId, role), recordReferenceRepoints | **Real guests** (provider functions bind directly; structurally checked). S15 proves merge/unmerge re-pointing |
| `FinancePort` | openFolio, postCharge, recordDeposit, applyDeposits, getFolioBalance, listFolios, setBillingRules, getDepositBalance — every call carries the authorized `propertyId` | **Real finance** via `financeForReservations(finance)` (property-scoped delegation). S04 proves routing |
| `PaymentsPort` | getPaymentStatus (payments' summary + authorizations, scoped to the property), createPaymentRequest, authorize (`propertyId`; returns the Authorization view, `processing` until the provider answers after commit) — shapes are payments' own | **Real payments** (`payments.service.provider`, ADR-0015 property-scoped). S05 proves the two-phase guarantee |
| `OperationsPort` | getUnitCondition, createTask | **Real operations** via `operationsForReservations(service)`. S07 proves readiness from the real condition |
| `AccessPort` (keys) | issueKeys({stayId, unitId, validFrom, validTo, count, kind: card/wristband/mobile, idempotencyKey}) → {status: issued/pending/unavailable/simulated, keyRefs}; extendKeys (extension/shortening), moveKeys (room move), cancelKeys (check-out / no-show / cancellation) | `environmentAccessAdapter()`: `simulated` in non-live environments (calls `assertExternalEffectAllowed(ctx,'access.key')`), `unavailable` in live until the `access` module is bound |

Key handling rules: check-in treats `unavailable` as a **failed step** that completes only when staff confirm a
manual fallback (recorded with who and what); `pending` keeps the step pending and is re-read on resume; room
moves, extensions and check-out call move/extend/cancel and return/show the result; an unavailable key system
outside the workflow raises an urgent `keys_manual_action` issue (shown in handover and on the stay).

Tests bind every port to fakes in `test/fakes/` (inventory and finance Postgres-backed for transactional and
concurrency fidelity; rates' plan sales Postgres-backed; guests/payments/operations/access in memory with scripted
outcomes). Fakes are strict: finance refuses unknown charge codes, future service dates and late postings without a
reason; payments is two-phase (provider answer after commit), journals by key, refuses a reused key with a
different request and a second in-flight authorization per reference, needs registered methods; rates' penalty and
complimentary rules live only in the fake (`test/fakes/rates-terms.ts`, with fidelity tests).

## Provider API (domain map "reservations (provider)")

`reservationsProvider(service)` exposes exactly: `getStay`, `getBooking`, `listInHouseStaysForNight`,
`listDueArrivals`, `listDueDepartures`, `markNoShow`, `ingestChannelBooking`.

## Contract changes / assumptions (to reconcile in the domain map)

1. `ingestChannelBooking` outcome adds `'stale'` and returns `{ fieldLosses?, conflictIds?, note? }` (spec proposal 2).
2. `markNoShow` returns `{ penalty, penaltyPostingIds, releasedNights, keys, replayed }` (spec proposal 5).
3. New `previewChange(tx, request)` / `commitChange(tx, { previewToken })` (spec proposal 1). The request is a
   discriminated union (`new_booking`, `dates`, `unit_type`, `rate_plan`, `occupancy`, `move`, `early_check_in`,
   `late_check_out`, `add_stay`, `cancel_stay`, `cancel_booking`, `waitlist_extension`).
4. `listExceptions` is provided as `listIssues` (own shape) — the common exception shape is not yet defined.
5. Inventory: `consume(..., onShortfall?)` returns `{ conflictIds? }` (inventory spec proposal 1);
   `changeConsumption` shape is `{ ref, from: { unitTypeId, nights }, to: { unitTypeId, nights } }`;
   inventory's real shapes are mapped by `inventoryPortFrom` (R-13). "Who sold the last unit" reads
   `explainAvailability.sold[]` stay refs and reservations' OWN `booking_versions` (actor, time, code) — no
   `consumedAt` is needed from inventory.
6. Rates: reservations reads only these `TermsSnapshot` fields: per-night `net` + `taxes` (kind tax/fee), `totals`,
   `inclusions`, `policies.cancellation` (`tiers[{deadline:{daysBeforeArrival,time}, penalty}]`, `nonRefundable`,
   `noShow`, `earlyDeparture`), `policies.guarantee.required`, `policies.deposit.items`, `currency`, `priceSource`.
   `priceChange(terms, change)` takes the TARGET state of one segment and returns a candidate snapshot covering
   exactly `change.nights`. **Penalties come from rates** (`evaluateCancellationPenalty(terms, at, { event, nights })`,
   one call per agreement, summed; a no-show is governed by the arrival night's agreement) and **complimentary /
   house-use terms from `rates.complimentaryTerms`** — reservations neither computes penalties nor rewrites terms
   (R-02/R-03). Channel prices: `termsFromChannelPrices` (rates computes every tax; rates does not provide it yet).
   Sales limits: `recordPlanSale`/`releasePlanSale` in the same transaction (`service/plan-sales.ts`; channel
   ingestion records an urgent `sales_limit_exceeded` issue instead of refusing).
7. Finance: `setBillingRules` (finance proposal 3), new `getDepositBalance(bookingId)`; `applyDeposits` returns
   `{ applied }`; `listFolios` returns balance + `isDefault`; assumption: the first folio opened for an owner is
   its default folio.
8. Payments (R-11): two-phase. The guarantee step ALWAYS reads `getPaymentStatus` first; `processing` /
   `pending_verification` keep the step pending (performWorkflow polls once after commit; never re-authorizes);
   the attempt key is `checkin:{runId}:guarantee:{n}` with `n` = declined authorizations counted from payments'
   own records; a non-retryable decline is not re-sent with the same card. Payments' provider functions still
   re-check `payments.payment.collect` on the caller (ADR-0015 pending in payments).
9. AccessPort (new, per orchestrator) as above.
10. GuestsPort follows the guests provider (its README "Contract changes"): `ProfileInput` with `propertyId`;
    `recordStayHistory` with `bookingId`/`role`; `recordReferenceRepoints`. Reservations' own HTTP contract keeps
    simple booking-form fields (firstName/lastName/email/phone…) and maps them in `src/service/guests.ts`.
11. Booking and stay events: payload version 2 with `stays[]` (see Events).
12. Finance (R-10): charge codes come from policy `reservations.chargeCodes` (default `CXL` for cancellation,
    no-show, early departure; `MISC` for early check-in / late check-out); `postCharge` carries `reason` for late
    service dates; time-request fees are posted when the service happens (check-in / check-out confirm).

## Events

Emitted: `reservations.booking.created|statusChanged|confirmed|modified|cancelled`,
`reservations.stay.checkedIn|checkedOut|moved|extended|shortened|noShow|relocationRequired|waitlistAvailable`,
`reservations.checkIn.stepFailed`, `reservations.handover.published|acknowledged`,
`reservations.channelRevision.fieldLoss`, `reservations.forwardedChange.created`.
Payload version 2 (all v1 fields kept) for booking events (`created|statusChanged|confirmed|modified|cancelled`)
and stay events (`checkedIn|checkedOut|moved|extended|shortened|noShow|relocationRequired|waitlistAvailable`):
`stays[]` with, per stay, stayId, bookingId, propertyId, status, commercialType, unitTypeId, unitId, arrival,
departure, eta/etd, earlyCheckIn/lateCheckOut ({time}|null), vipLevel (from booking tags `vip` / `vip:<level>`;
guests owns full recognition), occupants {adults, children, childrenAges}, requests {open, total,
bookingSpecialRequests}. Ids, dates, counts and flags only — no names, contacts or request texts.

Consumed (`service.subscriptions()`): `inventory.unit.blocked` (relocation cases), `inventory.availability.changed`
(waitlist), `guests.profile.merged` (re-point booker/occupant references to the survivor and report them with
`guests.recordReferenceRepoints`; skipped when the merge is no longer active), `guests.profile.unmerged` (restore
exactly `referencesToRestore.reservations` still pointing at the survivor, and `reassigned` stays/bookings/occupants).
Jobs: `reservationsJobs(service)` → `reservations.expireBookings` (tenants found via the SECURITY DEFINER routing
function `reservations.due_booking_expiries`, work inside each tenant's RLS transaction).

## Permissions

`reservations.booking.read|create|update|cancel`, `.booking.waivePenalty` ⚑, `.booking.reinstate` ⚑,
`.booking.overbook` ⚑, `.stay.checkIn|checkOut|move|noShow`, `.stay.checkoutWithBalance` ⚑,
`.stay.complimentary` ⚑, `.stay.houseUse` ⚑, `.stay.skipCheckInStep` ⚑, `.channelBooking.ingest`,
`.channelBooking.overrideLocally` ⚑, `.relocation.manage`, `.handover.manage`, `.waitlist.manage`,
`.forwardedChange.acknowledge`. Every service checks permission with the booking's property scope.

## HTTP (all under /v1; Zod contracts; ETag on reads; If-Match on updates; Idempotency-Key on creates/money)

`POST /reservations/quotes` · `POST|GET /bookings` (filters + cursor) · `GET|PATCH /bookings/:id` ·
`POST /bookings/:id/transitions` · `POST /walk-ins` · `POST /reservations/changes/preview` ·
`POST /reservations/changes/commit` · `GET|PATCH /stays/:id` · `POST /stays/:id/assignment` ·
`POST /stays/:id/no-show` · `POST /stays/:id/waitlist/confirm` · `GET|POST /stays/:id/check-in|check-out` ·
`POST /stays/:id/check-in|check-out/steps/:step[/skip]` · `GET /front-desk/arrivals|departures|in-house` ·
`POST /handover-items`, `POST /handover-items/:id/resolve`, `POST|GET /handovers`,
`POST /handovers/:id/acknowledge` · `GET /reservations/issues`, `POST /reservations/issues/:id/resolve` ·
`GET /relocation-cases`, `POST /relocation-cases/:id/resolve` ·
`POST /reservations/forwarded-changes/:id/acknowledge` · `POST /channel-bookings`.

## Adoption modes and data authority

- Writes call `platform.assertWritable(reservations)`: `read_only` → refused with the system's name;
  `forward` → a **pending forwarded change** record (create/modify/cancel/check-in/check-out/move) is created,
  nothing is applied locally, the booking shows it as an issue (`pending_external_confirmation`) until the
  integration module records `acknowledged|rejected` (`acknowledgeForwardedChange`). Delivery is the integration
  module's job (event `reservations.forwardedChange.created`).
- No-show and channel ingestion are refused in forward mode (Day Close / channels belong to the system of record).
- Mirror mode (reading bookings from an external PMS with provenance `external`) is **not built** (gap).

## Known gaps

Reinstatement and reverse check-in (RES-R10); channel-owned field lock (RES-R14); non-guaranteed auto-release
(RES-R06); upgrade offers (RES-R23); waiting-guests list; handover escalation; `listExceptions` common shape;
payment schedule / collection plans (payments proposal 1) — deposits are previewed from agreed terms only;
cancellation deposit treatment execution (finance/payments react to `booking.cancelled`); no-show MIT charge;
booker-role stay history (only occupants are recorded);
connected (mirror) mode; quote re-validation when confirming an old quote without a hold; relocation completion
does not itself execute the move; segment-level keys for a future-dated move (keys re-encoded only when the move
starts from the current night); the waitlist consumer raises an issue rather than an operations task.

### Next (integration) — known incompatibilities with providers now on main

1. **Rates canonical terms (R-02 rest):** bind the real rates module through a `ratesPortFrom` adapter that maps
   rates' sealed `TermsSnapshot` v1 / `Offer` / `RepricingResult` to the view reservations reads (`ratePlan.id`,
   tax line `category`→`kind`, `structure.tiers`/resolved `tiers[].fromInstant`, `guarantee.structure.accepted`,
   commission `model`), persists rates' document **verbatim** (never re-hashed) and passes it back unmodified to
   `priceChange` / `evaluateCancellationPenalty` / `complimentaryTerms`. `priceChange` input: `typeChange`,
   `asOf` (business date or instant), `ratePlanId` are supported as named by rates; output `nightly`/`terms`.
2. **Channel-price terms:** rates does not construct `priceSource: 'channel'` terms yet (rates README gap); channel
   ingestion needs it (R-01 contract `termsFromChannelPrices`).
3. **Deposits (R-03 rest):** use `rates.instantiatePaymentSchedule(terms)` instead of reservations' `requiredDeposit`.
4. Bind payments, finance, guests and operations ports in the composition root (shapes already follow each
   provider's README); payments/inventory permission re-checks per ADR-0015.
5. Persist inventory's `assignedUnitId` for composite types (R-25) and consume `inventory.assignment.changed`.

## Owner questions

- Answered (orchestrator, MIRA Green Tax FAQ, `docs/readiness/maldives-tax-rules.md` §5): complimentary stays still
  pay Green Tax. Implemented: complimentary/house-use agreed terms keep quantity-based levies (per person-night,
  under-2 exempt as computed by rates) and zero value-based taxes (TGST, percentage service charge); the levy is
  charged to the stay's house folio. Decided by the tax line's `basis` from rates (fallback when absent: `fee`
  lines kept, `tax` lines zeroed).

## Research adopted

Booking as a container of single-unit stays, requested type vs assigned unit (Apaleo/Mews, research 02 §3.3.5);
business-date-relative due in/out and explicit reversals (OPERA, research 01 §3.2); channel modifications as full
replacements with field-loss detection (SiteMinder semantics, research 03 §4.3); per-step status for interrupted
workflows (OPERA EOD, research 01 §4.5).
