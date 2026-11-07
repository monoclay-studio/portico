import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Booking } from '../src/contracts';
import { RESERVATIONS_EVENTS as E } from '../src/events';
import { BUSINESS_DATE, created, setupOrg, startDb } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('front desk views', () => {
  it('arrivals show readiness from distinct facts and exactly one blocker each', async () => {
    const org = await setupOrg(t);
    const mk = (over: Parameters<typeof org.stay>[0], name: string, guarantee: 'card' | 'company' = 'card') =>
      org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking(
            { booker: { kind: 'profile', profile: { lastName: name } }, guarantee: { kind: guarantee } },
            { ...over, occupants: [{ profile: { lastName: name }, kind: 'adult', primary: true }] },
          ),
        ),
      );
    await mk({ unitId: org.units.V101 }, 'NoCard');
    await mk({ unitTypeId: org.types.overwater }, 'Unassigned');
    await mk({ unitId: org.units.V102 }, 'Dirty', 'company');
    await mk({ unitId: org.units.V103, requests: ['Baby cot'] }, 'Cot', 'company');
    await mk({ unitTypeId: org.types.overwater, unitId: org.units.W202 }, 'Ready', 'company');
    org.fakes.operations.conditions.set(org.units.V102 as string, 'dirty');
    const arrivals = await org.run((tx) => org.svc.listArrivals(tx, { propertyId: org.propertyId }));
    expect(arrivals.date).toBe(BUSINESS_DATE);
    const blocker = Object.fromEntries(
      arrivals.items.map((r) => [r.guestName, r.readiness?.blockingReason?.key ?? null]),
    );
    expect(blocker).toEqual({
      NoCard: 'payment_secured',
      Unassigned: 'unit_assigned',
      Dirty: 'unit_ready',
      Cot: 'requests',
      Ready: null,
    });
    const dirty = arrivals.items.find((r) => r.guestName === 'Dirty');
    expect(dirty?.readiness?.blockingReason?.message).toBe('V102 is dirty (needs to be inspected).');
    // Distinct facts, never merged: booking status, stay status, unit condition and payment each have their own check.
    expect(dirty?.readiness?.checks.map((c) => c.key)).toEqual([
      'unit_assigned',
      'unit_ready',
      'payment_secured',
      'registration',
      'requests',
    ]);
    for (const r of arrivals.items) {
      expect(r.bookingStatus).toBe('confirmed');
      expect(r.stayStatus).toBe('expected');
      expect(r.flags).toContain('arriving_today');
    }
    expect(arrivals.counts).toEqual({ total: 5, ready: 1 });
  });

  it('departures include balances and in-house flags overstays', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101, departure: '2026-12-11' })),
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
        chargeCode: 'SPA',
        amount: { amountMinor: 9_000, currency: 'USD' },
        serviceDate: BUSINESS_DATE,
        description: 'Spa',
        sourceRef: { type: 'stay', id: stayId },
        idempotencyKey: 'spa-1',
      }),
    );
    const dep = await org.run((tx) =>
      org.svc.listDepartures(tx, { propertyId: org.propertyId, date: '2026-12-11' }),
    );
    expect(dep.items[0]).toMatchObject({ stayId, balance: { amountMinor: 9_000 } });
    const inHouse = await org.run((tx) =>
      org.svc.listInHouse(tx, { propertyId: org.propertyId, date: '2026-12-12' }),
    );
    expect(inHouse.items[0]?.flags).toContain('overstay');
    // Day Close feed: posting data comes from the agreed terms.
    const feed = await org.run((tx) =>
      org.svc.listInHouseStaysForNight(tx, { propertyId: org.propertyId, date: BUSINESS_DATE }),
    );
    expect(feed).toEqual([
      expect.objectContaining({
        stayId,
        night: BUSINESS_DATE,
        unitId: org.units.V101,
        nightly: expect.objectContaining({ net: { amountMinor: 30_000, currency: 'USD' } }),
      }),
    ]);
  });
});

