/**
 * Adoption brief §2 / ADR-0014 — housekeeping offered alongside an external PMS. With the external system as the
 * system of record for `roomStatus` (write mode forward), Portico's changes are PENDING until acknowledged; in
 * read-only mode they are refused with an explanation; inbound status is mirrored with `external` provenance.
 * Maintenance authority external: work orders and out-of-order requests are forwarded, inventory is not touched.
 */
import { newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ATTENDANT_GRANTS,
  eventsOf,
  type Harness,
  publish,
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

const INTEGRATION = [{ permission: 'operations.external.sync' }, { permission: 'operations.unit.read' }];

describe('connected mode: external system of record for room status', () => {
  it('forwards changes as pending until acknowledged; rejection leaves the unit unchanged', async () => {
    const org = await setupOrg(h);
    const connectionId = newId();
    await org.tx(org.admin, (tx) =>
      platform.setDataAuthority(tx, {
        propertyId: org.propertyId,
        domain: 'roomStatus',
        authority: 'external',
        connectionId,
        systemName: 'OPERA PMS (on-site)',
        writeMode: 'forward',
        reason: 'Housekeeping-only adoption',
      }),
    );
    const [unitId] = await seedUnits(h, org, [{ number: '214', condition: 'dirty' }]);
    if (!unitId) throw new Error('unit');
    const attendant = org.as(ATTENDANT_GRANTS, { displayName: 'Aminath' });
    const integration = org.as(INTEGRATION, { displayName: 'OPERA connector' });
    const u0 = await org.tx(attendant, (tx) => h.ops.getUnit(tx, unitId));
    const r = await org.tx(attendant, (tx) =>
      h.ops.setCondition(tx, unitId, { condition: 'clean' }, { expectedVersion: u0.version }),
    );
    // Not effective yet: still dirty, with the pending change visible and labelled.
    expect(r).toMatchObject({
      pending: true,
      unit: { condition: 'dirty', pendingChange: { change: { condition: 'clean' } } },
    });
    expect(r.unit.status.sync).toBe('pending_external_confirmation');
    expect(r.unit.issues.map((i) => i.code)).toContain('pending_external_confirmation');
    const [requested] = await eventsOf(h, org.tenantId, 'operations.statusForward.requested');
    expect(requested?.payload).toMatchObject({
      domain: 'roomStatus',
      connectionId,
      change: { condition: 'clean' },
    });
    const pending = await org.tx(integration, (tx) => h.ops.listForwards(tx, org.propertyId, 'pending'));
    expect(pending).toHaveLength(1);

    // The PMS acknowledges → effective, provenance external.
    const ack = await org.tx(integration, (tx) =>
      h.ops.acknowledgeForward(tx, pending[0]?.id ?? '', {
        outcome: 'acknowledged',
        externalRef: 'OPERA-RS-9912',
      }),
    );
    expect(ack.status).toBe('acknowledged');
    const u1 = await org.tx(attendant, (tx) => h.ops.getUnit(tx, unitId));
    expect(u1).toMatchObject({ condition: 'clean', pendingChange: null, provenance: 'external' });

    // A second change is rejected by the PMS → nothing changes, staff see why.
    const r2 = await org.tx(attendant, (tx) =>
      h.ops.setCondition(tx, unitId, { condition: 'dirty' }, { expectedVersion: u1.version }),
    );
    await expect(
      org.tx(integration, (tx) => h.ops.acknowledgeForward(tx, r2.forwardId ?? '', { outcome: 'rejected' })),
    ).rejects.toMatchObject({ code: 'reason_required' });
    await org.tx(integration, (tx) =>
      h.ops.acknowledgeForward(tx, r2.forwardId ?? '', {
        outcome: 'rejected',
        reason: 'Room is occupied in OPERA',
      }),
    );
    expect(await org.tx(attendant, (tx) => h.ops.getUnit(tx, unitId))).toMatchObject({
      condition: 'clean',
      pendingChange: null,
    });
    expect(await eventsOf(h, org.tenantId, 'operations.statusForward.rejected')).toHaveLength(1);
    // Attendants cannot acknowledge on behalf of the PMS.
    await expect(
      org.tx(attendant, (tx) =>
        h.ops.acknowledgeForward(tx, r2.forwardId ?? '', { outcome: 'acknowledged' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // Inbound mirror: newer observations apply, older ones never overwrite; wrong connection refused.
    const u2 = await org.tx(integration, (tx) =>
      h.ops.applyExternalRoomStatus(tx, unitId, {
        condition: 'dirty',
        observedAt: new Date('2026-11-07T04:30:00Z'),
        connectionId,
      }),
    );
    expect(u2).toMatchObject({
      condition: 'dirty',
      provenance: 'external',
      externalSyncedAt: '2026-11-07T04:30:00.000Z',
    });
    const u3 = await org.tx(integration, (tx) =>
      h.ops.applyExternalRoomStatus(tx, unitId, {
        condition: 'inspected',
        observedAt: new Date('2026-11-07T04:00:00Z'),
        connectionId,
      }),
    );
    expect(u3.condition).toBe('dirty');
    await expect(
      org.tx(integration, (tx) =>
        h.ops.applyExternalRoomStatus(tx, unitId, {
          condition: 'clean',
          observedAt: new Date('2026-11-07T05:00:00Z'),
          connectionId: newId(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_system_of_record' });

    // Checkout under external authority: the PMS sets the room dirty itself; Portico still plans the clean.
    const stayId = newId();
    await publish(h, org, {
      type: 'reservations.stay.checkedOut',
      aggregate: { type: 'stay', id: stayId },
      payload: { stayId, unitId, arrival: '2026-11-04', departure: '2026-11-07' },
    });
    const tasks = await org.tx(org.admin, (tx) =>
      h.ops.listTasks(tx, { propertyId: org.propertyId, unitId, limit: 10 }),
    );
    expect(tasks.some((t) => t.kind === 'departure_clean')).toBe(true);
  });

  it('read-only authority refuses room-status writes with the system name and recovery', async () => {
    const org = await setupOrg(h);
    await org.tx(org.admin, (tx) =>
      platform.setDataAuthority(tx, {
        propertyId: org.propertyId,
        domain: 'roomStatus',
        authority: 'external',
        connectionId: newId(),
        systemName: 'Protel PMS',
        writeMode: 'read_only',
        reason: 'Evaluation: read-only connection',
      }),
    );
    const [unitId] = await seedUnits(h, org, [{ number: '3', condition: 'dirty' }]);
    if (!unitId) throw new Error('unit');
    const attendant = org.as(SUPERVISOR_GRANTS);
    const u = await org.tx(attendant, (tx) => h.ops.getUnit(tx, unitId));
    await expect(
      org.tx(attendant, (tx) =>
        h.ops.setCondition(tx, unitId, { condition: 'clean' }, { expectedVersion: u.version }),
      ),
    ).rejects.toMatchObject({
      code: 'external_system_of_record',
      message: expect.stringContaining('Protel PMS'),
    });
  });

  it('maintenance authority external: work orders and out-of-order requests are forwarded, inventory untouched', async () => {
    const org = await setupOrg(h);
    await org.tx(org.admin, (tx) =>
      platform.setDataAuthority(tx, {
        propertyId: org.propertyId,
        domain: 'maintenance',
        authority: 'external',
        connectionId: newId(),
        systemName: 'Facility maintenance app',
        writeMode: 'forward',
        reason: 'Engineering keeps its CMMS',
      }),
    );
    const [unitId] = await seedUnits(h, org, [{ number: 'W9' }]);
    if (!unitId) throw new Error('unit');
    const engineer = org.as([
      { permission: 'operations.maintenance.manage' },
      { permission: 'operations.maintenance.setInventoryImpact' },
    ]);
    const calls = h.inventory.calls.length;
    const wo = await org.tx(engineer, (tx) =>
      h.ops.createWorkOrder(tx, {
        propertyId: org.propertyId,
        unitId,
        title: 'Ladder loose',
        faultCategory: 'structural',
        urgency: 'high',
        block: { kind: 'out_of_order', from: '2026-11-07', to: '2026-11-08', reason: 'Ladder unsafe' },
      }),
    );
    expect(wo).toMatchObject({
      authorityState: 'pending_forward',
      block: { status: 'pending_forward', blockId: null },
    });
    expect(wo.status.sync).toBe('pending_external_confirmation');
    expect(h.inventory.calls.length).toBe(calls);
    const forwards = await org.tx(org.admin, (tx) => h.ops.listForwards(tx, org.propertyId, 'pending'));
    expect(forwards.map((f) => f.change.action).sort()).toEqual(['block', 'create']);
  });
});
