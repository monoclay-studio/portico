/**
 * Scenario 13 (brief §17): a staff member loses connectivity while updating housekeeping.
 * The attendant's device queues changes offline; meanwhile a supervisor reassigns one task and inspects one villa.
 * On reconnect the batch is applied idempotently: valid changes apply (chained in device order), stale ones are
 * rejected with what changed and by whom, dependent ones are skipped, nothing is applied twice on retry, and the
 * delta pull returns the authoritative state.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SyncMutation } from '../src';
import {
  ATTENDANT_GRANTS,
  eventsOf,
  type Harness,
  SUPERVISOR_GRANTS,
  seedUnits,
  setupOrg,
  startHarness,
} from './support';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const at = (iso: string) => new Date(iso).toISOString();

describe('scenario 13: an attendant loses connectivity while updating housekeeping', () => {
  it('applies valid offline changes once, rejects stale ones with explanations, never overwrites silently', async () => {
    const org = await setupOrg(h);
    const [w301, w302, w303] = await seedUnits(h, org, [
      { number: 'W301', sectionCode: 'JC', condition: 'dirty' },
      { number: 'W302', sectionCode: 'JC', condition: 'dirty' },
      { number: 'W303', sectionCode: 'JC', condition: 'dirty' },
    ]);
    if (!w301 || !w302 || !w303) throw new Error('units');
    const mariyamId = newId();
    const hussainId = newId();
    const mariyam = org.as(ATTENDANT_GRANTS, { userId: mariyamId, displayName: 'Mariyam' });
    const supervisor = org.as(SUPERVISOR_GRANTS, { displayName: 'Supervisor Ibrahim' });
    await org.tx(org.admin, async (tx) => {
      for (const [userId, name] of [
        [mariyamId, 'Mariyam'],
        [hussainId, 'Hussain'],
      ] as const)
        await h.ops.upsertAttendant(tx, org.propertyId, {
          userId,
          displayName: name,
          homeSectionCodes: ['JC'],
          dailyCreditCapacity: 20,
        });
    });
    // Morning plan: one vacant clean per villa, all assigned to Mariyam.
    const plan = await org.tx(supervisor, (tx) => h.ops.generateDayPlan(tx, org.propertyId, {}));
    const taskFor = (unitId: string) => {
      const t = plan.created.find((x) => x.unitId === unitId && x.kind === 'vacant_clean');
      if (!t) throw new Error(`no task for ${unitId}`);
      return t;
    };
    for (const u of [w301, w302, w303]) {
      const t = taskFor(u);
      await org.tx(supervisor, (tx) =>
        h.ops.assignTask(tx, t.id, { assigneeUserId: mariyamId }, { expectedVersion: t.version }),
      );
    }

    // 1. Device syncs before going offline.
    const initial = await org.tx(mariyam, (tx) =>
      h.ops.pullChanges(tx, { propertyId: org.propertyId, limit: 500 }),
    );
    const seenUnit = (id: string) => initial.units.find((u) => u.unitId === id)?.version ?? -1;
    const seenTask = (unitId: string) => {
      const t = initial.tasks.find((x) => x.unitId === unitId && x.kind === 'vacant_clean');
      if (!t) throw new Error('task not pulled');
      return t;
    };
    const t301 = seenTask(w301);
    const t302 = seenTask(w302);
    expect(t301.assigneeName).toBe('Mariyam');

    // 2. While Mariyam is offline (25 min), the supervisor reassigns W302 and inspects W303.
    h.clock.advance(10 * 60_000);
    const cur302 = await org.tx(supervisor, (tx) => h.ops.getTask(tx, t302.id));
    await org.tx(supervisor, (tx) =>
      h.ops.assignTask(
        tx,
        t302.id,
        { assigneeUserId: hussainId, reason: 'Mariyam unreachable' },
        { expectedVersion: cur302.version },
      ),
    );
    await org.tx(supervisor, (tx) => h.ops.recordInspection(tx, w303, { items: [] }));
    h.clock.advance(15 * 60_000);

    // 3. Mariyam reconnects; the queued batch is sent (device order).
    const deviceId = 'ipad-hk-07';
    const mutations: SyncMutation[] = [
      {
        clientMutationId: 'm1-start-301',
        clientTimestamp: at('2026-11-07T04:05:00Z'),
        op: 'task.transition',
        taskId: t301.id,
        baseVersion: t301.version,
        to: 'in_progress',
      },
      {
        clientMutationId: 'm2-done-301',
        clientTimestamp: at('2026-11-07T04:25:00Z'),
        op: 'task.transition',
        taskId: t301.id,
        baseVersion: t301.version,
        to: 'done',
      },
      {
        clientMutationId: 'm3-occupancy-301',
        clientTimestamp: at('2026-11-07T04:26:00Z'),
        op: 'unit.reportOccupancy',
        unitId: w301,
        baseVersion: seenUnit(w301),
        observed: 'vacant',
      },
      {
        clientMutationId: 'm4-done-302',
        clientTimestamp: at('2026-11-07T04:27:00Z'),
        op: 'task.transition',
        taskId: t302.id,
        baseVersion: t302.version,
        to: 'done',
      },
      {
        clientMutationId: 'm5-clean-303',
        clientTimestamp: at('2026-11-07T04:28:00Z'),
        op: 'unit.setCondition',
        unitId: w303,
        baseVersion: seenUnit(w303),
        condition: 'clean',
      },
      {
        clientMutationId: 'm6-dnd-303',
        clientTimestamp: at('2026-11-07T04:29:00Z'),
        op: 'unit.setDnd',
        unitId: w303,
        baseVersion: seenUnit(w303),
        dnd: true,
      },
      {
        clientMutationId: 'm7-found-301',
        clientTimestamp: at('2026-11-07T04:20:00Z'),
        op: 'lostFound.record',
        item: {
          description: 'Sunglasses (black frame) under the daybed',
          category: 'accessories',
          highValue: false,
          foundAt: at('2026-11-07T04:20:00Z'),
          foundLocation: 'W301 deck',
          foundUnitId: w301,
          finder: 'Mariyam',
          storageLocation: 'HK office shelf B',
        },
      },
      {
        clientMutationId: 'm8-note-302',
        clientTimestamp: at('2026-11-07T04:27:30Z'),
        op: 'task.comment',
        taskId: t302.id,
        text: 'Bathroom done before I lost signal',
        attachments: [{ ref: 'obj://hk/w302-bath.jpg' }],
      },
    ];
    const batch = { propertyId: org.propertyId, deviceId, mutations };
    const first = await h.ops.applySyncBatch(h.t.db, mariyam, batch);
    expect(first.results.map((r) => [r.clientMutationId, r.status, r.code])).toEqual([
      ['m1-start-301', 'applied', null],
      ['m2-done-301', 'applied', null],
      ['m3-occupancy-301', 'applied', null],
      ['m4-done-302', 'conflict', 'task_reassigned'],
      ['m5-clean-303', 'conflict', 'unit_already_inspected'],
      ['m6-dnd-303', 'skipped', 'earlier_change_rejected'],
      ['m7-found-301', 'applied', null],
      ['m8-note-302', 'applied', null],
    ]);
    const m4 = first.results[3];
    expect(m4?.message).toContain('reassigned to Hussain by Supervisor Ibrahim');
    expect(m4?.conflict?.changesSinceYourVersion).toEqual([
      expect.objectContaining({
        field: 'assignee',
        from: 'Mariyam',
        to: 'Hussain',
        by: 'Supervisor Ibrahim',
      }),
    ]);
    const m5 = first.results[4];
    expect(m5?.message).toContain('inspected and passed by Supervisor Ibrahim');

    // Authoritative state for every touched record.
    const u301 = first.units.find((u) => u.unitId === w301);
    const u303 = first.units.find((u) => u.unitId === w303);
    expect(u301).toMatchObject({ condition: 'clean', observedOccupancy: 'vacant', discrepancy: 'none' });
    expect(u303).toMatchObject({ condition: 'inspected', dnd: false });
    expect(first.tasks.find((t) => t.id === t301.id)?.status.task).toBe('done');
    expect(first.tasks.find((t) => t.id === t302.id)).toMatchObject({
      status: { task: 'open' },
      assigneeName: 'Hussain',
    });

    // 4. The response was lost; the device retries the whole batch. Nothing is applied twice.
    const retry = await h.ops.applySyncBatch(h.t.db, mariyam, batch);
    expect(retry.results.map((r) => [r.status, r.originalStatus ?? null])).toEqual([
      ['duplicate', 'applied'],
      ['duplicate', 'applied'],
      ['duplicate', 'applied'],
      ['duplicate', 'conflict'],
      ['duplicate', 'conflict'],
      ['skipped', null],
      ['duplicate', 'applied'],
      ['duplicate', 'applied'],
    ]);
    const detail = await org.tx(supervisor, (tx) => h.ops.getTask(tx, t301.id));
    expect(detail.history.filter((x) => x.kind === 'status_changed' && x.to === 'done')).toHaveLength(1);
    expect(detail.history.find((x) => x.kind === 'status_changed' && x.to === 'done')?.clientOccurredAt).toBe(
      at('2026-11-07T04:25:00Z'),
    );
    const note = await org.tx(supervisor, (tx) => h.ops.getTask(tx, t302.id));
    expect(note.history.filter((x) => x.kind === 'attachment')).toHaveLength(1);
    const found = await org.tx(org.admin, (tx) => h.ops.listLostFound(tx, { propertyId: org.propertyId }));
    expect(found).toHaveLength(1);

    // 5. Reusing a mutation id for a different change is refused.
    const reused = await h.ops.applySyncBatch(h.t.db, mariyam, {
      propertyId: org.propertyId,
      deviceId,
      mutations: [
        { ...(mutations[2] as SyncMutation & { op: 'unit.reportOccupancy' }), observed: 'occupied' },
      ],
    });
    expect(reused.results[0]).toMatchObject({ status: 'rejected', code: 'mutation_id_reused' });

    // 6. A stale change outside any chain is a conflict with the server's version, not a silent overwrite.
    const stale = await h.ops.applySyncBatch(h.t.db, mariyam, {
      propertyId: org.propertyId,
      deviceId,
      mutations: [
        {
          clientMutationId: 'm9-dirty-301',
          clientTimestamp: at('2026-11-07T04:30:00Z'),
          op: 'unit.setCondition',
          unitId: w301,
          baseVersion: seenUnit(w301),
          condition: 'dirty',
        },
      ],
    });
    expect(stale.results[0]).toMatchObject({ status: 'conflict', code: 'stale_version' });
    expect(stale.units[0]?.condition).toBe('clean');

    // 7. Supervisors see every conflict too.
    const conflicts = await org.tx(supervisor, (tx) => h.ops.listSyncConflicts(tx, org.propertyId));
    expect(conflicts.map((c) => c.code).sort()).toEqual([
      'stale_version',
      'task_reassigned',
      'unit_already_inspected',
    ]);
    expect(await eventsOf(h, org.tenantId, 'operations.sync.conflict')).toHaveLength(3);

    // 8. Delta pull from the pre-offline cursor returns the authoritative changes; the next pull is empty.
    const delta = await org.tx(mariyam, (tx) =>
      h.ops.pullChanges(tx, { propertyId: org.propertyId, cursor: initial.cursor, limit: 500 }),
    );
    expect(new Set(delta.units.map((u) => u.unitNumber))).toEqual(new Set(['W301', 'W302', 'W303']));
    expect(delta.tasks.map((t) => t.id)).toEqual(expect.arrayContaining([t301.id, t302.id]));
    const again = await org.tx(mariyam, (tx) =>
      h.ops.pullChanges(tx, { propertyId: org.propertyId, cursor: delta.cursor, limit: 500 }),
    );
    expect(again).toMatchObject({ units: [], tasks: [], hasMore: false });
  });

  it('concurrent duplicate submissions apply each mutation exactly once', async () => {
    const org = await setupOrg(h);
    const [w401] = await seedUnits(h, org, [{ number: 'W401', condition: 'dirty' }]);
    if (!w401) throw new Error('unit');
    const attendant = org.as(ATTENDANT_GRANTS, { displayName: 'Ali' });
    const unit = await org.tx(attendant, (tx) => h.ops.getUnit(tx, w401));
    const batch = {
      propertyId: org.propertyId,
      deviceId: 'phone-2',
      mutations: [
        {
          clientMutationId: newId(),
          clientTimestamp: new Date().toISOString(),
          op: 'unit.setCondition' as const,
          unitId: w401,
          baseVersion: unit.version,
          condition: 'clean' as const,
        },
      ],
    };
    const [a, b] = await Promise.all([
      h.ops.applySyncBatch(h.t.db, attendant, batch),
      h.ops.applySyncBatch(h.t.db, attendant, batch),
    ]);
    expect([a.results[0]?.status, b.results[0]?.status].sort()).toEqual(['applied', 'duplicate']);
    const log = await h.t.admin.kysely
      .selectFrom('operations.unit_status_log')
      .select('to_value')
      .where('unit_id', '=', w401)
      .where('field', '=', 'condition')
      .execute();
    expect(log.map((l) => l.to_value)).toEqual(['clean']);
  });

  it('pagination of the delta feed never skips a change', async () => {
    const org = await setupOrg(h);
    await seedUnits(
      h,
      org,
      Array.from({ length: 7 }, (_, i) => ({ number: `B${i + 10}` })),
    );
    const reader = org.as(ATTENDANT_GRANTS);
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await org.tx(reader, (tx) =>
        h.ops.pullChanges(tx, { propertyId: org.propertyId, limit: 3, ...(cursor ? { cursor } : {}) }),
      );
      for (const u of r.units) seen.add(u.unitNumber);
      cursor = r.cursor;
      if (!r.hasMore) break;
    }
    expect(seen.size).toBe(7);
  });
});
