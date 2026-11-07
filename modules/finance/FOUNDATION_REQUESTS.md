# Foundation requests from finance (wave 1)

## 1. `packages/testing`: teardown race when dropping a test database

**Problem.** `TestDatabase.drop()` calls `db.close()` (→ `kysely.destroy()` → `pg.Pool.end()`) and then
`drop database … with (force)`. `pg-pool`'s `end()` resolves once clients are removed from the pool, not once their
sockets are closed. The forced drop then terminates connections that are still closing; the orphaned client emits
`error` (`57P01 terminating connection due to administrator command`) with no listener, which Vitest reports as an
unhandled error. It shows up intermittently in suites that run many concurrent transactions (finance S09, the
billing-rule limit concurrency test).

**Workaround (local, finance tests only).** `modules/finance/test/helpers.ts` attaches a no-op `error` listener to
every client on `connect` for the test pools.

**Proposed diff** (`packages/testing/src/database.ts`):

```ts
// in createTestDatabase(), after creating `db` and `adminDb`:
for (const pool of [db.pool, adminDb.pool]) pool.on('connect', (client) => client.on('error', () => {}));
```

or, in `drop()`, wait for the pools' clients to emit `end` before issuing the forced drop.

## 2. `packages/kernel` money formatting (nice to have)

Problem messages currently quote amounts as "12345 USD (minor units)". A shared, locale-aware
`formatMoney`-for-messages helper used by every module would make problem details read naturally ("USD 123.45").
No change made; finance keeps minor units in messages for precision.
