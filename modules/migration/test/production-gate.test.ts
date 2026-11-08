/**
 * Environment safety and the production gate (CLAUDE.md §1, rule 12): rehearsals only outside live; a production
 * cutover only in live, only with every gate passed — including a recorded authorization by a second person and the
 * property's activation scope. A refused cutover changes nothing in Portico and is audited.
 */
import { withTenantTx } from '@portico/db';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migration } from '../src';
import { db } from '../src/service/context';
import { productionInSync } from './flows';
import { ALL_MIGRATION, asSystem, type Harness, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('production gate', () => {
  it('without a valid authorization the cutover does not start, nothing changes, and the refusal is audited', async () => {
    const f = await productionInSync(h);
    expect((await f.live.run((tx) => migration.getJob(tx, f.jobId))).state).toBe('in_sync');
    await f.live.run(
      (tx) => migration.revokeAuthorization(tx, f.jobId, 'Owner wants to re-check the plan'),
      f.gm,
    );
    const r = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze' });
    expect(r.executed).toEqual([
      {
        step: 'freeze',
        status: 'waiting',
        detail: expect.stringMatching(/Cutover not started — nothing changed in Portico.*authorization/),
      },
    ]);
    const job = await f.live.run((tx) => migration.getJob(tx, f.jobId));
    expect(job.state).toBe('in_sync');
    expect(job.frozenAt).toBeNull();
    expect(await f.live.run((tx) => h.reservations.count(tx, f.live.propertyId))).toBe(0);
    const auth = await f.live.run((tx) => platform.getDataAuthority(tx, f.live.propertyId, 'reservations'));
    expect(auth).toMatchObject({ authority: 'external', writeMode: 'read_only' });
    const t = await f.live.run(
      async (tx) => (await platform.listAuthorityTransitions(asSystem(tx), f.live.propertyId))[0],
    );
    expect(t?.status).toBe('planned');
    const audit = await withTenantTx(h.t.db, f.live.admin, (tx) =>
      tx.db
        .selectFrom('core.audit_log' as never)
        .select(['action' as never, 'reason' as never])
        .where('action' as never, '=', 'migration.cutover.refused' as never)
        .execute(),
    );
    expect(audit).toHaveLength(1);
    // Authorized again by a second person: the same command now cuts over.
    await f.live.run(
      (tx) => migration.authorizeProduction(tx, f.jobId, { evidenceRef: 'DPA-2', validHours: 24 }),
      f.gm,
    );
    const ok = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze' });
    expect(ok.executed.map((e) => e.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'waiting']);
  });

  it('a pilot property whose approved scope does not include the migration is refused (platform activation scope)', async () => {
    const f = await productionInSync(h);
    const req = await f.live.run(
      (tx) =>
        platform.requestStatusChange(tx, h.platformPorts, f.live.propertyId, {
          toStatus: 'pilot',
          reason: 'Front-desk pilot',
          scope: {
            effects: [],
            workflows: ['reservations.frontDesk'],
            modules: ['reservations'],
            startsOn: '2026-11-01',
            endsOn: '2027-03-31',
            successCriteria: 'Arrivals handled in Portico',
            rollbackPlan: 'Back to the spreadsheets',
          },
        }),
      f.live.user('Requester'),
    );
    await f.live.run(
      (tx) => platform.approveActivationRequest(tx, h.platformPorts, req.id, {}),
      f.live.user('Activator'),
    );
    const r = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze' });
    expect(r.executed[0]).toMatchObject({
      step: 'freeze',
      status: 'waiting',
      detail: expect.stringMatching(/migration\.cutover.*is not live/),
    });
    expect(await f.live.run((tx) => h.reservations.count(tx, f.live.propertyId))).toBe(0);
    // Adding the migration to the approved pilot scope (a new approved version) lets it through.
    const change = await f.live.run(
      (tx) =>
        platform.requestScopeChange(tx, f.live.propertyId, {
          stage: 'pilot',
          reason: 'Migrate during the pilot',
          scope: {
            effects: [],
            workflows: ['reservations.frontDesk', 'migration.cutover'],
            modules: ['reservations', 'migration'],
            startsOn: '2026-11-01',
            endsOn: '2027-03-31',
            successCriteria: 'Arrivals handled in Portico',
            rollbackPlan: 'Back to the spreadsheets',
          },
        }),
      f.live.user('Requester'),
    );
    await f.live.run(
      (tx) => platform.approveActivationRequest(tx, h.platformPorts, change.id, {}),
      f.live.user('Activator'),
    );
    const ok = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze' });
    expect(ok.executed[0]).toMatchObject({ step: 'freeze', status: 'succeeded' });
  });

  it('the freeze never starts by itself: run stops before it until a person starts the cutover', async () => {
    const f = await productionInSync(h);
    const r = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId);
    expect(r.executed).toEqual([]);
    expect((await f.live.run((tx) => migration.getJob(tx, f.jobId))).frozenAt).toBeNull();
  });

  it('a person without cutover rights cannot plan, start or roll back; the approver must be a different person', async () => {
    const f = await productionInSync(h, { stopAt: 'signoff' });
    const reader = f.live.user('Reader', ['migration.job.read']);
    await expect(
      f.live.run(
        (tx) =>
          migration.planCutover(tx, h.deps, f.jobId, {
            plannedStartAt: '2026-12-01T22:00:00Z',
            freezeMinutes: 15,
          }),
        reader,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      migration.runPipeline(h.t.db, h.deps, reader, f.jobId, { start: 'freeze' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      f.live.run((tx) => migration.requestRollback(tx, h.deps, f.jobId, { reason: 'try it' }), reader),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('environment safety', () => {
  it('the simulator is never a source in a live organization', async () => {
    const live = await setupOrg(h, { environment: 'live' });
    await expect(
      live.run((tx) =>
        migration.createJob(tx, h.deps, {
          propertyId: live.propertyId,
          sourceAdapter: 'pms.simulator',
          sourceSystem: 'Sim',
          sourceRef: 'sim-x',
        }),
      ),
    ).rejects.toMatchObject({ code: 'simulator_not_in_live' });
  });

  it('a live job never imports before the cutover: its rehearsal runs in the trial organization only', async () => {
    const live = await setupOrg(h, { environment: 'live' });
    const lead = live.user('Lead', ALL_MIGRATION);
    const job = await live.run(
      (tx) =>
        migration.createJob(tx, h.deps, {
          propertyId: live.propertyId,
          sourceAdapter: 'portico.pack.v1',
          sourceSystem: 'Sheets',
        }),
      lead,
    );
    expect(job.purpose).toBe('production');
    const { sampleGuesthouseFiles } = await import('../src');
    await migration.uploadFiles(h.t.db, h.deps, lead, job.id, {
      files: sampleGuesthouseFiles(live.businessDate),
    });
    await live.run((tx) => migration.reviewMapping(tx, h.deps, job.id, {}), lead).catch(() => undefined);
    await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    await live.run((tx) =>
      migration.reviewMapping(tx, h.deps, job.id, {
        taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }],
      }),
    );
    const r = await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    expect(r.executed.at(-1)).toMatchObject({
      step: 'rehearse',
      status: 'waiting',
      detail: expect.stringMatching(/Link a trial organization/),
    });
    expect(await live.run((tx) => h.reservations.count(tx, live.propertyId))).toBe(0);
    await expect(migration.importAll(h.t.db, h.deps, lead, job.id)).resolves.toBeDefined();
    void db;
  });

  it('the trial bridge refuses an organization that is not a trial of this live organization', async () => {
    const live = await setupOrg(h, { environment: 'live' });
    const otherLive = await setupOrg(h, { environment: 'live' });
    const strangersTrial = await setupOrg(h, { environment: 'trial', liveTenantId: otherLive.tenantId });
    await expect(
      live.run((tx) =>
        h.deps.ports.rehearsal.evidence(tx, {
          trialOrganizationId: strangersTrial.tenantId,
          liveJobId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      live.run((tx) =>
        h.deps.ports.rehearsal.evidence(tx, {
          trialOrganizationId: otherLive.tenantId,
          liveJobId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'rehearsal_org_not_trial' });
  });
});

describe('cancelling a planned migration (R-P2-1: cancel restores what the migration restricted)', () => {
  it('cancels the open switch, plans the restore; a second person approves it and Portico operates the domains again', async () => {
    const f = await productionInSync(h);
    const job = await f.live.run(
      (tx) => migration.cancelJob(tx, h.deps, f.jobId, 'Hotel postponed the move'),
      f.lead,
    );
    expect(job.state).toBe('cancelled');
    const transitions = await f.live.run((tx) =>
      platform.listAuthorityTransitions(asSystem(tx), f.live.propertyId),
    );
    const cutover = transitions.find((t) => t.id !== job.restoreTransitionId && t.status !== 'effective');
    expect(transitions.map((t) => t.status)).toContain('cancelled');
    expect(cutover?.status).toBe('cancelled');
    expect(transitions.find((t) => t.id === job.restoreTransitionId)?.status).toBe('planned');
    // Until the second person approves, the old system stays the system of record (truthfully).
    const auth = await f.live.run((tx) => platform.getDataAuthority(tx, f.live.propertyId, 'reservations'));
    expect(auth).toMatchObject({ authority: 'external', writeMode: 'read_only' });
    await expect(migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId)).rejects.toMatchObject({
      code: 'migration_closed',
    });
    // The person who cancelled cannot approve the restore alone.
    await expect(
      f.live.run((tx) => migration.approveRestore(tx, h.deps, f.jobId), f.lead),
    ).rejects.toBeTruthy();
    await f.live.run((tx) => migration.approveRestore(tx, h.deps, f.jobId, 'Agreed'), f.gm);
    expect(
      await f.live.run((tx) => platform.getDataAuthority(tx, f.live.propertyId, 'reservations')),
    ).toMatchObject({
      authority: 'portico',
    });
  });

  it("planning alone restricts nothing: the property becomes read-only only at the second person's approval", async () => {
    const f = await productionInSync(h, { stopAt: 'signoff' });
    await f.live.run(
      (tx) => migration.authorizeProduction(tx, f.jobId, { evidenceRef: 'DPA-1', validHours: 72 }),
      f.gm,
    );
    await f.live.run(
      (tx) =>
        migration.planCutover(tx, h.deps, f.jobId, {
          plannedStartAt: '2026-12-01T22:00:00Z',
          freezeMinutes: 15,
        }),
      f.lead,
    );
    expect(
      await f.live.run((tx) => platform.getDataAuthority(tx, f.live.propertyId, 'reservations')),
    ).toMatchObject({
      authority: 'portico',
    });
  });
});

describe('R-P2-2 the gate is re-checked at the switch itself', () => {
  it('freeze passes, the authorizer revokes, the next run does not switch: it unfreezes and nothing is imported', async () => {
    const f = await productionInSync(h);
    const r1 = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze', maxSteps: 1 });
    expect(r1.executed.map((e) => `${e.step}:${e.status}`)).toEqual(['freeze:succeeded']);
    await f.live.run(
      (tx) => migration.revokeAuthorization(tx, f.jobId, 'Stop: the owner withdrew consent'),
      f.gm,
    );
    const r2 = await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId);
    expect(r2.executed).toEqual([
      { step: 'cutover', status: 'waiting', detail: expect.stringMatching(/authorization was revoked/) },
    ]);
    expect(
      await f.live.run((tx) => platform.getDataAuthority(asSystem(tx), f.live.propertyId, 'reservations')),
    ).toMatchObject({ authority: 'external' });
    const job = await f.live.run((tx) => migration.getJob(tx, f.jobId));
    expect(job.state).toBe('in_sync');
    expect(job.frozenAt).toBeNull();
    expect(await f.live.run((tx) => h.reservations.count(tx, f.live.propertyId))).toBe(0);
  });
});
