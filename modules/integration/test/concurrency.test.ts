/**
 * Regression tests from the steward review probes (review-integration.md): exactly-once inbound application,
 * per-record ordering and never-blind-replay outbound, with genuinely concurrent transactions.
 */
import { sql, withTenantTx } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorError, integration } from '../src';
import { activeSimulatorConnection, catalogIds, type Harness, setupOrg, startHarness, tx } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function latch() {
  let open!: () => void;
  const p = new Promise<void>((r) => {
    open = r;
  });
  return { p, open };
}
async function appliedEvents(tenantId: string, externalId: string) {
  const r = await sql<{ revision: string }>`
    select payload->>'revision' as revision from core.outbox
     where tenant_id = ${tenantId}::uuid and type = 'integration.inbound.applied' and payload->>'externalId' = ${externalId}
     order by created_at, id`.execute(h.t.admin.kysely);
  return r.rows.map((x) => x.revision);
}
async function watermark(tenantId: string, externalId: string) {
  const r = await sql<{ last_revision: string }>`
    select last_revision from integration.external_records
     where tenant_id = ${tenantId}::uuid and external_id = ${externalId}`.execute(h.t.admin.kysely);
  return r.rows[0]?.last_revision ?? null;
}
async function cmd(tenantId: string, key: string) {
  const r = await sql<{
    id: string;
    status: string;
    version: number;
    revalidated_at: Date | null;
    hold_after_send: boolean;
  }>`
    select id, status, version, revalidated_at, hold_after_send from integration.outbound_commands
     where tenant_id = ${tenantId}::uuid and idempotency_key = ${key}`.execute(h.t.admin.kysely);
  return r.rows[0];
}

const resPayload = (id: string, rev: number) => ({
  workflow: 'reservations',
  externalId: id,
  revision: String(rev),
  revisionOrder: rev,
  occurredAt: '2026-11-07T06:00:00.000Z',
  propertyExternalId: 'LGN',
  payload: {
    reservationId: id,
    propertyCode: 'LGN',
    status: 'CNF',
    arrival: '2026-12-01',
    departure: rev === 1 ? '2026-12-05' : '2026-12-09',
    roomTypeCode: 'BV',
    ratePlanCode: 'BAR',
    guestName: 'X',
    adults: 2,
    totalMinor: 1000 * rev,
    currency: 'USD',
  },
  summary: `Reservation ${id} rev ${rev}`,
});

