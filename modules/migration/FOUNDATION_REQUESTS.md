# Contract and foundation requests from `migration`

Migration consumes every data-owning module. It uses the providers that exist on `main` through their public
services (bound in `apps/api/src/composition.ts`) and declares the functions it still needs as ports
(`src/ports.ts`). Until a request is met, composition binds a stub that answers `503 migration_provider_unavailable`;
the pipeline then waits at that class with a blocking exception owned by the Monoclay onboarding lead — it never
pretends. Tests bind strict, Postgres-backed fakes that implement exactly the contract below (`test/harness.ts`), so
merging a real provider is a binding change in composition plus re-running the same tests against it.

Each request: problem, the contract (shape and rules), what migration does meanwhile, and the test that will prove it.

---

## MIG-CR-1 — reservations: `importMigratedBooking` and `listMigratedBookings` (blocking for a real migration)

**Problem.** Reservations has no import path that accepts a booking from another system with its agreed terms as
the source states them. `ingestChannelBooking` is the closest, but it is a channel revision flow (it compares with a
quote, raises price discrepancies, cannot express in-house, departed or no-show history) and on `main` its rates,
guests and finance ports are stubs.

**Contract** (`ReservationsPort` in `src/ports.ts`; called in migration's transaction, ADR-0015 scope = property):

```ts
importBooking(tx, {
  propertyId, sourceSystem, sourceKey,          // idempotency key: unique (tenant, property, sourceSystem, sourceKey)
  sourceVersion,                                // content hash: same version → outcome 'unchanged'
  status: 'confirmed'|'tentative'|'in_house'|'departed'|'cancelled'|'no_show',
  arrival, departure, unitTypeId, unitId|null, adults, children, guestProfileId|null, guestName,
  channel: { code, bookingId } | null,
  terms: { currency, ratePlanCode|null, nightly: [{date, amountMinor}]|null, roomTotalMinor,
           taxes: [{code, name, amountMinor}], taxInclusive, totalMinor, guarantee },
}) → { bookingId, outcome: 'created'|'updated'|'unchanged', inventoryConflictIds: string[] }
listImported(tx, { propertyId, sourceSystem }) → [{ sourceKey, bookingId, status, arrival, departure, unitTypeId,
  currency, roomTotalMinor, taxTotalMinor, totalMinor, nightly|null }]
```

Rules the provider must enforce (the fake enforces each; `test/harness.ts` `FakeReservations`):
1. **Exactly once**: unique on (tenant, property, sourceSystem, sourceKey); a repeat with the same `sourceVersion`
   is `unchanged`; a new version updates the same booking.
2. **Terms verbatim (no double tax)**: the terms snapshot is the source's amounts; taxes are stored as given and
   NEVER recomputed; refuse terms whose total is not room total plus stated taxes (or equal to it when inclusive),
   and nightly prices that do not add up.
3. **Inventory exactly once**: confirmed / tentative / in-house consume inventory for `[arrival, departure)` with
   `onShortfall: 'record_conflict'` (never fail, never oversell silently) and the booking as `ref`; departed,
   cancelled and no-show never consume; an update releases and re-consumes by `ref`.
4. **Data authority**: `platform.assertWritable(…, 'reservations')`; refused while the source is the system of record.
5. **Integrity**: the unit type (and unit) belong to the property; the guest profile is visible there.
6. **Provenance** from the environment (`copied` in a trial, `live` in live); the source key is searchable.
7. History (departed / cancelled / no-show) is imported with its status, never dropped (Cloudbeds' gap, DG #22).

## MIG-CR-2 — guests: `importProfile` keyed by source (works today through `resolveProfile`)

**Today:** bound to `resolveProfile(…, { matchStrategy: 'suggest' })` with migration's ledger as the source key
(exactly once through migration). **Request:** a provider function keyed by `(sourceSystem, sourceKey)` like
`upsertMirroredProfile`, with environment provenance (not `external`), returning scored suggestions with reason
CODES (migration shows codes, never personal data, in its exception list). Also: an **erase hook on
`PersonalDataContributor`** (`erase(tx, profileId)`) — migration already contributes to the data export
(`migrationPersonalData.collect`) and purges its copies 30 days after a migration ends; per-subject erasure inside a
running migration needs this hook (README Known gaps).

## MIG-CR-3 — finance: in-house folio opening balances

```ts
importOpeningFolioBalances(tx, { propertyId, importRef, items: [{ bookingId, folioRef, balanceMinor, currency,
  externalRef }] }) → { importedCount, rejected: [{ bookingId, reason }] }
folioOpeningBalances(tx, { propertyId, bookingIds }) → [{ bookingId, folioRef, balanceMinor, currency }]
```
Through migration suspense (like `importOpeningDeposits`), idempotent per (booking, folioRef), only for in-house
stays of the property, `assertWritable(…, 'accounting')`, a migration journal entry referencing the source totals.

## MIG-CR-4 — finance: receivables open items as opening balances

```ts
importOpeningReceivables(tx, { propertyId, importRef, items: [{ accountCode, accountName, invoiceRef, invoiceDate,
  dueDate|null, openMinor, currency }] }) → { importedCount, rejected: [{ invoiceRef, reason }] }
receivableOpenItems(tx, { propertyId }) → [{ accountCode, invoiceRef, openMinor, currency }]
```
Idempotent per (account, invoice), aging dates kept (migration reconciles per aging bucket), through suspense.

## MIG-CR-5 — payments: card re-collection request (Q142 default)

```ts
request(tx, { propertyId, bookingId, guestProfileId|null, idempotencyKey }) → { status: 'requested'|'simulated', reference }
```
A card-on-file request (payment link without an amount or a zero-amount setup) for a migrated future stay whose
guarantee card stayed at the previous provider. Two-phase like `createPaymentRequest` (provider call after commit),
`assertExternalEffectAllowed(…, 'message.guest')` (simulated outside live). Never moves card data.

## MIG-CR-6 — integration: register a migration source as a connection

Platform requires an external system of record to name a connection. Migration uses the job's `source_identity`
(a uuid) as that link for file sources. Request: integration registers migration sources as `file`-exchange
connections (catalogue entry "File exchange — not a live connection") so the authority row points to a real
connection with health and an exchange log. Also: export `suggestMappings` (INT-R10) through a port so migration
reuses integration's suggestion engine instead of its own small one (`src/domain/mapping.ts`).

## MIG-CR-7 — reservations / distribution: channel switch hook at cutover

The checklist step "channel switch" is a person's attestation today. Request a distribution hook to activate Portico's
channel mappings after verification and to confirm the old channel manager's disconnection (CR-7 order).

---

## FR-MIG-1 — kernel: `DataDomain` vocabulary

Migration declares `MigratedDomain` (a subset) in its ports because the full `DataDomain` lives in platform and modules
may not import platform (boundary check). Request: move `DataDomain` (type and runtime list) to `@portico/kernel`
(self-check BS3-1).

## FR-MIG-2 — identity: migration role templates

`MIGRATION_ROLE_TEMPLATES` (src/manifest.ts): *Migration lead*, *Finance controller (migration)*, *Migration approver*.
Request identity to seed them (or let modules contribute templates). Migration permissions are deliberately not in
the general-manager template.

## FR-MIG-3 — platform: operator co-sign for production migrations

The production gate requires an authorization by a second authorized person of the hotel (and the platform activation
scope). CLAUDE.md §1 also wants the owner's explicit authorization for production migrations; a Monoclay operator
co-sign needs an operator actor that can act inside a customer organization (identity operator directory). Until then
the gate records the hotel's authorization only (README Open questions).
