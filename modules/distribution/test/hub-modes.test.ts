/**
 * The simulator no longer mirrors the adapter's unverified assumptions (review P2-3/P2-4). For each assumption it
 * would otherwise mirror, the simulated hub is switched to the OTHER plausible behaviour and Portico must stay
 * truthful: nothing unconfirmed is shown as confirmed, nothing is lost, and what Portico cannot know is visible.
 */
import { sql } from '@portico/db';
import { addDays } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SimBookingInput, SimModes } from '../src/adapters/channex/simulator';
import * as svc from '../src/services';
import {
  BUSINESS_DATE,
  type Connected,
  connect,
  type Harness,
  maxPerMinute,
  type Org,
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

async function ready(
  modes: SimModes,
  settings?: Record<string, unknown>,
): Promise<{ org: Org; c: Connected }> {
  const org = await setupOrg(h);
  const c = await connect(org, settings ? { settings } : {});
  await runFor(org, 3_000);
  await org.run((tx) => svc.setSimulatorModes(tx, h.dist.deps, c.connectionId, modes));
  return { org, c };
}

function room(nights: number): SimBookingInput['rooms'][number] {
  return {
    roomTypeId: 'RT-WV',
    ratePlanId: 'RP-WV-BAR',
    checkin: d(30),
    checkout: d(30 + nights),
    adults: 2,
    nightly: Object.fromEntries(Array.from({ length: nights }, (_, i) => [d(30 + i), '500.00'])),
  };
}

const addRev = (org: Org, c: Connected, input: SimBookingInput) =>
  h.dist.deps.simulator.addRevision(org.tenantId, c.externalPropertyId, input);

const deliver = (
  org: Org,
  c: Connected,
  ids: string[],
  opts: { reverse?: boolean; duplicate?: number } = {},
) => h.dist.deps.simulator.deliver(org.tenantId, c.externalPropertyId, ids, opts);

const booking = (org: Org, externalId: string) =>
  org
    .run((tx) =>
      sql<{
        status: string;
        nights: number;
      }>`select status, nights from fake_res.bookings where external_id = ${externalId}`.execute(tx.db),
    )
    .then((r) => r.rows);

async function setPrice(org: Org, n: number, amountMinor: number, nights = 1) {
  await org.run((tx) =>
    h.rates.applyPriceUpdate(tx, {
      propertyId: org.propertyId,
      ratePlanId: org.bar,
      unitTypeIds: [org.water],
      ranges: [{ from: d(n), to: d(n + nights) }],
      set: { baseOccupancy: 2, baseAmountMinor: amountMinor },
    }),
  );
  await h.drain();
}

const restrictionCell = async (org: Org, c: Connected, n: number) =>
  (
    await org.run((tx) =>
      svc.getChannelCalendar(tx, h.dist.deps, c.connectionId, {
        from: d(n),
        to: d(n + 1),
        kind: 'restrictions',
      }),
    )
  ).find((x) => x.unitTypeId === org.water);

const openExceptions = (org: Org, c: Connected) =>
  org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }));

describe('revisions.ordering — the hub stamps revisions differently', () => {
  for (const timestamps of ['equal', 'second', 'absent', 'zoneless'] as const) {
    it(`${timestamps} timestamps: a creation and its extension delivered change-first end as one 4-night booking`, async () => {
      const { org, c } = await ready({ timestamps });
      const create = await addRev(org, c, { status: 'new', rooms: [room(3)] });
      const extend = await addRev(org, c, {
        status: 'modified',
        bookingId: create.booking_id,
        rooms: [room(4)],
      });
      await deliver(org, c, [create.id, extend.id], { reverse: true });
      await runFor(org, 5_000);
      expect(await booking(org, create.booking_id)).toEqual([{ status: 'confirmed', nights: 4 }]);
      const revs = await org.run((tx) => svc.listRevisions(tx, c.connectionId));
      expect(revs.map((r) => r.status)).toEqual([
        { revision: 'applied', ack: 'acked' },
        { revision: 'applied', ack: 'acked' },
      ]);
    });
  }
});

