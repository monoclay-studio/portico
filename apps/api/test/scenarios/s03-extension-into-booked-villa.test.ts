/**
 * S03 — A guest extends into dates when the assigned villa is already booked. Ms Ivanova (in house in Beach Villa
 * 214 until 12 Mar) extends to 14 Mar; 214 is booked by Mr Chen from 12 Mar. The preview shows the conflict and the
 * alternatives; the desk commits (a) "move to 216 for the extra nights": agreed nights keep their price, the new
 * nights are priced by rates.priceChange (sealed, superseding), inventory consumes +2 nights and assigns 216,
 * Mr Chen's assignment is untouched, keys are extended (simulated in this environment).
 */
import { sql } from '@portico/db';
import type { Booking, CommitResult } from '@portico/reservations';
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
  startScenario,
} from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

describe('S03 — extension into a booked villa', () => {
  it('previews the conflict with alternatives and commits "move the extra nights to 216" atomically', async () => {
    const org = await organization(s);
    const k = await kandu(s, org, '2027-03-10');
    const { reservations, rates } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const { profileId: guestId, card } = await guestWithCard(s, org, k);
    const ivanova = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(
            k,
            { arrival: '2027-03-10', departure: '2027-03-12', unit: '214', guestProfileId: guestId },
            { guarantee: { kind: 'card', paymentMethodId: card.id } },
          ),
        ),
      ),
    );
    const chen = applied<Booking>(
      await org.run(desk, (tx) =>
        reservations.createBooking(
          tx,
          bookingInput(k, {
            arrival: '2027-03-12',
            departure: '2027-03-15',
            unit: '214',
            guest: { firstName: 'Wei', lastName: 'Chen' },
          }),
        ),
      ),
    );
    const stayId = ivanova.stays[0]?.id as string;
    await s.drain();
    await readyUnit(s, org, k.id, k.units['214'] as string);
    const checkIn = await reservations.performWorkflow(s.t.db, desk, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 2 } },
    });
    expect(checkIn.run?.status).toBe('completed');
    const agreedBefore = ivanova.stays[0]?.totals?.gross.amountMinor as number;

    const plain = await org.run(desk, (tx) =>
      reservations.previewChange(tx, {
        kind: 'dates',
        stayId,
        arrival: '2027-03-10',
        departure: '2027-03-14',
      }),
    );
    expect(plain.stays[0]?.assignment.status).toBe('conflict');
    expect(plain.stays[0]?.assignment.conflictingRefs).toEqual([{ type: 'stay', id: chen.stays[0]?.id }]);
    expect(plain.alternatives.length).toBeGreaterThanOrEqual(3);

    const preview = await org.run(desk, (tx) =>
      reservations.previewChange(tx, {
        kind: 'dates',
        stayId,
        arrival: '2027-03-10',
        departure: '2027-03-14',
        extraNights: { strategy: 'move_extra_nights', unitId: k.units['216'] as string },
      }),
    );
    expect(preview.feasible).toBe(true);
    const nights = preview.stays[0]?.nights ?? [];
    expect(nights.filter((n) => n.status === 'kept').map((n) => n.date)).toEqual([
      '2027-03-10',
      '2027-03-11',
    ]);
    expect(nights.filter((n) => n.status === 'added').map((n) => n.date)).toEqual([
      '2027-03-12',
      '2027-03-13',
    ]);
    const committed = applied<CommitResult>(
      await reservations.commitChangeSafely(s.t.db, desk, { previewToken: preview.token }),
    );
    const stay = committed.booking.stays[0];
    expect(stay?.departure).toBe('2027-03-14');
    expect(stay?.segments.map((g) => [g.from, g.to, g.unitId])).toEqual([
      ['2027-03-10', '2027-03-12', k.units['214']],
      ['2027-03-12', '2027-03-14', k.units['216']],
    ]);
    // Agreed nights keep the agreed price; the new agreement is sealed by rates and supersedes nothing it should not.
    expect(stay?.totals?.gross.amountMinor).toBeGreaterThan(agreedBefore);
    const docs = await sql<{ document: { providerDocument: unknown } }>`
      select document from reservations.terms_snapshots where stay_id = ${stayId}`.execute(s.t.admin.kysely);
    expect(docs.rows).toHaveLength(2);
    for (const d of docs.rows) expect(rates.verifyTerms(d.document.providerDocument)).toBe(true);
    // Mr Chen's assignment is untouched.
    const chenUnits = await sql<{ unit_id: string }>`
      select unit_id from inventory.assignments where ref_type = 'stay' and ref_id = ${chen.stays[0]?.id}`.execute(
      s.t.admin.kysely,
    );
    expect(chenUnits.rows.map((r) => r.unit_id)).toEqual([k.units['214']]);
    expect(committed.keys.length).toBeGreaterThan(0);
    await assertGlobalConsistency(s, org, { auditActions: ['reservations.booking.create'] });
  });

  it.todo(
    'a preauthorization increment is requested via payments for the extra nights (reservations does not call incrementAuthorization yet)',
  );
  it.todo(
    'operations receives a move task for 12 Mar (reservations emits no dated move event for a future segment change)',
  );
});
