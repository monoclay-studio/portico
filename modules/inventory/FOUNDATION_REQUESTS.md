# Foundation requests from inventory

## 1. ~~`TestDatabase.drop()` races idle connections~~ — resolved on main (b484de3)

The module's `dropTestDatabase` workaround has been removed; tests use `t.drop()`.

## 2. Domain map § inventory: fold in the contract changes

`docs/architecture/domain-map.md` is outside this module's write boundary. Please fold in `README.md` § Contract
changes at merge, including the review amendments:

- consume, release, change, transfer, holds and assignments are gated on the `availability` authority by inventory
  itself; `applyExternalAvailability` is the only write path while an external system is authoritative (INV-03);
- `UnitAssignmentConflictError.details.conflicts` is `{ ref: EntityRef; nights: DateRange }[]`, with
  `conflictDetails` adding `unitId` / `unitNumber` (INV-06);
- `inventory.availability.changed` is `{ propertyId, unitTypeId, range, coalesceKey, cause }` — one event per unit type
  per command; there is no `cells` list (INV-14);
- the provider binding `createInventoryService({ platform })` and the added functions (`transferConsumption`,
  `previewBlock`, `previewUnitChange`, `getAvailabilityGrid`, `expireDueAllowances`, `checkLedgerConsistency`,
  record getters);
- the documented INV-R06 deviation for `record_conflict` composite sales (INV-25).

## 3. A shared, reviewed routing primitive for per-tenant sweepers (review INV-22)

Inventory's jobs find organizations with work through module-owned SECURITY DEFINER functions
(`inventory.tenants_with_due_expiries`, `inventory.tenants_with_ledger_since`) that return tenant ids only, and resolve
the environment with `platform.tenant_environment()`. Every module with a sweeper will copy this pattern. Proposal:
either approve the pattern in an ADR (module-owned routing functions: tenant ids only, `revoke … from public`,
reviewed like `core.claim_unfanned_events`), or add a generic helper in `@portico/db` such as
`forEachTenantWithWork(database, routingFunction, fn)` that also resolves the environment and builds the system
context.
