# Domain map and module contracts

Each bounded context is a package under `modules/` with its own Postgres schema. This document is the
**contract between modules**. Modules are built in parallel against these contracts; change a contract here
first (and tell dependents) before changing code.

Notation: `tx` = the `TxContext` from `@portico/db` (carries tenant, actor, transaction, outbox, audit, clock).
All functions are async. Dates are `LocalDate` strings (`YYYY-MM-DD`). Night ranges are half-open
`[arrival, departure)`. Money is `Money` from `@portico/kernel`.

## Module catalog

| Module | Schema | Owns | Wave |
|---|---|---|---|
| `platform` | `platform` | Organizations (tenants), environments, brands, regions, properties (+profile, timezone, currency, **business date**), legal entities, owners & unit ownership, departments, outlets, plans & entitlements, policies with inheritance & local overrides | 0 → 1 |
| `identity` | `identity` | Staff users, credentials, MFA, SSO links, sessions, roles, role assignments (scoped), API clients, permission catalog | 0 |
| `inventory` | `inventory` | Unit types, units, features, composite units, availability ledger, holds, assignments, unit blocks (OOO/OOS/house use), authorized overbooking, availability explanations | 1 |
| `rates` | `rates` | Rate plans (base/derived), prices, restrictions, promotions, packages, inclusions, allowances, meal plans, cancellation/guarantee/deposit policies, tax & fee rules, **quote engine**, terms snapshots | 1 |
| `guests` | `guests` | Guest profiles, companies, agencies, contacts, preferences, alerts, consent, identity documents (encrypted), duplicates, reversible merges, cross-property sharing | 1 |
| `reservations` | `reservations` | Bookings, stays, segments, occupants, booking lifecycle, change previews, waitlist, room moves, check-in/out workflows, front-desk views, shift handover | 1 |
| `finance` | `finance` | Chart of accounts, journal, folios, postings, charge codes, billing rules, transfers, deposits ledger, receivables & aging, credit limits, invoices/credit notes (fiscal ledger), cashier sessions, FX rates | 1 |
| `payments` | `payments` | Payment accounts (Stripe Connect), payment methods (tokens), authorizations, captures, refunds, disputes, payouts, payment requests/links, VCC, provider webhooks, reconciliation | 1 |
| `operations` | `operations` | Unit condition, housekeeping tasks & assignments, inspections, DND, discrepancies, lost & found, generic tasks + escalation, service requests, maintenance work orders, assets, preventive schedules | 1 |
| `day-close` | `day_close` | Day Close runs, steps, exceptions, statistics snapshots | 2 |
| `distribution` | `distribution` | Channels, connections, mappings, ARI outbound queue, inbound message log (revisions), acks, discrepancies, connection health, adapters (simulator, Channex), booking-engine API | 2 |
| `groups` | `groups` | Group sales pipeline, blocks, allotments, pickup, release, rooming lists, function space, events, event orders | 2 |
| `comms` | `comms` | Conversations, messages (original + translations), channels (email/SMS/WhatsApp), templates, automations (trigger/condition/action + run history) | 2 |
| `resort` | `resort` | Outlet charge intake (POS), meal-plan entitlement consumption, transfers & manifests, activities/spa sessions, resources, waivers, itineraries, weather disruptions | 3 |
| `analytics` | `analytics` | Metric definitions, daily facts, report catalog, drill-down, data-quality checks | 2 |
| `integration` | `integration` | **Connector framework** (catalogue of connectors with workflow-level capabilities, connection lifecycle with the 9-step setup journey, encrypted credentials, mappings with suggestions + review, exchange log, sync runs, health, exceptions), webhook subscriptions & deliveries, partner apps; later: import/migration jobs & reconciliation, data export | 1 (framework) / 2 (migration) |
| `ai` | `ai` | Assistant sessions, permission-aware retrieval, cited answers, action proposals requiring approval | 3 |
| `billing` | `billing` | Monoclay's own SaaS subscriptions & invoices to organizations (Stripe Billing on the platform account) — never mixed with hotel money | 3 |
| `access` | `access` | Door locks, key encoders, RFID wristbands, mobile keys: issue/duplicate/extend/cancel on move & checkout, lock-vendor connectors (often via local connector), manual fallback, key audit | 2 (spec: docs/specs/access.md) |
| `guest-experience` | `guest_experience` | Guest web portal & kiosk: pre-arrival, online check-in (registration card, ID, e-signature, authorization), upsells, itinerary, requests, chat, digital folio, express checkout, feedback | 3 |
| `crm` | `crm` | Segments, consented campaigns, abandoned-booking recovery, surveys/NPS, reputation (reviews & replies), loyalty/recognition, gift vouchers | 3 |
| `contracting` | `contracting` | Tour operator / DMC / wholesale contracts: seasons, net rates, allotments & release, stop-sale, combinable offers, statements (Maldives-critical) | 2 |
| `accounting` | `accounting` | Back-office accounting on the finance ledger: GL journals, period close, AP, bank reconciliation, fixed assets, budgets, consolidation, owner statements, financial statements, tax-return data, ERP exports | 3 |
| `fnb-pos` | `fnb_pos` | Outlet point of sale: menus, tables, orders, kitchen tickets/KDS, split checks, room charge with posting privileges, meal-plan consumption, voids/comps, offline tablets | 3 |
| `procurement` | `procurement` | Suppliers, requisitions, approvals, purchase orders, receiving, three-way match → AP, import/landed cost | 3 |
| `stock` | `stock` | Goods inventory (not accommodation): items, stores, issues/transfers, par levels, counts, costing, recipes & menu costing, minibar & amenity consumption | 3 |
| `workforce` | `workforce` | Staff records, rosters from forecast, time & attendance, leave, staff housing, certifications, work permits, service-charge distribution; payroll export (computation is a boundary) | 4 |
| `concessions` | `concessions` | Third-party operators inside resorts (dive, spa, boutique): room charges on their behalf, revenue share, settlements; utilities & sustainability metering | 4 |

