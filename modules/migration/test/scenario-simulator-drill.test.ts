/**
 * Scenario: same-day migration from the PMS SIMULATOR, end to end in a SANDBOX organization (a full cutover drill).
 *
 * Rehearse → certify → delta sync while the old system keeps taking bookings (new, modified, cancelled) → freeze
 * with final capture → switch → verify → post-capture sweep (MG-06: a booking made in the old system after the final
 * capture is imported exactly once; a change there after the switch is never applied silently) → a late source
 * booking racing a Portico booking for the LAST unit (never oversold silently) → rollback drill keeps everything.
 */
import { withTenantTx } from '@portico/db';
import type { SimAccountHandle } from '@portico/integration';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migration } from '../src';
import { db } from '../src/service/context';
import { ALL_MIGRATION, asSystem, type Harness, type Org, setupOrg, startHarness } from './harness';

let h: Harness;
let org: Org;
let sim: SimAccountHandle;
let jobId: string;
const T0 = new Date('2026-11-20T08:00:00Z');
const planner = () => org.user('Planner', ALL_MIGRATION);
const approver = () => org.user('Approver', ALL_MIGRATION);

beforeAll(async () => {
  h = await startHarness();
  org = await setupOrg(h, { environment: 'sandbox', businessDate: '2026-11-20' });
  ({ account: sim } = await h.hub.createAccount(org.tenantId));
  await sim.createReservation(T0, {
    reservationId: 'R1',
    arrival: '2026-12-01',
    departure: '2026-12-04',
    roomTypeCode: 'BV',
    guestName: 'Ana Silva',
    totalMinor: 90_000,
  });
  await sim.createReservation(T0, {
    reservationId: 'R2',
    arrival: '2026-12-02',
    departure: '2026-12-05',
    roomTypeCode: 'WV',
    guestName: 'Ben Okafor',
    totalMinor: 120_000,
    ratePlanCode: 'HB',
  });
  await sim.createReservation(T0, {
    reservationId: 'R3',
    status: 'TEN',
    arrival: '2026-12-10',
    departure: '2026-12-12',
    roomTypeCode: 'DV',
    guestName: 'Chen Wei',
    totalMinor: 60_000,
  });
  await sim.createReservation(T0, {
    reservationId: 'R4',
    status: 'CXL',
    arrival: '2026-12-01',
    departure: '2026-12-02',
    roomTypeCode: 'BV',
    guestName: 'Dana Levi',
    totalMinor: 30_000,
  });
});
afterAll(async () => h?.close());

const view = () => org.run(async (tx) => migration.jobView(tx, await migration.getJob(tx, jobId)));
const sold = (unitTypeCode: string, date: string) =>
  org.run(async (tx) => {
    const types = await h.inventory.listUnitTypes(asSystem(tx), org.propertyId);
    const id = types.find((t) => t.code === unitTypeCode)?.id as string;
    const [cell] = await h.inventory.getAvailability(asSystem(tx), {
      propertyId: org.propertyId,
      unitTypeIds: [id],
      range: { from: date, to: `${date.slice(0, 8)}${String(Number(date.slice(8)) + 1).padStart(2, '0')}` },
    });
    return cell;
  });