describe('shift handover (RES-R37, RES-I10)', () => {
  it('hands over owned items, the incoming shift acknowledges, items persist until resolved', async () => {
    const org = await setupOrg(t);
    const night = org.user('Night manager');
    const morning = org.user('Morning manager');
    const ownerId = newId();
    const item = await org.run(
      (tx) =>
        org.svc.addHandoverItem(tx, {
          propertyId: org.propertyId,
          department: 'front_office',
          kind: 'guest_commitment',
          title: 'Promised a sunset cruise upgrade to villa 214',
          ownerId,
          ownerName: 'Aishath',
        }),
      night,
    );
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    org.fakes.payments.script = ['timeout'];
    await org.svc.performWorkflow(t.db, org.ctx, {
      stayId: b.stays[0]?.id ?? '',
      kind: 'check_in',
      checkIn: { registration: { identityVerified: true } },
    });
    await org.run(
      (tx) =>
        org.svc.addHandoverItem(tx, {
          propertyId: org.propertyId,
          department: 'front_office',
          kind: 'financial_exception',
          title: 'Card payment pending verification for booking',
          ownerId,
          ref: { type: 'booking', id: b.id },
        }),
      night,
    );

    const h = await org.run(
      (tx) =>
        org.svc.publishHandover(tx, {
          propertyId: org.propertyId,
          department: 'front_office',
          shiftLabel: 'Night 2026-12-10',
          notes: 'Quiet night',
        }),
      night,
    );
    expect(h.items.map((i) => i.kind)).toEqual(['guest_commitment', 'financial_exception']);
    expect(h.items.every((i) => i.ownerId === ownerId && i.stillOpen)).toBe(true);
    await expect(
      org.run(
        (tx) => org.svc.acknowledgeHandover(tx, { handoverId: h.id, expectedVersion: h.version }),
        night,
      ),
    ).rejects.toThrow(/incoming shift/);
    const ack = await org.run(
      (tx) => org.svc.acknowledgeHandover(tx, { handoverId: h.id, expectedVersion: h.version }),
      morning,
    );
    expect(ack).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'Morning manager' });
    // Shift change never removes items: still open in the next handover until resolved.
    await org.run(
      (tx) => org.svc.resolveHandoverItem(tx, { itemId: item.id, resolution: 'Upgrade arranged' }),
      morning,
    );
    const next = await org.run(
      (tx) =>
        org.svc.publishHandover(tx, {
          propertyId: org.propertyId,
          department: 'front_office',
          shiftLabel: 'Morning 2026-12-11',
        }),
      morning,
    );
    expect(next.items.map((i) => i.title)).toEqual(['Card payment pending verification for booking']);
    const history = await org.run((tx) => org.svc.listHandovers(tx, { propertyId: org.propertyId }));
    expect(history[1]?.items.find((i) => i.itemId === item.id)?.stillOpen).toBe(false);
    const ev = await org.run((tx) =>
      sql<{
        type: string;
      }>`select type from core.outbox where type like 'reservations.handover.%' order by created_at`.execute(
        tx.db,
      ),
    );
    expect(ev.rows.map((r) => r.type)).toEqual([
      E.handoverPublished,
      E.handoverAcknowledged,
      E.handoverPublished,
    ]);
  });

  it('refuses to publish items without an owner (relocation case without owner)', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(tx, org.booking({ ownerId: undefined }, { unitId: org.units.V101 })),
      ),
    );
    await org.run((tx) =>
      sql`update reservations.bookings set owner_id = null where id = ${b.id}`.execute(tx.db),
    );
    const sub = org.svc.subscriptions().find((s) => s.consumer === 'reservations.relocation-on-unit-blocked');
    await org.run(
      (tx) =>
        sub?.handle(tx, {
          id: newId(),
          type: 'inventory.unit.blocked',
          tenantId: org.tenantId,
          propertyId: org.propertyId,
          aggregate: { type: 'unit', id: org.units.V101 as string },
          occurredAt: new Date().toISOString(),
          actor: { kind: 'system', process: 'test' },
          correlationId: newId(),
          version: 1,
          payload: {
            unitId: org.units.V101,
            kind: 'out_of_order',
            affectedAssignments: [
              { ref: { type: 'stay', id: b.stays[0]?.id }, nights: { from: '2026-12-10', to: '2026-12-13' } },
            ],
          },
        }) ?? Promise.resolve(),
    );
    await expect(
      org.run((tx) =>
        org.svc.publishHandover(tx, {
          propertyId: org.propertyId,
          department: 'front_office',
          shiftLabel: 'x',
        }),
      ),
    ).rejects.toThrow(/needs an owner/);
  });
});

