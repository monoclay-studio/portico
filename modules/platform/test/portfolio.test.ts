import { sourcesFromManifests, withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { createTestDatabase, type TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ConfigurationSectionProvider, platform, platformManifest } from '../src';
import { makeOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase(sourcesFromManifests([platformManifest]));
});
afterAll(async () => t?.drop());

describe('entitlements: add-ons and Connect packs', () => {
  it('property-scoped add-ons apply only to that property; tenants cannot grant themselves', async () => {
    const org = await makeOrg(t, { planCode: 'professional' });
    const a = await org.property('ENT1');
    const b = await org.property('ENT2');
    const has = (propertyId?: string) =>
      withTenantTx(t.db, org.as(), (tx) =>
        platform.hasEntitlement(tx, 'resort.transfers', propertyId ? { propertyId } : {}),
      );
    expect(await has(a.id)).toBe(false);
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.grantEntitlement(tx, {
          kind: 'add_on',
          key: 'resort.transfers',
          propertyId: a.id,
          reason: 'x',
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await withTenantTx(t.db, org.system, (tx) =>
      platform.grantEntitlement(tx, {
        kind: 'add_on',
        key: 'resort.transfers',
        propertyId: a.id,
        reason: 'contract 17',
      }),
    );
    expect(await has(a.id)).toBe(true);
    expect(await has(b.id)).toBe(false);
    expect(await has()).toBe(false);
    await expect(
      withTenantTx(t.db, org.system, (tx) =>
        platform.grantEntitlement(tx, { kind: 'pack', key: 'pack.reporting', reason: 'x' }),
      ),
    ).rejects.toMatchObject({ code: 'not_available_on_plan' });
  });

  it('a Connect organization gets features only from its packs', async () => {
    const org = await makeOrg(t, { planCode: 'connect' });
    const has = (f: string) => withTenantTx(t.db, org.as(), (tx) => platform.hasEntitlement(tx, f));
    expect(await has('core.housekeeping')).toBe(false);
    const { id } = await withTenantTx(t.db, org.system, (tx) =>
      platform.grantEntitlement(tx, { kind: 'pack', key: 'pack.housekeepingMaintenance', reason: 'signed' }),
    );
    expect(await has('core.housekeeping')).toBe(true);
    expect(await has('operations.assets')).toBe(true);
    expect(await has('core.reservations')).toBe(false);
    const summary = await withTenantTx(t.db, org.as(), (tx) => platform.getEntitlementSummary(tx));
    expect(summary.plan.code).toBe('connect');
    expect(summary.features).toContain('core.maintenance');
    expect(summary.limits['limits.users']).toBeUndefined();
    await withTenantTx(t.db, org.system, (tx) => platform.revokeEntitlementGrant(tx, id, 'ended'));
    expect(await has('core.housekeeping')).toBe(false);
  });
});

describe('owners and unit ownership', () => {
  it('needs the owners.accounting entitlement (enterprise or add-on)', async () => {
    const org = await makeOrg(t, { planCode: 'resort' });
    const input = { reference: 'OWN-1', kind: 'person' as const, displayName: 'Ahmed Rasheed' };
    await expect(withTenantTx(t.db, org.as(), (tx) => platform.createOwner(tx, input))).rejects.toMatchObject(
      {
        code: 'feature_not_enabled',
      },
    );
    await withTenantTx(t.db, org.system, (tx) =>
      platform.grantEntitlement(tx, {
        kind: 'add_on',
        key: 'owners.accounting',
        reason: 'villa ownership scheme',
      }),
    );
    expect((await withTenantTx(t.db, org.as(), (tx) => platform.createOwner(tx, input))).reference).toBe(
      'OWN-1',
    );
  });

  it('never stores bank data and keeps unit shares at or below 100 % on every date', async () => {
    const org = await makeOrg(t);
    const p = await org.property('OWN');
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.createOwner(tx, {
          reference: 'X',
          kind: 'company',
          displayName: 'X',
          payoutHint: 'Acct 7730000123456',
        }),
      ),
    ).rejects.toMatchObject({ code: 'bank_data_not_allowed' });
    const mk = (reference: string) =>
      withTenantTx(t.db, org.as(), (tx) =>
        platform.createOwner(tx, {
          reference,
          kind: 'person',
          displayName: reference,
          payoutAccountRef: `finance:payout:${reference}`,
          payoutHint: 'BML ••••1234',
        }),
      );
    const o1 = await mk('A');
    const o2 = await mk('B');
    const o3 = await mk('C');
    const unitId = newId();
    const add = (ownerId: string, shareBps: number, effectiveFrom: string, effectiveTo?: string) =>
      withTenantTx(t.db, org.as(), (tx) =>
        platform.addOwnershipShare(tx, {
          ownerId,
          propertyId: p.id,
          unitId,
          shareBps,
          effectiveFrom,
          ...(effectiveTo ? { effectiveTo } : {}),
        }),
      );
    await add(o1.id, 6000, '2026-01-01');
    await add(o2.id, 4000, '2026-01-01', '2026-07-01');
    await expect(add(o3.id, 1, '2026-06-30')).rejects.toMatchObject({
      code: 'ownership_exceeds_100_percent',
      details: { onDate: '2026-06-30', totalBps: 10001 },
    });
    const later = await add(o3.id, 4000, '2026-07-01');
    const june = await withTenantTx(t.db, org.as(), (tx) =>
      platform.getUnitOwnership(tx, { unitId, date: '2026-06-30' }),
    );
    expect(june).toMatchObject({ allocatedBps: 10000, unallocatedBps: 0 });
    // Ending a share frees capacity from that date (half-open periods).
    await withTenantTx(t.db, org.as(), (tx) =>
      platform.endOwnershipShare(tx, later.id, { effectiveTo: '2026-12-01', reason: 'sold back' }),
    );
    const dec = await withTenantTx(t.db, org.as(), (tx) =>
      platform.getUnitOwnership(tx, { unitId, date: '2026-12-01' }),
    );
    expect(dec.owners.map((o) => o.ownerId)).toEqual([o1.id]);
    // The same owner cannot hold two overlapping shares of one unit (database exclusion constraint).
    await expect(add(o1.id, 100, '2027-01-01')).rejects.toMatchObject({ code: 'overlapping_share' });
    await expect(
      withTenantTx(t.db, org.as(), (tx) => platform.archiveOwner(tx, o1.id, 'left')),
    ).rejects.toMatchObject({ code: 'owner_has_current_shares' });
  });

  it('concurrent share additions cannot both exceed 100 %', async () => {
    const org = await makeOrg(t);
    const p = await org.property('CON');
    const owners = await Promise.all(
      ['P', 'Q'].map((r) =>
        withTenantTx(t.db, org.as(), (tx) =>
          platform.createOwner(tx, { reference: r, kind: 'person', displayName: r }),
        ),
      ),
    );
    const unitId = newId();
    const results = await Promise.allSettled(
      owners.map((o) =>
        withTenantTx(t.db, org.as(), (tx) =>
          platform.addOwnershipShare(tx, {
            ownerId: o.id,
            propertyId: p.id,
            unitId,
            shareBps: 6000,
            effectiveFrom: '2026-01-01',
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('outlets', () => {
  it('creates outlets with property defaults, validates hours, and respects property scope', async () => {
    const org = await makeOrg(t);
    const p1 = await org.property('OUT1');
    const p2 = await org.property('OUT2');
    const bar = await withTenantTx(t.db, org.as(), (tx) =>
      platform.createOutlet(tx, p1.id, {
        code: 'SUNSET',
        name: 'Sunset Bar',
        kind: 'bar',
        defaultChargeCodeKey: 'beverage',
        openingHours: [{ day: 5, opens: '18:00', closes: '01:00' }],
        acceptsRoomCharge: true,
      }),
    );
    expect(bar).toMatchObject({
      legalEntityId: org.le.id,
      status: 'active',
      version: 1,
      acceptsRoomCharge: true,
    });
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.createOutlet(tx, p1.id, { code: 'SUNSET', name: 'Dup', kind: 'bar' }),
      ),
    ).rejects.toMatchObject({ code: 'outlet_code_taken' });
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.createOutlet(tx, p1.id, {
          code: 'SPA',
          name: 'Spa',
          kind: 'spa',
          openingHours: [
            { day: 1, opens: '09:00', closes: '13:00' },
            { day: 1, opens: '12:00', closes: '18:00' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_opening_hours' });
    const p1Manager = org.as(newId(), [
      { permission: 'platform.outlet.manage', propertyIds: [p1.id] },
      { permission: 'platform.property.read', propertyIds: [p1.id] },
    ]);
    await expect(
      withTenantTx(t.db, p1Manager, (tx) =>
        platform.createOutlet(tx, p2.id, { code: 'X', name: 'X', kind: 'boutique' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const updated = await withTenantTx(t.db, p1Manager, (tx) =>
      platform.updateOutlet(tx, bar.id, 1, { acceptsRoomCharge: false }),
    );
    expect(updated.version).toBe(2);
    await expect(
      withTenantTx(t.db, p1Manager, (tx) => platform.updateOutlet(tx, bar.id, 1, { name: 'stale' })),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    const other = await makeOrg(t);
    await expect(
      withTenantTx(t.db, other.as(), (tx) => platform.getOutlet(tx, bar.id)),
    ).rejects.toMatchObject({
      code: 'outlet_not_found',
    });
  });
});

describe('configuration bundles and staged rollout (adoption brief §11)', () => {
  async function modelOrg(planCode = 'enterprise') {
    const org = await makeOrg(t, { planCode });
    const model = await org.property('MODEL', { checkInTime: '15:00' });
    await withTenantTx(t.db, org.as(), async (tx) => {
      await platform.createOutlet(tx, model.id, {
        code: 'MAIN',
        name: 'Main Restaurant',
        kind: 'restaurant',
      });
      await platform.createOutlet(tx, model.id, {
        code: 'DIVE',
        name: 'Dive Centre',
        kind: 'dive_center',
        acceptsRoomCharge: true,
      });
      await platform.createDepartment(tx, {
        propertyId: model.id,
        code: 'HK',
        name: 'Housekeeping',
        kind: 'housekeeping',
      });
      await platform.setPolicy(tx, {
        key: 'operations.inspectionAfterClean',
        scopeType: 'property',
        scopeId: model.id,
        value: 'all',
        reason: 'brand standard',
      });
    });
    const bundle = await withTenantTx(t.db, org.as(), (tx) =>
      platform.exportConfigurationBundle(tx, {}, model.id, { name: 'resort-standard' }),
    );
    return { org, model, bundle };
  }

  it('exports a versioned bundle and previews changes before applying them', async () => {
    const { org, bundle } = await modelOrg();
    expect(bundle).toMatchObject({ name: 'resort-standard', version: 1, sourceKind: 'property' });
    expect(Object.keys(bundle.content.sections).sort()).toEqual([
      'platform.departments',
      'platform.outlets',
      'platform.policies',
      'platform.propertySettings',
    ]);
    const t1 = await org.property('T1');
    const t2 = await org.property('T2');
    // T2 has its own (local) value for the dive centre and the inspection policy.
    await withTenantTx(t.db, org.as(), async (tx) => {
      await platform.createOutlet(tx, t2.id, { code: 'DIVE', name: 'Reef Divers', kind: 'dive_center' });
      await platform.setPolicy(tx, {
        key: 'operations.inspectionAfterClean',
        scopeType: 'property',
        scopeId: t2.id,
        value: 'vip_only',
        reason: 'local decision',
      });
    });
    const preparer = newId();
    const approver = newId();
    const change = await withTenantTx(t.db, org.as(preparer), (tx) =>
      platform.prepareConfigurationChange(tx, {}, { bundleId: bundle.id, propertyIds: [t1.id, t2.id] }),
    );
    expect(change).toMatchObject({ status: 'pending_approval', approvalRequired: true });
    expect(change.summary).toMatchObject({ properties: 2, conflicts: 0 });
    const t2Plan = change.plan.find((x) => x.propertyId === t2.id);
    const outlets = t2Plan?.sections.find((s) => s.section === 'platform.outlets');
    expect(outlets?.items.map((i) => [i.key, i.action])).toEqual([
      ['DIVE', 'local_preserved'],
      ['MAIN', 'create'],
    ]);
    const policies = t2Plan?.sections.find((s) => s.section === 'platform.policies');
    expect(policies?.items[0]?.action).toBe('local_preserved');
    // Nothing changed yet (dry run).
    expect(await withTenantTx(t.db, org.as(), (tx) => platform.listOutlets(tx, t1.id))).toHaveLength(0);
    // Separation of duties: the preparer cannot approve; applying before approval is refused.
    await expect(
      withTenantTx(t.db, org.as(preparer), (tx) => platform.approveConfigurationChange(tx, change.id)),
    ).rejects.toMatchObject({ code: 'segregation_of_duties' });
    await expect(
      withTenantTx(t.db, org.as(preparer), (tx) => platform.applyConfigurationChange(tx, {}, change.id)),
    ).rejects.toMatchObject({ code: 'approval_pending' });
    await withTenantTx(t.db, org.as(approver), (tx) =>
      platform.approveConfigurationChange(tx, change.id, 'ok'),
    );
    const applied = await withTenantTx(t.db, org.as(preparer), (tx) =>
      platform.applyConfigurationChange(tx, {}, change.id),
    );
    expect(applied.status).toBe('applied');
    const t1Outlets = await withTenantTx(t.db, org.as(), (tx) => platform.listOutlets(tx, t1.id));
    expect(t1Outlets.map((o) => o.code).sort()).toEqual(['DIVE', 'MAIN']);
    expect(t1Outlets.find((o) => o.code === 'DIVE')?.legalEntityId).toBe(org.le.id);
    const t2Dive = (await withTenantTx(t.db, org.as(), (tx) => platform.listOutlets(tx, t2.id))).find(
      (o) => o.code === 'DIVE',
    );
    expect(t2Dive?.name).toBe('Reef Divers'); // local value preserved
    const t1Policy = await withTenantTx(t.db, org.as(), (tx) =>
      platform.resolvePolicy(tx, t1.id, 'operations.inspectionAfterClean', 'off'),
    );
    expect(t1Policy).toMatchObject({ value: 'all', source: 'property' });
    // Every property already has check-in times, so preserve_local keeps them (overwrite would replace them).
    const settings = change.plan[0]?.sections.find((s) => s.section === 'platform.propertySettings');
    expect(settings?.items[0]?.action).toBe('local_preserved');
    expect((await withTenantTx(t.db, org.as(), (tx) => platform.getProperty(tx, t1.id))).checkInTime).toBe(
      '14:00',
    );
  });

  it('refuses a stale plan and lets single-property changes through without a second approver', async () => {
    const { org, bundle } = await modelOrg();
    const target = await org.property('T3');
    const change = await withTenantTx(t.db, org.as(), (tx) =>
      platform.prepareConfigurationChange(
        tx,
        {},
        { bundleId: bundle.id, propertyIds: [target.id], mode: 'overwrite' },
      ),
    );
    expect(change).toMatchObject({ status: 'approved', approvalRequired: false });
    await withTenantTx(t.db, org.as(), (tx) =>
      platform.createOutlet(tx, target.id, { code: 'MAIN', name: 'Created meanwhile', kind: 'restaurant' }),
    );
    await expect(
      withTenantTx(t.db, org.as(), (tx) => platform.applyConfigurationChange(tx, {}, change.id)),
    ).rejects.toMatchObject({ code: 'plan_stale' });
  });

  it('targets rollout groups and gates portfolio rollouts by entitlement', async () => {
    const { org, bundle } = await modelOrg();
    const a = await org.property('W1A');
    const b = await org.property('W1B');
    const group = await withTenantTx(t.db, org.as(), (tx) =>
      platform.createRolloutGroup(tx, {
        key: 'pilot',
        name: 'Pilot properties',
        stage: 'pilot',
        propertyIds: [a.id],
      }),
    );
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.createRolloutGroup(tx, {
          key: 'wave1',
          name: 'Wave 1',
          stage: 'wave1',
          propertyIds: [a.id, b.id],
        }),
      ),
    ).rejects.toMatchObject({ code: 'property_in_other_group' });
    const change = await withTenantTx(t.db, org.as(), (tx) =>
      platform.prepareConfigurationChange(tx, {}, { bundleId: bundle.id, rolloutGroupId: group.id }),
    );
    expect(change).toMatchObject({
      targetPropertyIds: [a.id],
      approvalRequired: true,
      rolloutGroupId: group.id,
    });

    const proOrg = await makeOrg(t, { planCode: 'professional' });
    const pm = await proOrg.property('PM');
    const pb = await withTenantTx(t.db, proOrg.as(), (tx) =>
      platform.exportConfigurationBundle(tx, {}, pm.id, { name: 'std' }),
    );
    const px = await proOrg.property('PX');
    await expect(
      withTenantTx(t.db, proOrg.as(), (tx) =>
        platform.prepareConfigurationChange(tx, {}, { bundleId: pb.id, propertyIds: [pm.id, px.id] }),
      ),
    ).rejects.toMatchObject({ code: 'feature_not_enabled' });
  });

  it('reports sections of modules this organization does not run and legal-entity conflicts', async () => {
    const org = await makeOrg(t);
    const target = await org.property('IMP');
    const bundle = await withTenantTx(t.db, org.as(), (tx) =>
      platform.importConfigurationBundle(tx, {
        name: 'uploaded',
        content: {
          formatVersion: 1,
          sections: {
            'platform.outlets': {
              schemaVersion: 1,
              items: [
                {
                  key: 'BTQ',
                  value: {
                    name: 'Boutique',
                    kind: 'boutique',
                    legalEntity: 'Retail Co Ltd',
                    openingHours: [],
                  },
                },
              ],
            },
            'rates.ratePlans': { schemaVersion: 1, items: [{ key: 'BAR', value: {} }] },
          },
        },
      }),
    );
    const change = await withTenantTx(t.db, org.as(), (tx) =>
      platform.prepareConfigurationChange(tx, {}, { bundleId: bundle.id, propertyIds: [target.id] }),
    );
    expect(change.summary.conflicts).toBe(2);
    const notes = change.plan[0]?.sections.flatMap((s) => s.items.map((i) => i.note));
    expect(notes?.join(' ')).toMatch(/Retail Co Ltd/);
    expect(notes?.join(' ')).toMatch(/rates.ratePlans/);
  });
});

describe('trial environments (adoption brief §3)', () => {
  it('reset, export and close a trial; live organizations refuse; carry-forward copies configuration only', async () => {
    const live = await makeOrg(t, { name: 'Lagoon Collection' });
    const liveProp = await live.property('LIVE');
    const trial = await makeOrg(t, { environment: 'trial', name: 'Lagoon Collection (trial)' });
    await withTenantTx(t.db, trial.system, (tx) =>
      platform.initTrialLifecycle(tx, { sourceTenantId: live.tenantId }),
    );
    await withTenantTx(t.db, live.system, (tx) =>
      platform.linkEnvironment(tx, {
        linkedTenantId: trial.tenantId,
        environment: 'trial',
        name: 'Evaluation',
      }),
    );
    const trialProp = await trial.property('TP');
    await withTenantTx(t.db, trial.as(), async (tx) => {
      await platform.createOutlet(tx, trialProp.id, { code: 'BAR', name: 'Trial bar', kind: 'bar' });
      await platform.recordTrialImport(tx, {
        sourceSystem: 'OPERA export',
        copiedAt: new Date('2026-11-03T14:20:00Z'),
        recordCounts: { reservations: 120 },
      });
    });
    const info = await withTenantTx(t.db, trial.as(), (tx) => platform.getEnvironmentInfo(tx));
    expect(info).toMatchObject({
      environment: 'trial',
      importedDataProvenance: 'copied',
      effects: { 'integration.write': 'blocked', 'payment.charge': 'simulate' },
      trial: { sourceOrganizationId: live.tenantId, lastCopiedAt: '2026-11-03T14:20:00.000Z' },
    });
    expect(info.banner?.detail).toMatch(/copied 2026-11-03/);
    expect(platform.provenanceFor('trial', { imported: true })).toBe('copied');

    let resets = 0;
    const ports = {
      trialParticipants: [
        {
          module: 'reservations',
          resetOperationalData: async () => {
            resets++;
            return { removed: 120 };
          },
          exportOperationalData: async () => ({ bookings: 120 }),
        },
      ],
      configurationSections: [
        ...platform.platformConfigurationSections(),
        {
          // A misbehaving provider claiming operational data may move: the carry-forward rules exclude it anyway.
          key: 'reservations.bookings',
          title: 'Bookings',
          schemaVersion: 1,
          carryForward: true,
          exportItems: async () => [{ key: 'B1', value: { guest: 'x' } }],
          currentItems: async () => new Map(),
          applyItems: async () => {},
        } satisfies ConfigurationSectionProvider,
      ],
    };
    await expect(
      withTenantTx(t.db, trial.as(), (tx) =>
        platform.resetTrial(tx, ports, { reason: 'start over', confirmOrganizationName: 'wrong' }),
      ),
    ).rejects.toMatchObject({ code: 'confirmation_mismatch' });
    const reset = await withTenantTx(t.db, trial.as(), (tx) =>
      platform.resetTrial(tx, ports, { reason: 'start over', confirmOrganizationName: trial.name }),
    );
    expect(reset).toEqual({ removed: { reservations: 120 }, resetCount: 1 });
    expect(resets).toBe(1);
    expect(await withTenantTx(t.db, trial.as(), (tx) => platform.listOutlets(tx, trialProp.id))).toHaveLength(
      1,
    );
    await expect(
      withTenantTx(t.db, live.as(), (tx) =>
        platform.resetTrial(tx, ports, { reason: 'x', confirmOrganizationName: live.name }),
      ),
    ).rejects.toMatchObject({ code: 'not_a_trial' });
    const exported = await withTenantTx(t.db, trial.as(), (tx) => platform.exportTrial(tx, ports));
    expect(exported).toMatchObject({
      label: 'TRIAL',
      provenance: 'copied',
      operationalData: { reservations: { bookings: 120 } },
    });

    // Carry forward (EV-09): only configuration sections, never operational data.
    const bundle = await platform.pullTrialConfiguration(t.db, live.as(), ports, {
      trialOrganizationId: trial.tenantId,
      trialPropertyId: trialProp.id,
      bundleName: 'from-trial',
    });
    expect(bundle.sourceKind).toBe('trial');
    expect(Object.keys(bundle.content.sections)).not.toContain('reservations.bookings');
    expect(bundle.content.sections['platform.outlets']?.items.map((i) => i.key)).toEqual(['BAR']);
    const change = await withTenantTx(t.db, live.as(), (tx) =>
      platform.prepareConfigurationChange(tx, ports, { bundleId: bundle.id, propertyIds: [liveProp.id] }),
    );
    expect(change.summary.create).toBeGreaterThan(0);
    // An unrelated organization cannot pull from this trial.
    const stranger = await makeOrg(t);
    await expect(
      platform.pullTrialConfiguration(t.db, stranger.as(), ports, {
        trialOrganizationId: trial.tenantId,
        trialPropertyId: trialProp.id,
        bundleName: 'steal',
      }),
    ).rejects.toMatchObject({ code: 'trial_not_found' });

    const linked = await withTenantTx(t.db, live.as(), (tx) => platform.listLinkedEnvironments(tx));
    expect(linked).toEqual([expect.objectContaining({ organizationId: trial.tenantId, status: 'active' })]);
    const closed = await withTenantTx(t.db, trial.as(), (tx) =>
      platform.closeTrial(tx, { reason: 'evaluation finished', confirmOrganizationName: trial.name }),
    );
    expect(new Date(closed.deletionDueAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const { sql } = await import('@portico/db');
    const env = await sql<{
      e: string | null;
    }>`select platform.tenant_environment(${trial.tenantId}::uuid) as e`.execute(t.db.kysely);
    expect(env.rows[0]?.e).toBeNull(); // closed organizations no longer authenticate
    expect(
      (await withTenantTx(t.db, live.as(), (tx) => platform.listLinkedEnvironments(tx)))[0]?.status,
    ).toBe('closed');
  });
});
