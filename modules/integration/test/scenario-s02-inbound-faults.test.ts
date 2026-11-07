/**
 * Scenario S02 (integration part) and readiness-brief evidence for delayed / duplicated / reordered updates:
 * a reservation delivered twice, then modified and cancelled — one effect per revision, older revisions never
 * overwrite newer ones, late deliveries are labeled delayed, and missed revisions mark data incomplete until a
 * reconciliation. Unknown codes are held (never guessed) and applied once mapped.
 */
import { sql } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integration } from '../src';
import { activeSimulatorConnection, type Harness, setupOrg, startHarness, tx } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function inbound(tenantId: string, externalId: string) {
  const r = await sql<{
    revision: string;
    status: string;
    duplicate_count: number;
    delayed: boolean;
    gap_detected: boolean;
  }>`
    select revision, status, duplicate_count, delayed, gap_detected from integration.inbound_messages
     where tenant_id = ${tenantId}::uuid and external_id = ${externalId} order by revision_order`.execute(
    h.t.admin.kysely,
  );
  return r.rows;
}
async function appliedEvents(tenantId: string, externalId: string) {
  const r = await sql<{ revision: string }>`
    select payload->>'revision' as revision from core.outbox
     where tenant_id = ${tenantId}::uuid and type = 'integration.inbound.applied' and payload->>'externalId' = ${externalId}
     order by created_at`.execute(h.t.admin.kysely);
  return r.rows.map((x) => x.revision);
}