describe('event consumers', () => {
  it('S08 (reservations part): an out-of-order block on an assigned unit opens a relocation case once', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitId: org.units.V101 }))),
    );
    const stayId = b.stays[0]?.id as string;
    const sub = org.svc.subscriptions().find((s) => s.consumer === 'reservations.relocation-on-unit-blocked');
    const event = {
      id: newId(),
      type: 'inventory.unit.blocked',
      tenantId: org.tenantId,
      propertyId: org.propertyId,
      aggregate: { type: 'unit', id: org.units.V101 as string },
      occurredAt: new Date().toISOString(),
      actor: { kind: 'system' as const, process: 'test' },
      correlationId: newId(),
      version: 1,
      payload: {
        unitId: org.units.V101,
        kind: 'out_of_order',
        affectedAssignments: [
          { ref: { type: 'stay', id: stayId }, nights: { from: '2026-12-10', to: '2026-12-13' } },
        ],
      },
    };
    await org.run((tx) => sub?.handle(tx, event) ?? Promise.resolve());
    await org.run((tx) => sub?.handle(tx, { ...event, id: newId() }) ?? Promise.resolve());
    const cases = await org.run((tx) => org.svc.listRelocationCases(tx, { propertyId: org.propertyId }));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.options[0]).toMatchObject({ kind: 'same_type_other_unit', unitId: org.units.V102 });
    const booking = await org.run((tx) => org.svc.getBooking(tx, b.id));
    expect(booking.stays[0]?.issues.find((i) => i.code === 'relocation_required')?.severity).toBe('blocking');
    await org.run((tx) =>
      org.svc.resolveRelocationCase(tx, {
        caseId: cases[0]?.id ?? '',
        outcome: 'completed',
        note: 'Moved to V102',
        selectedOption: 0,
      }),
    );
    expect(
      await org.run((tx) => org.svc.listRelocationCases(tx, { propertyId: org.propertyId })),
    ).toHaveLength(0);
  });

  it('waitlisted stays are flagged when availability appears', async () => {
    const org = await setupOrg(t, { units: { family: ['F301'] } });
    const first = created<Booking>(
      await org.run((tx) => org.svc.createBooking(tx, org.booking({}, { unitTypeId: org.types.family }))),
    );
    const wl = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking(
            { intent: 'waitlist' },
            { unitTypeId: org.types.family, waitlist: { priority: 1, expiresAt: '2026-12-09' } },
          ),
        ),
      ),
    );
    const p = await org.run((tx) =>
      org.svc.previewChange(tx, { kind: 'cancel_booking', bookingId: first.id, reason: 'guest cancelled' }),
    );
    await org.svc.commitChangeSafely(t.db, org.ctx, { previewToken: p.token });
    const sub = org.svc.subscriptions().find((s) => s.consumer === 'reservations.waitlist-on-availability');
    await org.run(
      (tx) =>
        sub?.handle(tx, {
          id: newId(),
          type: 'inventory.availability.changed',
          tenantId: org.tenantId,
          propertyId: org.propertyId,
          aggregate: { type: 'property', id: org.propertyId },
          occurredAt: new Date().toISOString(),
          actor: { kind: 'system', process: 'test' },
          correlationId: newId(),
          version: 1,
          payload: {
            propertyId: org.propertyId,
            cells: [{ unitTypeId: org.types.family, night: '2026-12-10' }],
          },
        }) ?? Promise.resolve(),
    );
    const issues = await org.run((tx) => org.svc.listIssues(tx, { propertyId: org.propertyId }));
    expect(issues.find((i) => i.kind === 'waitlist_available')?.stayId).toBe(wl.stays[0]?.id);
  });
});

describe('global search (universal record contract)', () => {
  it('finds bookings by confirmation code, guest name, channel id and unit number, and summarizes them', async () => {
    const org = await setupOrg(t);
    const b = created<Booking>(
      await org.run((tx) =>
        org.svc.createBooking(
          tx,
          org.booking(
            { booker: { kind: 'profile', profile: { firstName: 'Aminath', lastName: 'Shareef' } } },
            { unitId: org.units.W201, unitTypeId: org.types.overwater },
          ),
        ),
      ),
    );
    const search = org.svc.search();
    const byCode = await org.run((tx) => search.search(tx, b.code.slice(0, 5).toLowerCase(), { limit: 5 }));
    expect(byCode[0]).toMatchObject({
      type: 'booking',
      id: b.id,
      matched: 'confirmation code',
      status: { booking: 'confirmed' },
    });
    const byName = await org.run((tx) => search.search(tx, 'Aminath Shareef', { limit: 5 }));
    expect(byName.map((h) => h.id)).toContain(b.id);
    const byGuest = await org.run((tx) => search.search(tx, 'Hoffmann', { limit: 5 }));
    expect(byGuest.some((h) => h.type === 'stay' && h.id === b.stays[0]?.id)).toBe(true);
    const byUnit = await org.run((tx) => search.search(tx, 'W201', { limit: 5 }));
    expect(byUnit[0]).toMatchObject({ type: 'stay', id: b.stays[0]?.id, matched: 'unit number' });
    const summary = await org.run((tx) => search.summarize(tx, 'stay', b.stays[0]?.id ?? ''));
    expect(summary).toMatchObject({ type: 'stay', status: { stay: 'expected', booking: 'confirmed' } });
  });
});
