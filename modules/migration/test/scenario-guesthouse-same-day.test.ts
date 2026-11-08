/**
 * Scenario: a guesthouse moves to Portico the same day (DD11 §7.2; brief increments 1–2).
 *
 * The hotel presses "Move to Portico" in its LIVE organization and uploads its spreadsheet pack. Portico discovers,
 * maps (finance decides the one tax mapping), validates, rehearses in the linked TRIAL organization (copied
 * provenance), reconciles exactly twice, waits for the seven human steps and a second person's authorization, plans
 * the switch of system of record, and — when the person confirms the old system is frozen — takes the final capture,
 * re-checks every gate, switches, imports, verifies, measures the freeze and opens the rollback window. Rollback
 * inside the window keeps every post-cutover change and hands it over as a worklist.
 */
import { type TxContext, withTenantTx } from '@portico/db';
import { type DomainEvent, newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FREEZE_TARGET_MINUTES, migration, sampleGuesthouseFiles } from '../src';
import { db } from '../src/service/context';
import { ALL_MIGRATION, asSystem, type Harness, type Org, setupLiveWithTrial, startHarness } from './harness';

let h: Harness;
let live: Org;
let trial: Org;
let jobId: string;
const ev = { evidence: {} };

beforeAll(async () => {
  h = await startHarness();
  ({ live, trial } = await setupLiveWithTrial(h));
});
afterAll(async () => h?.close());

/** The migration-lead role template: no finance sign-off, no staff acceptance, no production authorization. */
const LEAD = [
  'migration.job.read',
  'migration.job.manage',
  'migration.mapping.review',
  'migration.exception.manage',
  'migration.cutover.execute',
  'migration.checklist.complete',
];
const lead = () => live.user('Mariyam (migration lead)', LEAD);
const finance = () =>
  live.user('Ahmed (finance controller)', [
    'migration.job.read',
    'migration.mapping.review',
    'migration.finance.signoff',
  ]);
const gm = () => live.user('Aisha (general manager)', [...ALL_MIGRATION]);
const view = (ctx = lead()) =>
  live.run(async (tx) => migration.jobView(tx, await migration.getJob(tx, jobId)), ctx);
const authority = (domain: 'reservations' | 'accounting' | 'availability') =>
  live.run((tx) => platform.getDataAuthority(asSystem(tx), live.propertyId, domain));

