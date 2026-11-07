import { sql, withTenantTx } from '@portico/db';
import { systemAuthorizer } from '@portico/kernel';
import { platform } from '@portico/platform';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking } from '../src/contracts';
import { RESERVATIONS_EVENTS as E } from '../src/events';
import { created, setupOrg, startDb } from './helpers';

/**
 * Brief §6: "An interrupted workflow must make it clear which steps succeeded and which remain incomplete."
 * (+ S05 supporting: the guarantee step stays pending on timeout and resume reads the authoritative status.)
 */
let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('check-in as a resumable workflow', () => {
  it('an interrupted check-in resumes; payments answers after commit; never authorizes twice; lock outage needs a manual fallback', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    const stayId = b.stays[0]?.id as string;
    org.fakes.payments.crashNextAuthorize = true;
    org.fakes.payments.script = ['timeout'];
    org.fakes.access.mode = 'unavailable';

    // 1st attempt: the process dies inside the guarantee step's transaction — nothing was recorded anywhere.
    const first = await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    expect(first.interrupted).toMatchObject({ step: 'guarantee', error: { code: 'interrupted' } });
    expect(first.run?.summary).toMatchObject({
      succeeded: ['registration', 'unit'],
      remaining: ['guarantee', 'deposits', 'access', 'confirm'],
    });
    const g1 = first.run?.steps.find((s) => s.key === 'guarantee');
    expect(g1).toMatchObject({ status: 'failed', message: expect.stringMatching(/Interrupted/) });
    expect(org.fakes.payments.authorizations.size).toBe(0);

    // Resume: payments records the authorization (processing); the provider is called after commit and never
    // answers → pending verification. The workflow polls once and stops there.
    const second = await org.svc.performWorkflow(t.db, org.ctx, { stayId, kind: 'check_in' });
    expect(second.interrupted).toBeNull();
    expect(second.run?.steps.find((s) => s.key === 'guarantee')).toMatchObject({
      status: 'pending',
      message: expect.stringMatching(/pending verification/),
    });
    expect(org.fakes.payments.authorizations.size).toBe(1);
    expect(org.fakes.payments.providerCalls).toBe(1);
    // The arrivals board shows the single blocker truthfully.
    const arrivals = await org.run((tx) => org.svc.listArrivals(tx, { propertyId: org.propertyId }));
    expect(arrivals.items[0]?.readiness?.blockingReason?.message).toMatch(
      /pending verification — do not take payment again/,
    );
    // Resuming while pending reads the status again and never authorizes again.
    const callsPending = org.fakes.payments.authorizeCalls;
    await org.svc.performWorkflow(t.db, org.ctx, { stayId, kind: 'check_in' });
    expect(org.fakes.payments.authorizeCalls).toBe(callsPending);

    // Reconciliation resolves it; resume reads the authoritative status (no new authorization).
    org.fakes.payments.resolve({ type: 'stay', id: stayId }, 'authorized');
    const callsBefore = org.fakes.payments.authorizeCalls;
    const third = await org.svc.performWorkflow(t.db, org.ctx, { stayId, kind: 'check_in' });
    expect(org.fakes.payments.authorizeCalls).toBe(callsBefore);
    expect(org.fakes.payments.authorizations.size).toBe(1);
    expect(org.fakes.payments.providerCalls).toBe(1);
    expect(third.run?.steps.find((s) => s.key === 'guarantee')?.status).toBe('done');
    // Keys: lock system down → step failed with instructions, never silently done.
    const access = third.run?.steps.find((s) => s.key === 'access');
    expect(access).toMatchObject({ status: 'failed', message: expect.stringMatching(/lock console/) });
    expect(third.run?.status).toBe('in_progress');

    // Staff confirm the manual fallback; check-in completes.
    const done = await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: {
        access: { manualFallback: { confirmed: true, note: 'Card 2 encoded on the lock console' } },
      },
    });
    expect(done.run?.status).toBe('completed');
    expect(done.run?.steps.find((s) => s.key === 'access')).toMatchObject({
      status: 'done',
      result: expect.objectContaining({ manualFallback: true }),
    });
    const booking = await org.run((tx) => org.svc.getBooking(tx, b.id));
    expect(booking.stays[0]?.status).toMatchObject({ stay: 'in_house', payment: 'authorized' });
    expect(booking.stays[0]?.allowedActions.map((a) => a.action)).toContain('checkOut');
    const events = await org.run((tx) =>
      sql<{
        type: string;
      }>`select type from core.outbox where aggregate_id = ${stayId} order by created_at`.execute(tx.db),
    );
    expect(events.rows.map((r) => r.type).filter((x) => x === E.stayCheckedIn)).toHaveLength(1);
    expect(org.fakes.guests.history.map((h) => h.status)).toEqual(['in_house']);
  });

  it("a declined card is reported with payments' explanation; the same card is not retried; another card gets a new key", async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    const stayId = b.stays[0]?.id as string;
    org.fakes.payments.script = ['failed', 'authorized'];
    const first = await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    expect(first.run?.steps.find((s) => s.key === 'guarantee')).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/Card declined: The card issuer declined.*another card/),
      result: expect.objectContaining({ authorizationStatus: 'failed', declinedAttempts: 1 }),
    });
    const arrivals = await org.run((tx) => org.svc.listArrivals(tx, { propertyId: org.propertyId }));
    expect(arrivals.items[0]?.readiness?.blockingReason?.message).toMatch(/declined/);

    // Resume with the same card: not retryable → refused without calling payments.
    const calls = org.fakes.payments.authorizeCalls;
    const again = await org.svc.performWorkflow(t.db, org.ctx, { stayId, kind: 'check_in' });
    expect(again.run?.steps.find((s) => s.key === 'guarantee')).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/cannot be retried/),
    });
    expect(org.fakes.payments.authorizeCalls).toBe(calls);

    // Another card: a NEW idempotency key (one decline counted from payments' records), authorized after commit.
    const otherCard = org.fakes.payments.addMethod(org.propertyId);
    const done = await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { guarantee: { paymentMethodId: otherCard } },
    });
    expect(done.run?.steps.find((s) => s.key === 'guarantee')).toMatchObject({
      status: 'done',
      message: expect.stringMatching(/Card authorized/),
    });
    const runId = done.run?.id as string;
    expect([...org.fakes.payments.authorizations.keys()]).toEqual([
      `checkin:${runId}:guarantee:0`,
      `checkin:${runId}:guarantee:1`,
    ]);
    expect(org.fakes.payments.providerCalls).toBe(2);
  });

  it('a unit that failed inspection blocks the unit step until another ready unit is chosen', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    const stayId = b.stays[0]?.id as string;
    org.fakes.operations.conditions.set(org.units.V101 as string, 'failed_inspection');
    const before = await org.run((tx) => org.svc.getBooking(tx, b.id));
    expect(before.stays[0]?.allowedActions.find((a) => a.action === 'checkIn')).toMatchObject({
      enabled: false,
      reason: 'V101 is failed inspection and has not passed inspection yet.',
    });
    const r = await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    expect(r.run?.steps.find((s) => s.key === 'unit')).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/failed inspection/),
    });
    expect(r.run?.summary.succeeded).toEqual(['registration']);
    const resumed = await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { unit: { unitId: org.units.V102 } },
    });
    expect(resumed.run?.status).toBe('completed');
    expect(
      (await org.run((tx) => org.fakes.inventory.assignmentsOf(tx, { type: 'stay', id: stayId }))).map(
        (a) => a.unitId,
      ),
    ).toEqual([org.units.V102]);
  });

  it('skipping a mandatory step needs permission and a reason', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    const stayId = b.stays[0]?.id as string;
    const desk = org.user('Desk', [
      { permission: 'reservations.stay.checkIn', propertyIds: [org.propertyId] },
      { permission: 'reservations.booking.read', propertyIds: [org.propertyId] },
    ]);
    await org.run((tx) => org.svc.startWorkflow(tx, { stayId, kind: 'check_in' }), desk);
    await expect(
      org.run(
        (tx) => org.svc.skipStep(tx, { stayId, kind: 'check_in', step: 'deposits', reason: 'no deposits' }),
        desk,
      ),
    ).rejects.toThrow(/skipCheckInStep/);
    const run = await org.run((tx) =>
      org.svc.skipStep(tx, { stayId, kind: 'check_in', step: 'deposits', reason: 'no deposits held' }),
    );
    expect(run.steps.find((s) => s.key === 'deposits')).toMatchObject({
      status: 'skipped',
      message: 'Skipped: no deposits held',
    });
  });
});

