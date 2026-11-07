# Proof scenarios: binding manifest and assertion map

Scenario-tests playbook v2 (`docs/quality/playbooks/scenario-tests.md`). Catalogue: `docs/scenarios/README.md`. Every
test here runs through the real composition root (`harness.ts` → `compose(database)`). No module fakes are imported.
Every passing scenario ends with `assertGlobalConsistency` (`harness.ts`). That function checks:
- INV-I02 and INV-I03 (the inventory ledger, and no oversold cell without a conflict);
- RES-I02 (active stays consume exactly their nights);
- that every deposit belongs to a booking of its own property;
- FIN-I02 and FIN-I14 for each legal entity;
- no duplicate journal keys and no provider operation sent twice;
- the audit actions the scenario names.

## Binding manifest (ST2-1)

| Port | Bound to | Real? |
|---|---|---|
| reservations.inventory | `inventoryPortFrom(inventoryProvider(inventoryService))` | real |
| reservations.rates | `ratesPortFrom(ratesProvider(rates))` | real; channel-price terms answer 503 (`channel_terms_not_available`) |
| reservations.guests | guests service | real |
| reservations.finance | `financeForReservations(finance)` | real |
| reservations.payments | `payments.service.provider` | real (simulator in demo organizations) |
| reservations.operations | `operationsForReservations(operations)` | real |
| reservations.access | `environmentAccessAdapter()` | **stub**: simulated outside live; `access` module not built |
| finance.tax / payments / payers / bookings | rates / `paymentsCollectionsForFinance` / guests / reservations directory | real |
| payments.ledger / references | `financeLedgerForPayments` / reservations directory | real |
| operations.inventory | `inventoryProvider` | real |
| integration inbound handlers, catalog (tax rule, charge code, ledger account, outlet), activation scope, authority transitions | `{}` / `unavailableCatalog` / stubs | **stub** (not exercised by these scenarios) |
| rates `affectedAgreements`, `channelForApiClient` | unbound | **stub** (not exercised) |

| Scenario | Ports exercised | Result |
|---|---|---|
| S01 | reservations → inventory, rates, guests | passing |
| S03 | reservations → inventory, rates, guests, payments, finance, operations, access | passing for its catalogue lines; the check-in keys step goes through the **access stub** (simulated keys: no access module exists), which is outside S03's catalogue |
| S04 | reservations → rates, guests, finance; finance → rates (tax) | passing (parts todo) |
| S05 | reservations → payments, operations, guests, finance, access; payments → finance | passing for its catalogue lines; keys step via the **access stub** (outside the catalogue) |
| S06 | payments → finance (HTTP) | passing |
| S07 | operations, reservations → inventory, operations | passing (parts todo) |
| S08 | operations → inventory; inventory event → reservations; reservations → rates | passing (parts todo) |
| S13 | operations | passing (offline UI todo) |
| S14 | reservations → rates, inventory | passing |
| S15 | guests ↔ reservations (events); reservations → guests, access | passing (finance/comms consumers todo); keys step via the **access stub** (outside the catalogue) |
| S16 | platform | passing (locks/exemptions todo) |
| S17 | HTTP (every module), RLS | passing (security log todo) |
| S02, S09–S12, S18–S20 | — | todo: the missing capability is named in each file |

## Assertion map (ST2-2): catalogue line → asserting line

| Scenario | State | Money | Inventory | Audit | Recovery |
|---|---|---|---|---|---|
| S01 | `s01-last-room.test.ts:60-75` (one wins, `preview_stale`, sold-by explanation) | `:80` (no postings at booking) | `:88` (sold 3, available 0); `:121` (stress: exactly 3) | `:101` (`reservations.booking.create`) | `:100` (alternative committed at once) |
| S03 | `s03-…:108-109` (departure 14 Mar, 216 segment) | `:96-100`, `:114-118` (agreed nights kept; new sealed agreement) | `:124` (Chen's assignment untouched) + global RES-I02 | `:126` | `:81-83` (conflict and alternatives previewed); payment increment and move task: `.todo` |
| S04 | `s04-…:109`, `:123` (company and guest folios, routing preview) | `:85-101` (child supplement, Green Tax per person, infants exempt), `:159-161` (postings routed as previewed) | `:62` + global | `:162` | invoices, receivables and transfer back: `.todo` |
| S05 | `s05-…:70-75` (pending verification on step and board), `:105-106` (resolved) | `:111` (one operation), `:116` (an authorization is not a posting) | — | `:117` | `:82`, `:96-97` (retry blocked on the user paths); variant `:163-178` |
| S06 | `s06-…:79` (one refund) | `:45`, `:65`, `:86` (one payment and one refund posting; folio −500) | — | global (no duplicate keys) | `:64-71` (same key, same refund), `:84` (sent once) |
| S07 | `s07-…:70-77` (failed inspection, re-clean task, blocker) | — | `:96` (assignment moved) | `:97` | `:90-91` (moved; ready); desk alert and waiting timer: `.todo` |
| S08 | `s08-…:59-63` (block, relocation case), `:102-110` (released only after inspection) | `:76` (complimentary upgrade keeps the price); relocation costs `.todo` | global INV-I03 | `:111` | `:94` (return to service refused before inspection) |
| S13 | `s13-…:54-59` (5 applied, 1 conflict, server state kept) | — | — | global | conflict resolved by the supervisor: server keeps the newer state; "Delayed" labels `.todo` |
| S14 | `s14-…:60-61` (409 with who changed it), `:73-75` (both changes) | repricing through rates (preview) | global | `:76` | `:73` (re-applied) |
| S15 | `s15-…:55` (merge re-points), `:107-114` (exact restore and reassignment) | finance payer references `.todo` | — | `:115` | `:102` (unmerge) |
| S16 | `s16-…:70-71` (A changes; B and C keep overrides), `:84` (sources) | — | — | global | `:91` (a property manager cannot change the org value); locks and exemptions `.todo` |
| S17 | `s17-…:68-77` (404 everywhere, no leak), `:87` (RLS zero rows) | — | — | `:88`; security log `.todo` | — |

## Hold under the CI gate (ST2-3)

Both commands (`pnpm turbo run test --force --concurrency=2` and the default concurrency) are run before each report.
The slowest files and their times are listed in the integration-step report. Every test here stays well under the
30 s per-test budget (`apps/api/vitest.config.ts`).
