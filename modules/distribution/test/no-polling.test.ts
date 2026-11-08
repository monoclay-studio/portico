/**
 * Owner requirement 1 ("no heavy database polling loops") in the blocked states (review P1-1; probes A1/A2
 * inverted). Work that waits on a person or on another system contributes no due instant: the organization sleeps
 * until its 15-minute ceiling, the standing exception is written once per state change, and the transition that
 * removes the block (Verify, authority back to Portico) wakes the organization once and the pending work goes out.
 */
import { sql, withTenantTx } from '@portico/db';
import { addDays, newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as svc from '../src/services';
import {
  BUSINESS_DATE,
  type Connected,
  connect,
  type Harness,
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
const CEILING_MS = 15 * 60_000;

async function priceChange(org: Org, amountMinor: number) {
  await org.run((tx) =>
    h.rates.applyPriceUpdate(tx, {
      propertyId: org.propertyId,
      ratePlanId: org.bar,
      unitTypeIds: [org.water],
      ranges: [{ from: d(3), to: d(4) }],
      set: { baseOccupancy: 2, baseAmountMinor: amountMinor },
    }),
  );
  await h.drain();
}

/**
 * Follow the due index for one hour like the scheduler does (wake exactly at each stored instant) and return the
 * gaps between wakes. Before P1-1 a blocked organization woke every second (3 600 wakes an hour).
 */
async function wakesForAnHour(org: Org): Promise<number[]> {
  const gaps: number[] = [];
  const end = h.clock.now().getTime() + 3_600_000;
  while (h.clock.now().getTime() < end && gaps.length < 200) {
    const r = await tick(org);
    expect(r.errors).toEqual([]);
    const gap = Date.parse(r.nextDueAt) - h.clock.now().getTime();
    gaps.push(gap);
    h.clock.advance(gap);
  }
  return gaps;
}

const storedDue = (org: Org) =>
  org
    .run((tx) =>
      sql<{ next_due_at: Date }>`select next_due_at from distribution.tenant_schedule`.execute(tx.db),
    )
    .then((r) => new Date(r.rows[0]?.next_due_at ?? 0).getTime());

const openException = async (org: Org, c: Connected, code: string) =>
  (await org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }))).find(
    (e) => e.code === code,
  );

