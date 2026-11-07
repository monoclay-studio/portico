/**
 * Scenario S20 (integration part): an external system goes unavailable during a busy shift. Health turns
 * degraded with a plain impact statement; nothing pretends to be synced; on reconnection, money-moving and
 * inventory-reopening actions are NOT replayed blindly — they wait for revalidation — and state-setting updates
 * are coalesced to the latest. Unknown outcomes are verified with the vendor before any resend.
 */
import { sql } from '@portico/db';
import { IdempotencyConflictError } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integration } from '../src';
import { activeSimulatorConnection, type Harness, setupOrg, startHarness, tx, userCtx } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const charge = (n: number, amountMinor = 4500) => ({
  workflow: 'charges',
  operation: 'create',
  idempotencyKey: `folio-posting:P${n}`,
  payload: { reservationId: 'R1001', chargeCode: 'FNB', amountMinor, currency: 'USD', reference: `P${n}` },
  sourceRef: { type: 'finance_posting', id: `P${n}` },
});

async function commands(tenantId: string) {
  const r = await sql<{ idempotency_key: string; status: string; effect_class: string }>`
    select idempotency_key, status, effect_class from integration.outbound_commands where tenant_id = ${tenantId}::uuid order by enqueued_at, idempotency_key`.execute(
    h.t.admin.kysely,
  );
  return Object.fromEntries(r.rows.map((x) => [x.idempotency_key, x.status]));
}

