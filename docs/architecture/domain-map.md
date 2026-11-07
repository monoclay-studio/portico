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

## Rules for changing a contract

1. Update this file in the same commit as the provider change.
2. Additive changes only once a consumer exists; breaking changes need a new function name.
3. The composition root (`apps/api/src/composition.ts`) is the only place that binds ports to providers.
