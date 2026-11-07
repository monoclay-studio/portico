import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking } from '../src/contracts';
import { created, type Org, setupOrg, startDb } from './helpers';

/**
 * Integration-step re-review R2-P1-1 (ADR-0015 Amendment 1), reservations side: whoever links a person to a booking
 * never chooses that person's card. Without `payments.payment.collect` only a card its cardholder supplied for THIS
 * booking (or a mandate naming it) is recorded or held — on create, patch, channel create, channel modify and the
 * check-in input; a card a payment user attached is not held by someone without payment rights.
 */
let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

const agentOf = (org: Org) =>
  org.user(
    'Reservations agent',
    [
      'reservations.booking.create',
      'reservations.booking.read',
      'reservations.booking.update',
      'reservations.stay.checkIn',
      'guests.profile.read',
      'payments.payment.read',
    ].map((permission) => ({ permission, propertyIds: [org.propertyId] })),
  );

const nightOf = (org: Org) =>
  org.user('Night receptionist', [
    { permission: 'reservations.stay.checkIn', propertyIds: [org.propertyId] },
    { permission: 'reservations.booking.read', propertyIds: [org.propertyId] },
  ]);

describe('R2-P1-1 — a card is the agreed guarantee only if its cardholder supplied it (or a mandate names the booking)', () => {
  it('create and patch: a role without payments.payment.collect cannot record the booker’s saved card', async () => {
    const org = await setupOrg(t);
    const agent = agentOf(org);
    // The default card belongs to the default guest — linked as occupant AND booker here — yet it is refused.
    await expect(org.run((tx) => org.svc.createBooking(tx, org.booking()), agent)).rejects.toMatchObject({
      code: 'guarantee_method_not_allowed',
      message: expect.stringMatching(/Linking a person to a booking/),
    });
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({ guarantee: { kind: 'none' } })), agent),
    );
    const patch = (paymentMethodId: string, version: number) =>
      org.run(
        (tx) =>
          org.svc.patchBooking(tx, {
            bookingId: b.id,
            expectedVersion: version,
            patch: { guarantee: { kind: 'card', paymentMethodId } },
          }),
        agent,
      );
    await expect(patch(org.cardMethodId, b.version)).rejects.toMatchObject({
      code: 'guarantee_method_not_allowed',
    });
    // Once the cardholder supplies the card for THIS booking (hosted entry), the agent may record it.
    org.fakes.payments.supplyFor(org.cardMethodId, b.id);
    const ok = created<Booking>(await patch(org.cardMethodId, b.version));
    expect(ok.guarantee).toMatchObject({ kind: 'card', basis: 'cardholder_supplied' });
  });

  it('check-in: a card a payment user attached is not held by a role without payment rights; a supplied one is', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    expect(b.guarantee.basis).toBe('designated');
    const stayId = b.stays[0]?.id as string;
    const night = nightOf(org);
    const run = await org.svc.performWorkflow(t.db, night, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    expect(run.run?.steps.find((s) => s.key === 'guarantee')).toMatchObject({ status: 'failed' });
    expect(org.fakes.payments.authorizeCalls).toBe(0);
    // The cardholder supplies it for the booking: the same receptionist now holds it.
    org.fakes.payments.supplyFor(org.cardMethodId, b.id);
    const again = await org.svc.performWorkflow(t.db, night, { stayId, kind: 'check_in', checkIn: {} });
    expect(again.run?.steps.find((s) => s.key === 'guarantee')).toMatchObject({ status: 'done' });
    expect(org.fakes.payments.authorizeCalls).toBe(1);
  });

  it("a payment user still cannot choose a stranger's card (owned by someone not on the booking)", async () => {
    const org = await setupOrg(t);
    const stranger = org.fakes.payments.addMethod(org.propertyId, { type: 'guest_profile', id: newId() });
    await expect(
      org.run((tx) =>
        org.svc.createBooking(tx, org.booking({ guarantee: { kind: 'card', paymentMethodId: stranger } })),
      ),
    ).rejects.toMatchObject({ code: 'guarantee_method_not_allowed' });
  });

  it('channel create and modify: a card that is not the booking’s own is left off with an issue, never a refusal', async () => {
    const org = await setupOrg(t);
    const stranger = org.fakes.payments.addMethod(org.propertyId, { type: 'guest_profile', id: newId() });
    const connectionId = newId();
    const externalId = `OTA-${newId().slice(-8)}`;
    const nights = ['2026-12-20', '2026-12-21'].map((date) => ({ date, amountMinor: 30_000 }));
    const payload = {
      status: 'confirmed' as const,
      propertyId: org.propertyId,
      currency: 'USD',
      booker: { firstName: 'Kenji', lastName: 'Watanabe' },
      rooms: [
        {
          roomRef: 'R1',
          unitTypeId: org.types.beach,
          ratePlanId: org.plans.bar,
          arrival: '2026-12-20',
          departure: '2026-12-22',
          adults: 2,
          childrenAges: [],
          guests: [{ firstName: 'Kenji', lastName: 'Watanabe' }],
          nightlyPrices: nights,
          specialRequests: [],
        },
      ],
      guarantee: { kind: 'card' as const, paymentMethodId: stranger },
      amountsIncludeTax: false,
      specialRequests: [],
      marketSegment: 'ota',
    };
    const ingest = (revision: number) =>
      org.run((tx) => org.svc.ingestChannelBooking(tx, { connectionId, externalId, revision, payload }));
    const r1 = await ingest(1);
    expect(r1.outcome).toBe('created');
    const b = await org.run((tx) => org.svc.getBooking(tx, r1.bookingId as string));
    expect(b.guarantee.paymentMethodId).toBeUndefined();
    expect(b.issues.map((i) => i.code)).toContain('guarantee_card_not_attached');
    const r2 = await ingest(2);
    expect(r2.outcome).not.toBe('rejected');
    const b2 = await org.run((tx) => org.svc.getBooking(tx, r1.bookingId as string));
    expect(b2.guarantee.paymentMethodId).toBeUndefined();
  });

  it('readers without payment rights do not see which card secures the booking', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    const hk = org.user('Housekeeping', [
      { permission: 'reservations.booking.read', propertyIds: [org.propertyId] },
    ]);
    const seen = await org.run((tx) => org.svc.getBooking(tx, b.id), hk);
    expect(seen.guarantee).toMatchObject({ kind: 'card', cardOnFile: true });
    expect(seen.guarantee.paymentMethodId).toBeUndefined();
  });
});
