import { sql } from '@portico/db';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integration } from '../src';
import { catalogIds, FULL_SCOPE, type Harness, setupOrg, startHarness, tx, userCtx } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('connect alongside: the 9-step setup journey on the simulated PMS', () => {
  it('goes from selection to monitoring, with a required review of an ambiguous mapping', async () => {
    const org = await setupOrg(h);
    const ctx = org.ctx;
    const ids = catalogIds(org.propertyId);
    const { account, apiKey } = await h.hub.createAccount(org.tenantId, { seedAt: h.clock.now() });

    // 1. Select
    let conn = await tx(h, ctx, (t) =>
      integration.createConnection(t, h.deps, {
        connectorKey: 'pms.simulator',
        name: 'Lagoon PMS',
        propertyIds: [org.propertyId],
      }),
    );
    expect(conn).toMatchObject({
      state: 'selected',
      integrationStatus: 'supported',
      exchangeProvenance: 'simulated',
    });
    expect(conn.setup.currentStep).toBe(2);
    expect(conn.allowedActions.find((a) => a.action === 'reviewCompatibility')?.enabled).toBe(true);
    expect(conn.allowedActions.find((a) => a.action === 'activate')).toMatchObject({
      enabled: false,
      previewRequired: true,
    });

    // 2. Compatibility: an incoherent or unsupported scope is refused with reasons
    await expect(
      tx(h, ctx, (t) =>
        integration.reviewCompatibility(t, h.deps, conn.id, conn.version, {
          workflows: [{ workflow: 'availability', operations: ['read'] }],
          authority: [{ domain: 'availability', writeMode: 'read_only' }],
        }),
      ),
    ).rejects.toThrow(/not offered|reservations must be too/);
    const review = await tx(h, ctx, (t) =>
      integration.reviewCompatibility(t, h.deps, conn.id, conn.version, FULL_SCOPE),
    );
    conn = review.connection;
    expect(conn.state).toBe('compatibility_reviewed');
    expect(review.report.checks.map((c) => c.code)).toEqual(
      expect.arrayContaining(['simulator', 'workflow_limited']),
    );
    expect(review.report.vendorSetupSteps.length).toBeGreaterThan(0);

    // 3. Authorize: a wrong key is refused, nothing stored, progress kept
    await expect(
      integration.authorize(h.t.db, h.deps, ctx, conn.id, conn.version, {
        credentials: { accountId: account.accountId, apiKey: 'simk_wrong_key_value_123456' },
        label: 'Simulator key',
      }),
    ).rejects.toMatchObject({ code: 'connector_failed', details: { responsibleParty: 'hotel' } });
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    expect(conn.state).toBe('compatibility_reviewed');
    await expect(
      integration.authorize(h.t.db, h.deps, ctx, conn.id, conn.version, {
        credentials: { accountId: account.accountId },
        label: 'x',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials', details: { fields: ['apiKey'] } });
    conn = await integration.authorize(h.t.db, h.deps, ctx, conn.id, conn.version, {
      credentials: { accountId: account.accountId, apiKey },
      label: 'Simulator key',
    });
    expect(conn.state).toBe('authorized');
    // Never plaintext: the secret table holds ciphertext only; the audit holds no key.
    const secrets = await sql<{ ciphertext: string }>`select ciphertext from integration.secrets`.execute(
      h.t.admin.kysely,
    );
    expect(secrets.rows.length).toBeGreaterThan(0);
    expect(secrets.rows.every((r) => !r.ciphertext.includes(apiKey))).toBe(true);
    const audit = await sql<{
      after: unknown;
    }>`select after from core.audit_log where tenant_id = ${org.tenantId}::uuid`.execute(h.t.admin.kysely);
    expect(JSON.stringify(audit.rows)).not.toContain(apiKey);

    // 4. Suggested mappings with confidence and reasons
    const set = await integration.suggestConnectionMappings(h.t.db, h.deps, ctx, conn.id, conn.version);
    const byExt = (kind: string, ext: string) =>
      set.items.find((m) => m.kind === kind && m.externalId === ext);
    expect(byExt('property', 'LGN')).toMatchObject({ internalId: org.propertyId, autoConfirmed: true });
    expect(byExt('unitType', 'BV')).toMatchObject({ internalId: ids.bv, autoConfirmed: true });
    expect(byExt('unit', 'LGN-101')).toMatchObject({ internalId: ids.unit('101'), autoConfirmed: true });
    expect(byExt('status', 'roomStatus:VD')).toMatchObject({ internalId: 'dirty', autoConfirmed: true });
    const dv = byExt('unitType', 'DV');
    expect(dv).toMatchObject({
      requiresReview: true,
      autoConfirmed: false,
      status: { mapping: 'suggested', review: 'required' },
    });
    expect(dv?.reviewReason).toMatch(/Ambiguous/);
    expect(byExt('chargeCode', 'RM')).toMatchObject({
      financiallySignificant: true,
      requiresReview: true,
      internalId: ids.rm,
    });
    expect(set.issues.filter((i) => i.severity === 'blocking').length).toBeGreaterThanOrEqual(5);

    // 5. Issues block until resolved
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    expect(conn.allowedActions.find((a) => a.action === 'resolveIssues')).toMatchObject({ enabled: false });
    await expect(
      tx(h, ctx, (t) => integration.resolveIssues(t, h.deps, conn.id, conn.version)),
    ).rejects.toMatchObject({ code: 'blocking_issues' });

    // A reviewer without the finance permission can resolve the ambiguous unit type but not charge codes.
    const reviewer = userCtx(org, [
      { permission: 'integration.mapping.review', propertyIds: [org.propertyId] },
      { permission: 'integration.connection.read', propertyIds: [org.propertyId] },
      { permission: 'platform.property.read', propertyIds: [org.propertyId] },
    ]);
    const dvReviewed = await tx(h, reviewer, (t) =>
      integration.reviewMapping(t, h.deps, dv?.id ?? '', dv?.version ?? 0, {
        decision: 'override',
        internalId: ids.dbv,
        reason: 'Deluxe villas are on the beach',
      }),
    );
    expect(dvReviewed.mapping).toMatchObject({
      internalId: ids.dbv,
      reviewed: true,
      status: { mapping: 'confirmed' },
    });
    const rm = byExt('chargeCode', 'RM');
    await expect(
      tx(h, reviewer, (t) =>
        integration.reviewMapping(t, h.deps, rm?.id ?? '', rm?.version ?? 0, { decision: 'confirm' }),
      ),
    ).rejects.toMatchObject({
      code: 'forbidden',
      details: { permission: 'integration.mapping.reviewFinancial' },
    });
    await expect(
      tx(h, ctx, (t) =>
        integration.reviewMapping(t, h.deps, rm?.id ?? '', rm?.version ?? 0, {
          decision: 'override',
          internalId: 'not-a-portico-id',
        }),
      ),
    ).rejects.toMatchObject({ code: 'mapping_target_not_found' });
    for (const m of set.items.filter(
      (x) => x.requiresReview && !(x.kind === 'unitType' && x.externalId === 'DV'),
    )) {
      await tx(h, ctx, (t) =>
        integration.reviewMapping(
          t,
          h.deps,
          m.id,
          m.version,
          m.internalId ? { decision: 'confirm' } : { decision: 'ignore', reason: 'not used' },
        ),
      );
    }
    const history = await tx(h, ctx, (t) => integration.mappingHistory(t, dv?.id ?? ''));
    expect(history.map((x) => x.change)).toEqual(['suggested', 'overridden']);
    expect(history[1]).toMatchObject({ reason: 'Deluxe villas are on the beach', internalId: ids.dbv });
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    conn = await tx(h, ctx, (t) => integration.resolveIssues(t, h.deps, conn.id, conn.version));
    expect(conn).toMatchObject({ state: 'issues_resolved', integrationStatus: 'configured' });

    // 6. Validation
    const run = await integration.runValidation(h.t.db, h.deps, ctx, conn.id, conn.version);
    expect(run.status).toBe('passed');
    expect(run.checks.map((c) => c.code)).toEqual(
      expect.arrayContaining(['credential', 'mappings_complete', 'sample', 'write_path']),
    );

    // 7. Preview: plain-English behavior, authority changes and impact
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    const preview = await integration.previewActivation(h.t.db, h.deps, ctx, conn.id, conn.version);
    expect(preview.authorityChanges).toHaveLength(3);
    expect(preview.authorityChanges.find((a) => a.domain === 'roomStatus')).toMatchObject({
      before: { authority: 'portico', writeMode: 'exclusive' },
      after: { authority: 'external', writeMode: 'forward' },
    });
    expect(preview.expectedBehavior.filter((b) => b.outcome === 'would_apply').length).toBeGreaterThanOrEqual(
      3,
    );
    expect(preview.impact.summary).toMatch(/Lagoon Island Resort/);
    expect(preview.warnings.join(' ')).toMatch(/Simulated system/);

    // CL-03: a mapping change after the preview makes validation and preview stale.
    const bv = set.items.find((m) => m.kind === 'unitType' && m.externalId === 'BV');
    const changed = await tx(h, ctx, (t) =>
      integration.reviewMapping(t, h.deps, bv?.id ?? '', bv?.version ?? 0, {
        decision: 'confirm',
        reason: 'explicit check',
      }),
    );
    expect(changed.connectionState).toBe('mappings_suggested');
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    await expect(
      tx(h, ctx, (t) =>
        integration.activate(t, h.deps, conn.id, conn.version, {
          previewId: preview.id,
          previewHash: preview.hash,
        }),
      ),
    ).rejects.toMatchObject({ code: 'step_not_available' });
    conn = await tx(h, ctx, (t) => integration.resolveIssues(t, h.deps, conn.id, conn.version));
    await integration.runValidation(h.t.db, h.deps, ctx, conn.id, conn.version);
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    const preview2 = await integration.previewActivation(h.t.db, h.deps, ctx, conn.id, conn.version);
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    await expect(
      tx(h, ctx, (t) =>
        integration.activate(t, h.deps, conn.id, conn.version, {
          previewId: preview.id,
          previewHash: preview.hash,
        }),
      ),
    ).rejects.toMatchObject({ code: 'preview_outdated' });

    // 8. Activation needs its own permission (separation of duties) …
    const manager = userCtx(org, [
      { permission: 'integration.connection.manage', propertyIds: [org.propertyId] },
      { permission: 'integration.connection.read', propertyIds: [org.propertyId] },
      { permission: 'platform.property.read', propertyIds: [org.propertyId] },
    ]);
    await expect(
      tx(h, manager, (t) =>
        integration.activate(t, h.deps, conn.id, conn.version, {
          previewId: preview2.id,
          previewHash: preview2.hash,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'forbidden',
      details: { permission: 'integration.connection.activate' },
    });
    // … and sets the data authority (system of record) for the governed domains.
    conn = await tx(h, ctx, (t) =>
      integration.activate(t, h.deps, conn.id, conn.version, {
        previewId: preview2.id,
        previewHash: preview2.hash,
      }),
    );
    expect(conn.state).toBe('active');
    const authority = await tx(h, ctx, (t) => platform.getDataAuthority(t, org.propertyId, 'reservations'));
    expect(authority).toMatchObject({
      authority: 'external',
      connectionId: conn.id,
      writeMode: 'forward',
      systemName: 'Lagoon PMS (Simulated PMS)',
    });
    await expect(tx(h, ctx, (t) => platform.assertWritable(t, org.propertyId, 'roomStatus'))).resolves.toBe(
      'forward',
    );

    // 9. First successful exchange → monitoring; inbound records applied and published for owning modules.
    const runSync = await integration.runSync(h.t.db, h.deps, ctx, conn.id, { trigger: 'manual' });
    expect(runSync).toMatchObject({
      status: 'succeeded',
      counts: { received: 3, applied: 3 },
      provenance: 'simulated',
    });
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    expect(conn.state).toBe('monitoring');
    expect(conn.setup.steps.every((s) => s.status === 'done' && s.completedAt && s.completedBy)).toBe(true);
    expect(conn.status).toMatchObject({ setup: 'monitoring', health: 'healthy', integration: 'tested' });
    // The owning module applied each record in the same transaction (handler port); the outbox only carries a
    // thin notification without guest data.
    const forConn = h.applied.filter((r) => r.connectionId === conn.id);
    expect(forConn.map((r) => r.workflow).sort()).toEqual(['reservations', 'reservations', 'roomStatus']);
    expect(forConn.find((r) => r.workflow === 'reservations')?.mapped.roomTypeCode?.internalId).toBeDefined();
    const events = await sql<{ payload: Record<string, unknown> }>`
      select payload from core.outbox where tenant_id = ${org.tenantId}::uuid and type = 'integration.inbound.applied'`.execute(
      h.t.admin.kysely,
    );
    expect(events.rows).toHaveLength(3);
    expect(JSON.stringify(events.rows)).not.toContain('Sample'); // guest names never reach the outbox
    const health = await tx(h, ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health).toMatchObject({ overall: 'healthy', urgent: [] });
    expect(health.workflows.find((w) => w.workflow === 'reservations')).toMatchObject({
      status: 'healthy',
      dataProvenance: 'simulated',
      freshnessTargetSeconds: 120,
    });
    // The vendor acknowledged after commit: nothing left to deliver.
    expect(await account.pendingCount()).toBe(0);
    // The connection disconnect is refused while it is the system of record (INT-I04).
    expect(conn.allowedActions.find((a) => a.action === 'disconnect')).toMatchObject({ enabled: false });
    expect(conn.allowedActions.find((a) => a.action === 'disconnect')?.reason).toMatch(/system of record/);
  });

  it('a second connection cannot take over a domain another active connection controls', async () => {
    const org = await setupOrg(h);
    const { activeSimulatorConnection } = await import('./harness');
    await activeSimulatorConnection(h, org);
    const other = await tx(h, org.ctx, (t) =>
      integration.createConnection(t, h.deps, {
        connectorKey: 'pms.simulator',
        name: 'Second PMS',
        propertyIds: [org.propertyId],
      }),
    );
    await expect(
      tx(h, org.ctx, (t) => integration.reviewCompatibility(t, h.deps, other.id, other.version, FULL_SCOPE)),
    ).rejects.toThrow(/already controlled by Lagoon PMS/);
  });

  it('planned connectors are listed honestly and cannot be connected', async () => {
    const org = await setupOrg(h);
    const catalogue = await tx(h, org.ctx, async (t) => integration.listCatalogue(t, h.deps, {}));
    const channex = catalogue.find((c) => c.key === 'channel.channex');
    expect(channex).toMatchObject({
      connectable: false,
      setupPath: 'not_available',
      implementation: { level: 'R1' },
      externalApproval: { status: 'not_started' },
    });
    expect(channex?.workflows.every((w) => w.status === 'unverified')).toBe(true);
    const csv = catalogue.find((c) => c.key === 'file.csv');
    expect(csv?.workflows.every((w) => w.sync === 'file')).toBe(true);
    expect(csv?.workflows[0]?.limitations.join(' ')).toMatch(/not a live connection/);
    expect(catalogue.every((c) => c.disclaimer.includes('does not mean the vendor has certified'))).toBe(
      true,
    );
    const locks = catalogue.find((c) => c.category === 'doorLock');
    expect(locks).toMatchObject({
      localConnectorRequired: true,
      costNotes: [expect.stringMatching(/Quote required/)],
    });
    await expect(
      tx(h, org.ctx, (t) =>
        integration.createConnection(t, h.deps, {
          connectorKey: 'channel.channex',
          name: 'Hub',
          propertyIds: [org.propertyId],
        }),
      ),
    ).rejects.toMatchObject({ code: 'connector_not_available' });
  });
});
