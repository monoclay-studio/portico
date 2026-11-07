/**
 * Credentials: expiry reminders and the "credential expiring" health signal, suspension when the vendor rejects
 * the credential (one urgent exception, no retry storm), and zero-downtime rotation that never stores an
 * untested credential (CL-09, CL-11; readiness-brief evidence "expired credentials").
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

const DAY = 86_400_000;

describe('credential expiry and rotation', () => {
  it('signals an expiring credential (routine, then urgent), then suspends at expiry and recovers by rotation', async () => {
    const org = await setupOrg(h);
    const expiresAt = new Date(h.clock.now().getTime() + 10 * DAY);
    const { conn, account } = await activeSimulatorConnection(h, org, { keyExpiresAt: expiresAt });
    const ctx = org.ctx;
    await integration.runSync(h.t.db, h.deps, ctx, conn.id, { trigger: 'manual' });
    const creds = await tx(h, ctx, (t) => integration.listCredentials(t, conn.id));
    expect(creds[0]).toMatchObject({
      status: 'active',
      expiresAt: expiresAt.toISOString(),
      readOnlyAtVendor: false,
      scopesGranted: ['read', 'write'],
    });
    expect(JSON.stringify(creds)).not.toContain('simk_');

    let health = await tx(h, ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health).toMatchObject({
      overall: 'healthy',
      credentialStatus: 'expiring',
      credential: { daysToExpiry: 10 },
    });
    expect(health.routine.map((s) => s.code)).toContain('credential_expiring');

    // Daily job: reminders at 30 / 7 / 1 days are raised once each.
    const reminders = async () => {
      await tx(h, ctx, async (t) =>
        integration.checkCredentialExpiry(t, await integration.loadConnection(t, conn.id)),
      );
      return (
        await tx(h, ctx, (t) =>
          integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
        )
      ).filter((e) => e.code === 'credential_expiring');
    };
    expect((await reminders()).map((e) => e.severity)).toEqual(['routine']);
    expect((await reminders())[0]?.occurrences).toBe(2);
    h.clock.advance(9.5 * DAY);
    await integration.runSync(h.t.db, h.deps, ctx, conn.id, { trigger: 'manual' });
    // The 7-day threshold was skipped (no job ran in between); the 1-day reminder is urgent.
    expect((await reminders()).map((e) => e.severity).sort()).toEqual(['routine', 'urgent']);
    health = await tx(h, ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health.urgent.map((s) => s.code)).toContain('credential_expiring');
    const expiring = await sql<{
      n: number;
    }>`select count(*)::int as n from core.outbox where tenant_id = ${org.tenantId}::uuid and type = 'integration.credentials.expiring'`.execute(
      h.t.admin.kysely,
    );
    expect(expiring.rows[0]?.n).toBe(2);

    // Expired: the vendor rejects the key → connection suspended (error), ONE urgent exception, no retry storm.
    h.clock.advance(1 * DAY);
    await tx(h, ctx, (t) =>
      integration.enqueueOutbound(t, h.deps, {
        connectionId: conn.id,
        propertyId: org.propertyId,
        workflow: 'charges',
        operation: 'create',
        idempotencyKey: 'posting:X1',
        payload: { reservationId: 'R1001', chargeCode: 'SPA', amountMinor: 12000, currency: 'USD' },
      }),
    );
    const failed = await integration.runSync(h.t.db, h.deps, ctx, conn.id, { trigger: 'manual' });
    expect(failed.status).toBe('failed');
    let c = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    expect(c).toMatchObject({ state: 'error', health: { status: 'down' } });
    await expect(
      integration.runSync(h.t.db, h.deps, ctx, conn.id, { trigger: 'manual' }),
    ).rejects.toMatchObject({ code: 'connection_not_active' });
    const open = await tx(h, ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    const rejected = open.filter((e) => e.code === 'credential_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ severity: 'urgent', responsibleParty: 'hotel' });
    expect(rejected[0]?.nextStep).toMatch(/rotate the credential/);
    health = await tx(h, ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health).toMatchObject({ overall: 'down', credentialStatus: 'invalid' });
    expect(c.allowedActions.find((a) => a.action === 'rotateCredential')).toMatchObject({
      enabled: true,
      previewRequired: true,
    });

    // Rotation with a bad key changes nothing.
    await expect(
      integration.rotateCredential(h.t.db, h.deps, ctx, c.id, c.version, {
        credentials: { accountId: account.accountId, apiKey: 'simk_definitely_not_valid_key' },
        label: 'bad',
      }),
    ).rejects.toMatchObject({ code: 'connector_failed' });
    expect((await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id))).state).toBe('error');

    // A new key: recovered; the old secret is destroyed; held money action waits for a person (no blind replay).
    const newKey = await account.issueKey(new Date(h.clock.now().getTime() + 365 * DAY));
    c = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    c = await integration.rotateCredential(h.t.db, h.deps, ctx, c.id, c.version, {
      credentials: { accountId: account.accountId, apiKey: newKey },
      label: 'Renewed key',
      reason: 'expired',
    });
    expect(c.state).toBe('monitoring');
    const after = await tx(h, ctx, (t) => integration.listCredentials(t, conn.id));
    expect(after.map((x) => x.status)).toEqual(['active', 'superseded']);
    const refs = await sql<{
      secret_ref: string | null;
      status: string;
    }>`select secret_ref, status from integration.credentials where connection_id = ${conn.id}::uuid`.execute(
      h.t.admin.kysely,
    );
    expect(refs.rows.find((r) => r.status === 'superseded')?.secret_ref).toBeNull();
    const stillOpen = await tx(h, ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(stillOpen.map((e) => e.code)).not.toContain('credential_rejected');
    expect(stillOpen.map((e) => e.code)).toContain('actions_need_revalidation');
    const [cmd] = await tx(h, ctx, (t) => integration.listOutbound(t, conn.id));
    expect(cmd?.status).toBe('needs_revalidation');
    expect((await integration.runSync(h.t.db, h.deps, ctx, conn.id, { trigger: 'manual' })).status).toBe(
      'succeeded',
    );
  });

  it('rotation while healthy is zero-downtime (CL-11)', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, { trigger: 'manual' });
    const preview = await tx(h, org.ctx, (t) => integration.previewLifecycle(t, h.deps, conn.id, 'rotate'));
    expect(preview.impact.hotelFunctions[0]?.effect).toMatch(/No interruption expected/);
    let c = await tx(h, org.ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    c = await integration.rotateCredential(h.t.db, h.deps, org.ctx, c.id, c.version, {
      credentials: { accountId: account.accountId, apiKey: await account.issueKey(null) },
      label: 'Rotated',
    });
    expect(c.state).toBe('monitoring');
    expect((await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, { trigger: 'manual' })).status).toBe(
      'succeeded',
    );
  });
});