describe('blocked work never keeps the organization due (P1-1)', () => {
  it('A1 inverted: a refused key with a pending change and a pending acknowledgement sleeps to the ceiling; Verify wakes it once', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 5_000);
    // A booking is applied, then the key is refused on the next hub call (ARI), so its acknowledgement waits too.
    const rev = await h.dist.deps.simulator.addRevision(org.tenantId, c.externalPropertyId, {
      status: 'new',
      rooms: [
        {
          roomTypeId: 'RT-WV',
          ratePlanId: 'RP-WV-BAR',
          checkin: d(20),
          checkout: d(21),
          adults: 1,
          nightly: { [d(20)]: '500.00' },
        },
      ],
    });
    await h.dist.deps.simulator.deliver(org.tenantId, c.externalPropertyId, [rev.id]);
    await org.run((tx) =>
      svc.injectFault(tx, h.dist.deps, c.connectionId, { endpoint: 'any', kind: 'unauthorized', times: 1 }),
    );
    await priceChange(org, 61_100);
    await tick(org);
    const conn = await org.run((tx) => svc.getConnection(tx, h.dist.deps, c.connectionId));
    expect(conn.status.credentials).toBe('invalid');
    const [r1] = await org.run((tx) => svc.listRevisions(tx, c.connectionId));
    expect(r1?.status).toMatchObject({ revision: 'applied', ack: 'pending' });
    const sentBefore = (await simState(org, c)).log.length;

    const gaps = await wakesForAnHour(org);
    // Nothing can progress until a person verifies a key: only the 15-minute ceiling wakes the organization.
    expect(gaps.length).toBeLessThanOrEqual(5);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(CEILING_MS);
    expect((await simState(org, c)).log.length).toBe(sentBefore); // nothing reached the hub
    expect((await openException(org, c, 'credentials_invalid'))?.occurrences).toBe(1);

    // The unblocking transition pulls the schedule: due now, one pass sends the change and the acknowledgement.
    await tick(org); // the stored next wake is the 15-minute ceiling again
    expect(await storedDue(org)).toBeGreaterThan(h.clock.now().getTime() + 60_000);
    await svc.verifyConnection(h.t.db, h.dist.deps, org.ctx, c.connectionId);
    expect(await storedDue(org)).toBeLessThanOrEqual(h.clock.now().getTime());
    h.clock.advance(1_000);
    await tick(org);
    expect((await simState(org, c)).restrictions['RP-WV-BAR']?.[d(3)]?.rate).toBe('611.00');
    const [r2] = await org.run((tx) => svc.listRevisions(tx, c.connectionId));
    expect(r2?.status.ack).toBe('acked');
    expect((await openException(org, c, 'credentials_invalid')) ?? null).toBeNull();
  });

  it('A2 inverted: another system of record with a pending change sleeps to the ceiling, the exception is written once; authority back wakes it once', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 5_000);
    const setAuthority = (authority: 'external' | 'portico') =>
      withTenantTx(h.t.db, sys(org), (tx) =>
        platform.setDataAuthority(tx, {
          propertyId: org.propertyId,
          domain: 'availability',
          authority,
          ...(authority === 'external'
            ? { connectionId: newId(), systemName: 'Legacy PMS', writeMode: 'read_only' as const }
            : { writeMode: 'exclusive' as const }),
          reason: 'test',
        }),
      );
    await setAuthority('external');
    await h.drain();
    await priceChange(org, 61_100);
    const sentBefore = (await simState(org, c)).log.filter((l) => l.endpoint !== 'feed').length;

    const gaps = await wakesForAnHour(org);
    // Only real work wakes the organization: the 15-minute feed pull (bookings still flow) and the ceiling.
    expect(gaps.length).toBeLessThanOrEqual(6);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(60_000);
    expect((await simState(org, c)).log.filter((l) => l.endpoint !== 'feed').length).toBe(sentBefore);
    const blocked = (await org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId }))).filter(
      (e) => e.code === 'publication_blocked',
    );
    // One row per blocked kind (availability; restrictions follow availability), each written once.
    expect(blocked.length).toBeGreaterThan(0);
    for (const e of blocked) expect(e.occurrences).toBe(1);
    expect((await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId))).health).toBe('blocked');

    await tick(org);
    expect(await storedDue(org)).toBeGreaterThan(h.clock.now().getTime() + 60_000);
    await setAuthority('portico');
    await h.drain();
    expect(await storedDue(org)).toBeLessThanOrEqual(h.clock.now().getTime());
    h.clock.advance(1_000);
    await tick(org);
    expect((await simState(org, c)).restrictions['RP-WV-BAR']?.[d(3)]?.rate).toBe('611.00');
  });

  it('sibling: a connection the environment refuses (target mismatch) sleeps to the ceiling and shows "blocked" with the hub reason', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await runFor(org, 5_000);
    // A demo organization may reach only the simulator; a connection recorded for staging is refused at every call.
    await withTenantTx(h.t.db, sys(org), (tx) =>
      sql`update distribution.connections set target = 'staging' where id = ${c.connectionId}::uuid`.execute(
        tx.db,
      ),
    );
    await priceChange(org, 61_100);
    const gaps = await wakesForAnHour(org);
    expect(gaps.length).toBeLessThanOrEqual(5);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(CEILING_MS);
    const refused = (await org.run((tx) => svc.listExceptions(tx, { connectionId: c.connectionId }))).filter(
      (e) => e.code === 'publication_refused',
    );
    expect(refused.length).toBe(1);
    expect(refused[0]?.occurrences).toBe(1);
    const health = await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId));
    expect(health).toMatchObject({ health: 'blocked', banner: { severity: 'warning' } });
    expect(health.reason).toContain('staging');
  });

  it('sibling: once the oldest change has crossed the freshness target, waiting for the budget wakes at the slot, not every second', async () => {
    const org = await setupOrg(h);
    const c = await connect(org, {
      settings: { availabilityPerMinute: 1, restrictionsPerMinute: 1, freshnessTargetSeconds: 30 },
    });
    await runFor(org, 61_000, 61_000); // the connect resync has used the slots; they are free again now
    await priceChange(org, 61_100);
    await tick(org); // sent: the restrictions slot is used for 60 s
    h.clock.advance(1_000);
    await priceChange(org, 62_200); // waits for the slot
    h.clock.advance(39_000); // the oldest unconfirmed change is now older than the 30 s target
    const r = await tick(org);
    expect((await org.run((tx) => svc.getHealth(tx, h.dist.deps, c.connectionId))).health).toBe('degraded');
    // The freshness instant is already in the past: the next wake is the budget slot (~20 s), never now + 1 s.
    expect(Date.parse(r.nextDueAt) - h.clock.now().getTime()).toBeGreaterThanOrEqual(15_000);
    h.clock.advance(Date.parse(r.nextDueAt) - h.clock.now().getTime());
    await tick(org);
    expect((await simState(org, c)).restrictions['RP-WV-BAR']?.[d(3)]?.rate).toBe('622.00');
  });
});