Dependency direction (who calls whom synchronously). Arrows point at the provider. No cycles allowed.

```
reservations ─► inventory, rates, guests, finance, payments(port), platform
payments     ─► finance (ledger port), platform
finance      ─► platform
operations   ─► inventory (unit blocks), platform        reservations ─► operations (unit condition read)
day-close    ─► reservations, finance, payments, inventory, operations, platform
distribution ─► reservations, inventory, rates, platform
groups       ─► inventory, rates, reservations, finance
resort       ─► reservations, finance, guests, operations
comms        ─► guests, reservations (read), operations (tasks)
analytics    ─► reads events + module query APIs
everything   ─► identity (authz), platform (property/business date)
```

Asynchronous reactions use **domain events** (outbox). Event type naming: `<module>.<aggregate>.<pastTenseVerb>`.

---

## Shared types (from `@portico/kernel`)

```ts
type Uuid = string;                 // UUIDv7
type LocalDate = string;            // 'YYYY-MM-DD'
interface Money { amountMinor: number; currency: string }   // integer minor units, ISO-4217
interface DateRange { from: LocalDate; to: LocalDate }      // half-open [from, to)
interface Occupancy { adults: number; childrenAges: number[] }
type EntityRef = { type: string; id: Uuid };                 // e.g. { type: 'stay', id }
```

---

## platform (provider)

```ts
getProperty(tx, propertyId): Promise<Property>          // id, name, profile, timezone, baseCurrency, legalEntityId, businessDate, classification
getBusinessDate(tx, propertyId): Promise<LocalDate>
advanceBusinessDate(tx, propertyId, expected: LocalDate): Promise<LocalDate>  // only Day Close; optimistic (expected must match)
getLegalEntity(tx, legalEntityId): Promise<LegalEntity> // id, name, taxId, countryCode, baseCurrency
hasEntitlement(tx, feature: string): Promise<boolean>
// Data authority (system of record) — ADR-0014. Domains: reservations, availability, rates, guestProfiles,
// charges, payments, roomStatus, maintenance, accounting.
getDataAuthority(tx, propertyId, domain): Promise<DataAuthority>   // { authority: 'portico'|'external', connectionId, writeMode }
assertWritable(tx, propertyId, domain): Promise<'portico' | 'forward'>  // throws external_system_of_record when read_only
resolvePolicy<T>(tx, propertyId, key: string): Promise<{ value: T; source: 'default'|'organization'|'brand'|'region'|'property' }>
```
Events: `platform.property.businessDateAdvanced`, `platform.policy.changed`, `platform.dataAuthority.changed`.

## identity (provider)

