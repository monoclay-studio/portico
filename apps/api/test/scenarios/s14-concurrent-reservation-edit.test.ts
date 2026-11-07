/**
 * S14 — Two users edit the same reservation: the second writer gets 409 with what changed and who changed it; her
 * edits are re-applied on the new version; no lost update.
 */
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  assertGlobalConsistency,
  bookingInput,
  kandu,
  organization,
  type Scenario,
  startScenario,
} from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

describe('S14 — concurrent edits of one booking', () => {
  it('Hassan changes the departure; Aishath gets a field diff, re-applies, and both changes survive', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const { reservations } = s.c.services;
    const hassan = org.staff('reservations_agent', 'Hassan', [k.id]);
    const aishath = org.staff('reservations_agent', 'Aishath', [k.id]);
    const b = applied<Booking>(
      await org.run(hassan, (tx) =>
        reservations.createBooking(tx, bookingInput(k, { arrival: '2027-03-10', departure: '2027-03-12' })),
      ),
    );
    const stayId = b.stays[0]?.id as string;
    const v1 = b.version;
    // Hassan commits a departure change (new night re-priced by rates).
    const p = await org.run(hassan, (tx) =>
      reservations.previewChange(tx, {
        kind: 'dates',
        stayId,
        arrival: '2027-03-10',
        departure: '2027-03-13',
      }),
    );
    await reservations.commitChangeSafely(s.t.db, hassan, { previewToken: p.token });
    // Aishath saves notes and a special request on the version she loaded.
    const conflict = await org
      .run(aishath, (tx) =>
        reservations.patchBooking(tx, {
          bookingId: b.id,
          expectedVersion: v1,
          patch: { notes: 'Honeymoon — champagne on arrival', specialRequests: ['Late dinner on arrival'] },
        }),
      )
      .then(
        () => null,
        (e: unknown) => e as { status: number; code: string; details: Record<string, unknown> },
      );
    expect(conflict).toMatchObject({ status: 409 });
    expect(JSON.stringify(conflict?.details)).toMatch(/Hassan/);
    // Her edits are re-applied on the current version — both changes are present.
    const current = await org.run(aishath, (tx) => reservations.getBooking(tx, b.id));
    const saved = applied<Booking>(
      await org.run(aishath, (tx) =>
        reservations.patchBooking(tx, {
          bookingId: b.id,
          expectedVersion: current.version,
          patch: { notes: 'Honeymoon — champagne on arrival', specialRequests: ['Late dinner on arrival'] },
        }),
      ),
    );
    expect(saved.notes).toBe('Honeymoon — champagne on arrival');
    expect(saved.stays[0]?.departure).toBe('2027-03-13');
    expect(saved.version).toBeGreaterThan(current.version);
    await assertGlobalConsistency(s, org, { auditActions: ['reservations.booking.create'] });
  });
});