describe('check-out as a resumable workflow', () => {
  it('refuses to depart with an open balance unless permitted; revokes keys; early departure releases nights', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking(
            { billing: { incidentalsPayer: 'booker' } },
            { unitId: org.units.V101, departure: '2026-12-14' },
          ),
        ),
      ),
    );
    const stayId = b.stays[0]?.id as string;
    await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    await org.run((tx) =>
      org.fakes.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: stayId },
        chargeCode: 'MINIBAR',
        amount: { amountMinor: 2_500, currency: 'USD' },
        serviceDate: '2026-12-10',
        description: 'Minibar',
        sourceRef: { type: 'stay', id: stayId },
        idempotencyKey: 'pos:1',
      }),
    );
    // Advance the business date by one day: the guest leaves early (agreed departure 2026-12-14).
    await org.run((tx) => sql`update platform.properties set business_date = '2026-12-11'`.execute(tx.db));
    const r1 = await org.svc.performWorkflow(t.db, org.ctx, { stayId, kind: 'check_out' });
    expect(r1.run?.steps.find((s) => s.key === 'settle')).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/Open balance/),
    });
    expect(r1.run?.summary.succeeded).toEqual(['charges']);
    const r2 = await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_out',
      checkOut: { settle: { leaveOpenReason: 'Company will settle by bank transfer' } },
    });
    expect(r2.run?.status).toBe('completed');
    expect(org.fakes.access.executed.map((c) => c.op)).toEqual(['issue', 'cancel']);
    const after = await org.run((tx) => org.svc.getBooking(tx, b.id));
    expect(after.stays[0]).toMatchObject({ status: { stay: 'departed' }, departure: '2026-12-11' });
    expect(after.status.booking).toBe('completed');
    expect(
      (await org.run((tx) => org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: stayId }))).map(
        (c) => c.night,
      ),
    ).toEqual(['2026-12-10']);
    const penalty = (await org.run((tx) => org.fakes.finance.postings(tx))).filter(
      (p) => p.chargeCode === 'CXL',
    );
    expect(penalty.map((p) => p.amountMinor)).toEqual([30_000]);
    const issues = await org.run((tx) => org.svc.listIssues(tx, { propertyId: org.propertyId }));
    expect(issues.map((i) => i.kind)).toContain('departed_with_balance');
  });
});