```ts
authorize(ctx, permission: string, scope?: { propertyId?: Uuid }): Promise<void>  // throws ForbiddenError
can(ctx, permission, scope?): Promise<boolean>
listAccessiblePropertyIds(ctx, permission): Promise<Uuid[] | 'all'>
```
Permission keys: `<module>.<resource>.<action>`, registered by each module's `ModuleDefinition.permissions`.

## inventory (provider)

```ts
// Inventory is counted per unit type per night. All mutating calls lock affected rows in a deterministic
// order (unitTypeId, date) and either fully succeed or throw.
consume(tx, { propertyId, unitTypeId, nights: DateRange, quantity: number, ref: EntityRef,
              overbooking?: { authorizedBy: Uuid; reason: string } }): Promise<void>
   // throws InventoryUnavailableError { shortNights: { date, available }[] }
release(tx, { ref: EntityRef, nights?: DateRange }): Promise<void>          // release all or part
changeConsumption(tx, { ref, from: {...}, to: {...} }): Promise<void>       // atomic move between types/dates
createHold(tx, { propertyId, unitTypeId, nights, quantity, expiresAt, ref }): Promise<{ holdId }>
convertHold(tx, { holdId, ref }): Promise<void>                             // hold → consumption
assignUnit(tx, { unitId, ref, nights }): Promise<void>                      // throws UnitAssignmentConflictError { conflicts: EntityRef[] }
unassignUnit(tx, { ref, nights? }): Promise<void>
blockUnit(tx, { unitId, nights, kind: 'out_of_order'|'out_of_service'|'house_use', reason, sourceRef? })
   : Promise<{ blockId; affectedAssignments: { ref: EntityRef; nights: DateRange }[] }>
releaseBlock(tx, { blockId }): Promise<void>
getAvailability(tx, { propertyId, unitTypeIds?, range }): Promise<AvailabilityCell[]>   // includes breakdown
explainAvailability(tx, { propertyId, unitTypeId, date }): Promise<AvailabilityExplanation>
findAssignableUnits(tx, { propertyId, unitTypeId, nights }): Promise<UnitCandidate[]>
getUnit / listUnits / getUnitType / listUnitTypes
```
Events: `inventory.availability.changed` (coalescible, for distribution), `inventory.unit.blocked`,
`inventory.unit.unblocked`, `inventory.assignment.changed`.

## rates (provider)

**Canonical shapes: `modules/rates/README.md` § Provider contract** (merged 2026-11-07; reservations and finance adapt).

```ts
quote / quoteDetailed(tx, QuoteRequest): Promise<Offer[]> / { quoteId, configVector, offers }
   // channel is derived from the principal; bookingDate = today unless rates.quote.backdate;
   // companyId is staff-only and verified; non-staff never see unbookable offers.
   // Offer.taxesAndFees: TaxLine[] (TaxLine.basis, nature, base|null, quantity, fixedAmount, fx, taxPointDate, estimated)
priceChange(tx, { terms, change }): Promise<{ nightly, penalties, before, after, difference, violations, terms }>
   // verifies the seal first; supports ratePlanId / typeChange / asOf; returns new sealed terms
overridePrice / complimentaryTerms(tx, …): Promise<TermsSnapshot>   // rates.price.override, audited; Green Tax kept on comps
evaluateCancellationPenalty(terms, at, { event?, nights? })          // pure; basis = price + hotel fees, never levies
instantiatePaymentSchedule(terms); postingPlan / postingChargeLines(terms, stayId)  // lines carry agreedRuleVersionIds
levyDays(checkInAt, checkOutAt, 12) / levyTrueUp(terms, { checkInAt, checkOutAt })  // Green Tax 12-hour rule
computeTaxes / computeTaxesDetailed(tx, { lines: ChargeLine[], fullPaymentDate?, expectedInvoiceDate?,
                                        ruleVersionIds?, fxRates? })  // single tax engine for every charge
getRulePackStatus(tx, propertyId)                                     // finance live gate (adviser-confirmed rules)
recordPlanSale / releasePlanSale; getRatePlan / listRatePlans
```
`TermsSnapshot` v1 is a self-contained JSON document persisted by reservations, sealed with HMAC-SHA256
(`seal`, `supersedesSeal`; key `PORTICO_TERMS_SEAL_KEY`, required in production); `verifyTerms(terms)`. It is
sufficient to post every night's charges without reading current rate configuration.
**Breaking renames for consumers:** `TaxLine.kind` → `basis`; `paymentDate` → `fullPaymentDate` +
`ChargeLine.taxPointSplits`; `nights`/`candidateTerms` → `nightly`/`terms`; plain hash → `seal`; finance
`taxGroup`/`priceMode` → `taxCategory`/`taxInclusion`.
**Ports rates needs:** `listUnitTypes` (inventory, bound), `companyExists` (guests, bound), `channelForApiClient`
(distribution, wave 2; until then API clients sell as `api_client:<id>`), `affectedAgreements` (reservations/finance,
for the tax change report).
Events: `rates.prices.changed`, `rates.restrictions.changed` (for distribution).

