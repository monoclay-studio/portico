import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking } from '../src/contracts';
import { BUSINESS_DATE, created, type Org, setupOrg, startDb } from './helpers';

/** S03 — a guest extends a stay into dates when their assigned villa is already booked. */
let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

async function scenario(org: Org) {
  const book = async (unit: string, arrival: string, departure: string, last: string) =>
    created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking(
            { booker: { kind: 'profile', profile: { lastName: last } } },
            { arrival, departure, unitId: org.units[unit] },
          ),
        ),
      ),
    );
  const x = await book('V101', BUSINESS_DATE, '2026-12-13', 'Hoffmann');
  await book('V101', '2026-12-13', '2026-12-16', 'Next guest');
  await book('V102', '2026-12-12', '2026-12-15', 'Other guest');
  const stayId = x.stays[0]?.id as string;
  const { run } = await org.svc.performWorkflow(t.db, org.ctx, {
    stayId,
    kind: 'check_in',
    checkIn: { registration: { identityVerified: true } },
  });
  expect(run.status).toBe('completed');
  return { x, stayId };
}

describe('S03: extension into nights where the assigned villa is taken', () => {
  it('previews the conflict and four fully previewed alternatives; the chosen one commits atomically', async () => {
    const org = await setupOrg(t);
    const { stayId } = await scenario(org);
    const preview = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'dates', stayId, arrival: BUSINESS_DATE, departure: '2026-12-15' }),
    );
    expect(preview.feasible).toBe(false);
    const effect = preview.stays[0];
    expect(effect?.assignment.status).toBe('conflict');
    expect(effect?.assignment.conflictingRefs).toHaveLength(1);
    expect(preview.blockers.map((b) => b.code)).toEqual(['assigned_unit_taken']);
    // The unit type itself still has availability on the extra nights.
    expect(
      effect?.nights.filter((n) => n.status === 'added').map((n) => [n.date, n.availability?.sufficient]),
    ).toEqual([
      ['2026-12-13', true],
      ['2026-12-14', true],
    ]);
    const ids = preview.alternatives.map((a) => a.id.split(':')[0]);
    expect(ids).toEqual([
      'move_extra_nights',
      'move_whole_stay',
      'upgrade',
      'upgrade_complimentary',
      'waitlist_extension',
    ]);
    for (const alt of preview.alternatives) expect(alt.preview.feasible).toBe(true);
    const extra = preview.alternatives[0];
    expect(extra?.label).toBe('Move to V103 for the extra nights');
    // Prices: agreed nights kept, extra nights priced at current rates; deposits and balance projected.
    const nights = extra?.preview.stays[0]?.nights ?? [];
    expect(nights.map((n) => [n.date, n.status, n.after?.amountMinor])).toEqual([
      ['2026-12-10', 'kept', 30_000],
      ['2026-12-11', 'kept', 30_000],
      ['2026-12-12', 'kept', 30_000],
      ['2026-12-13', 'added', 30_000],
      ['2026-12-14', 'added', 30_000],
    ]);
    expect(extra?.preview.totals.difference.amountMinor).toBe(2 * 37_500);
    expect(extra?.preview.deposits.requiredAfter.amountMinor).toBe(Math.round(5 * 37_500 * 0.3));
    const upgrade = preview.alternatives.find((a) => a.id.startsWith('upgrade:'));
    const comp = preview.alternatives.find((a) => a.id.startsWith('upgrade_complimentary:'));
    expect(upgrade?.preview.totals.difference.amountMinor).toBeGreaterThan(
      comp?.preview.totals.difference.amountMinor ?? 0,
    );

    // Commit option (a): exactly what was previewed.
    const result = created(
      await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: extra?.preview.token ?? '' }),
    );
    const stay = result.booking.stays[0];
    expect(stay?.departure).toBe('2026-12-15');
    expect(stay?.segments.map((s) => [s.from, s.to, s.unitId])).toEqual([
      ['2026-12-10', '2026-12-13', org.units.V101],
      ['2026-12-13', '2026-12-15', org.units.V103],
    ]);
    expect(result.booking.totals.gross.amountMinor).toBe(5 * 37_500);
    const assignments = await org.run((tx) =>
      org.fakes.inventory.assignmentsOf(tx, { type: 'stay', id: stayId }),
    );
    expect(assignments).toEqual([
      { unitId: org.units.V101, from: '2026-12-10', to: '2026-12-13' },
      { unitId: org.units.V103, from: '2026-12-13', to: '2026-12-15' },
    ]);
    expect(
      (await org.run((tx) => org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: stayId }))).map(
        (c) => c.night,
      ),
    ).toEqual(['2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13', '2026-12-14']);
    // Keys follow the extension (access module) and the outcome is reported, not assumed.
    expect(result.keys).toEqual([
      { stayId, action: 'extend', result: expect.objectContaining({ status: 'issued' }) },
    ]);
    // The same preview cannot be committed twice.
    await expect(
      org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: extra?.preview.token ?? '' }),
    ).rejects.toThrow(/already committed/);
  });

  it('a complimentary upgrade for the extra nights charges the agreed price; waitlisting changes nothing now', async () => {
    const org = await setupOrg(t);
    const { stayId } = await scenario(org);
    const preview = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'dates', stayId, arrival: BUSINESS_DATE, departure: '2026-12-15' }),
    );
    const comp = preview.alternatives.find((a) => a.id.startsWith('upgrade_complimentary:'));
    const res = created(
      await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: comp?.preview.token ?? '' }),
    );
    const segs = res.booking.stays[0]?.segments ?? [];
    expect(segs[1]).toMatchObject({
      from: '2026-12-13',
      to: '2026-12-15',
      unitTypeId: org.types.overwater,
      unitId: org.units.W201,
    });
    expect(res.booking.stays[0]?.totals.net.amountMinor).toBe(5 * 30_000);

    const org2 = await setupOrg(t);
    const s2 = await scenario(org2);
    const p2 = await org2.run((tx) =>
      org2.svc.previewChange(tx, {
        kind: 'dates',
        stayId: s2.stayId,
        arrival: BUSINESS_DATE,
        departure: '2026-12-15',
      }),
    );
    const wl = p2.alternatives.find((a) => a.id === 'waitlist_extension');
    const r2 = created(
      await org2.svc.commitChangeSafely(t.db, org2.ctx, { previewToken: wl?.preview.token ?? '' }),
    );
    expect(r2.booking.stays[0]?.departure).toBe('2026-12-13');
    const issues = await org2.run((tx) => org2.svc.listIssues(tx, { propertyId: org2.propertyId }));
    expect(issues.map((i) => i.kind)).toContain('extension_waitlisted');
  });
});