describe('inbound: exactly once and in order under concurrency', () => {
  it('PROBE-2 an older revision ingested concurrently with a newer one of a new record never wins', async () => {
    const org = await setupOrg(h);
    const { conn } = await activeSimulatorConnection(h, org);
    const def = h.deps.connectors.get('pms.simulator')?.definition;
    if (!def) throw new Error('no definition');
    const a = latch();
    const reachedA = latch();
    const pA = withTenantTx(h.t.db, org.ctx, async (t) => {
      const c = await integration.loadConnection(t, conn.id);
      const r = await integration.ingestRecords(t, h.deps, c, def, [resPayload('RC2', 2)], {
        syncRunId: null,
        provenance: 'simulated',
      });
      reachedA.open();
      await a.p;
      return r;
    });
    await reachedA.p;
    const pB = withTenantTx(h.t.db, org.ctx, async (t) => {
      const c = await integration.loadConnection(t, conn.id);
      return integration.ingestRecords(t, h.deps, c, def, [resPayload('RC2', 1)], {
        syncRunId: null,
        provenance: 'simulated',
      });
    });
    await sleep(300);
    a.open();
    const [, rb] = await Promise.all([pA, pB]);
    expect(await watermark(org.tenantId, 'RC2')).toBe('2');
    expect(await appliedEvents(org.tenantId, 'RC2')).toEqual(['2']);
    expect(rb.stale).toBe(1);
    const handled = h.applied.filter((r) => r.connectionId === conn.id && r.externalId === 'RC2');
    expect(handled.map((r) => r.revision)).toEqual(['2']);
  });

  it('PROBE-3 two concurrent reprocessHeld calls apply a held record once', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    await account.createReservation(h.clock.now(), { reservationId: 'RC3', roomTypeCode: 'PV' });
    await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
      trigger: 'manual',
      workflow: 'reservations',
    });
    const set = await tx(h, org.ctx, (t) => integration.getMappingSet(t, conn.id));
    const pv = set.items.find((m) => m.kind === 'unitType' && m.externalId === 'PV');
    if (!pv) throw new Error('no PV mapping');
    // Confirm the mapping without the built-in reprocess, so both concurrent calls find the held record.
    await tx(h, org.ctx, (t) =>
      integration.reviewMapping(t, h.deps, pv.id, pv.version, {
        decision: 'override',
        internalId: catalogIds(org.propertyId).bv,
      }),
    );
    const a = latch();
    const reachedA = latch();
    const pA = withTenantTx(h.t.db, org.ctx, async (t) => {
      const c = await integration.loadConnection(t, conn.id);
      const r = await integration.reprocessHeld(t, h.deps, c);
      reachedA.open();
      await a.p;
      return r;
    });
    await reachedA.p;
    const pB = withTenantTx(h.t.db, org.ctx, async (t) => {
      const c = await integration.loadConnection(t, conn.id);
      return integration.reprocessHeld(t, h.deps, c);
    });
    await sleep(300);
    a.open();
    await Promise.all([pA, pB]);
    expect(await appliedEvents(org.tenantId, 'RC3')).toEqual(['1']);
    expect(h.applied.filter((r) => r.connectionId === conn.id && r.externalId === 'RC3')).toHaveLength(1);
  });

  it('PROBE-7 an older CSV imported concurrently with a newer one never overwrites it', async () => {
    const HEADER =
      'reservation_id,modified_at,property_code,status,arrival,departure,room_type_code,rate_plan_code,guest_name,adults,total_amount_minor,currency';
    const row = (id: string, modified: string, rt = 'BV') =>
      `${id},${modified},LGN,CNF,2026-12-01,2026-12-04,${rt},BAR,"Guest ${id}",2,150000,USD`;
    const org = await setupOrg(h);
    const ctx = org.ctx;
    let conn = await tx(h, ctx, (t) =>
      integration.createConnection(t, h.deps, {
        connectorKey: 'file.csv',
        name: 'Old PMS',
        propertyIds: [org.propertyId],
      }),
    );
    conn = (
      await tx(h, ctx, (t) =>
        integration.reviewCompatibility(t, h.deps, conn.id, conn.version, {
          workflows: [{ workflow: 'reservations', operations: ['read'] }],
          authority: [{ domain: 'reservations', writeMode: 'read_only' }],
        }),
      )
    ).connection;
    conn = await integration.authorize(h.t.db, h.deps, ctx, conn.id, conn.version, {
      credentials: {},
      label: 'Files',
    });
    await tx(h, ctx, (t) =>
      integration.importFile(t, h.deps, conn.id, {
        workflow: 'reservations',
        fileName: 'sample.csv',
        content: `${HEADER}\r\n${row('S1', '2026-11-01T08:00:00+05:00')}\r\n${row('S2', '2026-11-01T08:00:00+05:00', 'WV')}\r\n`,
      }),
    );
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    const set = await integration.suggestConnectionMappings(h.t.db, h.deps, ctx, conn.id, conn.version);
    for (const m of set.items.filter((x) => x.requiresReview)) {
      await tx(h, ctx, (t) =>
        integration.reviewMapping(
          t,
          h.deps,
          m.id,
          m.version,
          m.internalId ? { decision: 'confirm' } : { decision: 'ignore' },
        ),
      );
    }
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    conn = await tx(h, ctx, (t) => integration.resolveIssues(t, h.deps, conn.id, conn.version));
    await integration.runValidation(h.t.db, h.deps, ctx, conn.id, conn.version);
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    const preview = await integration.previewActivation(h.t.db, h.deps, ctx, conn.id, conn.version);
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    conn = await tx(h, ctx, (t) =>
      integration.activate(t, h.deps, conn.id, conn.version, {
        previewId: preview.id,
        previewHash: preview.hash,
      }),
    );
    const a = latch();
    const reachedA = latch();
    // Two first imports after activation, concurrently (also covers F29: monitoring is confirmed once).
    const pA = withTenantTx(h.t.db, ctx, async (t) => {
      const r = await integration.importFile(t, h.deps, conn.id, {
        workflow: 'reservations',
        fileName: 'tuesday.csv',
        content: `${HEADER}\r\n${row('F900', '2026-11-03T08:00:00+05:00', 'WV')}\r\n`,
      });
      reachedA.open();
      await a.p;
      return r;
    });
    await reachedA.p;
    const pB = withTenantTx(h.t.db, ctx, (t) =>
      integration.importFile(t, h.deps, conn.id, {
        workflow: 'reservations',
        fileName: 'monday.csv',
        content: `${HEADER}\r\n${row('F900', '2026-11-02T08:00:00+05:00', 'BV')}\r\n`,
      }),
    );
    await sleep(300);
    a.open();
    const results = await Promise.allSettled([pA, pB]);
    expect(results.map((r) => (r.status === 'rejected' ? String(r.reason) : r.status))).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(await watermark(org.tenantId, 'F900')).toBe('2026-11-03T08:00:00+05:00');
    expect(await appliedEvents(org.tenantId, 'F900')).toEqual(['2026-11-03T08:00:00+05:00']);
  });
});

