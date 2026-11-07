/**
 * Tenant isolation (scenario 17 for operations records) and least-privilege permissions.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ATTENDANT_GRANTS,
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

describe('tenant isolation', () => {
  it('another organization cannot read, list, change or sync records by id', async () => {
    const victim = await setupOrg(h, { code: 'VIC' });
    const [unitId] = await seedUnits(h, victim, [{ number: 'V1', condition: 'dirty' }]);
    if (!unitId) throw new Error('unit');
    const task = await victim.tx(victim.admin, (tx) =>
      h.ops.createGenericTask(tx, { propertyId: victim.propertyId, title: 'Fix sunbed', unitId }),
    );
    const sr = await victim.tx(victim.admin, (tx) =>
      h.ops.createServiceRequest(tx, {
        propertyId: victim.propertyId,
        channel: 'desk',
        category: 'Spa',
        description: 'Book massage',
      }),
    );
    const wo = await victim.tx(victim.admin, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: victim.propertyId,
        unitId,
        title: 'Leaking tap',
        faultCategory: 'plumbing',
      }),
    );
    const lf = await victim.tx(victim.admin, (tx) =>
      h.ops.recordLostFound(tx, {
        propertyId: victim.propertyId,
        description: 'Gold ring',
        category: 'jewellery',
        highValue: true,
        foundAt: '2026-11-07T03:00:00Z',
        foundLocation: 'Spa',
        finder: 'Spa therapist',
        storageLocation: 'Front office safe',
      }),
    );
    // The attacker is an all-powerful admin of ANOTHER organization, using the victim's ids.
    const attacker = await setupOrg(h, { code: 'ATK' });
    const a = attacker.admin;
    await expect(attacker.tx(a, (tx) => h.ops.getUnit(tx, unitId))).rejects.toMatchObject({
      code: 'unit_not_found',
    });
    await expect(attacker.tx(a, (tx) => h.ops.getTask(tx, task.id))).rejects.toMatchObject({
      code: 'task_not_found',
    });
    await expect(attacker.tx(a, (tx) => h.ops.getServiceRequest(tx, sr.id))).rejects.toMatchObject({
      status: 404,
    });
    await expect(attacker.tx(a, (tx) => h.ops.getWorkOrder(tx, wo.id))).rejects.toMatchObject({
      status: 404,
    });
    await expect(attacker.tx(a, (tx) => h.ops.getLostFound(tx, lf.id))).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      attacker.tx(a, (tx) =>
        h.ops.transitionTask(tx, task.id, { to: 'cancelled', reason: 'x' }, { expectedVersion: 1 }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      attacker.tx(a, (tx) => h.ops.setCondition(tx, unitId, { condition: 'clean' }, { expectedVersion: 1 })),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await attacker.tx(a, (tx) => h.ops.listTasks(tx, { propertyId: victim.propertyId, limit: 50 })),
    ).toEqual([]);
    await expect(attacker.tx(a, (tx) => h.ops.board(tx, victim.propertyId, {}))).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await attacker.tx(a, (tx) =>
        h.ops.listMyWork(tx, { departments: ['front_office', 'engineering'], limit: 50 }),
      ),
    ).toEqual([]);
    const sync = await h.ops.applySyncBatch(h.t.db, a, {
      propertyId: victim.propertyId,
      deviceId: 'evil',
      mutations: [
        {
          clientMutationId: newId(),
          clientTimestamp: '2026-11-07T04:00:00Z',
          op: 'unit.setCondition',
          unitId,
          baseVersion: 1,
          condition: 'clean',
        },
      ],
    });
    expect(sync.results[0]).toMatchObject({ status: 'rejected', code: expect.stringMatching(/_not_found$/) });
    // Search finds nothing across the boundary.
    const { operationsSearch } = await import('../src');
    expect(await attacker.tx(a, (tx) => operationsSearch.search(tx, wo.number, { limit: 10 }))).toEqual([]);
    const summarize = operationsSearch.summarize;
    if (!summarize) throw new Error('summarize');
    expect(await attacker.tx(a, (tx) => summarize(tx, 'work_order', wo.id))).toBeNull();
    // The victim's data is untouched.
    expect((await victim.tx(victim.admin, (tx) => h.ops.getUnit(tx, unitId))).condition).toBe('dirty');
    const found = await victim.tx(victim.admin, (tx) =>
      operationsSearch.search(tx, wo.number, { limit: 10 }),
    );
    expect(found[0]).toMatchObject({ type: 'work_order', id: wo.id, score: 1 });
  });
});

describe('permissions (deny by default, property scope)', () => {
  it('attendants work their own tasks; supervisors verify, inspect and reassign', async () => {
    const org = await setupOrg(h, { code: 'PRM' });
    const [unitId] = await seedUnits(h, org, [{ number: 'P1', condition: 'dirty' }]);
    if (!unitId) throw new Error('unit');
    const mineId = newId();
    const attendant = org.as(ATTENDANT_GRANTS, { userId: mineId, displayName: 'Aminath' });
    const colleague = org.as(ATTENDANT_GRANTS, { displayName: 'Ali' });
    const supervisor = org.as(SUPERVISOR_GRANTS);
    const t = await org.tx(supervisor, (tx) =>
      h.ops.createGenericTask(tx, {
        propertyId: org.propertyId,
        kind: 'vacant_clean',
        title: 'Clean P1',
        unitId,
        assigneeUserId: mineId,
        assigneeName: 'Aminath',
      }),
    );
    // Someone else's task: refused (needs task.manage), and the record says why.
    await expect(
      org.tx(colleague, (tx) =>
        h.ops.transitionTask(tx, t.id, { to: 'in_progress' }, { expectedVersion: t.version }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const asSeenByColleague = await org.tx(colleague, (tx) => h.ops.getTask(tx, t.id));
    expect(asSeenByColleague.allowedActions.find((x) => x.action === 'start')).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('assigned to Aminath'),
    });
    // Own task: allowed; verifying is not.
    const done = await org.tx(attendant, (tx) =>
      h.ops.transitionTask(tx, t.id, { to: 'done' }, { expectedVersion: t.version }),
    );
    expect(done.allowedActions.find((x) => x.action === 'verify')?.enabled).toBe(false);
    await expect(
      org.tx(attendant, (tx) =>
        h.ops.transitionTask(tx, t.id, { to: 'verified' }, { expectedVersion: done.version }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Attendants cannot inspect; the unit says so and offers only allowed actions.
    const unit = await org.tx(attendant, (tx) => h.ops.getUnit(tx, unitId));
    expect(unit.allowedActions.find((x) => x.action === 'inspect')).toMatchObject({ enabled: false });
    expect(unit.allowedActions.find((x) => x.action === 'takeOutOfOrder')?.enabled).toBe(false);
    await expect(
      org.tx(attendant, (tx) => h.ops.recordInspection(tx, unitId, { items: [] })),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Direct jump to "inspected" is never allowed — only through an inspection record.
    await expect(
      org.tx(supervisor, (tx) =>
        h.ops.setCondition(tx, unitId, { condition: 'inspected' }, { expectedVersion: unit.version }),
      ),
    ).rejects.toMatchObject({ code: 'inspection_required' });
    // Stale If-Match → 409 with the current version.
    await expect(
      org.tx(supervisor, (tx) =>
        h.ops.setCondition(tx, unitId, { condition: 'dirty' }, { expectedVersion: unit.version - 1 }),
      ),
    ).rejects.toMatchObject({ code: 'version_conflict', details: { currentVersion: unit.version } });
    // Lost & found: attendants may log an item but not release it.
    const item = await org.tx(attendant, (tx) =>
      h.ops.recordLostFound(tx, {
        propertyId: org.propertyId,
        description: 'Kindle',
        category: 'electronics',
        highValue: false,
        foundAt: '2026-11-07T03:30:00Z',
        foundLocation: 'P1 bedside',
        finder: 'Aminath',
        storageLocation: 'HK office',
      }),
    );
    await expect(
      org.tx(attendant, (tx) =>
        h.ops.releaseLostFound(tx, item.id, item.version, {
          releasedTo: 'Guest',
          signatureRef: 'obj://sig/1.png',
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('grants for one property do not reach another property of the same organization', async () => {
    const org = await setupOrg(h, { code: 'PA' });
    const [unitId] = await seedUnits(h, org, [{ number: 'X1', condition: 'dirty' }]);
    if (!unitId) throw new Error('unit');
    const elsewhere = org.as(
      SUPERVISOR_GRANTS.map((g) => ({ ...g, propertyIds: [newId()] })),
      { displayName: 'Other property supervisor' },
    );
    await expect(org.tx(elsewhere, (tx) => h.ops.getUnit(tx, unitId))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(org.tx(elsewhere, (tx) => h.ops.board(tx, org.propertyId, {}))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      org.tx(elsewhere, (tx) =>
        h.ops.setCondition(tx, unitId, { condition: 'cleaning' }, { expectedVersion: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      await org.tx(elsewhere, (tx) => h.ops.listMyWork(tx, { propertyId: org.propertyId, limit: 10 })),
    ).toEqual([]);
  });
});
