/**
 * Owner requirement 3, revision order within a booking (review P1-2 and P2-1; probes A3/A4 inverted). Revisions of
 * one booking are applied in the hub's order: the hub's time to the microsecond (zone-less read as UTC), then
 * lifecycle meaning (new < modified < cancelled), then arrival — never a hash. A modification is never lost as
 * "stale" because the hub gave it its creation's timestamp, a creation never waits behind its own parked
 * cancellation, and a revision waits for an EARLIER unsettled revision of its booking (the guard M3 removed).
 */
import { sql, withTenantTx } from '@portico/db';
import { addDays, newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HubRevision } from '../src/domain/revisions';
import { loadConnection } from '../src/service/common';
import * as svc from '../src/services';
import {
  BUSINESS_DATE,
  type Connected,
  connect,
  type Harness,
  type Org,
  runFor,
  setupOrg,
  startHarness,
  sys,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const d = (n: number) => addDays(BUSINESS_DATE, n);
const T0 = '2026-11-07T06:00:00Z';

function rooms(nights: 3 | 4): HubRevision['rooms'] {
  return [
    {
      roomRef: '1',
      channelRoomTypeId: 'RT-WV',
      channelRatePlanId: 'RP-WV-BAR',
      checkin: d(30),
      checkout: d(30 + nights),
      adults: 2,
      childrenAges: [],
      nightly: Array.from({ length: nights }, (_, i) => ({ date: d(30 + i), amountMinor: 50_000 })),
    },
  ];
}

function hubRev(c: Connected, bookingId: string, o: Partial<HubRevision>): HubRevision {
  return {
    revisionId: newId(),
    bookingId,
    externalPropertyId: c.externalPropertyId,
    status: 'new',
    insertedAt: T0,
    otaName: 'Booking.com',
    otaReservationCode: bookingId,
    currency: 'USD',
    customer: { firstName: 'Aiko', lastName: 'Tanaka', email: null, phone: null, country: 'JP' },
    rooms: rooms(3),
    notes: null,
    paymentCollect: 'ota',
    ...o,
  };
}

async function ready(): Promise<{ org: Org; c: Connected }> {
  const org = await setupOrg(h);
  const c = await connect(org);
  await runFor(org, 3_000);
  return { org, c };
}

const store = (org: Org, c: Connected, rev: HubRevision) =>
  withTenantTx(h.t.db, sys(org), async (tx) =>
    svc.storeRevision(tx, await loadConnection(tx, c.connectionId), rev, 'webhook'),
  );

const processAll = (org: Org, c: Connected) =>
  svc.processInbound(h.t.db, h.dist.deps, sys(org), c.connectionId);

const booking = (org: Org, externalId: string) =>
  org
    .run((tx) =>
      sql<{
        status: string;
        nights: number;
      }>`select status, nights from fake_res.bookings where external_id = ${externalId}`.execute(tx.db),
    )
    .then((r) => r.rows);

async function stateOf(org: Org, c: Connected, revisionId: string) {
  const all = await org.run((tx) => svc.listRevisions(tx, c.connectionId));
  const r = all.find((x) => x.revisionId === revisionId);
  if (!r) throw new Error(`revision ${revisionId} not stored`);
  return r;
}

const callsFor = (externalId: string) => h.reservations.calls.filter((x) => x.externalId === externalId);

describe('order within a booking (P1-2)', () => {
  it('A3: a modification carrying its creation’s timestamp is applied (never acknowledged as stale)', async () => {
    const { org, c } = await ready();
    const id = `BK-${newId()}`;
    await store(org, c, hubRev(c, id, { status: 'new' }));
    await processAll(org, c);
    const mod = hubRev(c, id, { status: 'modified', rooms: rooms(4) });
    await store(org, c, mod);
    await processAll(org, c);
    expect((await stateOf(org, c, mod.revisionId)).status.revision).toBe('applied');
    expect(await booking(org, id)).toEqual([{ status: 'confirmed', nights: 4 }]);
    // Reservations receives a number that increases in the order Portico applies.
    expect(callsFor(id).map((x) => x.revision)).toEqual([1, 2]);
  });

  it('equal timestamps delivered modification-first: it parks, the creation applies, then it applies (4 nights)', async () => {
    const { org, c } = await ready();
    const id = `BK-${newId()}`;
    const mod = hubRev(c, id, { status: 'modified', rooms: rooms(4) });
    await store(org, c, mod);
    await processAll(org, c);
    expect((await stateOf(org, c, mod.revisionId)).status.revision).toBe('parked');
    await store(org, c, hubRev(c, id, { status: 'new' }));
    await processAll(org, c);
    expect((await stateOf(org, c, mod.revisionId)).status.revision).toBe('applied');
    expect(await booking(org, id)).toEqual([{ status: 'confirmed', nights: 4 }]);
  });

  it('A4: without hub timestamps a cancellation delivered first never strands the creation (one cancelled booking)', async () => {
    const { org, c } = await ready();
    const id = `BK-${newId()}`;
    const cancel = hubRev(c, id, { status: 'cancelled', insertedAt: null });
    await store(org, c, cancel);
    await processAll(org, c);
    expect((await stateOf(org, c, cancel.revisionId)).status.revision).toBe('parked');
    const create = hubRev(c, id, { status: 'new', insertedAt: null });
    await store(org, c, create);
    await processAll(org, c);
    expect((await stateOf(org, c, create.revisionId)).status.revision).toBe('applied');
    expect((await stateOf(org, c, cancel.revisionId)).status.revision).toBe('applied');
    expect(await booking(org, id)).toEqual([{ status: 'cancelled', nights: 3 }]);
    expect((await stateOf(org, c, create.revisionId)).note).toContain('ordered by meaning');
  });

  it('a change carrying its cancellation’s timestamp and arriving after it is stale: the booking stays cancelled', async () => {
    const { org, c } = await ready();
    const id = `BK-${newId()}`;
    await store(org, c, hubRev(c, id, { status: 'new', insertedAt: '2026-11-07T06:00:00Z' }));
    await processAll(org, c);
    await store(org, c, hubRev(c, id, { status: 'cancelled', insertedAt: '2026-11-07T06:00:30Z' }));
    await processAll(org, c);
    const late = hubRev(c, id, { status: 'modified', rooms: rooms(4), insertedAt: '2026-11-07T06:00:30Z' });
    await store(org, c, late);
    await processAll(org, c);
    expect((await stateOf(org, c, late.revisionId)).status.revision).toBe('stale');
    expect(await booking(org, id)).toEqual([{ status: 'cancelled', nights: 3 }]);
  });

  it('equal timestamps, cancellation delivered first: the creation applies, then the cancellation', async () => {
    const { org, c } = await ready();
    const id = `BK-${newId()}`;
    await store(org, c, hubRev(c, id, { status: 'cancelled' }));
    await processAll(org, c);
    await store(org, c, hubRev(c, id, { status: 'new' }));
    await processAll(org, c);
    expect(await booking(org, id)).toEqual([{ status: 'cancelled', nights: 3 }]);
    expect(callsFor(id).map((x) => x.status)).toEqual(['confirmed', 'cancelled']);
  });

  it('microseconds decide: the earlier of two changes 543 µs apart, arriving last, is stale and never sent to reservations', async () => {
    const { org, c } = await ready();
    const id = `BK-${newId()}`;
    await store(org, c, hubRev(c, id, { status: 'new', insertedAt: '2026-11-07T06:00:00.000001Z' }));
    const later = hubRev(c, id, {
      status: 'modified',
      rooms: rooms(4),
      insertedAt: '2026-11-07T06:00:05.123999Z',
    });
    const earlier = hubRev(c, id, {
      status: 'modified',
      notes: 'x',
      insertedAt: '2026-11-07T06:00:05.123456Z',
    });
    await store(org, c, later);
    await processAll(org, c);
    const before = callsFor(id).length;
    await store(org, c, earlier);
    await processAll(org, c);
    const e = await stateOf(org, c, earlier.revisionId);
    expect(e.status).toEqual({ revision: 'stale', ack: 'pending' });
    expect(e.note).toContain(later.revisionId);
    expect(callsFor(id)).toHaveLength(before); // decided by Portico, not sent
    expect(await booking(org, id)).toEqual([{ status: 'confirmed', nights: 4 }]);
  });

  // Zone-less hub times: src/domain/domain.test.ts parses them in a process running at UTC+14 (the test runner does
  // not apply a runtime TZ change, so an in-process check would prove nothing).
  it('a change that arrives behind an earlier change parked as an orphan parks itself (visible, escalated)', async () => {
    const { org, c } = await ready();
    const id = `BK-${newId()}`;
    const m1 = hubRev(c, id, { status: 'modified', notes: 'first', insertedAt: '2026-11-07T06:00:10Z' });
    const m2 = hubRev(c, id, { status: 'modified', rooms: rooms(4), insertedAt: '2026-11-07T06:00:20Z' });
    await store(org, c, m1);
    await processAll(org, c);
    await store(org, c, m2);
    await processAll(org, c);
    expect((await stateOf(org, c, m2.revisionId)).status.revision).toBe('parked');
    await store(org, c, hubRev(c, id, { status: 'new', insertedAt: '2026-11-07T06:00:00Z' }));
    await processAll(org, c);
    expect((await stateOf(org, c, m1.revisionId)).status.revision).toBe('applied');
    expect((await stateOf(org, c, m2.revisionId)).status.revision).toBe('applied');
    expect(await booking(org, id)).toEqual([{ status: 'confirmed', nights: 4 }]);
  });

  it('two changes the hub cannot separate are applied in arrival order with a discrepancy to check the extranet', async () => {
    const { org, c } = await ready();
    const id = `BK-${newId()}`;
    await store(org, c, hubRev(c, id, { status: 'new', insertedAt: '2026-11-07T06:00:00Z' }));
    await processAll(org, c);
    const m1 = hubRev(c, id, { status: 'modified', notes: 'first', insertedAt: '2026-11-07T06:00:09Z' });
    const m2 = hubRev(c, id, { status: 'modified', rooms: rooms(4), insertedAt: '2026-11-07T06:00:09Z' });
    await store(org, c, m1);
    await store(org, c, m2);
    await processAll(org, c);
    expect((await stateOf(org, c, m1.revisionId)).status.revision).toBe('applied');
    expect((await stateOf(org, c, m2.revisionId)).status.revision).toBe('applied');
    expect(await booking(org, id)).toEqual([{ status: 'confirmed', nights: 4 }]);
    const disc = await org.run((tx) => svc.listDiscrepancies(tx, c.connectionId));
    expect(disc.filter((x) => x.summary.includes('could not be ordered'))).toHaveLength(1);
  });
});

describe('a revision waits for an EARLIER unsettled revision of its booking (P2-1)', () => {
  it('a modification arriving while its creation is failed (retryable) waits — not parked, not sent — then both apply in order', async () => {
    const { org, c } = await ready();
    const id = `BK-${newId()}`;
    h.reservations.mode = { kind: 'unavailable', times: 1 };
    const create = hubRev(c, id, { status: 'new', insertedAt: '2026-11-07T06:00:00Z' });
    await store(org, c, create);
    await processAll(org, c);
    expect((await stateOf(org, c, create.revisionId)).status.revision).toBe('failed');
    const mod = hubRev(c, id, { status: 'modified', rooms: rooms(4), insertedAt: '2026-11-07T06:00:30Z' });
    await store(org, c, mod);
    await processAll(org, c);
    const waiting = await stateOf(org, c, mod.revisionId);
    expect(waiting.status.revision).toBe('received');
    expect(waiting.nextAttemptAt).toBeNull(); // waits to be woken by its creation, no timer
    expect(callsFor(id).map((x) => x.status)).toEqual(['confirmed']); // only the failed creation attempt
    h.clock.advance(60_000);
    await processAll(org, c);
    expect((await stateOf(org, c, create.revisionId)).status.revision).toBe('applied');
    expect((await stateOf(org, c, mod.revisionId)).status.revision).toBe('applied');
    expect(await booking(org, id)).toEqual([{ status: 'confirmed', nights: 4 }]);
  });

  it('"Apply as new" on a parked change is refused while its creation is unsettled (sibling guard)', async () => {
    const { org, c } = await ready();
    const id = `BK-${newId()}`;
    const mod = hubRev(c, id, { status: 'modified', rooms: rooms(4), insertedAt: '2026-11-07T06:00:30Z' });
    await store(org, c, mod);
    await processAll(org, c);
    const parked = await stateOf(org, c, mod.revisionId);
    expect(parked.status.revision).toBe('parked');
    h.reservations.mode = { kind: 'unavailable', times: 1 };
    await store(org, c, hubRev(c, id, { status: 'new', insertedAt: '2026-11-07T06:00:00Z' }));
    await processAll(org, c);
    const current = await stateOf(org, c, mod.revisionId);
    await expect(
      org.run((tx) =>
        svc.resolveRevision(tx, h.dist.deps, current.id, current.version, {
          action: 'apply_as_new',
          reason: 'test',
        }),
      ),
    ).rejects.toMatchObject({ code: 'earlier_revision_unsettled' });
  });
});
