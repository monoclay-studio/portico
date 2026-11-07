/**
 * S15 — A profile is merged incorrectly and needs correction. Two "Ahmed Ali" guests are merged by mistake;
 * reservations re-points its occupant references (guests.profile.merged consumer) and reports them; a stay is added
 * to the survivor afterwards; the unmerge restores exactly the re-pointed references and re-assigns the post-merge
 * stay to the restored profile (guests.profile.unmerged consumer).
 */
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  cardOnFile,
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

describe('S15 — wrong merge corrected by an unmerge', () => {
  it('references in reservations are restored exactly; the post-merge stay goes to the restored profile', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const { reservations, guests } = s.c.services;
    const desk = org.staff('front_desk', 'Hassan', [k.id]);
    const manager = org.staff('general_manager', 'Guest relations manager', [k.id]);
    const ahmed = { firstName: 'Ahmed', lastName: 'Ali' };
    const book = (arrival: string, departure: string, extra: object = {}) =>
      org.run(desk, async (tx) =>
        applied<Booking>(
          await reservations.createBooking(tx, {
            ...bookingInput(k, { arrival, departure, guest: ahmed }),
            ...extra,
          }),
        ),
      );
    const first = await book('2027-03-10', '2027-03-12');
    const second = await book('2027-03-20', '2027-03-22');
    const a = first.stays[0]?.occupants[0]?.profileId as string;
    const b = second.stays[0]?.occupants[0]?.profileId as string;
    expect(a).not.toBe(b);

    const { mergeId } = await org.run(manager, (tx) =>
      guests.mergeProfiles(tx, { survivorId: a, mergedId: b, reason: 'Looked like the same guest' }),
    );
    await s.drain();
    const secondAfterMerge = await org.run(desk, (tx) => reservations.getBooking(tx, second.id));
    expect(secondAfterMerge.stays[0]?.occupants[0]?.profileId).toBe(a);

    // After the merge, the second Ahmed Ali arrives and is checked in on the survivor profile (stay history).
    s.clock.advance(60 * 60_000);
    const card = await cardOnFile(s, org, k.id, k.legalEntityId, 'pm_card_visa', {
      type: 'guest_profile',
      id: a,
    });
    const third = await org.run(desk, async (tx) => {
      const input = bookingInput(k, {
        arrival: '2027-03-08',
        departure: '2027-03-10',
        guest: ahmed,
        unit: '216',
      });
      const stay = input.stays[0];
      if (!stay) throw new Error('no stay');
      return applied<Booking>(
        await reservations.createBooking(tx, {
          ...input,
          guarantee: { kind: 'card', paymentMethodId: card.id },
          stays: [{ ...stay, occupants: [{ profileId: a, profile: ahmed, kind: 'adult', primary: true }] }],
        }),
      );
    });
    const thirdStay = third.stays[0]?.id as string;
    await s.drain();
    await readyUnit(s, org, k.id, k.units['216'] as string);
    const checkedIn = await reservations.performWorkflow(s.t.db, desk, {
      stayId: thirdStay,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true }, access: { kind: 'card', count: 1 } },
    });
    expect(checkedIn.run?.status).toBe('completed');

    // The unmerge review proposes owners for what was added after the merge; the stay goes to the restored guest.
    const preview = await org.run(manager, (tx) => guests.previewUnmerge(tx, mergeId));
    const items = (preview.postMergeItems ?? []) as Array<{ kind: string; id: string }>;
    const stayItem = items.find((i) => i.kind === 'stay_history');
    expect(stayItem).toBeTruthy();
    const undone = await org.run(manager, (tx) =>
      guests.unmergeProfiles(tx, {
        mergeId,
        reason: 'Different passports — two different guests',
        assignments: [{ kind: 'stay_history', id: stayItem?.id as string, owner: 'restored' }],
      }),
    );
    expect(undone.restoredId).toBe(b);
    await s.drain();
    const r1 = await org.run(desk, (tx) => reservations.getBooking(tx, first.id));
    const r2 = await org.run(desk, (tx) => reservations.getBooking(tx, second.id));
    const r3 = await org.run(desk, (tx) => reservations.getBooking(tx, third.id));
    expect(r1.stays[0]?.occupants[0]?.profileId).toBe(a);
    expect(r2.stays[0]?.occupants[0]?.profileId).toBe(b);
    expect(r3.stays[0]?.occupants[0]?.profileId).toBe(b);
    const profiles = await org.run(manager, async (tx) => [
      await guests.getProfile(tx, a),
      await guests.getProfile(tx, b),
    ]);
    expect(profiles.map((p) => p.status.profile)).toEqual(['active', 'active']);
    await assertGlobalConsistency(s, org, { auditActions: ['reservations.booking.create'] });
  });

  it.todo(
    'finance payer references and comms threads restored by the unmerge (finance and comms consume guests.profile.unmerged — not built)',
  );
});