describe('exceptions under concurrency', () => {
  it('PROBE-8 two concurrent raises of the same problem both succeed (one row, two occurrences)', async () => {
    const org = await setupOrg(h);
    const { conn } = await activeSimulatorConnection(h, org);
    const input = {
      connectionId: conn.id,
      workflow: 'reservations',
      severity: 'routine' as const,
      problem: 'A repeated problem',
      businessImpact: 'none',
      responsibleParty: 'hotel' as const,
      nextStep: 'none',
      code: 'probe',
      dedupeKey: 'probe:1',
    };
    const a = latch();
    const reachedA = latch();
    const pA = withTenantTx(h.t.db, org.ctx, async (t) => {
      const r = await integration.raiseException(t, input);
      reachedA.open();
      await a.p;
      return r;
    });
    await reachedA.p;
    const pB = withTenantTx(h.t.db, org.ctx, (t) => integration.raiseException(t, input));
    await sleep(300);
    a.open();
    const res = await Promise.allSettled([pA, pB]);
    expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = await sql<{ occurrences: number }>`
      select occurrences from integration.exceptions
       where tenant_id = ${org.tenantId}::uuid and dedupe_key = 'probe:1'`.execute(h.t.admin.kysely);
    expect(rows.rows).toEqual([{ occurrences: 2 }]);
  });
});

