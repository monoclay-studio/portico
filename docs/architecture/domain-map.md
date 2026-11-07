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
| `integration` | `integration` | Public API clients/scopes, webhook subscriptions & deliveries, connector framework (POS, CRM e.g. Salesforce, accounting, door locks), import/migration jobs & reconciliation, data export | 2 |
| `ai` | `ai` | Assistant sessions, permission-aware retrieval, cited answers, action proposals requiring approval | 3 |
| `billing` | `billing` | Monoclay's own SaaS subscriptions & invoices to organizations (Stripe Billing on the platform account) — never mixed with hotel money | 3 |

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
resolvePolicy<T>(tx, propertyId, key: string): Promise<{ value: T; source: 'default'|'organization'|'brand'|'region'|'property' }>
```
Events: `platform.property.businessDateAdvanced`, `platform.policy.changed`.

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

```ts
quote(tx, { propertyId, nights: DateRange, occupancy: Occupancy, unitTypeIds?, ratePlanIds?,
            channelId?, companyId?, promoCode?, bookingDate?: LocalDate }): Promise<Offer[]>
   // Offer = { unitTypeId, ratePlanId, nightly: NightPrice[], inclusions, taxesAndFees: TaxLine[],
   //           totals: { net, taxes, fees, gross }, policies: { cancellation, guarantee, deposit },
   //           restrictionViolations: Violation[], terms: TermsSnapshot }
priceChange(tx, { terms: TermsSnapshot, change: StayChangeRequest }): Promise<RepricingResult>
   // used by change previews: keeps agreed nights at agreed prices, prices new nights by policy
computeTaxes(tx, { propertyId, lines: ChargeLine[], occupancy?, stayContext? }): Promise<TaxLine[]>
   // used by finance for non-room charges too (single tax engine for everything)
getRatePlan / listRatePlans
```
`TermsSnapshot` is a self-contained JSON document (versioned schema) persisted by reservations; it must be
sufficient to post every night's charges without reading current rate configuration.
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

```ts
createPaymentRequest(tx, { legalEntityId, payer, amount, purpose, ref, expiresAt }): Promise<PaymentRequest>
authorize(tx, { methodId, amount, ref, idempotencyKey }): Promise<PaymentAttempt>   // status may be 'pending_verification'
capture(tx, { authorizationId, amount?, idempotencyKey }): Promise<PaymentAttempt>
charge(tx, { methodId, amount, ref, idempotencyKey, initiator: 'customer'|'merchant' })
refund(tx, { paymentId, amount, reason, idempotencyKey }): Promise<Refund>
getPaymentStatus(tx, ref)                                    // authoritative status incl. 'pending_verification'
listUnresolved(tx, { propertyId })                           // Day Close + dashboards
```
Payments calls finance through its `LedgerPort` (record payment/refund/deposit/payout) **only after the
provider confirms**. Provider calls happen outside the DB transaction with persisted idempotency keys
(`payments.provider_operations` table) — see ADR-0007.

## operations (provider)

```ts
getUnitCondition(tx, unitId): Promise<{ condition; inspectedAt?; discrepancy? }>
listUnitConditions(tx, { propertyId }): Promise<...>
createTask(tx, { propertyId, departmentId, kind, title, ref?, dueAt?, priority }): Promise<{ taskId }>
```
Consumes: `reservations.stay.checkedOut` (→ unit dirty + departure clean task), `reservations.stay.moved`,
`inventory.unit.blocked`. Emits: `operations.unit.conditionChanged`, `operations.inspection.failed`,
`operations.workOrder.created|completed`, `operations.task.escalated`.

---

## Rules for changing a contract

1. Update this file in the same commit as the provider change.
2. Additive changes only once a consumer exists; breaking changes need a new function name.
3. The composition root (`apps/api/src/composition.ts`) is the only place that binds ports to providers.
