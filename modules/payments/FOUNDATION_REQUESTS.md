# Foundation requests from payments (wave 1)

## 1. `@portico/testing` — teardown race in `createTestDatabase().drop()`

**Problem.** Very rarely (1 in ~5 full runs of this package) Vitest reports an uncaught
`57P01 terminating connection due to administrator command` from a `portico_app` pool client whose state is
`_ending: true, _ended: false`, i.e. `pool.end()` resolved while a client was still closing, and
`drop database … with (force)` then terminated it. All tests pass; the run is marked failed by the uncaught error.

**Proposed diff** (`packages/testing/src/database.ts`, `drop()`):

```ts
async drop() {
  await db.close();
  await adminDb.close();
  const c = new pg.Client({ connectionString: ADMIN_URL });
  c.on('error', () => {});
  await c.connect();
  try {
    // let ending clients finish before forcing the drop
    await c.query(`select pg_sleep(0.05)`);
    await c.query(`drop database if exists "${name}" with (force)`);
  } finally {
    await c.end();
  }
}
```
or attach `pool.on('error', () => {})` in `createDatabase` for test pools only.

## 2. Role templates (identity) — read access for the front desk

`front_desk` has `payments.payment.collect` but not `payments.payment.read`. Payments accepts either for reads, but
role editors would show the desk as unable to "view payments". Proposed: add `payments.payment.read` to
`front_desk` and `reservations_agent`; add `payments.vcc.manage` to `reservations_agent`.

## 3. Domain map — payments contract changes

Recorded in `modules/payments/README.md` § Contract changes (propertyId on provider functions, LedgerPort additions
`recordPaymentAdjustment` and `recordDisputeMovement`, `recordRefund.bookingId`, `method`/`verification` on
payment/deposit postings). Please apply to `docs/architecture/domain-map.md` at merge.

## 4. Parity matrix location

`modules/payments/PARITY.md` is written in the machine-checked format of `docs/parity/README.md`; move it to
`docs/parity/payments.md` at merge (module agents may not write under `docs/`).