describe('fees post when the service happens (steward R-10)', () => {
  it('a late check-out fee is approved by preview but charged at check-out, with the business date', async () => {
    const org = await setupOrg(t);
    await withTenantTx(t.db, { ...org.ctx, authz: systemAuthorizer }, (tx) =>
      platform.setPolicy(tx, {
        key: 'reservations.lateCheckOut.fee',
        scopeType: 'property',
        scopeId: org.propertyId,
        value: { amountMinor: 5_000 },
        reason: 'test',
      }),
    );
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101, departure: '2026-12-11' })),
      ),
    );
    const stayId = b.stays[0]?.id as string;
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'late_check_out', stayId, time: '16:00' }),
    );
    expect(p.fees).toEqual([
      expect.objectContaining({ kind: 'late_check_out', amount: { amountMinor: 5_000, currency: 'USD' } }),
    ]);
    await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p.token });
    expect(
      (await org.run((tx) => org.fakes.finance.postings(tx))).filter((x) => x.key.startsWith('fee:')),
    ).toEqual([]);
    await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    await org.run((tx) => sql`update platform.properties set business_date = '2026-12-11'`.execute(tx.db));
    const out = await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_out',
      checkOut: { settle: { leaveOpenReason: 'Paid at the desk later' } },
    });
    expect(out.run?.status).toBe('completed');
    const fee = (await org.run((tx) => org.fakes.finance.postings(tx))).filter(
      (x) => x.key === `fee:${stayId}:late_check_out`,
    );
    expect(fee.map((x) => [x.chargeCode, x.amountMinor])).toEqual([['MISC', 5_000]]);
  });
});