describe('ari.response — the hub answers 2xx in another shape (P2-3: fail closed)', () => {
  for (const ariAnswer of ['warning_without_index', 'errors_in_200', 'empty_object'] as const) {
    it(`${ariAnswer}: the values are "pending verification", never "in sync"; a later confirmed push settles them`, async () => {
      const { org, c } = await ready({ ariAnswer });
      if (ariAnswer !== 'empty_object') {
        // These shapes appear when the hub refuses a value.
        await org.run((tx) =>
          svc.injectFault(tx, h.dist.deps, c.connectionId, {
            endpoint: 'restrictions',
            kind: 'partial_acceptance',
            times: 1,
          }),
        );
      }
      await setPrice(org, 3, 61_100);
      await tick(org);
      const msgs = await org.run((tx) => svc.listMessages(tx, c.connectionId));
      expect(msgs.find((m) => m.kind === 'restrictions')?.status.message).toBe('pending_verification');
      const cell = await restrictionCell(org, c, 3);
      expect(cell?.state).toBe('pending_verification');
      expect(cell?.acked).toMatchObject({ rateMinor: 50_000 }); // the channel state was NOT overwritten
      const exc = (await openExceptions(org, c)).find((e) => e.code === 'ari_answer_unrecognized');
      expect(exc).toMatchObject({ severity: 'urgent', responsibleParty: 'monoclay' });
      // Past the freshness target the connection is not "connected": the change is unconfirmed.
      await runFor(org, 125_000, 5_000);
      expect((await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId))).health).not.toBe(
        'connected',
      );
      // The hub's format is confirmed (R4) — modelled by switching back — and the dates are re-pushed.
      await org.run((tx) => svc.setSimulatorModes(tx, h.dist.deps, c.connectionId, { ariAnswer: 'v2' }));
      await org.run((tx) =>
        svc.resyncConnection(tx, h.dist.deps, c.connectionId, {
          from: d(3),
          to: d(4),
          kinds: ['restrictions'],
        }),
      );
      await runFor(org, 5_000);
      expect((await restrictionCell(org, c, 3))?.state).toBe('in_sync');
      expect(
        (await openExceptions(org, c)).find((e) => e.code === 'ari_answer_unrecognized'),
      ).toBeUndefined();
    });
  }
});

describe('webhook.payload — the webhook carries something other than the feed', () => {
  it('ids only: the webhook is a notification; the revision is stored from the hub (feed) and applied', async () => {
    const { org, c } = await ready({ webhookPayload: 'ids_only' });
    const rev = await addRev(org, c, { status: 'new', rooms: [room(3)] });
    await deliver(org, c, [rev.id]);
    await runFor(org, 5_000);
    const [r] = await org.run((tx) => svc.listRevisions(tx, c.connectionId));
    expect(r).toMatchObject({ receivedVia: 'feed', status: { revision: 'applied', ack: 'acked' } });
    expect((await openExceptions(org, c)).map((e) => e.code)).not.toContain('revision_conflict');
  });

  it('differs: with the default "store" the difference is flagged (urgent, first stands); with "notify" the hub resource is the only source', async () => {
    const storedPrice = (org: Org, revisionId: string) =>
      org
        .run((tx) =>
          sql<{
            amount: number;
          }>`select (payload->'rooms'->0->'nightly'->0->>'amountMinor')::int as amount from distribution.inbound_revisions where revision_id = ${revisionId}`.execute(
            tx.db,
          ),
        )
        .then((x) => x.rows[0]?.amount);
    // store: the webhook's content is kept; the feed's different content raises an urgent conflict.
    const a = await ready({ webhookPayload: 'differs' });
    const revA = await addRev(a.org, a.c, { status: 'new', rooms: [room(3)] });
    await deliver(a.org, a.c, [revA.id]);
    await svc.pullFeed(h.t.db, h.dist.deps, sys(a.org), a.c.connectionId);
    const conflict = (await openExceptions(a.org, a.c)).find((e) => e.code === 'revision_conflict');
    expect(conflict).toMatchObject({ severity: 'urgent' });
    expect(conflict?.problem).toContain('first delivery stands');
    expect(await storedPrice(a.org, revA.id)).toBe(100);
    // notify: the payload is ignored; the revision comes from the hub's revision resource.
    const b = await ready({ webhookPayload: 'differs' }, { webhookPayload: 'notify' });
    const revB = await addRev(b.org, b.c, { status: 'new', rooms: [room(3)] });
    await deliver(b.org, b.c, [revB.id]);
    await runFor(b.org, 5_000);
    expect(await storedPrice(b.org, revB.id)).toBe(50_000);
    expect((await openExceptions(b.org, b.c)).map((e) => e.code)).not.toContain('revision_conflict');
  });
});