## guests (provider)

```ts
resolveProfile(tx, input: ProfileInput, opts?: { matchStrategy }): Promise<{ profileId; created: boolean; possibleDuplicates: Uuid[] }>
getProfile(tx, profileId): Promise<GuestProfile>        // respects cross-property sharing policy
getCompany(tx, companyId): Promise<Company>
recordStayHistory(tx, { profileId, stayRef, propertyId, ... }): Promise<void>
mergeProfiles(tx, { survivorId, mergedId, reason }): Promise<{ mergeId }>   // reversible
unmergeProfiles(tx, { mergeId, reason }): Promise<void>
```
Events: `guests.profile.merged`, `guests.profile.unmerged` (other modules re-point references by event).

## reservations (provider)

```ts
getStay(tx, stayId) / getBooking(tx, bookingId)
listInHouseStaysForNight(tx, { propertyId, date }): Promise<StayForPosting[]>   // Day Close
listDueArrivals / listDueDepartures (tx, { propertyId, date })
markNoShow(tx, { stayId, idempotencyKey })                                      // Day Close
ingestChannelBooking(tx, { connectionId, externalId, revision, payload: CanonicalChannelBooking })
   : Promise<{ outcome: 'created'|'modified'|'cancelled'|'duplicate'|'conflict'; bookingId? }>
```
Events: `reservations.booking.confirmed|modified|cancelled`, `reservations.stay.checkedIn|checkedOut|
moved|extended|shortened|noShow`, `reservations.stay.relocationRequired`.

## finance (provider)

```ts
openFolio(tx, { propertyId, owner: EntityRef, payer: PayerRef, label? }): Promise<{ folioId }>
postCharge(tx, { propertyId, folioId? | target: EntityRef, chargeCode, amount: Money, quantity?,
                 serviceDate: LocalDate, description, sourceRef: EntityRef, idempotencyKey,
                 taxMode?: 'compute'|'provided', taxLines?: TaxLine[], allowanceRef? })
   : Promise<{ postingIds: Uuid[]; folioId }>     // billing rules decide the folio when target is a stay/booking
recordPayment(tx, { folioId, amount, paymentRef: EntityRef, method, idempotencyKey }): Promise<{ postingId }>
recordRefund(tx, { folioId, amount, refundRef, originalPaymentRef, idempotencyKey })
recordDeposit(tx, { bookingId, amount, paymentRef, idempotencyKey })        // liability
applyDeposits(tx, { bookingId, toFolioId })                                  // at check-in
recordPayout(tx, { legalEntityId, payoutRef, gross, fees, net, currency, idempotencyKey })
getFolioBalance / listFolios(tx, { owner })
getUnbalancedItems(tx, { propertyId, businessDate })                          // Day Close checks
```
Events: `finance.posting.created`, `finance.folio.settled`, `finance.invoice.issued`.

## payments (provider)

**Canonical shapes: `modules/payments/README.md` § Provider contract** (merged 2026-11-07). Every call runs in the
caller's transaction, takes an `idempotencyKey`, and calls the provider after commit.

