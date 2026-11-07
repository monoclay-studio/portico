/**
 * Environment safety (ADR-0010, gap G-03, EV-02/EV-04): a trial organization can read from a hotel's systems
 * through an approved read-only connection but can never write to them; a write-capable credential is labeled;
 * demo organizations exchange only simulated data. In `live`, real connectors also pass the activation scope check.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integration } from '../src';
import {
  activeSimulatorConnection,
  FULL_SCOPE,
  type Harness,
  READ_SCOPE,
  setupOrg,
  startHarness,
  tx,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('trial organizations read but never write', () => {
  it('refuses write workflows and forwarding at compatibility review (EV-04)', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const c = await tx(h, org.ctx, (t) =>
      integration.createConnection(t, h.deps, {
        connectorKey: 'pms.simulator',
        name: 'Trial PMS',
        propertyIds: [org.propertyId],
      }),
    );
    await expect(
      tx(h, org.ctx, (t) => integration.reviewCompatibility(t, h.deps, c.id, c.version, FULL_SCOPE)),
    ).rejects.toMatchObject({
      code: 'compatibility_blocked',
      details: { checks: expect.arrayContaining([expect.objectContaining({ code: 'trial_read_only' })]) },
    });
  });

  it('activates a read-only connection, labels a write-capable credential, and blocks every write', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const { conn, account } = await activeSimulatorConnection(h, org, { scope: READ_SCOPE });
    expect(conn.trialWriteGuard).toBe(
      'This credential would allow changes in Lagoon PMS (Simulated PMS). Portico blocks all writes from trials.',
    );
    expect(conn.issues.map((i) => i.code)).toContain('trial_write_capable_credential');
    const run = await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, { trigger: 'manual' });
    expect(run.counts.applied).toBe(3); // 2 reservations + 1 room status, read only
    await expect(
      tx(h, org.ctx, (t) =>
        integration.enqueueOutbound(t, h.deps, {
          connectionId: conn.id,
          propertyId: org.propertyId,
          workflow: 'roomStatus',
          operation: 'update',
          idempotencyKey: 'x',
          payload: {},
        }),
      ),
    ).rejects.toMatchObject({ code: 'workflow_not_in_scope' });
    expect(await account.appliedCommands()).toHaveLength(0);
  });

  it('even an approved write workflow is blocked by the environment policy in a trial', async () => {
    // Simulate a misconfigured scope reaching enqueue: the environment policy is the last line of defense.
    const org = await setupOrg(h, { environment: 'sandbox' });
    const { conn } = await activeSimulatorConnection(h, org);
    const trialCtx = { ...org.ctx, environment: 'trial' as const };
    await expect(
      tx(h, trialCtx, (t) =>
        integration.enqueueOutbound(t, h.deps, {
          connectionId: conn.id,
          propertyId: org.propertyId,
          workflow: 'roomStatus',
          operation: 'update',
          idempotencyKey: 'rs-1',
          payload: { roomNumber: '101', statusCode: 'VC' },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'effect_blocked_in_environment',
      details: { effect: 'integration.write', environment: 'trial' },
    });
  });

  it('a read-only credential at the vendor removes the residual-risk label', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const { conn } = await activeSimulatorConnection(h, org, { scope: READ_SCOPE, readOnlyKey: true });
    expect(conn.trialWriteGuard).toBeNull();
    const creds = await tx(h, org.ctx, (t) => integration.listCredentials(t, conn.id));
    expect(creds[0]).toMatchObject({ readOnlyAtVendor: true, scopesGranted: ['read'] });
  });
});

describe('demo and live', () => {
  it('demo organizations use the simulator and label everything simulated', async () => {
    const org = await setupOrg(h, { environment: 'demo' });
    const { conn } = await activeSimulatorConnection(h, org);
    expect(conn.exchangeProvenance).toBe('simulated');
    expect(conn.integrationStatus).toBe('tested');
    const run = await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, { trigger: 'manual' });
    expect(run.provenance).toBe('simulated');
  });

  it('a live organization can never use a simulator, let alone make it a system of record (F8)', async () => {
    const org = await setupOrg(h, { environment: 'live' });
    await expect(
      tx(h, org.ctx, (t) => integration.createPmsSimulator(t, h.deps, { seed: true })),
    ).rejects.toMatchObject({ code: 'simulator_not_in_live' });
    await expect(
      tx(h, org.ctx, (t) =>
        integration.createConnection(t, h.deps, {
          connectorKey: 'pms.simulator',
          name: 'Fake',
          propertyIds: [org.propertyId],
        }),
      ),
    ).rejects.toMatchObject({ code: 'simulator_not_in_live' });
  });
});