describe('pagination.meta — lists span several pages', () => {
  it('the feed and "re-request since T" read every page; a list beyond the page cap says it is truncated and flags nothing', async () => {
    const { org, c } = await ready({ pageSize: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await addRev(org, c, { status: 'new', rooms: [room(1)] })).id);
    const pulled = await svc.pullFeed(h.t.db, h.dist.deps, sys(org), c.connectionId);
    expect(pulled.stored).toBe(5);
    await runFor(org, 3_000);
    // 5 bookings at 2 per page: three pages, nothing missing.
    const rec = await svc.recoverSince(h.t.db, h.dist.deps, sys(org), c.connectionId, new Date(0));
    expect(rec).toMatchObject({ listed: 5, truncated: false, notAtChannel: 0 });
    // More pages than the cap (20 pages of 1 item, 21 bookings): truncated, and no booking is called missing.
    await org.run((tx) => svc.setSimulatorModes(tx, h.dist.deps, c.connectionId, { pageSize: 1 }));
    for (let i = 0; i < 16; i++) await addRev(org, c, { status: 'new', rooms: [room(1)] });
    const big = await svc.recoverSince(h.t.db, h.dist.deps, sys(org), c.connectionId, new Date(0));
    expect(big).toMatchObject({ listed: 20, truncated: true, notAtChannel: 0 });
  });
});

describe('revisions.ack_idempotent — acknowledging twice is refused', () => {
  it('a redelivered, already acknowledged revision answered 404 stays acknowledged (no failure, no exception)', async () => {
    const { org, c } = await ready({ ackAgain: 404 });
    const rev = await addRev(org, c, { status: 'new', rooms: [room(2)] });
    await deliver(org, c, [rev.id]);
    await runFor(org, 3_000);
    const first = (await org.run((tx) => svc.listRevisions(tx, c.connectionId)))[0];
    expect(first?.status.ack).toBe('acked');
    await deliver(org, c, [rev.id]); // the hub resends it
    await runFor(org, 3_000);
    const again = (await org.run((tx) => svc.listRevisions(tx, c.connectionId)))[0];
    expect(again?.status.ack).toBe('acked');
    expect((await simState(org, c)).revisions[0]?.ack_count).toBe(2);
    expect((await openExceptions(org, c)).map((e) => e.code)).not.toContain('ack_failed');
  });
});

describe('ari.availability.dates — the hub reads date_to as exclusive', () => {
  it('a one-night value is refused by the hub and shown "not accepted" (never "in sync")', async () => {
    const { org, c } = await ready({ dateTo: 'exclusive' });
    await setPrice(org, 5, 63_300);
    await runFor(org, 3_000);
    const cell = await restrictionCell(org, c, 5);
    expect(cell?.state).toBe('not_accepted');
    expect((await openExceptions(org, c)).map((e) => e.code)).toContain('ari_refused');
    // Multi-night runs would lose their last night SILENTLY under this reading: only a read-back at R4 can
    // tell (README, R4 checklist item 1). The simulator shows it:
    await setPrice(org, 7, 64_400, 3);
    await runFor(org, 3_000);
    const s = await simState(org, c);
    expect(s.restrictions['RP-WV-BAR']?.[d(7)]?.rate).toBe('644.00');
    expect(s.restrictions['RP-WV-BAR']?.[d(9)]?.rate).not.toBe('644.00');
  });
});

describe('limits.ari — the hub counts per calendar minute, refused requests included, without Retry-After', () => {
  it('a sustained burst never meets a 429; an injected 429 without Retry-After still pauses a full minute', async () => {
    const { org, c } = await ready(
      { rateLimit: 'fixed_minute_all', retryAfter: false },
      { maxCellsPerMessage: 50 },
    );
    for (let i = 0; i < 90; i++) {
      await setPrice(org, 40 + i, 70_000 + i);
      h.clock.advance(2_000);
      await tick(org);
    }
    await runFor(org, 120_000, 5_000);
    const s = await simState(org, c);
    expect(s.log.filter((l) => l.status === 429)).toHaveLength(0);
    expect(maxPerMinute(s, 'restrictions')).toBeLessThanOrEqual(10);
    await org.run((tx) =>
      svc.injectFault(tx, h.dist.deps, c.connectionId, {
        endpoint: 'restrictions',
        kind: 'rate_limit',
        times: 1,
      }),
    );
    await setPrice(org, 200, 80_000);
    await tick(org);
    const at429 = h.clock.now().getTime();
    await setPrice(org, 201, 80_100);
    await runFor(org, 59_000, 1_000);
    const during = (await simState(org, c)).log.filter(
      (l) => l.endpoint === 'restrictions' && Date.parse(l.at) > at429,
    );
    expect(during).toHaveLength(0);
    await runFor(org, 5_000, 1_000);
    expect((await simState(org, c)).restrictions['RP-WV-BAR']?.[d(201)]?.rate).toBe('801.00');
  });
});