```ts
createPaymentRequest(tx, { propertyId, legalEntityId?, payer, amount, purpose, ref: LedgerRef, expiresAt, idempotencyKey })
authorize(tx, { propertyId, methodId, amount, ref, idempotencyKey })   // returns 'processing'; settles after commit
                                                                       // (payments.authorization.authorized|failed)
capture / charge / refund(tx, …)
getPaymentStatus(tx, ref)   // read FIRST; never charge again while pending_verification
listUnresolved(tx, { propertyId })
```
`LedgerRef = { type: 'folio' | 'booking'; id }` (booking = deposit). Refusal codes: `ledger_target_unknown`,
`ledger_target_other_property`, `wrong_merchant_of_record`, `payment_pending_verification`,
`collection_owned_by_payment_request`, `duplicate_reference`, `mit_not_agreed`, `card_payments_unavailable` (503),
`payment_declined` (402).
**Port payments needs from finance — `LedgerPort`** (`modules/payments/src/ports.ts`, bound in composition via
`financeLedgerForPayments`): `describeTarget(tx, ref) → { propertyId, legalEntityId } | null` (checked before any
money moves), postings carrying property + legal entity + clearing account per provider, `markPaymentVerified`,
`recordSettlementFees`. Until finance merges, folio collections are refused (503) and deposits are flagged
"not yet on the bill".

## operations (provider)

```ts
getUnitCondition(tx, unitId): Promise<{ condition; inspectedAt?; discrepancy? }>
listUnitConditions(tx, { propertyId }): Promise<...>
createTask(tx, { propertyId, departmentId, kind, title, ref?, dueAt?, priority }): Promise<{ taskId }>
```
Consumes: `reservations.stay.checkedOut` (→ unit dirty + departure clean task), `reservations.stay.moved`,
`inventory.unit.blocked`. Emits: `operations.unit.conditionChanged`, `operations.inspection.failed`,
`operations.workOrder.created|completed`, `operations.task.escalated`.

## integration (provider)

```ts
// Connector SDK — every connector (simulator PMS, channel hub, POS, accounting, door lock, CSV import…) is a
// ConnectorDefinition registered in code. Capabilities are declared per WORKFLOW, never per vendor:
interface WorkflowCapability {
  workflow: string;                       // e.g. 'reservations', 'roomStatus', 'posCharges', 'journals'
  operations: Array<'read' | 'create' | 'update' | 'receive'>;
  sync: 'realtime' | 'periodic' | 'manual' | 'file';   // a file export is never shown as a live connection
  status: 'supported' | 'limited' | 'unsupported' | 'unverified';
  limitations: string[];
}
getConnection(tx, connectionId) / listConnections(tx, { propertyId? })
getMapping(tx, { connectionId, kind, externalId }): Promise<{ internalId; reviewed: boolean } | null>
   // kinds: property, unitType, unit, ratePlan, outlet, chargeCode, taxRule, ledgerAccount, status
recordExchange(tx, { connectionId, workflow, direction: 'inbound'|'outbound', externalRef, outcome, detail })
raiseException(tx, { connectionId, workflow, severity: 'urgent'|'routine', problem, businessImpact,
                     responsibleParty: 'hotel'|'monoclay'|'vendor', nextStep, ref? }): Promise<{ exceptionId }>
resolveException(tx, { exceptionId, resolution })
markHealthy(tx, connectionId, at) / markDegraded(tx, connectionId, reason)
```
Every outbound call is gated by `assertExternalEffectAllowed(ctx, 'integration.read' | 'integration.write' |
'channel.publish' …)`. Reconnecting never replays queued actions that move money or reopen inventory without
re-validation. Events: `integration.connection.statusChanged`, `integration.exception.raised|resolved`,
`integration.mapping.changed`.

---

## Universal record contract (every module — docs/product/experience-architecture.md)

Every primary aggregate's `GET` response includes, in addition to its own fields:

```ts
status: Record<string, string>      // one entry per status family — never merged into one field
allowedActions: RecordAction[]      // { action, label, enabled, reason?, previewRequired? } computed server-side
issues: RecordIssue[]               // { code, severity: blocking|warning|info, message, owner?, since? }
owner?: RecordOwner                 // responsible user or department
links: RecordLink[]                 // { rel, type, id, title? } related records across modules
provenance?: Provenance             // when data is mirrored/simulated/copied/delayed
```
Types live in `@portico/kernel` (`records.ts`). Each module also:
- declares `recordTypes` in its manifest (the `type` equals the `target.type` used in its audit entries), which
  powers `GET /v1/records/{type}/{id}/history` (one cross-module timeline from the audit log);
- exports a `SearchProvider` (`@portico/db`) with `search` + `summarize`, permission- and property-scope-aware,
  registered in the composition root → `GET /v1/search` and hover previews. Reference: `modules/platform/src/search.ts`.
- never writes secrets or sensitive identity values into audit `before`/`after` (mask them) — history is shown to
  anyone with read permission on the record.

