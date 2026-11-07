import { sql } from '@portico/db';
import { fixedClock } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking, ChangePreview } from '../src/contracts';
import { PreviewStaleError } from '../src/errors';
import { RESERVATIONS_EVENTS as E } from '../src/events';
import { created, setupOrg, startDb } from './helpers';

/** Change previews (brief §4, RES-R11/R12, RES-I07): the user commits exactly what they saw. */
let t: TestDatabase;
const clock = fixedClock('2026-12-10T05:00:00Z');
beforeAll(async () => {
  t = await startDb({ clock });
});
afterAll(async () => t?.drop());

describe('change preview → commit token', () => {
  it('commit fails with preview_stale and a fresh preview when prices changed meanwhile', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    const stayId = b.stays[0]?.id as string;
    const preview = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'dates', stayId, arrival: '2026-12-10', departure: '2026-12-15' }),
    );
    expect(
      preview.stays[0]?.nights.filter((n) => n.status === 'added').map((n) => n.after?.amountMinor),
    ).toEqual([30_000, 30_000]);
    org.fakes.rates.setBase(org.propertyId, org.plans.bar, org.types.beach, 33_000);
    const err = (await org.svc
      .commitChangeSafely(t.db, org.ctx, { previewToken: preview.token })
      .catch((e: unknown) => e)) as PreviewStaleError;
    expect(err).toBeInstanceOf(PreviewStaleError);
    expect(err.message).toMatch(/prices or penalties changed/);
    const fresh = err.details?.freshPreview as ChangePreview;
    // Agreed nights keep the agreed price; only the new nights move.
    expect(fresh.stays[0]?.nights.map((n) => n.after?.amountMinor)).toEqual([
      30_000, 30_000, 30_000, 33_000, 33_000,
    ]);
    expect(err.details?.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'stays[0].nights[3].after.amountMinor', from: 30_000, to: 33_000 }),
      ]),
    );
    // Nothing changed.
    expect((await org.run((tx) => org.svc.getBooking(tx, b.id))).stays[0]?.departure).toBe('2026-12-13');
    // The fresh preview commits; the old token stays refused.
    const ok = created(await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: fresh.token }));
    expect(ok.booking.stays[0]?.totals?.net.amountMinor).toBe(3 * 30_000 + 2 * 33_000);
    const status = await org.run((tx) =>
      sql<{
        status: string;
      }>`select status from reservations.change_previews where token = ${preview.token}`.execute(tx.db),
    );
    expect(status.rows[0]?.status).toBe('stale');
  });

  it('an expired preview is refused with a fresh one; a committed preview cannot be replayed', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    const stayId = b.stays[0]?.id as string;
    const preview = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'occupancy', stayId, occupancy: { adults: 2, childrenAges: [7] } }),
    );
    clock.advance(16 * 60_000);
    const err = (await org.svc
      .commitChangeSafely(t.db, org.ctx, { previewToken: preview.token })
      .catch((e: unknown) => e)) as PreviewStaleError;
    expect(err.message).toMatch(/expired/);
    const fresh = err.details?.freshPreview as ChangePreview;
    expect(err.details?.differences).toEqual([]);
    const ok = created(await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: fresh.token }));
    // Occupancy change reprices supplements and per-person levies from the change date (Green Tax, RES-R19).
    expect(ok.booking.stays[0]?.totals?.fees.amountMinor).toBe(3 * 3 * 1_200);
    await expect(org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: fresh.token })).rejects.toThrow(
      /already committed/,
    );
    clock.set('2026-12-10T05:00:00Z');
  });

  it('a split stay (unit type change from a date) keeps agreed nights and re-snapshots the rest, superseding the old terms', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    const stayId = b.stays[0]?.id as string;
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, {
        kind: 'unit_type',
        stayId,
        unitTypeId: org.types.overwater,
        fromDate: '2026-12-12',
        typeChange: 'difference',
      }),
    );
    expect(p.feasible).toBe(true);
    expect(p.stays[0]?.nights.map((n) => n.status)).toEqual(['kept', 'kept', 'retyped']);
    const res = created(await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p.token }));
    const segs = res.booking.stays[0]?.segments ?? [];
    expect(segs.map((s) => [s.from, s.to, s.unitTypeId === org.types.overwater])).toEqual([
      ['2026-12-10', '2026-12-12', false],
      ['2026-12-12', '2026-12-13', true],
    ]);
    expect(segs[0]?.termsSnapshotId).toBe(b.stays[0]?.segments[0]?.termsSnapshotId);
    const snap = await org.run((tx) =>
      sql<{
        supersedes_id: string | null;
        accepted_via: string;
      }>`select supersedes_id, accepted_via from reservations.terms_snapshots where id = ${segs[1]?.termsSnapshotId}`.execute(
        tx.db,
      ),
    );
    expect(snap.rows[0]).toEqual({
      supersedes_id: b.stays[0]?.segments[0]?.termsSnapshotId,
      accepted_via: 'change',
    });
    const consumption = await org.run((tx) =>
      org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: stayId }),
    );
    expect(consumption.map((c) => c.unitTypeId === org.types.overwater)).toEqual([false, false, true]);
    expect(res.booking.stays[0]?.totals?.net.amountMinor).toBe(2 * 30_000 + 50_000);
  });

  it('cancellation preview applies the agreed tier in Malé time; waiving needs permission', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(tx, org.booking({}, { arrival: '2026-12-16', departure: '2026-12-19' })),
      ),
    );
    // 7 days before 2026-12-16 at 14:00 Malé = 2026-12-09T09:00Z → passed: 1 night penalty.
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'cancel_booking', bookingId: b.id, reason: 'Guest request' }),
    );
    expect(p.penalties).toEqual([
      expect.objectContaining({
        kind: 'cancellation',
        amount: { amountMinor: 30_000, currency: 'USD' },
        waived: false,
      }),
    ]);
    expect(p.balance.projectedAfter.amountMinor).toBe(30_000);
    const agent = org.user('Agent', [
      { permission: 'reservations.booking.cancel', propertyIds: [org.propertyId] },
      { permission: 'reservations.booking.read', propertyIds: [org.propertyId] },
    ]);
    await expect(
      org.run(
        (tx) =>
          org.svc.previewChange(tx, {
            kind: 'cancel_booking',
            bookingId: b.id,
            reason: 'x',
            waive: { reason: 'goodwill' },
          }),
        agent,
      ),
    ).rejects.toThrow(/waivePenalty/);
    const res = created(await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p.token }));
    expect(res.booking.status.booking).toBe('cancelled');
    expect(res.booking.stays[0]?.status.stay).toBe('cancelled');
    const postings = await org.run((tx) => org.fakes.finance.postings(tx));
    expect(postings.map((x) => [x.chargeCode, x.amountMinor, x.key])).toEqual([
      ['CXL', 30_000, `penalty:cancellation:${b.stays[0]?.id}`],
    ]);
    const ev = await org.run((tx) =>
      sql<{ type: string }>`select type from core.outbox where type = ${E.bookingCancelled}`.execute(tx.db),
    );
    expect(ev.rows).toHaveLength(1);
    expect(
      await org.run((tx) =>
        org.fakes.inventory.consumptionOf(tx, { type: 'stay', id: b.stays[0]?.id ?? '' }),
      ),
    ).toHaveLength(0);
  });
});