describe('outbound: never blind replay across lifecycle actions', () => {
  const charge = (ref: string) => ({
    workflow: 'charges',
    operation: 'create',
    idempotencyKey: `folio-posting:${ref}`,
    payload: {
      reservationId: 'R1001',
      chargeCode: 'FNB',
      amountMinor: 4500,
      currency: 'USD',
      reference: ref,
    },
    sourceRef: { type: 'finance_posting', id: ref },
  });
  const CHARGES_ONLY = {
    workflows: [
      { workflow: 'reservations', operations: ['read', 'receive'] as Array<'read' | 'receive' | 'create'> },
      {
        workflow: 'charges',
        operations: ['read', 'receive', 'create'] as Array<'read' | 'receive' | 'create'>,
      },
    ],
    authority: [] as never[],
  };

  it('PROBE-4 two concurrent dispatches send a money command once', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    await tx(h, org.ctx, (t) =>
      integration.enqueueOutbound(t, h.deps, {
        connectionId: conn.id,
        propertyId: org.propertyId,
        ...charge('D1'),
      }),
    );
    const results = await Promise.all([
      integration.dispatchOutbound(h.t.db, h.deps, org.ctx, conn.id),
      integration.dispatchOutbound(h.t.db, h.deps, org.ctx, conn.id),
      integration.dispatchOutbound(h.t.db, h.deps, org.ctx, conn.id),
    ]);
    expect(results.reduce((s, r) => s + r.attempted, 0)).toBe(1);
    expect(
      (await account.appliedCommands()).filter((x) => x.idempotencyKey === 'folio-posting:D1'),
    ).toHaveLength(1);
  });

  it('PROBE-5 a send in flight across pause + resume cannot escape revalidation (F2)', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    await tx(h, org.ctx, (t) =>
      integration.enqueueOutbound(t, h.deps, {
        connectionId: conn.id,
        propertyId: org.propertyId,
        ...charge('RACE'),
      }),
    );
    const adapter = h.deps.connectors.get('pms.simulator')?.adapter as unknown as Record<string, unknown>;
    const origSend = adapter.send;
    const gate = latch();
    const inflight = latch();
    let deadline: Date | undefined;
    adapter.send = async (actx: { deadline?: Date }) => {
      deadline = actx.deadline;
      inflight.open();
      await gate.p;
      throw new ConnectorError('outage', 'The simulated PMS is unavailable (HTTP 503).');
    };
    try {
      const d1 = integration.dispatchOutbound(h.t.db, h.deps, org.ctx, conn.id);
      await inflight.p;
      let c = await tx(h, org.ctx, (t) => integration.getConnection(t, h.deps, conn.id));
      const pp = await tx(h, org.ctx, (t) => integration.previewLifecycle(t, h.deps, c.id, 'pause'));
      c = await tx(h, org.ctx, (t) =>
        integration.pause(t, h.deps, c.id, c.version, { reason: 'vendor incident', previewHash: pp.hash }),
      );
      const rp = await tx(h, org.ctx, (t) => integration.previewLifecycle(t, h.deps, c.id, 'resume'));
      c = await tx(h, org.ctx, (t) =>
        integration.resume(t, h.deps, c.id, c.version, { previewHash: rp.hash }),
      );
      // The in-flight row is not taken from under the sender; it is marked to be held when the call ends.
      expect(await cmd(org.tenantId, 'folio-posting:RACE')).toMatchObject({
        status: 'sending',
        hold_after_send: true,
      });
      gate.open();
      await d1;
    } finally {
      adapter.send = origSend;
    }
    // Adapter calls carry a deadline shorter than the lease.
    expect(deadline).toBeInstanceOf(Date);
    expect((deadline as Date).getTime() - h.clock.now().getTime()).toBeLessThan(60_000);
    expect(await cmd(org.tenantId, 'folio-posting:RACE')).toMatchObject({ status: 'needs_revalidation' });
    h.clock.advance(60_000);
    await integration.dispatchOutbound(h.t.db, h.deps, org.ctx, conn.id);
    const final = await cmd(org.tenantId, 'folio-posting:RACE');
    expect(final?.status).toBe('needs_revalidation');
    expect(final?.revalidated_at).toBeNull();
    expect(
      (await account.appliedCommands()).filter((x) => x.idempotencyKey === 'folio-posting:RACE'),
    ).toHaveLength(0);
    const ex = await tx(h, org.ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(ex.map((e) => e.code)).toContain('actions_need_revalidation');
  });

  it('PROBE-6 disconnect keeps an uncertain charge pending verification with an exception (F4)', async () => {
    const org = await setupOrg(h);
    // biome-ignore lint/suspicious/noExplicitAny: scope literal narrower than the harness type
    const { conn, account } = await activeSimulatorConnection(h, org, { scope: CHARGES_ONLY as any });
    await tx(h, org.ctx, (t) =>
      integration.enqueueOutbound(t, h.deps, {
        connectionId: conn.id,
        propertyId: org.propertyId,
        ...charge('U1'),
      }),
    );
    await tx(h, org.ctx, (t) =>
      integration.enqueueOutbound(t, h.deps, {
        connectionId: conn.id,
        propertyId: org.propertyId,
        ...charge('NEVER'),
        idempotencyKey: 'folio-posting:NEVER',
      }),
    );
    await account.setFaults({ timeoutNextCommand: true });
    await integration.dispatchOutbound(h.t.db, h.deps, org.ctx, conn.id, { limit: 1 });
    expect((await cmd(org.tenantId, 'folio-posting:U1'))?.status).toBe('pending_verification');
    expect(await account.appliedCommands()).toHaveLength(1); // the vendor HAS the charge
    let c = await tx(h, org.ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    const dp = await tx(h, org.ctx, (t) => integration.previewLifecycle(t, h.deps, c.id, 'disconnect'));
    expect(dp.warnings.join(' ')).toMatch(/1 action\(s\) that never reached .* will be cancelled/);
    expect(dp.warnings.join(' ')).toMatch(/1 action\(s\) have an unknown outcome/);
    c = await tx(h, org.ctx, (t) =>
      integration.disconnect(t, h.deps, c.id, c.version, {
        reason: 'switching vendor',
        previewHash: dp.hash,
      }),
    );
    const uncertain = await cmd(org.tenantId, 'folio-posting:U1');
    expect(uncertain?.status).toBe('pending_verification');
    expect((await cmd(org.tenantId, 'folio-posting:NEVER'))?.status).toBe('cancelled');
    const cancelledEvents = await sql<{ id: string }>`
      select payload->>'commandId' as id from core.outbox
       where tenant_id = ${org.tenantId}::uuid and type = 'integration.outbound.cancelled'`.execute(
      h.t.admin.kysely,
    );
    expect(cancelledEvents.rows.map((r) => r.id)).not.toContain(uncertain?.id);
    const ex = await tx(h, org.ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(ex.map((e) => [e.code, e.severity])).toContainEqual(['uncertain_after_disconnect', 'urgent']);
    // Nothing can be sent any more; a person settles it after checking the vendor.
    await expect(
      tx(h, org.ctx, (t) =>
        integration.revalidateCommand(t, h.deps, uncertain?.id ?? '', uncertain?.version ?? 0, {
          decision: 'resend',
          reason: 'retry',
        }),
      ),
    ).rejects.toMatchObject({ code: 'connection_disconnected' });
    const settled = await tx(h, org.ctx, (t) =>
      integration.revalidateCommand(t, h.deps, uncertain?.id ?? '', uncertain?.version ?? 0, {
        decision: 'confirm_applied',
        reason: 'The charge is on the guest bill in the PMS.',
      }),
    );
    expect(settled.status).toBe('acknowledged');
    const after = await tx(h, org.ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(after.map((e) => e.code)).not.toContain('uncertain_after_disconnect');
  });
});

describe('inbound handler port (F6): the owning module applies in the same transaction', () => {
  it('reject, hold and throw are recorded as integration exceptions and never acknowledged as applied', async () => {
    const org = await setupOrg(h);
    const { conn } = await activeSimulatorConnection(h, org);
    const def = h.deps.connectors.get('pms.simulator')?.definition;
    if (!def) throw new Error('no definition');
    const outcomes: Record<string, unknown> = {};
    try {
      for (const [mode, id] of [
        ['reject', 'HR1'],
        ['hold', 'HH1'],
        ['throw', 'HT1'],
      ] as const) {
        h.handlerMode.set('reservations', mode);
        outcomes[mode] = await tx(h, org.ctx, async (t) => {
          const c = await integration.loadConnection(t, conn.id);
          return integration.ingestRecords(t, h.deps, c, def, [resPayload(id, 1)], {
            syncRunId: null,
            provenance: 'simulated',
          });
        });
      }
    } finally {
      h.handlerMode.delete('reservations');
    }
    expect(outcomes.reject).toMatchObject({ rejected: 1, applied: 0 });
    expect(outcomes.hold).toMatchObject({ held: 1, applied: 0 });
    expect(outcomes.throw).toMatchObject({ held: 1, applied: 0 });
    for (const id of ['HR1', 'HH1', 'HT1']) expect(await appliedEvents(org.tenantId, id)).toEqual([]);
    const ex = await tx(h, org.ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(ex.length).toBeGreaterThanOrEqual(3);
    // The held ones are retried and applied once the cause is gone.
    const again = await tx(h, org.ctx, async (t) =>
      integration.reprocessHeld(t, h.deps, await integration.loadConnection(t, conn.id)),
    );
    expect(again.applied).toBeGreaterThanOrEqual(2);
    expect(await appliedEvents(org.tenantId, 'HH1')).toEqual(['1']);
    expect(await appliedEvents(org.tenantId, 'HT1')).toEqual(['1']);
  });
});