## Integration step (2026-11-07): contract changes applied when every port was bound

- **Port calls carry the authorized property (ADR-0015).** Providers called through a port receive the caller's
  `propertyId`, grant their own keys at that property only (kernel `delegateAtProperty`) and refuse records of another
  property with `scope_mismatch`. Inventory exposes this as `inventoryProvider(service)` (`release`, `changeConsumption`,
  `convertHold`, `assignUnit`, `unassignUnit`, `releaseBlock` take `propertyId`; `getUnit(tx, id, { propertyId })`);
  payments' provider (`getPaymentStatus(tx, ref, { propertyId })`, `capture({ …, propertyId? })`); refunds,
  overbooking authorization, house-use blocks and lock overrides stay explicit.
- **reservations → finance:** `recordDeposit`, `applyDeposits`, `listFolios`, `setBillingRules`, `getDepositBalance`
  carry `propertyId`; `getFolioBalance(tx, folioId, { propertyId })`.
- **reservations → rates:** reservations stores rates' sealed `TermsSnapshot` v1 verbatim (`providerDocument` inside its
  view) and passes it back unchanged; new port function `instantiatePaymentSchedule(terms)` for deposits. Quotes and
  price changes are evaluated "now" (reservations' business date is not a backdated quote).
- **rates `ChargeLine.valueOnly`** (opposite of `levyOnly`): only value-based rules — finance taxes deposits at receipt
  with it (per-guest levies need occupancy and fall due per guest-day).
- **finance `CollectionRequest.payerName`**; payments implements finance's `requestCollection` with
  `paymentsCollectionsForFinance` (a payment request, intent only).
- **operations:** `InventoryPort.blockUnit` / `releaseBlock` carry `propertyId`; `createTask` (provider) does not
  re-check `operations.task.manage`; `operationsForReservations(service)` adapts views to reservations' port.
- **Payer types:** glossary § Payer (`guest | company | agency | house | other`).

### Integration-step fix round (steward review)

- **reservations (provider):** `describeBooking(tx, id) → { propertyId, status } | null` and
  `describeReference(tx, ref) → { propertyId } | null | undefined` (booking or stay owner; routing metadata, no permission
  check, RLS). Bound as finance's `BookingDirectoryPort` and payments' `ReferenceDirectoryPort`.
- **finance:** a booking deposit is refused for an unknown booking (`ledger_target_unknown`) or a booking of another
  property (`scope_mismatch`); never bound to the first property that pays. `financeForReservations` requires `propertyId`
  everywhere; `delegated()` has no organization-wide mode. `CollectionRequest.payer` added; late-charge collection
  requests only what the folio owes.
- **payments (provider):** `describeMethod(tx, methodId, { propertyId }) → { id, owner } | null`; holds and recorded
  authorizations for a stay/booking of another property or nowhere are refused (`reference_other_property`,
  `reference_unknown`).
- **reservations:** another guarantee card or amount at check-in needs `payments.payment.collect`; the card must belong to
  the booking's guest, booker, occupant or payer (also when a booking records its card); amount capped by policy
  `reservations.checkIn.guaranteeCapPercent` (150). Booking/stay `totals` are nullable (`moneyRedacted`) for roles without
  money permissions. Money steps of check-in are attested when charges/payments are external.
- **rates:** `ratesProvider(service)` port surface (rates.quote.read granted at the property; overrides stay explicit);
  `ChargeLine.valueOnly` and `levyOnly` are mutually exclusive. The reservations adapter verifies the seal before use.

### Integration-step fix round 2 (focused re-review, ADR-0015 Amendment 1, fix sweep SW-PAY-1…4)

Breaking changes (no consumer outside the composition root, all bound in the same commit):
- **payments (provider):** `describeMethod` is replaced by `assessGuaranteeCard(tx, { propertyId, methodId, bookingId,
  amount? }) → { usable, basis: 'cardholder_supplied' | 'channel_card' | 'mandate' | null, card, owner, reason }`
  (Amendment 1); `syncBalanceRequest(tx, { propertyId, folioId, outstanding, payer, reason }) → { status, requestId,
  openMinor, detail }` keeps a departed folio's ONE open balance request equal to its debt; `capture` and
  `getPaymentStatus` require the property scope (BS3-3).
- **payments ports:** `ReferenceDirectoryPort` is required (standalone: `standaloneReferenceDirectory`) and returns a
  booking's `source` and `channelConnectionId`; `LedgerPort.assertTargetUsable(tx, ref, scope)` is finance's posting
  predicate, asked before any card is charged.
- **payments contracts:** `mandate.scope { legalEntityId, propertyIds?, purposes, maxAmount?, bookingIds? }`;
  `entryChannel` on a method input is information only (the server derives `entryChannel` on the view: `hosted_entry`
  only for a guest saving their own card); `authorize` and `capture` accept `separateCollection`.
- **finance:** `PaymentsPort.requestCollection` is replaced by `syncBalanceRequest` (called after every balance change of a
  departed folio); `assertTargetInScope(…, direction)` is THE ledger-target predicate (deposit accounts held elsewhere →
  `deposit_account_conflict`); opening-deposit rows take `legacyNotMigrated` and the report `legacyCount`.
- **reservations:** `PaymentsPort.assessGuaranteeCard` (replaces `describeMethod`); booking `guarantee` view gains
  `basis` and `cardOnFile` (the card id only for payment roles); check-in input `guarantee.externalReference` (attestation
  in connected mode); workflow money steps are redacted for roles without money permissions.

### Integration-step fix round 3 (re-review #3, ADR-0015 Amendment 2)

- **Lock order across modules:** collection lock (payments, one key per booking family) → folio row (finance) → payment
  request row (payments). Finance takes the collection lock through `PaymentsPort.lockCollections(tx, { folioIds })`
  before it locks a folio whose balance changes; every payments collection path takes it first.
- **payments ports:** `LedgerPort.describeTarget` returns a folio's `owner` and `payer`; `ReferenceDirectoryPort` returns a
  stay's or booking's `bookingId` and the booking's `people` (owner keys) — the booking family and consent coverage.
- **payments provider:** `lockCollections(tx, refs)`; `syncBalanceRequest` returns `reissued` (never amends in place) and
  `retiredRequestId`; `assessGuaranteeCard` returns `withinConsent` / `consentReason`. Provider interface
  `deactivatePaymentLink` (simulator and Stripe). Payment requests store `family_booking_id`; `link_status` adds
  `deactivating` / `deactivated` (migration 0003).
- **payments contracts:** a mandate must record its `scope`; `maxAmount` is the total the hotel may take on the card.
- **finance:** `PaymentsPort.lockCollections`; consumer `finance.departed-folio-payment-ended` (payments payment
  succeeded/failed) re-syncs a deferred balance request; `transferToReceivables` and `recordPaymentAdjustment` sync.

### Integration-step fix round 4 (re-review #4, ADR-0015 Amendment 3)

- **Lock order across modules (complete):** authorization row → saved-card row (payments: `consentProblem` re-reads the
  card `FOR UPDATE` before the running total) → collection lock (one key per booking family) → deposit account / folio
  row (finance) → payment request row (payments). Finance's `applyDeposits` takes the collection lock (through
  `PaymentsPort.lockCollections`) before the deposit account (R4-P3-2).