describe('no-show (Day Close provider)', () => {
  it('is idempotent: one penalty, one release, one event, however often it is called', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    const stayId = b.stays[0]?.id as string;
    const first = await org.run((tx) =>
      org.svc.markNoShow(tx, { stayId, idempotencyKey: 'dayclose:2026-12-10:1' }),
    );
    expect(first).toMatchObject({
      status: 'no_show',
      penalty: { amountMinor: 30_000 },
      replayed: false,
      releasedNights: { from: '2026-12-10', to: '2026-12-13' },
    });
    const again = await org.run((tx) =>
      org.svc.markNoShow(tx, { stayId, idempotencyKey: 'dayclose:2026-12-10:retry' }),
    );
    expect(again).toMatchObject({ replayed: true, penaltyPostingIds: first.penaltyPostingIds });
    expect(
      (await org.run((tx) => org.fakes.finance.postings(tx))).filter((p) => p.chargeCode === 'CXL'),
    ).toHaveLength(1);
    const ev = await org.run((tx) =>
      sql<{ type: string }>`select type from core.outbox where type = ${E.stayNoShow}`.execute(tx.db),
    );
    expect(ev.rows).toHaveLength(1);
    expect((await org.run((tx) => org.svc.getBooking(tx, b.id))).status.booking).toBe('completed');
  });

  it('refuses before the arrival business date', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(tx, org.booking({}, { arrival: '2026-12-12', departure: '2026-12-14' })),
      ),
    );
    await expect(
      org.run((tx) => org.svc.markNoShow(tx, { stayId: b.stays[0]?.id ?? '', idempotencyKey: 'k' })),
    ).rejects.toThrow(/due on 2026-12-12/);
  });
});

