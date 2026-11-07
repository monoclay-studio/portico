/**
 * S05 — A payment succeeds externally, but the screen times out before confirmation (E05). The check-in guarantee
 * step authorizes through payments (two-phase); the simulator times out after taking the hold → the step shows
 * "pending verification", a second attempt is blocked, "check now" resolves it, the resumed check-in completes.
 * Exactly one provider operation; an authorization never posts to the ledger.
 */
import { sql } from '@portico/db';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  cardOnFile,
  guestWithCard,
  kandu,
  organization,
  readyUnit,
  type Scenario,
  signIn,
  startScenario,
} from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

describe('S05 — payment timeout at check-in', () => {
  it('pending verification, second attempt blocked, check-now resolves, check-in resumes; one operation', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations, payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId: guestId, card } = await guestWithCard(
      s,
      org,
      k,
      undefined,
      'sim_timeout_then_succeeded',
    );
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(
            k,
            {
              arrival: '2027-03-10',
              departure: '2027-03-12',
              unit: '305',
              type: 'WV',
              guestProfileId: guestId,
            },
            { guarantee: { kind: 'card', paymentMethodId: card.id } },
          ),
        ),
      ),
    );
    const stayId = b.stays[0]?.id as string;
    await s.drain();
    await readyUnit(s, org, k.id, k.units['305'] as string);
    const first = await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 2 } },
    });
    const guarantee = first.run?.steps.find((st) => st.key === 'guarantee');
    expect(guarantee).toMatchObject({
      status: 'pending',
      message: expect.stringMatching(/pending verification/),
    });
    const arrivals = await org.run(desk, (tx) => reservations.listArrivals(tx, { propertyId: k.id }));
    expect(arrivals.items[0]?.readiness?.blockingReason?.message).toMatch(/pending verification/);
    // The desk resumes check-in (the user path, review P3-8): the guarantee step reads payments first and stays
    // pending — no second authorization is sent.
    const resumedWhilePending = await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
    });
    expect(resumedWhilePending.run?.steps.find((st) => st.key === 'guarantee')?.status).toBe('pending');
    // Pressing "authorize" again in payments (its own route) is blocked with an explanation, never a second hold.
    const auth = await signIn(s, org);
    const again = await s.app.inject({
      method: 'POST',
      url: '/v1/payments/authorizations',
      headers: { ...auth, 'idempotency-key': `desk-retry:${stayId}` },
      payload: {
        propertyId: k.id,
        methodId: card.id,
        amount: { amountMinor: 50_000, currency: 'USD' },
        ref: { type: 'stay', id: stayId },
      },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'authorization_pending_verification' });
    // "Check now": payments looks the operation up with the provider → authorized.
    const status = await org.run(desk, (tx) =>
      payments.provider.getPaymentStatus(tx, { type: 'stay', id: stayId }, { propertyId: k.id }),
    );
    const authorizationId = status.authorizations[0]?.id as string;
    await payments.checkNow(desk, { type: 'authorization', id: authorizationId });
    const resumed = await reservations.performWorkflow(s.t.db, desk, { stayId, kind: 'check_in' });
    expect(resumed.run?.steps.find((st) => st.key === 'guarantee')?.status).toBe('done');
    expect(resumed.run?.status).toBe('completed');
    const ops = await sql<{ attempts: number }>`
      select attempts from payments.provider_operations where authorization_id = ${authorizationId}`.execute(
      s.t.admin.kysely,
    );
    expect(ops.rows.map((r) => r.attempts)).toEqual([1]);
    const postings = await sql<{ n: number }>`
      select count(*)::int as n from finance.journal_entries where tenant_id = ${org.tenantId}`.execute(
      s.t.admin.kysely,
    );
    expect(postings.rows[0]?.n).toBe(0); // an authorization is not a payment
    await assertGlobalConsistency(s, org, { auditActions: ['reservations.booking.create'] });
  });

  it('variant timeout-then-failure: the step fails with an explanation; another card makes a new attempt', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations, payments } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId: guestId, card: bad } = await guestWithCard(
      s,
      org,
      k,
      undefined,
      'sim_timeout_then_failed',
    );
    const b = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(
            k,
            {
              arrival: '2027-03-10',
              departure: '2027-03-11',
              unit: '307',
              type: 'WV',
              guestProfileId: guestId,
            },
            { guarantee: { kind: 'card', paymentMethodId: bad.id } },
          ),
        ),
      ),
    );
    const stayId = b.stays[0]?.id as string;
    await s.drain();
    await readyUnit(s, org, k.id, k.units['307'] as string);
    await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    const st = await org.run(desk, (tx) =>
      payments.provider.getPaymentStatus(tx, { type: 'stay', id: stayId }, { propertyId: k.id }),
    );
    await payments.checkNow(desk, { type: 'authorization', id: st.authorizations[0]?.id as string });
    const failed = await reservations.performWorkflow(s.t.db, desk, { stayId, kind: 'check_in' });
    expect(failed.run?.steps.find((x) => x.key === 'guarantee')?.status).toBe('failed');
    // The guest's other card (review P1-2: only a card of the booking's guest, booker or payer secures the stay).
    const good = await cardOnFile(s, org, k.id, k.legalEntityId, 'pm_card_visa', {
      type: 'guest_profile',
      id: guestId,
    });
    const retried = await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: { guarantee: { paymentMethodId: good.id }, access: { kind: 'card', count: 1 } },
    });
    expect(retried.run?.steps.find((x) => x.key === 'guarantee')?.status).toBe('done');
    const final = await org.run(desk, (tx) =>
      payments.provider.getPaymentStatus(tx, { type: 'stay', id: stayId }, { propertyId: k.id }),
    );
    expect(final.authorizations.map((a) => a.status.authorization).sort()).toEqual(['authorized', 'failed']);
    await assertGlobalConsistency(s, org);
  });
});
