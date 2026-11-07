# Foundation requests from reservations

## 1. Test databases: unhandled pool errors on `drop()` — RESOLVED on main (b484de3); local workaround removed

**Problem.** `pg-pool`'s `end()` resolves before its clients have closed their sockets. `TestDatabase.drop()` then
runs `drop database … with (force)`, Postgres terminates the still-closing connections, and the termination
(`57P01`) is emitted as a pool `'error'` with no listener → Vitest reports "unhandled errors" and fails the run.
It shows up as soon as a test uses several pooled connections concurrently (S01 races).

**Workaround (local).** `modules/reservations/test/helpers.ts` attaches a no-op `'error'` listener to `t.db.pool`
and `t.admin.pool`.

**Proposed diff** (`packages/testing/src/database.ts`, after creating `db` and `adminDb`):

```ts
for (const pool of [db.pool, adminDb.pool]) pool.on('error', () => {}); // termination during drop(force)
```

## 2. `Occupancy` readonly vs. contract arrays (minor)

`@portico/kernel` `Occupancy.childrenAges` is `readonly number[]`, Zod contracts infer `number[]`; modules copy at
the boundary (`occ()` in `src/service/repo.ts`). Optional: export a `toMutableOccupancy` helper or make contracts
use `.readonly()`. No change required.