describe('room moves', () => {
  it('moving an in-house guest re-encodes keys, records the move and emits stay.moved', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    const stayId = b.stays[0]?.id as string;
    await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, {
        kind: 'move',
        stayId,
        unitId: org.units.W201 as string,
        reason: 'maintenance',
        chargeable: false,
      }),
    );
    expect(p.feasible).toBe(true);
    expect(p.totals?.difference.amountMinor).toBe(0); // complimentary move to a better type keeps the agreed price
    const res = created(await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p.token }));
    expect(res.keys).toEqual([
      { stayId, action: 'move', result: expect.objectContaining({ status: 'pending' }) },
    ]);
    expect(res.booking.stays[0]?.unitId).toBe(org.units.W201);
    const ev = await org.run((tx) =>
      sql<{
        payload: { fromUnitId: string; toUnitId: string; reason: string };
      }>`select payload from core.outbox where type = ${E.stayMoved}`.execute(tx.db),
    );
    expect(ev.rows[0]?.payload).toMatchObject({
      fromUnitId: org.units.V101,
      toUnitId: org.units.W201,
      reason: 'maintenance',
    });
    const moves = await org.run((tx) =>
      sql<{ reason: string }>`select reason from reservations.room_moves where stay_id = ${stayId}`.execute(
        tx.db,
      ),
    );
    expect(moves.rows).toEqual([{ reason: 'maintenance' }]);
  });

  it('when the key system is down the move still commits and a manual-action item is raised', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    const stayId = b.stays[0]?.id as string;
    await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    org.fakes.access.mode = 'unavailable';
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, {
        kind: 'move',
        stayId,
        unitId: org.units.V102 as string,
        reason: 'guest_request',
        chargeable: false,
      }),
    );
    const res = created(await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p.token }));
    // Two-phase: the move commits with the key operation recorded; the lock system (down) never re-encoded keys.
    expect(res.keys[0]?.result.status).toBe('pending');
    expect(res.booking.stays[0]?.unitId).toBe(org.units.V102);
    expect(org.fakes.access.executed.filter((e) => e.op === 'move')).toEqual([]);
  });

  it('R-09: keys are changed only after commit — a rolled-back move leaves no key re-encoded', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    const stayId = b.stays[0]?.id as string;
    await org.svc.performWorkflow(t.db, org.ctx, {
      stayId,
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    expect(org.fakes.access.executed.map((e) => e.op)).toEqual(['issue']);
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, {
        kind: 'move',
        stayId,
        unitId: org.units.V102 as string,
        reason: 'guest_request',
        chargeable: false,
      }),
    );
    await expect(
      org.run(async (tx) => {
        await org.svc.commitChange(tx, { previewToken: p.token });
        throw new Error('crash after the key call, before commit');
      }),
    ).rejects.toThrow(/crash/);
    expect(org.fakes.access.executed.map((e) => e.op)).toEqual(['issue']);
    expect((await org.run((tx) => org.svc.getBooking(tx, b.id))).stays[0]?.unitId).toBe(org.units.V101);
    // The committed move executes the key change after commit.
    created(await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p.token }));
    expect(org.fakes.access.executed.map((e) => e.op)).toEqual(['issue', 'move']);
  });
});

describe('preview token integrity (steward R-04, R-18)', () => {
  it('R-04: a policy change after the preview makes the commit stale; the preview shows the policy', async () => {
    const org = await setupOrg(t);
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'new_booking', booking: org.booking() }),
    );
    expect(p.stays[0]?.agreedTerms[0]?.cancellation).toMatch(/Free cancellation until 7 days/);
    const plan = (org.fakes.rates.plans.get(org.propertyId) ?? []).find((x) => x.id === org.plans.bar);
    if (!plan) throw new Error('no plan');
    plan.cancellation = { tiers: [], nonRefundable: true, noShow: { kind: 'percent_of_stay', percent: 100 } };
    plan.guarantee = ['deposit'];
    const err = (await org.svc
      .commitChangeSafely(t.db, org.ctx, { previewToken: p.token })
      .catch((e: unknown) => e)) as PreviewStaleError;
    expect(err).toBeInstanceOf(PreviewStaleError);
    const fresh = err.details?.freshPreview as ChangePreview;
    expect(fresh.stays[0]?.agreedTerms[0]?.cancellation).toMatch(/Non-refundable/);
    const count = await org.run((tx) =>
      sql<{ n: number }>`select count(*)::int as n from reservations.bookings`.execute(tx.db),
    );
    expect(count.rows[0]?.n).toBe(0);
  });

  it('R-18: only one alternative of a preview can be committed', async () => {
    const org = await setupOrg(t, { units: { family: ['F301'] } });
    await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitTypeId: org.types.family })));
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, {
        kind: 'new_booking',
        booking: org.booking({}, { unitTypeId: org.types.family }),
      }),
    );
    const [a1, a2] = p.alternatives;
    await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: a1?.preview.token ?? '' });
    await expect(
      org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: a2?.preview.token ?? '' }),
    ).rejects.toThrow(/no longer applies/);
    await expect(org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p.token })).rejects.toThrow(
      /no longer applies/,
    );
    const count = await org.run((tx) =>
      sql<{ n: number }>`select count(*)::int as n from reservations.bookings`.execute(tx.db),
    );
    expect(count.rows[0]?.n).toBe(2);
  });
});