describe('a guesthouse moved to Portico the same day', () => {
  it('1. Move to Portico: the job and the seven human steps exist from the start, with owners and due times', async () => {
    const job = await live.run(
      (tx) =>
        migration.createJob(tx, h.deps, {
          propertyId: live.propertyId,
          sourceAdapter: 'portico.pack.v1',
          sourceSystem: 'Coral Nest spreadsheets',
          rehearsal: { trialOrganizationId: trial.tenantId, trialPropertyId: trial.propertyId },
        }),
      lead(),
    );
    jobId = job.id;
    expect(job.purpose).toBe('production');
    const v = await view();
    expect(v.checklist.map((c) => [c.key, c.status, c.ownerRole])).toEqual([
      ['data_authorization', 'waiting', 'General manager or owner'],
      ['source_access', 'waiting', 'Hotel IT or general manager'],
      ['card_transfer', 'waiting', 'Finance controller'],
      ['opening_balances', 'waiting', 'Finance controller'],
      ['channel_switch', 'waiting', 'Revenue manager'],
      ['cutover_window', 'waiting', 'General manager'],
      ['staff_acceptance', 'waiting', 'Department heads'],
    ]);
    // Nothing to read yet: the pipeline says exactly what it waits for, and from whom.
    const r = await migration.runPipeline(h.t.db, h.deps, lead(), jobId);
    expect(r.executed).toEqual([
      {
        step: 'discover',
        status: 'waiting',
        detail: expect.stringMatching(/Waiting for the export from Coral Nest spreadsheets/),
      },
    ]);
  });

  it('2. the pack is read, mapped (finance decides the tax mapping), rehearsed twice in the trial copy', async () => {
    await migration.uploadFiles(h.t.db, h.deps, lead(), jobId, {
      files: sampleGuesthouseFiles(live.businessDate),
    });
    let r = await migration.runPipeline(h.t.db, h.deps, lead(), jobId);
    expect(r.executed.at(-1)).toMatchObject({ step: 'map', status: 'waiting' });
    expect((await view()).checklist.find((c) => c.key === 'source_access')).toMatchObject({
      status: 'done',
      completedBy: 'system:migration',
    });
    await live.run(
      (tx) =>
        migration.reviewMapping(tx, h.deps, jobId, {
          taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }],
        }),
      finance(),
    );
    r = await migration.runPipeline(h.t.db, h.deps, lead(), jobId);
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'map:succeeded',
      'validate:succeeded',
      'rehearse:succeeded',
      'reconcile:succeeded',
      'signoff:waiting',
    ]);
    expect(r.executed.at(-1)?.detail).toMatch(
      /Sign the data authorization.*production authorization by a second authorized person/,
    );
    // The rehearsal ran in the TRIAL organization: its copy is labelled copied; the live organization holds nothing.
    const t = await withTenantTx(h.t.db, trial.admin, async (tx) => {
      const jobs = await db(tx).selectFrom('migration.jobs').selectAll().execute();
      return {
        jobs,
        bookings: await h.reservations.count(tx, trial.propertyId),
        env: await platform.getEnvironmentInfo(tx),
      };
    });
    expect(t.jobs).toHaveLength(1);
    expect(t.jobs[0]).toMatchObject({ purpose: 'rehearsal', state: 'rehearsed', environment: 'trial' });
    expect(t.bookings).toBe(8);
    expect(t.env.importedDataProvenance).toBe('copied');
    expect(t.env.banner?.detail).toMatch(/Data copied/);
    expect(await live.run((tx) => h.reservations.count(tx, live.propertyId))).toBe(0);
    expect((await view()).status.rehearsal).toBe('certified');
  });

  it('3. the human steps cannot be faked or skipped', async () => {
    await expect(
      live.run(
        (tx) =>
          migration.completeChecklistItem(tx, jobId, 'data_authorization', {
            status: 'not_applicable',
            evidence: {},
          }),
        gm(),
      ),
    ).rejects.toMatchObject({ code: 'evidence_required' });
    await expect(
      live.run(
        (tx) => migration.completeChecklistItem(tx, jobId, 'source_access', { status: 'done', evidence: {} }),
        gm(),
      ),
    ).rejects.toMatchObject({ code: 'checklist_observed' });
    await expect(
      live.run(
        (tx) =>
          migration.completeChecklistItem(tx, jobId, 'card_transfer', {
            status: 'done',
            evidence: { decision: 'psp_transfer' },
          }),
        finance(),
      ),
    ).rejects.toMatchObject({ code: 'psp_transfer_unavailable' });
    // The lead holds no finance sign-off: opening balances are finance's.
    await expect(
      live.run(
        (tx) =>
          migration.completeChecklistItem(tx, jobId, 'opening_balances', { status: 'done', evidence: {} }),
        lead(),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // The person who started the migration cannot authorize it.
    await expect(
      live.run(
        (tx) => migration.authorizeProduction(tx, jobId, { evidenceRef: 'DPA-2026-001', validHours: 72 }),
        lead(),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const creatorWithRight = live.user('Mariyam (migration lead)', ALL_MIGRATION);
    await expect(
      live.run(
        (tx) => migration.authorizeProduction(tx, jobId, { evidenceRef: 'DPA-2026-001', validHours: 72 }),
        creatorWithRight,
      ),
    ).rejects.toMatchObject({ code: 'authorization_same_person' });
  });

  it('4. the hotel completes its seven steps; a second person authorizes; the switch is planned and approved', async () => {
    const done = (key: string, evidence: Record<string, string>, ctx = gm()) =>
      live.run((tx) => migration.completeChecklistItem(tx, jobId, key, { status: 'done', evidence }), ctx);
    await done('data_authorization', { reference: 'DPA-CORALNEST-2026-12-01 (signed)' });
    await done('card_transfer', { decision: 're_collect' }, finance());
    await done(
      'opening_balances',
      { note: 'Deposits 300.00 and in-house 340.00 agree with the closing reports.' },
      finance(),
    );
    await done('channel_switch', {
      note: 'Booking.com and Expedia: old channel manager off at 22:00, Portico mappings on after verify.',
    });
    await done('staff_acceptance', {
      note: 'Front office checked 8 arrivals and the in-house folio on the trial copy.',
    });
    await live.run(
      (tx) =>
        migration.authorizeProduction(tx, jobId, { evidenceRef: 'DPA-CORALNEST-2026-12-01', validHours: 72 }),
      gm(),
    );
    let r = await migration.runPipeline(h.t.db, h.deps, lead(), jobId);
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'signoff:succeeded',
      'delta_sync:waiting',
    ]);
    await live.run(
      (tx) =>
        migration.planCutover(tx, h.deps, jobId, {
          plannedStartAt: '2026-12-01T22:00:00Z',
          freezeMinutes: 15,
        }),
      lead(),
    );
    // Until the switch, the old system is the system of record: Portico refuses staff writes there.
    expect(await authority('reservations')).toMatchObject({
      authority: 'external',
      writeMode: 'read_only',
      systemName: 'Coral Nest spreadsheets',
    });
    // The planner cannot approve the switch; a second person does.
    await expect(
      live.run(
        (tx) => migration.approveCutover(tx, h.deps, jobId),
        live.user('Mariyam (migration lead)', ALL_MIGRATION),
      ),
    ).rejects.toMatchObject({
      code: 'segregation_of_duties',
    });
    await live.run((tx) => migration.approveCutover(tx, h.deps, jobId, 'Go for 22:00'), gm());
    r = await migration.runPipeline(h.t.db, h.deps, lead(), jobId);
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual(['delta_sync:succeeded']);
    expect((await view()).state).toBe('in_sync');
    expect((await view()).checklist.every((c) => c.status === 'done')).toBe(true);
  });

  it('5. cutover: freeze ≤ 15 min measured, Portico holds exactly the source, nothing twice', async () => {
    const r = await migration.runPipeline(h.t.db, h.deps, lead(), jobId, { start: 'freeze' });
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'freeze:succeeded',
      'cutover:succeeded',
      'verify:succeeded',
      'rollback_window:waiting',
    ]);
    const v = await view();
    expect(v.state).toBe('rollback_window');
    expect(v.status.cutover).toBe('verified');
    expect(v.freeze.measuredMinutes).not.toBeNull();
    expect(v.freeze.measuredMinutes as number).toBeLessThanOrEqual(FREEZE_TARGET_MINUTES);
    // A guesthouse (8 bookings, 2 deposits) freezes for seconds, measured from the confirmation to the verified opening.
    expect(v.freeze.measuredMinutes as number).toBeLessThan(1);
    expect(v.headline).toMatch(/Portico is the system of record/);
    expect(await authority('reservations')).toMatchObject({ authority: 'portico', writeMode: 'exclusive' });
    expect(await authority('accounting')).toMatchObject({ authority: 'portico' });
    await live.run(async (tx) => {
      expect(await h.reservations.count(tx, live.propertyId)).toBe(8);
      const ledger = await migration.loadLedger(tx, await migration.getJob(tx, jobId));
      const b8 = ledger.get('reservation:CN1008')?.targetId as string;
      expect((await h.finance.getDeposits(asSystem(tx), b8))?.balance.amountMinor).toBe(20000);
      const cards = await db(tx)
        .selectFrom('migration.card_recollections')
        .select(['source_key', 'status'])
        .where('job_id', '=', jobId)
        .execute();
      expect(cards).toEqual([{ source_key: 'CN1002', status: 'to_request' }]);
    }, lead());
    // Running again after the switch changes nothing.
    const again = await migration.importAll(h.t.db, h.deps, lead(), jobId);
    expect(again).toMatchObject({ created: 0, updated: 0, pending: 0 });
  });

  it('6. card re-collection requests are sent after the switch (live: requested, never card data)', async () => {
    const out = await live.run((tx) => migration.requestCardRecollections(tx, h.deps, jobId), finance());
    expect(out).toEqual({ requested: 1, simulated: 0 });
    const again = await live.run((tx) => migration.requestCardRecollections(tx, h.deps, jobId), finance());
    expect(again).toEqual({ requested: 0, simulated: 0 });
  });

  it('7. rollback inside the window keeps every post-cutover booking and payment and returns a worklist', async () => {
    // Staff work in Portico after the switch (events journaled by the consumer).
    const job = await live.run((tx) => migration.getJob(tx, jobId));
    const post: DomainEvent[] = [
      'reservations.booking.confirmed',
      'reservations.booking.modified',
      'finance.posting.created',
      'payments.payment.captured',
    ].map((type, i) => ({
      id: newId(),
      type,
      tenantId: live.tenantId,
      propertyId: live.propertyId,
      aggregate: { type: type.split('.')[1] as string, id: newId() },
      aggregateVersion: 1,
      occurredAt: new Date((job.switchedAt as Date).getTime() + 60_000 * (i + 1)).toISOString(),
      actor: { kind: 'user', userId: newId() },
      correlationId: newId(),
      version: 1,
      payload: {},
    }));
    const journaled = await live.run(async (tx: TxContext) => {
      let n = 0;
      for (const e of post) if (await migration.journalEvent(tx, e)) n++;
      // the same event twice is journaled once
      await migration.journalEvent(tx, post[0] as DomainEvent);
      // events raised by the migration's own writes carry the server-issued migration actor: not activity
      const own = {
        ...(post[0] as DomainEvent),
        id: newId(),
        actor: { kind: 'system' as const, process: 'migration' },
      };
      expect(await migration.journalEvent(tx, own)).toBe(false);
      // R-P2-3: a staff write that reuses a run's correlation id (a client-chosen X-Request-Id) is still journaled
      const runs = (
        await db(tx)
          .selectFrom('migration.jobs')
          .select('run_correlations')
          .where('id', '=', jobId)
          .executeTakeFirstOrThrow()
      ).run_correlations;
      expect(runs.length).toBeGreaterThan(0);
      const spoofed = {
        ...(post[1] as DomainEvent),
        id: newId(),
        correlationId: runs[runs.length - 1] as string,
      };
      expect(await migration.journalEvent(tx, spoofed)).toBe(true);
      return n + 1;
    });
    expect(journaled).toBe(5);
    const before = await live.run((tx) => h.reservations.count(tx, live.propertyId));
    const req = await live.run(
      (tx) => migration.requestRollback(tx, h.deps, jobId, { reason: 'Day Close cannot complete (drill)' }),
      lead(),
    );
    expect(req.worklist).toBe(5);
    await live.run((tx) => migration.approveRollback(tx, h.deps, jobId, 'Agreed with the GM'), gm());
    const v = await view();
    expect(v.state).toBe('rolled_back');
    expect(v.status.cutover).toBe('rolled_back');
    expect(await authority('reservations')).toMatchObject({ authority: 'external', writeMode: 'read_only' });
    // Nothing in Portico was erased: bookings, deposits and the journal stay.
    expect(await live.run((tx) => h.reservations.count(tx, live.propertyId))).toBe(before);
    const journal = await live.run((tx) =>
      db(tx).selectFrom('migration.cutover_journal').selectAll().where('job_id', '=', jobId).execute(),
    );
    expect(journal.map((j) => j.event_type).sort()).toEqual([
      'finance.posting.created',
      'payments.payment.captured',
      'reservations.booking.confirmed',
      'reservations.booking.modified',
      'reservations.booking.modified', // the spoofed-correlation staff write (R-P2-3)
    ]);
    expect(JSON.stringify(journal)).not.toMatch(/Rasheed|Lindqvist|@example/);
    void ev;
  });
});
