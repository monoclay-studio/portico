/**
 * S02 / E02 — An OTA reservation is delivered twice, then modified and cancelled (docs/scenarios/README.md), the
 * distribution part, through the simulated Channex hub and distribution's public services.
 *
 * Binding manifest: platform, inventory, rates, integration secrets = REAL; hub = simulator (R3);
 * reservations.ingestChannelBooking = STRICT FAKE (the real provider cannot price channel bookings on main: its
 * rates port is unbound — apps/api/test/distribution.test.ts proves that path is stored, NOT acknowledged).
 * So the scenario's Money and Inventory lines belong to reservations/finance/payments and stay `.todo` here.
 *
 * Assertion map (catalogue line → assertion):
 *  - State: one booking; second delivery → duplicate              → "one booking, duplicate logged and re-acknowledged"
 *  - State: revision 2 applied (field loss is reservations')      → "revision 2 applied in order"
 *  - State: revision 3 → cancelled                                → "booking cancelled"
 *  - E02: cancel-before-create parked then applied                → "reordered: parked then applied"
 *  - E02: stale older modification stored, not applied            → "older revision arriving last is stale"
 *  - E02: ARI acceptance out of order                             → ari-engine/regressions "late answer"
 *  - Audit: all revisions stored immutably; acks only after commit → "every revision stored once, acked after commit"
 *  - Recovery: a resent ack or redelivery is harmless (duplicate)  → "redelivery after ack"
 *  - Money / Inventory                                             → .todo (reservations/finance/payments)
 */
import { sql } from '@portico/db';
import { addDays } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SimBookingInput } from '../src/adapters/channex/simulator';
import * as svc from '../src/services';
import {
  BUSINESS_DATE,
  connect,
  type Harness,
  runFor,
  setupOrg,
  simState,
  startHarness,
  sys,
  tick,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const d = (n: number) => addDays(BUSINESS_DATE, n);
const nightly = (from: number, n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [d(from + i), '480.00']));
const room = (nights: number): SimBookingInput['rooms'][number] => ({
  roomTypeId: 'RT-WV',
  ratePlanId: 'RP-WV-BAR',
  checkin: d(20),
  checkout: d(20 + nights),
  adults: 2,
  nightly: nightly(20, nights),
});