describe('S20: connection outage during a busy shift', () => {
  it('degrades with impact, holds money and inventory actions, coalesces state, and never replays blindly', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    const ctx = org.ctx;
    await integration.runSync(h.t.db, h.deps, ctx, conn.id, { trigger: 'manual' });
    const enqueue = (
      input: Omit<Parameters<typeof integration.enqueueOutbound>[2], 'connectionId' | 'propertyId'>,
    ) =>
      tx(h, ctx, (t) =>
        integration.enqueueOutbound(t, h.deps, {
          connectionId: conn.id,
          propertyId: org.propertyId,
          ...input,
        }),
      );

    // Normal operation: a forwarded charge is sent and confirmed once.
    const c1 = await enqueue(charge(1));
    expect(c1).toMatchObject({ status: 'queued', effectClass: 'money', duplicate: false });
    expect(await enqueue(charge(1))).toMatchObject({ commandId: c1.commandId, duplicate: true });
    await expect(
      enqueue({ ...charge(1), payload: { ...charge(1).payload, amountMinor: 1 } }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(await integration.dispatchOutbound(h.t.db, h.deps, ctx, conn.id)).toMatchObject({
      acknowledged: 1,
    });
    expect(await account.appliedCommands()).toHaveLength(1);

    // Outage starts.
    await account.setFaults({ outage: true });
    await enqueue(charge(2));
    await enqueue({
      workflow: 'reservations',
      operation: 'cancel',
      idempotencyKey: 'cancel:R1001',
      payload: { reservationId: 'R1001' },
      businessKey: 'reservation:R1001',
    });
    for (const statusCode of ['VD', 'VC', 'INS']) {
      await enqueue({
        workflow: 'roomStatus',
        operation: 'update',
        idempotencyKey: `rs:101:${statusCode}`,
        payload: { roomNumber: '101', statusCode },
        businessKey: 'roomStatus:LGN-101',
      });
      h.clock.advance(1000);
    }
    for (let i = 0; i < 3; i++) {
      h.clock.advance(20_000);
      const run = await integration.runSync(h.t.db, h.deps, ctx, conn.id, { trigger: 'manual' });
      expect(run.status).toBe('failed');
      await integration.dispatchOutbound(h.t.db, h.deps, ctx, conn.id);
    }
    // Nothing reached the vendor during the outage; risky actions were not even attempted while interrupted.
    expect(await account.appliedCommands()).toHaveLength(1);
    let health = await tx(h, ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health.overall).toBe('degraded');
    expect(health.urgent.map((s) => s.code)).toEqual(
      expect.arrayContaining(['connection_interrupted', 'workflow_degraded']),
    );
    expect(health.urgent.find((s) => s.code === 'workflow_degraded')?.responsibleParty).toBe('vendor');
    expect(health.impact?.summary).toMatch(/Reservations and arrivals.*Lagoon Island Resort/);
    expect(health.impact?.properties).toEqual([{ id: org.propertyId, name: 'Lagoon Island Resort' }]);
    expect(health.impact?.hotelFunctions.find((f) => f.workflow === 'charges')?.effect).toMatch(
      /need a person's confirmation/,
    );
    // Three failed reads (plus one forwarded cancellation tried before the interruption threshold).
    expect(health.workflows.find((w) => w.workflow === 'reservations')?.status).toBe('degraded');
    expect(
      health.workflows.find((w) => w.workflow === 'reservations')?.consecutiveFailures,
    ).toBeGreaterThanOrEqual(3);
    const exceptions = await tx(h, ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    const failing = exceptions.find((e) => e.code === 'workflow_failing' && e.workflow === 'reservations');
    expect(failing).toMatchObject({ severity: 'urgent', responsibleParty: 'vendor' });
    expect(failing?.problem).toMatch(/cannot exchange reservations/);
    expect(failing?.nextStep).toMatch(/held for your confirmation/);
    // Past 3× the freshness target, a system-of-record workflow is failing and its data delayed.
    h.clock.advance(5 * 60_000);
    health = await tx(h, ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health.workflows.find((w) => w.workflow === 'reservations')).toMatchObject({
      status: 'failing',
      dataProvenance: 'delayed',
    });
    expect(health.overall).toBe('down');

    // The vendor comes back: the next successful exchange is a reconnection.
    await account.setFaults({ outage: false });
    const back = await integration.runSync(h.t.db, h.deps, ctx, conn.id, { trigger: 'manual' });
    expect(back.status).toBe('succeeded');
    expect(await commands(org.tenantId)).toMatchObject({
      'folio-posting:P1': 'acknowledged',
      'folio-posting:P2': 'needs_revalidation',
      'cancel:R1001': 'needs_revalidation',
      'rs:101:VD': 'superseded',
      'rs:101:VC': 'superseded',
      'rs:101:INS': 'queued',
    });
    const held = (
      await tx(h, ctx, (t) => integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }))
    ).filter((e) => e.code !== 'unmapped_code');
    expect(held.map((e) => e.code)).toEqual(['actions_need_revalidation']);
    expect(held[0]?.businessImpact).toMatch(/no guest is charged twice and no sold room is reopened/);
    // Dispatch sends only the latest room status; the held actions stay held.
    const d = await integration.dispatchOutbound(h.t.db, h.deps, ctx, conn.id);
    expect(d).toMatchObject({ acknowledged: 1 });
    expect((await account.appliedCommands()).map((a) => a.idempotencyKey)).toEqual([
      'folio-posting:P1',
      'rs:101:INS',
    ]);
    health = await tx(h, ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health.urgent.map((s) => s.code)).toContain('actions_need_revalidation');
    expect(health.outbound.needsRevalidation).toBe(2);

    // A person decides. Without the permission: refused.
    const held2 = await tx(h, ctx, (t) => integration.listOutbound(t, conn.id, 'needs_revalidation'));
    const p2 = held2.find((c) => c.idempotencyKey === 'folio-posting:P2');
    const cancel = held2.find((c) => c.idempotencyKey === 'cancel:R1001');
    expect(p2?.revalidationReason).toMatch(/unreachable/);
    const viewer = userCtx(org, [
      { permission: 'integration.connection.read', propertyIds: [org.propertyId] },
    ]);
    await expect(
      tx(h, viewer, (t) =>
        integration.revalidateCommand(t, h.deps, p2?.id ?? '', p2?.version ?? 0, {
          decision: 'resend',
          reason: 'checked the bill',
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await tx(h, ctx, (t) =>
      integration.revalidateCommand(t, h.deps, p2?.id ?? '', p2?.version ?? 0, {
        decision: 'resend',
        reason: 'Checked: not on the PMS bill',
      }),
    );
    await tx(h, ctx, (t) =>
      integration.revalidateCommand(t, h.deps, cancel?.id ?? '', cancel?.version ?? 0, {
        decision: 'cancel',
        reason: 'Villa was resold meanwhile',
      }),
    );
    expect(await integration.dispatchOutbound(h.t.db, h.deps, ctx, conn.id)).toMatchObject({
      acknowledged: 1,
    });
    expect((await account.appliedCommands()).map((a) => a.idempotencyKey)).toEqual([
      'folio-posting:P1',
      'rs:101:INS',
      'folio-posting:P2',
    ]);
    expect(await commands(org.tenantId)).toMatchObject({
      'folio-posting:P2': 'acknowledged',
      'cancel:R1001': 'cancelled',
    });
    const left = await tx(h, ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(left.filter((e) => e.code === 'actions_need_revalidation')).toHaveLength(0);
    const cancelled = await sql<{
      n: number;
    }>`select count(*)::int as n from core.outbox where tenant_id = ${org.tenantId}::uuid and type = 'integration.outbound.cancelled'`.execute(
      h.t.admin.kysely,
    );
    expect(cancelled.rows[0]?.n).toBe(1);
  });

  it('an unknown outcome is verified with the vendor before any resend (CL-07): no double charge', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    const ctx = org.ctx;
    await tx(h, ctx, (t) =>
      integration.enqueueOutbound(t, h.deps, {
        connectionId: conn.id,
        propertyId: org.propertyId,
        ...charge(3),
      }),
    );
    await account.setFaults({ timeoutNextCommand: true });
    expect(await integration.dispatchOutbound(h.t.db, h.deps, ctx, conn.id)).toMatchObject({
      pendingVerification: 1,
    });
    // The vendor DID apply it, but Portico could not know.
    expect(await account.appliedCommands()).toHaveLength(1);
    const [pending] = await tx(h, ctx, (t) => integration.listOutbound(t, conn.id, 'pending_verification'));
    expect(pending).toBeDefined();
    const health = await tx(h, ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health.urgent.map((s) => s.code)).toContain('actions_pending_verification');
    h.clock.advance(30_000);
    expect(await integration.dispatchOutbound(h.t.db, h.deps, ctx, conn.id)).toMatchObject({
      verifiedAlreadyApplied: 1,
      acknowledged: 0,
    });
    expect(
      (await account.appliedCommands()).filter((a) => a.idempotencyKey === 'folio-posting:P3'),
    ).toHaveLength(1);
    const log = await tx(h, ctx, (t) =>
      integration.listExchanges(t, conn.id, { limit: 10, workflow: 'charges' }),
    );
    expect(log[0]?.summary).toMatch(/verified and not sent again/);
    expect(log.some((e) => e.outcome === 'unknown' && /pending verification/.test(e.summary))).toBe(true);
  });

  it('a refused money action is final and explained: not on the guest bill', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    await tx(h, org.ctx, (t) =>
      integration.enqueueOutbound(t, h.deps, {
        connectionId: conn.id,
        propertyId: org.propertyId,
        ...charge(4),
      }),
    );
    await account.setFaults({ rejectNextCommand: true });
    expect(await integration.dispatchOutbound(h.t.db, h.deps, org.ctx, conn.id)).toMatchObject({
      rejected: 1,
    });
    h.clock.advance(60_000);
    expect(await integration.dispatchOutbound(h.t.db, h.deps, org.ctx, conn.id)).toMatchObject({
      attempted: 0,
    });
    const ex = await tx(h, org.ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(ex.find((e) => e.code === 'action_rejected')).toMatchObject({ severity: 'urgent' });
    expect(ex.find((e) => e.code === 'action_rejected')?.businessImpact).toMatch(/NOT on the guest's bill/);
    const events = await sql<{
      n: number;
    }>`select count(*)::int as n from core.outbox where tenant_id = ${org.tenantId}::uuid and type = 'integration.outbound.rejected'`.execute(
      h.t.admin.kysely,
    );
    expect(events.rows[0]?.n).toBe(1);
  });

  it('pausing holds work; resuming is a reconnection with the same rules; impact is previewed first', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    const ctx = org.ctx;
    let c = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    const preview = await tx(h, ctx, (t) => integration.previewLifecycle(t, h.deps, c.id, 'pause'));
    expect(preview.impact.summary).toMatch(/will be affected/);
    expect(preview.blockers).toEqual([]);
    c = await tx(h, ctx, (t) =>
      integration.pause(t, h.deps, c.id, c.version, {
        reason: 'PMS upgrade tonight',
        previewHash: preview.hash,
      }),
    );
    expect(c).toMatchObject({ state: 'paused', health: { status: 'paused' } });
    await expect(integration.runSync(h.t.db, h.deps, ctx, c.id, { trigger: 'manual' })).rejects.toMatchObject(
      { code: 'connection_not_active' },
    );
    await tx(h, ctx, (t) =>
      integration.enqueueOutbound(t, h.deps, {
        connectionId: c.id,
        propertyId: org.propertyId,
        ...charge(5),
      }),
    );
    expect(await integration.dispatchOutbound(h.t.db, h.deps, ctx, c.id)).toMatchObject({ attempted: 0 });
    // A stale preview is refused: the impact changed (a held action appeared).
    const resumePreview = await tx(h, ctx, (t) => integration.previewLifecycle(t, h.deps, c.id, 'resume'));
    expect(resumePreview.warnings.join(' ')).toMatch(/1 money or inventory action/);
    c = await tx(h, ctx, (t) =>
      integration.resume(t, h.deps, c.id, c.version, { previewHash: resumePreview.hash }),
    );
    expect(c.state).toBe('active'); // resumes to the remembered operational state
    const [cmd] = await tx(h, ctx, (t) => integration.listOutbound(t, c.id));
    expect(cmd?.status).toBe('needs_revalidation');
    expect(await account.appliedCommands()).toHaveLength(0);
  });
});
