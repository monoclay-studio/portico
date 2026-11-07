import { sql, withTenantTx } from '@portico/db';
import { newId, systemAuthorizer } from '@portico/kernel';
import { platform } from '@portico/platform';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking } from '../src/contracts';
import { isForwarded } from '../src/service';
import { created, type Org, setupOrg, startDb } from './helpers';

/** Data authority (ADR-0014, CLAUDE.md rule 15): connect-alongside adoption without split-brain reservations. */
let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

async function setAuthority(org: Org, writeMode: 'read_only' | 'forward') {
  await withTenantTx(t.db, { ...org.ctx, authz: systemAuthorizer }, (tx) =>
    platform.setDataAuthority(tx, {
      propertyId: org.propertyId,
      domain: 'reservations',
      authority: 'external',
      connectionId: newId(),
      systemName: 'Legacy PMS',
      writeMode,
      reason: 'connect alongside',
    }),
  );
}

describe('reservations data authority', () => {
  it('read_only: commands are refused with an explanation naming the system of record', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    await setAuthority(org, 'read_only');
    await expect(org.run((tx) => org.svc.createBooking(tx, org.booking()))).rejects.toThrow(
      /Legacy PMS is the system of record for reservations/,
    );
    await expect(
      org.run((tx) =>
        org.svc.patchBooking(tx, { bookingId: b.id, expectedVersion: b.version, patch: { notes: 'x' } }),
      ),
    ).rejects.toThrow(/system of record/);
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'cancel_booking', bookingId: b.id, reason: 'x' }),
    );
    await expect(org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p.token })).rejects.toThrow(
      /system of record/,
    );
    // Reads still work.
    expect((await org.run((tx) => org.svc.getBooking(tx, b.id))).status.booking).toBe('confirmed');
  });

  it('forward: a pending forwarded change is recorded and NOTHING becomes effective until acknowledged', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(await org.run((tx) => org.svc.createBooking(tx, org.booking())));
    await setAuthority(org, 'forward');
    const res = await org.run((tx) => org.svc.createBooking(tx, org.booking()));
    expect(isForwarded(res)).toBe(true);
    if (!isForwarded(res)) return;
    expect(res.forwardedChange).toMatchObject({
      kind: 'create_booking',
      status: 'pending',
      systemName: 'Legacy PMS',
    });
    expect(res.message).toMatch(/pending until it confirms; nothing has changed in Portico yet/);
    const count = await org.run((tx) =>
      sql<{ n: number }>`select count(*)::int as n from reservations.bookings`.execute(tx.db),
    );
    expect(count.rows[0]?.n).toBe(1);

    const p = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'cancel_booking', bookingId: b.id, reason: 'guest called' }),
    );
    const fwd = await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p.token });
    expect(isForwarded(fwd)).toBe(true);
    const still = await org.run((tx) => org.svc.getBooking(tx, b.id));
    expect(still.status.booking).toBe('confirmed');
    expect(still.pendingForwardedChanges).toEqual([
      expect.objectContaining({ kind: 'cancel_booking', status: 'pending' }),
    ]);
    expect(still.issues.map((i) => i.code)).toContain('pending_external_confirmation');

    const pending = await org.run((tx) => org.svc.listForwardedChanges(tx, { propertyId: org.propertyId }));
    expect(pending).toHaveLength(2);
    const ack = await org.run((tx) =>
      org.svc.acknowledgeForwardedChange(tx, {
        id: pending[0]?.id ?? '',
        outcome: 'acknowledged',
        externalRef: 'PMS-123',
      }),
    );
    expect(ack.status).toBe('acknowledged');
    await expect(
      org.run((tx) =>
        org.svc.acknowledgeForwardedChange(tx, { id: pending[0]?.id ?? '', outcome: 'acknowledged' }),
      ),
    ).rejects.toThrow(/recorded once/);
    // Channel bookings belong to the external system of record in this mode.
    await expect(
      org.run((tx) =>
        org.svc.ingestChannelBooking(tx, {
          connectionId: newId(),
          externalId: 'X',
          revision: 1,
          payload: {
            status: 'confirmed',
            propertyId: org.propertyId,
            currency: 'USD',
            booker: { lastName: 'X' },
            rooms: [
              {
                roomRef: 'R1',
                unitTypeId: org.types.beach,
                ratePlanId: org.plans.bar,
                arrival: '2026-12-20',
                departure: '2026-12-21',
                adults: 2,
                childrenAges: [],
                guests: [],
                nightlyPrices: [{ date: '2026-12-20', amountMinor: 30_000 }],
                specialRequests: [],
              },
            ],
            guarantee: { kind: 'prepaid_channel' },
            specialRequests: [],
            marketSegment: 'ota',
          },
        }),
      ),
    ).rejects.toThrow(/system of record/);
  });
});

describe('data authority on every write (steward R-07, R-08)', () => {
  it('read_only refuses stay edits, unit assignment, waitlist confirmation and check-in BEFORE any external effect', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    const wl = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking({ intent: 'waitlist' }, { waitlist: { priority: 1, expiresAt: '2026-12-09' } }),
        ),
      ),
    );
    await setAuthority(org, 'read_only');
    const stayId = b.stays[0]?.id as string;
    const refused = /Legacy PMS is the system of record/;
    await expect(
      org.run((tx) =>
        org.svc.patchStay(tx, { stayId, expectedVersion: b.version, patch: { notes: 'local only' } }),
      ),
    ).rejects.toThrow(refused);
    await expect(
      org.run((tx) =>
        org.svc.assignUnit(tx, { stayId, unitId: org.units.V102 as string, expectedVersion: b.version }),
      ),
    ).rejects.toThrow(refused);
    await expect(
      org.run((tx) =>
        org.svc.confirmWaitlistedStay(tx, { stayId: wl.stays[0]?.id ?? '', expectedVersion: wl.version }),
      ),
    ).rejects.toThrow(refused);
    await expect(
      org.svc.performWorkflow(t.db, org.ctx, {
        stayId,
        kind: 'check_in',
        checkIn: { registration: { identityVerified: true } },
      }),
    ).rejects.toThrow(refused);
    expect(org.fakes.payments.authorizeCalls).toBe(0);
    expect(org.fakes.access.calls).toEqual([]);
  });

  it('forward: check-in is forwarded once, however often it is confirmed, and nothing external happens', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    await setAuthority(org, 'forward');
    const stayId = b.stays[0]?.id as string;
    for (let i = 0; i < 3; i++) {
      const r = await org.svc.performWorkflow(t.db, org.ctx, {
        stayId,
        kind: 'check_in',
        checkIn: { registration: { identityVerified: true } },
      });
      expect(r.run).toBeNull();
      expect(r.forwarded?.forwardedChange).toMatchObject({ kind: 'check_in', status: 'pending' });
    }
    const n = await org.run((tx) =>
      sql<{
        n: number;
      }>`select count(*)::int as n from reservations.forwarded_changes where kind = 'check_in'`.execute(
        tx.db,
      ),
    );
    expect(n.rows[0]?.n).toBe(1);
    expect(org.fakes.payments.authorizeCalls).toBe(0);
    expect(org.fakes.access.calls).toEqual([]);
    const patched = await org.run((tx) =>
      org.svc.patchStay(tx, { stayId, expectedVersion: b.version, patch: { eta: '16:00' } }),
    );
    expect(isForwarded(patched)).toBe(true);
    expect((await org.run((tx) => org.svc.getBooking(tx, b.id))).stays[0]?.eta).toBeNull();
  });
});
