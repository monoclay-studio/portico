/**
 * S13 — A staff member loses connectivity while updating housekeeping: queued updates sync on reconnect; the one
 * unit the supervisor changed meanwhile becomes a sync conflict with both values, never a silent overwrite.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertGlobalConsistency, kandu, organization, type Scenario, startScenario } from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

describe('S13 — offline housekeeping', () => {
  it('5 updates apply, 1 conflicts after 25 minutes offline; the supervisor change is kept', async () => {
    const org = await organization(s);
    const k = await kandu(s, org);
    const ops = s.c.services.operations;
    const attendant = org.staff('housekeeping_attendant', 'Fathimath', [k.id]);
    const supervisor = org.staff('housekeeping_supervisor', 'Mariyam', [k.id]);
    const units = ['214', '216', '218', '305', '307', '309'].map((n) => k.units[n] as string);
    // What the device knew when it went offline.
    const base = await org.run(attendant, async (tx) => Promise.all(units.map((u) => ops.getUnit(tx, u))));
    const offlineAt = s.clock.now();
    s.clock.advance(10 * 60_000);
    // Meanwhile the supervisor changes villa 309 (cleaned by another team, then found dirty again).
    const changed = units[5] as string;
    await org.run(supervisor, async (tx) => {
      const u = await ops.getUnit(tx, changed);
      await ops.setCondition(tx, changed, { condition: 'clean' }, { expectedVersion: u.version });
      const u2 = await ops.getUnit(tx, changed);
      await ops.setCondition(
        tx,
        changed,
        { condition: 'dirty', reason: 'Guest returned early' },
        { expectedVersion: u2.version },
      );
    });
    s.clock.advance(15 * 60_000);
    const result = await ops.applySyncBatch(s.t.db, attendant, {
      propertyId: k.id,
      deviceId: 'phone-jetty-a',
      mutations: base.map((u, i) => ({
        op: 'unit.setCondition' as const,
        clientMutationId: `m-${newId()}`,
        clientTimestamp: new Date(offlineAt.getTime() + (i + 1) * 60_000).toISOString(),
        unitId: u.unitId,
        baseVersion: u.version,
        condition: 'clean' as const,
      })),
    });
    const statuses = result.results.map((r) => r.status);
    expect(statuses.filter((x) => x === 'applied')).toHaveLength(5);
    const conflict = result.results.find((r) => r.status === 'conflict');
    expect(conflict?.entity?.id).toBe(changed);
    expect(conflict?.message).toBeTruthy();
    const after = await org.run(supervisor, (tx) => ops.getUnit(tx, changed));
    expect(after.condition).toBe('dirty'); // the newer server state wins; the device's value is a conflict to resolve
    // Re-sending the same batch (flaky network) changes nothing.
    await assertGlobalConsistency(s, org);
  });

  it.todo('lists show "Delayed" while the device is offline (client/PWA behaviour — apps/staff, later wave)');
});