describe('S02 — OTA reservation delivered twice, modified, cancelled (distribution)', () => {
  it('one booking; duplicate delivery harmless; modification and cancellation applied in order; every ack after commit', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    const sim = h.dist.deps.simulator;
    const r1 = await sim.addRevision(org.tenantId, c.externalPropertyId, {
      status: 'new',
      rooms: [room(3)],
      paymentCollect: 'ota',
      notes: 'Honeymoon — champagne',
    });
    // Revision 1 delivered twice.
    await sim.deliver(org.tenantId, c.externalPropertyId, [r1.id], { duplicate: 1 });
    await tick(org);
    // Revision 2: one night added, special request removed. Revision 3: cancellation.
    const r2 = await sim.addRevision(org.tenantId, c.externalPropertyId, {
      bookingId: r1.booking_id,
      status: 'modified',
      rooms: [room(4)],
      notes: null,
    });
    const r3 = await sim.addRevision(org.tenantId, c.externalPropertyId, {
      bookingId: r1.booking_id,
      status: 'cancelled',
      rooms: [room(4)],
    });
    await sim.deliver(org.tenantId, c.externalPropertyId, [r2.id, r3.id]);
    await tick(org);

    // State: one booking, cancelled; the reservations provider saw confirmed → modified → cancelled exactly once each.
    const bookings = await org.run((tx) =>
      sql<{ status: string; nights: number }>`select status, nights from fake_res.bookings`.execute(tx.db),
    );
    expect(bookings.rows).toEqual([{ status: 'cancelled', nights: 4 }]);
    expect(h.reservations.calls.filter((x) => x.externalId === r1.booking_id).map((x) => x.status)).toEqual([
      'confirmed',
      'modified',
      'cancelled',
    ]);
    // The modification carried the full replacement (4 nights, request removed → reservations raises field loss).
    const payloads = await org.run((tx) =>
      sql<{ revision: number; payload: { rooms: Array<{ departure: string }>; specialRequests: string[] } }>`
        select revision, payload from fake_res.revisions order by revision`.execute(tx.db),
    );
    expect(payloads.rows.map((r) => [r.payload.rooms[0]?.departure, r.payload.specialRequests])).toEqual([
      [d(23), ['Honeymoon — champagne']],
      [d(24), []],
      [d(24), []],
    ]);
    // Audit: each revision stored once, immutably; the duplicate is logged; all acknowledged — after commit.
    const revs = await org.run((tx) => svc.listRevisions(tx, c.connectionId));
    expect(revs.map((r) => [r.channelStatus, r.status.revision, r.status.ack]).sort()).toEqual([
      ['cancelled', 'applied', 'acked'],
      ['modified', 'applied', 'acked'],
      ['new', 'applied', 'acked'],
    ]);
    const deliveries = await org.run((tx) =>
      tx.db
        .selectFrom('distribution.inbound_deliveries')
        .select('outcome')
        .where('connection_id', '=', c.connectionId)
        .execute(),
    );
    expect(deliveries.map((x) => x.outcome).sort()).toEqual(['duplicate', 'stored', 'stored', 'stored']);
    const hub = await simState(org, c);
    expect(hub.revisions.map((r) => r.acked)).toEqual([true, true, true]);
    // Recovery: a redelivery after everything is acknowledged is harmless — logged, acknowledged again, not applied.
    await sim.deliver(org.tenantId, c.externalPropertyId, [r3.id]);
    await tick(org);
    expect(h.reservations.calls.filter((x) => x.externalId === r1.booking_id)).toHaveLength(3);
    expect((await simState(org, c)).revisions.find((r) => r.id === r3.id)?.ack_count).toBe(2);
    // Audit rows exist for every processed revision.
    const audit = await org.run((tx) =>
      tx.db
        .selectFrom('core.audit_log')
        .select('action')
        .where('action', '=', 'distribution.revision.processed')
        .execute(),
    );
    expect(audit).toHaveLength(3);
  });

  it('E02: reordered — the cancellation arrives first and is parked, then applied after the creation; an older modification arriving last is stale', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 3_000);
    const sim = h.dist.deps.simulator;
    const r1 = await sim.addRevision(org.tenantId, c.externalPropertyId, { status: 'new', rooms: [room(3)] });
    const r2 = await sim.addRevision(org.tenantId, c.externalPropertyId, {
      bookingId: r1.booking_id,
      status: 'modified',
      rooms: [room(4)],
    });
    const r3 = await sim.addRevision(org.tenantId, c.externalPropertyId, {
      bookingId: r1.booking_id,
      status: 'cancelled',
      rooms: [room(4)],
    });
    await sim.deliver(org.tenantId, c.externalPropertyId, [r3.id]);
    await svc.processInbound(h.t.db, h.dist.deps, sys(org), c.connectionId);
    const parked = await org.run((tx) => svc.listRevisions(tx, c.connectionId));
    expect(parked[0]).toMatchObject({ status: { revision: 'parked', ack: 'not_due' }, parkReason: 'orphan' });
    await sim.deliver(org.tenantId, c.externalPropertyId, [r1.id]);
    await svc.processInbound(h.t.db, h.dist.deps, sys(org), c.connectionId);
    await sim.deliver(org.tenantId, c.externalPropertyId, [r2.id]);
    await tick(org);
    const byRev = new Map(
      (await org.run((tx) => svc.listRevisions(tx, c.connectionId))).map((r) => [r.revisionId, r.status]),
    );
    expect(byRev.get(r1.id)).toEqual({ revision: 'applied', ack: 'acked' });
    expect(byRev.get(r3.id)).toEqual({ revision: 'applied', ack: 'acked' });
    expect(byRev.get(r2.id)).toEqual({ revision: 'stale', ack: 'acked' });
    const bookings = await org.run((tx) =>
      sql<{ status: string }>`select status from fake_res.bookings`.execute(tx.db),
    );
    expect(bookings.rows).toEqual([{ status: 'cancelled' }]);
    // The recovery event was emitted for the revision that waited.
    const events = await org.run((tx) =>
      tx.db
        .selectFrom('core.outbox')
        .select(['type', 'payload'])
        .where('type', '=', 'distribution.booking.recovered')
        .execute(),
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(events.map((e) => e.payload))).not.toMatch(/Tanaka|example\.com/); // events carry ids only
  });

  it.todo(
    'S02 Money: penalty = 1 night + taxes posted to the booking folio; VCC charge via collection plan (reservations, finance, payments)',
  );
  it.todo(
    'S02 Inventory: consumed (3 nights) → changed (4 nights) → released through the REAL reservations provider (needs rates termsFromChannelPrices bound)',
  );
});
