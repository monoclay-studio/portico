import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking } from '../src/contracts';
import { BookingVersionConflictError, PreviewStaleError } from '../src/errors';
import { created, setupOrg, startDb } from './helpers';

/** S14 — two users edit the same reservation. */
let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('S14: two users edit the same reservation', () => {
  it('the second writer gets 409 with a field-level diff and who changed it; no lost update', async () => {
    const org = await setupOrg(t);
    const aishath = org.user('Aishath');
    const ibrahim = org.user('Ibrahim');
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({ notes: 'Original note' }))),
    );
    const seenByBoth = b.version;

    const a = created<Booking>(
      await org.run(
        (tx) =>
          org.svc.patchBooking(tx, {
            bookingId: b.id,
            expectedVersion: seenByBoth,
            patch: { notes: 'Seaplane at 15:40' },
          }),
        aishath,
      ),
    );
    expect(a.version).toBe(seenByBoth + 1);

    const err = await org
      .run(
        (tx) =>
          org.svc.patchBooking(tx, {
            bookingId: b.id,
            expectedVersion: seenByBoth,
            patch: { tags: ['vip'] },
          }),
        ibrahim,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BookingVersionConflictError);
    const e = err as BookingVersionConflictError;
    expect(e.status).toBe(409);
    expect(e.code).toBe('version_conflict');
    expect(e.message).toMatch(/changed by Aishath/);
    expect(e.details).toMatchObject({
      expectedVersion: seenByBoth,
      currentVersion: seenByBoth + 1,
      changes: [{ path: 'notes', from: 'Original note', to: 'Seaplane at 15:40' }],
      changedBy: [{ version: seenByBoth + 1, actor: 'Aishath', action: 'edit' }],
    });
    // Ibrahim re-applies on the latest version: both edits survive.
    const final = created<Booking>(
      await org.run(
        (tx) =>
          org.svc.patchBooking(tx, { bookingId: b.id, expectedVersion: a.version, patch: { tags: ['vip'] } }),
        ibrahim,
      ),
    );
    expect(final).toMatchObject({ notes: 'Seaplane at 15:40', tags: ['vip'] });
  });

  it('a change previewed on an older version is refused at commit with a fresh preview', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    const stayId = b.stays[0]?.id as string;
    const preview = await org.run((tx) =>
      org.svc.previewChange(tx, {
        kind: 'dates',
        stayId,
        arrival: b.stays[0]?.arrival ?? '',
        departure: '2026-12-14',
      }),
    );
    await org.run(
      (tx) => org.svc.patchStay(tx, { stayId, expectedVersion: b.version, patch: { eta: '15:40' } }),
      org.user('Ibrahim'),
    );
    const err = await org.svc
      .commitChangeSafely(t.db, org.ctx, { previewToken: preview.token })
      .catch((x: unknown) => x);
    expect(err).toBeInstanceOf(PreviewStaleError);
    expect((err as PreviewStaleError).message).toMatch(/changed by someone else/);
    const fresh = (err as PreviewStaleError).details?.freshPreview as {
      bookingVersion: number;
      token: string;
    };
    expect(fresh.bookingVersion).toBe(b.version + 1);
    const ok = created(await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: fresh.token }));
    expect(ok.booking.stays[0]).toMatchObject({ departure: '2026-12-14', eta: '15:40' });
  });

  it('concurrent commits on the same booking serialize: one wins, the other is told what changed', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    const stayId = b.stays[0]?.id as string;
    const p1 = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'dates', stayId, arrival: '2026-12-10', departure: '2026-12-14' }),
    );
    const p2 = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'occupancy', stayId, occupancy: { adults: 3, childrenAges: [] } }),
    );
    const results = await Promise.allSettled([
      org.svc.commitChangeSafely(t.db, org.user('A'), { previewToken: p1.token }),
      org.svc.commitChangeSafely(t.db, org.user('B'), { previewToken: p2.token }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(PreviewStaleError);
  });
});