- **Consent coverage (Amendment 3):** an agreement covers exactly the bookings in `scope.bookingIds` and the folios in
  `scope.folioIds`. Each named booking carries server-built evidence `scope.bookingEvidence[bookingId] = { at, channel,
  stayIds }`: the booking's stays when the cardholder consented; a stay added later is not covered until the
  cardholder confirms again. No reservations relationship (booker, occupant, payer, profile merge) extends coverage.
  Only the cardholder adds a booking (`confirmCardForBooking`, guest actor). Q160 (a future-stays, payer-account scope)
  is not offered; `scope.coverage` is `named_bookings` only.
- **Running total:** merchant charges and captures (processing, pending verification, succeeded) + every open merchant
  hold (amount − captured − reserved) + this use; a capture or increase counts its own hold once.
- **payments ports:** `ReferenceDirectoryPort.describeReference` returns a stay's `stayCreatedAt` and a booking's
  `stayIds` (reservations); `LedgerPort.balanceOf(tx, ref)` (what a folio owes; null when unknown) and
  `LedgerPort.depositsHeldFor(tx, bookingId)` (deposits held, not yet applied) (finance).
- **payments provider:** `confirmCardForBooking(tx, { methodId, bookingId })` (guest actor only, audited);
  `confirmLinkStopped(tx, { requestId, reason })` and `POST /v1/payments/requests/:id/link-stopped`;
  `syncBalanceRequest` returns `linkReady` and `oldLinkStopping`. Payment requests: `link_status` adds `completed`
  (paid at the provider, payment not yet recorded) and `link_status_at` (migration 0004). Exception kind
  `payment_link_not_stopped` (urgent, owner finance) after 30 minutes without the provider's confirmation.