describe('S02: duplicated, reordered and delayed inbound updates', () => {
  it('a reservation delivered twice, then modified and cancelled has exactly one effect per revision', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    const r = account.createReservation(h.clock.now(), { reservationId: 'R5001', roomTypeCode: 'BV' });
    account.setFaults({ duplicateNext: 2 });
    const first = await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
      trigger: 'manual',
      workflow: 'reservations',
    });
    expect(first.counts).toMatchObject({ applied: 3, duplicates: 2 });
    // The vendor resends (no acknowledgement reached it, or it simply repeats) — still one effect.
    account.modifyReservation(h.clock.now(), r.reservationId, { departure: '2026-12-06' });
    account.cancelReservation(h.clock.now(), r.reservationId);
    account.setFaults({ duplicateNext: 2, reorderNext: true });
    const second = await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
      trigger: 'manual',
      workflow: 'reservations',
    });
    expect(second.counts).toMatchObject({ applied: 2, duplicates: 2, stale: 0 });
    const rows = await inbound(org.tenantId, 'R5001');
    expect(rows.map((x) => [x.revision, x.status])).toEqual([
      ['1', 'applied'],
      ['2', 'applied'],
      ['3', 'applied'],
    ]);
    expect(rows.reduce((s, x) => s + x.duplicate_count, 0)).toBeGreaterThanOrEqual(1);
    expect(await appliedEvents(org.tenantId, 'R5001')).toEqual(['1', '2', '3']);
    const log = await tx(h, org.ctx, (t) =>
      integration.listExchanges(t, conn.id, { limit: 50, workflow: 'reservations' }),
    );
    expect(log.filter((e) => e.outcome === 'duplicate').length).toBe(4);
    expect(log.every((e) => e.provenance === 'simulated')).toBe(true);
    // CL-04: duplicates were acknowledged too, so the vendor stops resending.
    expect(account.pendingCount('reservations')).toBe(0);
  });

  it('an older revision arriving after a newer one is stored as stale and not applied', async () => {
    const org = await setupOrg(h);
    const { conn } = await activeSimulatorConnection(h, org);
    const def = h.deps.connectors.get('pms.simulator')?.definition;
    if (!def) throw new Error('missing connector');
    const rec = (revision: number, roomTypeCode: string) => ({
      workflow: 'reservations',
      externalId: 'R7001',
      revision: String(revision),
      revisionOrder: revision,
      occurredAt: h.clock.now().toISOString(),
      propertyExternalId: 'LGN',
      payload: {
        reservationId: 'R7001',
        propertyCode: 'LGN',
        status: 'CNF',
        arrival: '2026-12-01',
        departure: '2026-12-03',
        roomTypeCode,
        ratePlanCode: 'BAR',
        guestName: 'X',
        adults: 2,
        totalMinor: 100,
        currency: 'USD',
      },
      summary: `Reservation R7001 rev ${revision}`,
    });
    const counts = await tx(h, org.ctx, async (t) => {
      const row = await integration.loadConnection(t, conn.id);
      const a = await integration.ingestRecords(t, h.deps, row, def, [rec(2, 'WV')], {
        syncRunId: null,
        provenance: 'simulated',
      });
      const b = await integration.ingestRecords(t, h.deps, row, def, [rec(1, 'BV')], {
        syncRunId: null,
        provenance: 'simulated',
      });
      return { a, b };
    });
    expect(counts.a.applied).toBe(1);
    expect(counts.b).toMatchObject({ applied: 0, stale: 1 });
    expect((await inbound(org.tenantId, 'R7001')).map((x) => [x.revision, x.status])).toEqual([
      ['1', 'stale'],
      ['2', 'applied'],
    ]);
    expect(await appliedEvents(org.tenantId, 'R7001')).toEqual(['2']);
  });

  it('late delivery is labeled delayed; a missed revision makes data incomplete until reconciliation', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, { trigger: 'manual' });
    account.setFaults({ delaySeconds: 600 });
    account.createReservation(h.clock.now(), { reservationId: 'R8001' });
    const early = await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
      trigger: 'manual',
      workflow: 'reservations',
    });
    expect(early.counts.received).toBe(0);
    h.clock.advance(11 * 60_000);
    const late = await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
      trigger: 'manual',
      workflow: 'reservations',
    });
    expect(late.counts.applied).toBe(1);
    expect((await inbound(org.tenantId, 'R8001'))[0]).toMatchObject({ delayed: true });
    let health = await tx(h, org.ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    const res = health.workflows.find((w) => w.workflow === 'reservations');
    expect(res).toMatchObject({ status: 'delayed', dataProvenance: 'delayed' });
    expect(res?.lastMessageLatencySeconds).toBeGreaterThanOrEqual(600);

    // Missed revision: the vendor jumps from revision 1 to 3 (revision 2 never arrives).
    account.setFaults({ delaySeconds: 0 });
    account.modifyReservation(h.clock.now(), 'R8001', { adults: 3 });
    // Drop revision 2 from the vendor queue to simulate a lost message.
    account.acknowledge('reservations', [{ externalId: 'R8001', revision: '2' }]);
    account.modifyReservation(h.clock.now(), 'R8001', { adults: 2 });
    await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
      trigger: 'manual',
      workflow: 'reservations',
    });
    expect((await inbound(org.tenantId, 'R8001')).map((x) => [x.revision, x.gap_detected])).toEqual([
      ['1', false],
      ['3', true],
    ]);
    health = await tx(h, org.ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health.workflows.find((w) => w.workflow === 'reservations')).toMatchObject({
      dataProvenance: 'incomplete',
    });
    expect(health.urgent.map((s) => s.code)).toContain('workflow_incomplete');

    // Reconciliation re-reads recent records: the missing revision is recorded (stale vs the newer one), the
    // stream is complete again.
    const rec = await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
      trigger: 'reconciliation',
      workflow: 'reservations',
    });
    expect(rec.trigger).toBe('reconciliation');
    expect((await inbound(org.tenantId, 'R8001')).map((x) => [x.revision, x.status])).toEqual([
      ['1', 'applied'],
      ['2', 'stale'],
      ['3', 'applied'],
    ]);
    health = await tx(h, org.ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health.workflows.find((w) => w.workflow === 'reservations')?.incompleteSince).toBeNull();
  });

  it('an unknown room type is held (never guessed), raises one exception, and is applied once mapped', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    account.createReservation(h.clock.now(), { reservationId: 'R9001', roomTypeCode: 'PV' });
    account.createReservation(h.clock.now(), { reservationId: 'R9002', roomTypeCode: 'PV' });
    const run = await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
      trigger: 'manual',
      workflow: 'reservations',
    });
    expect(run.counts).toMatchObject({ held: 2 });
    const exceptions = await tx(h, org.ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    const ex = exceptions.filter((e) => e.code === 'unmapped_code');
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ severity: 'urgent', responsibleParty: 'hotel', occurrences: 2 });
    expect(ex[0]?.problem).toMatch(/"PV"/);
    expect(ex[0]?.nextStep).toMatch(/applied automatically/);
    expect(ex[0]?.businessImpact).not.toMatch(/\{|payload/);
    const health = await tx(h, org.ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health.overall).toBe('degraded');
    expect(health.mappingProblems.heldMessages).toBe(2);
    // The new code appears in the mapping review; mapping it re-applies the held records and closes the exception.
    const set = await tx(h, org.ctx, (t) => integration.getMappingSet(t, conn.id));
    const pv = set.items.find((m) => m.kind === 'unitType' && m.externalId === 'PV');
    expect(pv).toMatchObject({ status: { mapping: 'unmapped' } });
    const { catalogIds } = await import('./harness');
    const res = await tx(h, org.ctx, (t) =>
      integration.reviewMappingAndReprocess(t, h.deps, pv?.id ?? '', pv?.version ?? 0, {
        decision: 'override',
        internalId: catalogIds(org.propertyId).bv,
      }),
    );
    expect(res.reprocessed).toMatchObject({ applied: 2, stillHeld: 0 });
    const after = await tx(h, org.ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(after.filter((e) => e.code === 'unmapped_code')).toHaveLength(0);
    expect(await appliedEvents(org.tenantId, 'R9001')).toEqual(['1']);
  });

  it('amounts in another currency are held, never converted', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    account.createReservation(h.clock.now(), { reservationId: 'R9500', currency: 'EUR' });
    const run = await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
      trigger: 'manual',
      workflow: 'reservations',
    });
    expect(run.counts.held).toBe(1);
    const ex = await tx(h, org.ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(ex.find((e) => e.code === 'record_held')?.problem).toMatch(/EUR.*USD.*never converts/);
  });
});
