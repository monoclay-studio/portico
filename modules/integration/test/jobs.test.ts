/**
 * Background work through the foundation's scheduled-job runner: organizations with due work are found via the
 * scheduler index (routing metadata only) and processed in their own context and environment.
 */
import { runDueJobs, sql } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integration, integrationJobs } from '../src';
import { activeSimulatorConnection, type Harness, setupOrg, startHarness, tx } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('integration.dueWork scheduled job', () => {
  it('runs periodic syncs and dispatches queued actions for organizations with due work', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    await tx(h, org.ctx, (t) =>
      integration.enqueueOutbound(t, h.deps, {
        connectionId: conn.id,
        propertyId: org.propertyId,
        workflow: 'roomStatus',
        operation: 'update',
        idempotencyKey: 'rs:101:VC',
        payload: { roomNumber: '101', statusCode: 'VC' },
        businessKey: 'roomStatus:LGN-101',
      }),
    );
    const errors: unknown[] = [];
    const ran = await runDueJobs(h.t.db, integrationJobs(h.deps, { onError: (_t, e) => errors.push(e) }));
    expect(ran).toEqual(['integration.dueWork']);
    expect(errors).toEqual([]);
    expect(account.appliedCommands().map((a) => a.idempotencyKey)).toEqual(['rs:101:VC']);
    const runs = await tx(h, org.ctx, (t) => integration.listSyncRuns(t, conn.id));
    expect(runs[0]).toMatchObject({ trigger: 'periodic', status: 'succeeded' });
    const c = await tx(h, org.ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    expect(c.state).toBe('monitoring');
    // The organization is rescheduled for its next due work (next periodic sync).
    const schedule = await sql<{
      next_due_at: Date;
    }>`select next_due_at from integration.tenant_schedule where tenant_id = ${org.tenantId}::uuid`.execute(
      h.t.admin.kysely,
    );
    expect(new Date(schedule.rows[0]?.next_due_at ?? 0).getTime()).toBeGreaterThan(h.clock.now().getTime());
  });
});