- **payments contracts:** charge and recorded-payment purposes add `no_show`; `maxAmount` is a total (not per use);
  `scope.folioIds`, `scope.coverage`.
- **finance:** `BalanceSyncResult.linkReady` / `oldLinkStopping` decide the late-charge item text (never "a link is
  open" before one exists).

### Integration-step fix round 5 (re-review #5, ADR-0015 Amendment 4)

- **Consent inputs are facts (rule 1).** The purpose of a collection is derived (`payments/service/purpose.ts`): a booking
  collects a `deposit` up to the deposit its agreed payment schedule asks for (`ReferenceDirectoryPort.describeReference`
  → `depositDue`, from rates `instantiatePaymentSchedule` over the live stays' agreed terms); a folio its `balance` up to
  what it owes (`LedgerPort.balanceOf` − `depositsHeldFor` − payments not yet posted); `no_show` only on the folio of a
  stay whose penalty reservations recorded (`describeReference` → `penalties`: the no-show penalty written by
  `markNoShow`, the only writer, and the cancellation penalty now recorded on the cancelled stay, `stays.cancellation`,
  reservations migration 0002), up to what it still owes (`payments.payments.purpose_basis`, payments migration 0005).
  Client labels (`collectionLabel`) are display text; the one taxonomy is `collectionPurpose` (+ `guarantee`,
  `incidentals` for holds in `mandatePurpose`). The limits are checked under the collection lock.
- **Coverage where money lands (rule 2).** A booking-level reference (the booking, or a folio it owns) is covered only
  while every current stay is in the consent's evidence (no stay list → not covered; the timestamp fallback is gone,
  `ReferenceOwner.stayCreatedAt` removed). A folio is covered only if every owner of its debt is: finance's provenance
  (`finance/service/provenance.ts`) follows transferred postings to the original, routed charges to their rule's owner,
  balance transfers to the source folio's debt, and counts active routing rules into the folio
  (`LedgerPort.debtOriginsOf`). Finance asks payments before it moves card money or debt — `PaymentsPort.cardMoneyMayMeet`
  in `applyDeposits`, `transferPostings` (money onto, debt onto) and the billing-rule writers (create, update, merge) —
  and refuses an uncovered move (`deposit_not_covered_by_card_consent`, `transfer_not_covered_by_card_consent`,
  `routing_not_covered_by_card_consent`). Payments re-checks the destination under the collection lock (charge,
  authorize, capture).
- **Lock order (unchanged, one new edge):** authorization row → card row → collection lock → deposit account / folio →
  payment request. Billing-rule writers take the owner's rule lock, then the destination's collection lock (no path
  takes them the other way round).
- **Staff agreements are capped (rule 3):** `createMethod` refuses an agreement recorded by staff without `maxAmount`
  (`mandate_limit_required`); `scope.noLimitChosenByCardholder` only from the cardholder (guest actor); consent refuses an
  uncapped staff agreement saved earlier (`mandate_limit_missing`). The stored mandate records `recordedBy`; evidence
  `at` and `channel` are the server's (`staff_recorded`, `guest_self_service`, `hosted_entry`, `channel_virtual_card`),
  the client's channel kept as `declaredChannel`.
- **Stable cardholder:** `payments.payment_methods.cardholder_ref` (who the card was saved for; migration 0005) decides
  the guest checks (customer-initiated use, `confirmCardForBooking`); a profile merge rewrites `owner_id` only.
- **Finance owns money-risk states (rule 4):** `confirmLinkStopped(tx, { requestId, reason, expectedVersion })` needs
  `payments.reconciliation.manage`, an open `payment_link_not_stopped` exception and the version (route If-Match);
  a `completed` link is refused (`link_reported_paid`). "Already paid" is recorded only when the request's paid total
  reaches the link's amount.

## Rules for changing a contract

1. Update this file in the same commit as the provider change.
2. Additive changes only once a consumer exists; breaking changes need a new function name.
3. The composition root (`apps/api/src/composition.ts`) is the only place that binds ports to providers.
