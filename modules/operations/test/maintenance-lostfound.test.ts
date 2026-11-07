/**
 * Preventive maintenance generation (idempotent), asset history, lost & found lifecycle with signatures and
 * retention, global search and the "My work" feed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { operationsSearch, seedResortOperations } from '../src';
import { type Harness, setupOrg, startHarness } from './support';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('preventive maintenance and asset history', () => {
  it('generates due work orders once per asset and occurrence, then advances the schedule', async () => {
    const org = await setupOrg(h);
    const seeded = await org.tx(org.admin, (tx) =>
      seedResortOperations(tx, h.ops, { propertyId: org.propertyId, villasPerSection: 1 }),
    );
    const engineer = org.as(
      [
        'operations.maintenance.manage',
        'operations.asset.manage',
        'operations.maintenance.read',
        'operations.task.manage',
      ].map((permission) => ({
        permission,
      })),
      { displayName: 'Chief Engineer' },
    );
    // Business date 7 Nov: nothing due yet (generator due 8 Nov, ladders 10 Nov with 2 lead days).
    const today = await org.tx(engineer, (tx) => h.ops.runPreventiveSchedules(tx, org.propertyId, undefined));
    expect(today).toMatchObject({ asOf: '2026-11-07', created: [] });
    const run = await org.tx(engineer, (tx) =>
      h.ops.runPreventiveSchedules(tx, org.propertyId, '2026-11-08'),
    );
    expect(run.created.map((c) => c.scheduleCode).sort()).toEqual([
      'GEN-WEEKLY',
      'LADDER-INSPECT-30D',
      'LADDER-INSPECT-30D',
    ]);
    expect(run.created.find((c) => c.scheduleCode === 'LADDER-INSPECT-30D')?.dueOn).toBe('2026-11-10');
    const again = await org.tx(engineer, (tx) =>
      h.ops.runPreventiveSchedules(tx, org.propertyId, '2026-11-08'),
    );
    expect(again.created).toEqual([]);
    const schedules = await org.tx(engineer, (tx) => h.ops.listPreventiveSchedules(tx, org.propertyId));
    expect(schedules.find((s) => s.code === 'LADDER-INSPECT-30D')?.nextDueOn).toBe('2026-12-10');
    expect(schedules.find((s) => s.code === 'GEN-WEEKLY')?.nextDueOn).toBe('2026-11-15');

    const ladder = seeded.assets.find((a) => a.category === 'ladder');
    if (!ladder) throw new Error('ladder');
    const history = await org.tx(engineer, (tx) => h.ops.assetHistory(tx, ladder.id));
    expect(history.workOrders).toHaveLength(1);
    expect(history.workOrders[0]).toMatchObject({
      preventiveDueOn: '2026-11-10',
      urgency: 'high',
      reportedVia: 'preventive',
      task: { departmentKind: 'engineering' },
      links: expect.arrayContaining([expect.objectContaining({ rel: 'asset', id: ladder.id })]),
    });
    // Engineering's "My work" shows the generated work orders (department queue, unassigned).
    const work = await org.tx(engineer, (tx) =>
      h.ops.listMyWork(tx, { propertyId: org.propertyId, departments: ['engineering'], limit: 50 }),
    );
    expect(work.length).toBe(3);
    expect(work[0]?.owner).toMatchObject({ kind: 'department' });
    // Search by work-order number prefix and hover preview.
    const wo = history.workOrders[0];
    if (!wo) throw new Error('wo');
    const hits = await org.tx(engineer, (tx) => operationsSearch.search(tx, wo.number, { limit: 5 }));
    expect(hits[0]).toMatchObject({ type: 'work_order', id: wo.id, matched: 'number' });
    const summarize = operationsSearch.summarize;
    if (!summarize) throw new Error('summarize');
    expect(await org.tx(engineer, (tx) => summarize(tx, 'work_order', wo.id))).toMatchObject({
      title: expect.stringContaining(wo.number),
      status: { workOrder: 'open' },
    });
  });
});

describe('lost & found', () => {
  it('records, matches, ships to the guest with a receipt, and enforces retention before disposal', async () => {
    const org = await setupOrg(h);
    const manager = org.as([{ permission: 'operations.lostFound.manage' }], {
      displayName: 'Front office manager',
    });
    const watch = await org.tx(manager, (tx) =>
      h.ops.recordLostFound(tx, {
        propertyId: org.propertyId,
        description: 'Diving watch, orange strap',
        category: 'jewellery',
        highValue: true,
        foundAt: '2026-11-07T03:10:00Z',
        foundLocation: 'Dive centre locker 4',
        finder: 'Dive instructor',
        storageLocation: 'Front office safe',
        photos: [{ ref: 'obj://lf/watch.jpg' }],
      }),
    );
    expect(watch).toMatchObject({
      number: expect.stringMatching(/^LF-/),
      status: { lostFound: 'stored' },
      retentionUntil: '2027-05-06',
      issues: [expect.objectContaining({ code: 'high_value' })],
    });
    const matched = await org.tx(manager, (tx) =>
      h.ops.matchLostFound(tx, watch.id, watch.version, {
        stayId: '01a1b51b-7a6f-7b8b-81f4-b2cb5699a30b',
        note: 'Guest emailed',
      }),
    );
    expect(matched.links).toEqual([expect.objectContaining({ rel: 'stay' })]);
    const shipped = await org.tx(manager, (tx) =>
      h.ops.releaseLostFound(tx, watch.id, matched.version, {
        method: 'shipped',
        trackingRef: 'DHL 1234567890',
        releasedTo: 'Guest (Germany) via courier',
        signatureRef: 'obj://lf/courier-receipt.pdf',
      }),
    );
    expect(shipped).toMatchObject({
      status: { lostFound: 'released' },
      releaseMethod: 'shipped',
      trackingRef: 'DHL 1234567890',
    });
    expect(shipped.allowedActions.every((a) => !a.enabled)).toBe(true);
    await expect(
      org.tx(manager, (tx) =>
        h.ops.disposeLostFound(tx, watch.id, shipped.version, { method: 'donated', signatureRef: 'obj://x' }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_lost_found_transition' });

    const towel = await org.tx(manager, (tx) =>
      h.ops.recordLostFound(tx, {
        propertyId: org.propertyId,
        description: 'Child swim shorts',
        category: 'clothing',
        highValue: false,
        foundAt: '2026-11-07T02:00:00Z',
        foundLocation: 'Kids club',
        finder: 'Kids club host',
        storageLocation: 'HK lost & found shelf',
      }),
    );
    await expect(
      org.tx(manager, (tx) =>
        h.ops.disposeLostFound(tx, towel.id, towel.version, {
          method: 'donated',
          signatureRef: 'obj://w/1.png',
        }),
      ),
    ).rejects.toMatchObject({ code: 'retention_period_active' });
    const disposed = await org.tx(manager, (tx) =>
      h.ops.disposeLostFound(tx, towel.id, towel.version, {
        method: 'destroyed',
        signatureRef: 'obj://w/1.png',
        reason: 'Soiled with sunscreen and sand; hygiene policy',
      }),
    );
    expect(disposed.status.lostFound).toBe('disposed');
    const audit = await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select(['action', 'reason'])
      .where('tenant_id', '=', org.tenantId)
      .where('target_type', '=', 'lost_found_item')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'operations.lostFound.record',
        'operations.lostFound.released',
        'operations.lostFound.disposed',
      ]),
    );
  });
});