describe('PMS simulator → sandbox: rehearsal and full cutover drill', () => {
  it('rehearses and certifies with no person needed (nothing ambiguous in this source)', async () => {
    const job = await org.run(
      (tx) =>
        migration.createJob(tx, h.deps, {
          propertyId: org.propertyId,
          sourceAdapter: 'pms.simulator',
          sourceSystem: 'Lagoon PMS (simulated)',
          sourceRef: sim.accountId,
        }),
      planner(),
    );
    jobId = job.id;
    const r = await migration.runPipeline(h.t.db, h.deps, planner(), jobId);
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'discover:succeeded',
      'extract:succeeded',
      'map:succeeded',
      'validate:succeeded',
      'rehearse:succeeded',
      'reconcile:succeeded',
      'signoff:succeeded',
      'delta_sync:waiting',
    ]);
    expect((await view()).provenance).toBe('simulated');
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(4);
    expect((await sold('BV', '2026-12-01'))?.sold).toBe(1); // R1; R4 cancelled holds nothing
  });

  it('delta sync while the old system keeps changing: new, modified and cancelled bookings are captured', async () => {
    await org.run(
      (tx) =>
        migration.planCutover(tx, h.deps, jobId, {
          plannedStartAt: '2026-11-20T20:00:00Z',
          freezeMinutes: 15,
        }),
      planner(),
    );
    await org.run((tx) => migration.approveCutover(tx, h.deps, jobId), approver());
    await sim.createReservation(T0, {
      reservationId: 'R5',
      arrival: '2026-12-06',
      departure: '2026-12-08',
      roomTypeCode: 'BV',
      guestName: 'Eli Moss',
      totalMinor: 70_000,
    });
    await sim.modifyReservation(T0, 'R2', { departure: '2026-12-06', totalMinor: 160_000 });
    await sim.cancelReservation(T0, 'R1');
    const r = await migration.runPipeline(h.t.db, h.deps, planner(), jobId);
    expect(r.executed).toEqual([
      { step: 'delta_sync', status: 'succeeded', detail: expect.stringMatching(/In sync: 4 change\(s\)/) },
    ]); // 3 bookings + 1 new guest
    // Staged, not applied: the old system is the system of record until the switch (Portico read-only here).
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(4);
    await expect(
      org.run((tx) => platform.assertWritable(tx, org.propertyId, 'reservations')),
    ).rejects.toMatchObject({
      code: 'external_system_of_record',
    });
  });

  it('cutover: one more booking lands right before the freeze; the final capture takes it; all reconcile', async () => {
    await sim.createReservation(T0, {
      reservationId: 'R6',
      arrival: '2026-12-15',
      departure: '2026-12-16',
      roomTypeCode: 'DV',
      guestName: 'Fay Ito',
      totalMinor: 40_000,
    });
    const r = await migration.runPipeline(h.t.db, h.deps, planner(), jobId, { start: 'freeze' });
    if (r.executed[0]?.status !== 'succeeded') console.error(r.executed);
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'freeze:succeeded',
      'cutover:succeeded',
      'verify:succeeded',
      'rollback_window:waiting',
    ]);
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(6);
    expect((await sold('BV', '2026-12-01'))?.sold).toBe(0); // R1 cancelled in the source → released, never twice
    expect((await sold('WV', '2026-12-05'))?.sold).toBe(1); // R2 extended
    expect((await sold('DV', '2026-12-15'))?.sold).toBe(1); // R6 captured at the freeze
    const listed = await org.run((tx) =>
      h.reservations.listImported(tx, {
        propertyId: org.propertyId,
        sourceSystem: `pms.simulator:${sim.accountId}`,
      }),
    );
    expect(listed.find((b) => b.sourceKey === 'R2')).toMatchObject({
      departure: '2026-12-06',
      totalMinor: 160_000,
    });
    expect(listed.find((b) => b.sourceKey === 'R1')?.status).toBe('cancelled');
  });

  it('MG-06: a booking made in the old system after the final capture is imported once by the sweep', async () => {
    await sim.createReservation(T0, {
      reservationId: 'R7',
      arrival: '2026-12-20',
      departure: '2026-12-22',
      roomTypeCode: 'WV',
      guestName: 'Gus Hale',
      totalMinor: 80_000,
    });
    const s1 = await migration.sweep(h.t.db, h.deps, planner(), jobId);
    expect(s1.imported).toBe(2); // the booking and its (new) guest profile
    const s2 = await migration.sweep(h.t.db, h.deps, planner(), jobId);
    expect(s2.imported).toBe(0);
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(7);
  });

  it('a change made in the old system after the switch is an exception, never applied over Portico', async () => {
    await sim.modifyReservation(T0, 'R5', { totalMinor: 1 });
    await migration.sweep(h.t.db, h.deps, planner(), jobId);
    const listed = await org.run((tx) =>
      h.reservations.listImported(tx, {
        propertyId: org.propertyId,
        sourceSystem: `pms.simulator:${sim.accountId}`,
      }),
    );
    expect(listed.find((b) => b.sourceKey === 'R5')?.totalMinor).toBe(70_000);
    const ex = await org.run((tx) =>
      db(tx)
        .selectFrom('migration.exceptions')
        .select(['code', 'source_key', 'status'])
        .where('job_id', '=', jobId)
        .where('code', '=', 'changed_after_final_capture')
        .execute(),
    );
    expect(ex).toEqual([{ code: 'changed_after_final_capture', source_key: 'R5', status: 'open' }]);
  });

  it('a late source booking racing a Portico booking for the LAST unit is never oversold silently', async () => {
    // DV has one unit (301). Portico sells it for 2026-12-25 while the old system (late) also booked it.
    await sim.createReservation(T0, {
      reservationId: 'R8',
      arrival: '2026-12-25',
      departure: '2026-12-26',
      roomTypeCode: 'DV',
      guestName: 'Hal Roy',
      totalMinor: 40_000,
    });
    const dv = await org.run(
      async (tx) =>
        (await h.inventory.listUnitTypes(asSystem(tx), org.propertyId)).find((t) => t.code === 'DV')
          ?.id as string,
    );
    const staff = org.run((tx) =>
      h.inventory.consume(asSystem(tx), {
        propertyId: org.propertyId,
        unitTypeId: dv,
        nights: { from: '2026-12-25', to: '2026-12-26' },
        quantity: 1,
        ref: { type: 'booking', id: '00000000-0000-7000-8000-000000000025' },
      }),
    );
    const results = await Promise.allSettled([staff, migration.sweep(h.t.db, h.deps, planner(), jobId)]);
    const cell = await sold('DV', '2026-12-25');
    const conflicts = await org.run((tx) =>
      db(tx)
        .selectFrom('migration.exceptions')
        .select(['code'])
        .where('job_id', '=', jobId)
        .where('source_key', '=', 'R8')
        .execute(),
    );
    if (results[0].status === 'fulfilled') {
      // Portico's booking won the unit: the late source booking is imported WITH a recorded inventory conflict.
      expect(cell?.sold).toBe(2);
      expect(cell?.oversoldBy).toBe(1);
      expect(cell?.conflictId).not.toBeNull();
      expect(conflicts.map((c) => c.code)).toContain('inventory_conflict');
    } else {
      // The sweep won the unit: the desk booking was refused (sold out) — one stay, no conflict.
      expect(results[0].reason).toMatchObject({ code: 'inventory_unavailable' });
      expect(cell?.sold).toBe(1);
    }
    // Either way R8 exists exactly once.
    const listed = await org.run((tx) =>
      h.reservations.listImported(tx, {
        propertyId: org.propertyId,
        sourceSystem: `pms.simulator:${sim.accountId}`,
      }),
    );
    expect(listed.filter((b) => b.sourceKey === 'R8')).toHaveLength(1);
  });

  it('rollback drill: the old system is the system of record again; Portico keeps everything', async () => {
    const before = await org.run((tx) => h.reservations.count(tx, org.propertyId));
    await org.run((tx) => migration.requestRollback(tx, h.deps, jobId, { reason: 'Drill' }), planner());
    // The person who requested it cannot approve it alone.
    await expect(
      org.run((tx) => migration.approveRollback(tx, h.deps, jobId), planner()),
    ).rejects.toMatchObject({
      code: 'segregation_of_duties',
    });
    await org.run((tx) => migration.approveRollback(tx, h.deps, jobId), approver());
    expect((await view()).state).toBe('rolled_back');
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(before);
    const auth = await withTenantTx(h.t.db, org.admin, (tx) =>
      platform.getDataAuthority(tx, org.propertyId, 'reservations'),
    );
    expect(auth).toMatchObject({ authority: 'external', writeMode: 'read_only' });
  });
});
