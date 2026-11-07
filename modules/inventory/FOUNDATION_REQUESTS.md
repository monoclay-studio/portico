# Foundation requests from inventory

## 1. `TestDatabase.drop()` races the admin pool's idle connections (packages/testing)

**Problem.** A test that uses `t.admin` (the superuser pool) leaves an idle client in that pool. `drop()` calls
`admin.close()` → `kysely.destroy()` → `pool.end()`, which removes idle clients and calls `client.end()` without
waiting for the connection to terminate, then immediately runs `DROP DATABASE … WITH (FORCE)`. Postgres terminates the
half-closed backend (`57P01 terminating connection due to administrator command`) and the client emits an `error` with
no listener → Vitest reports an *unhandled error* and the file fails even though every test passed.

**Workaround in this module.** `test/harness.ts` → `adminQuery()` uses a short-lived `pg.Client` on `t.adminUrl` and
ends it before returning; inventory tests never touch `t.admin`.

**Proposed diff** (`packages/testing/src/database.ts`):

```diff
   const adminDb = createDatabase({ connectionString: adminUrl, max: 2, clock, applicationName: 'portico-test-admin' });
+  // Idle clients that are terminated by DROP DATABASE … WITH (FORCE) must not crash the test run.
+  for (const pool of [db.pool, adminDb.pool]) pool.on('error', () => {});
   …
     async drop() {
       await db.close();
       await adminDb.close();
+      await new Promise((r) => setTimeout(r, 50)); // let terminated clients finish closing
```

## 2. Domain map § inventory needs the additive contract changes

`docs/architecture/domain-map.md` is outside this module's write boundary. The additive changes to the inventory
provider contract are listed in `README.md` § Contract changes (all additive, matching the spec's "Proposed contract
changes" 1–7 plus `previewBlock`, `getAvailabilityGrid`, record getters and the per-unit-type `range` payload of
`inventory.availability.changed`). Please fold them into the domain map at merge.
