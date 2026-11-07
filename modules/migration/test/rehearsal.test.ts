/**
 * Increment 1 acceptance (guesthouse spreadsheet): the sample pack migrates into a TRIAL organization, reconciles
 * exactly twice in a row (certificate), and re-running creates zero duplicates. Real platform, inventory, guests,
 * finance and rates; strict fakes only for the requested reservations / in-house / AR contracts.
 */
import { withTenantTx } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migration, sampleGuesthouseFiles } from '../src';
import { db } from '../src/service/context';
import { ALL_MIGRATION, asSystem, type Harness, type Org, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function stagedRehearsal(org: Org) {
  const lead = org.user('Migration lead', ALL_MIGRATION);
  const job = await org.run(
    (tx) =>
      migration.createJob(tx, h.deps, {
        propertyId: org.propertyId,
        sourceAdapter: 'portico.pack.v1',
        sourceSystem: 'Coral Nest spreadsheets',
      }),
    lead,
  );
  const up = await migration.uploadFiles(h.t.db, h.deps, lead, job.id, {
    files: sampleGuesthouseFiles(org.businessDate),
  });
  return { lead, job, up };
}

describe('guesthouse spreadsheet → trial organization (rehearsal)', () => {
  let org: Org;
  let jobId: string;
  beforeAll(async () => {
    org = await setupOrg(h, { environment: 'trial' });
    const s = await stagedRehearsal(org);
    jobId = s.job.id;
    expect(s.up).toMatchObject({
      stored: true,
      extractSeq: 1,
      counts: { reservation: 8, guest: 6, deposit: 2 },
    });
  });

  it('runs until the one financial decision a person must make (tax declared on deposits → finance)', async () => {
    const lead = org.user('Migration lead', ALL_MIGRATION);
    const r = await migration.runPipeline(h.t.db, h.deps, lead, jobId);
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'discover:succeeded',
      'extract:succeeded',
      'map:waiting',
    ]);
    expect(r.executed[0]?.detail).toMatch(
      /Found 3 unit types, 6 units, 2 rate plans, 6 guest profiles, 8 reservations \(4 future, 1 in house, 3 history\)/,
    );
    const view = await org.run(async (tx) => migration.jobView(tx, await migration.loadJob(tx, jobId)), lead);
    expect(view.pendingReview).toEqual([
      expect.objectContaining({ kind: 'taxAccount', ref: 'TGST', financial: true }),
    ]);
    expect(view.provenance).toBe('copied');
    // The migration lead may not decide a tax mapping (INT-R11): finance only.
    const noFinance = org.user(
      'Lead without finance',
      ALL_MIGRATION.filter((p) => p !== 'migration.finance.signoff'),
    );
    await expect(
      org.run(
        (tx) =>
          migration.reviewMapping(tx, h.deps, jobId, {
            taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }],
          }),
        noFinance,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('after the finance review it rehearses, reconciles exactly twice and certifies', async () => {
    const fin = org.user('Finance controller', [
      'migration.job.read',
      'migration.mapping.review',
      'migration.finance.signoff',
    ]);
    await org.run(
      (tx) =>
        migration.reviewMapping(tx, h.deps, jobId, {
          taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }],
        }),
      fin,
    );
    const lead = org.user('Migration lead', ALL_MIGRATION);
    const r = await migration.runPipeline(h.t.db, h.deps, lead, jobId);
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'map:succeeded',
      'validate:succeeded',
      'rehearse:succeeded',
      'reconcile:succeeded',
      'signoff:succeeded',
      'delta_sync:waiting',
    ]);
    const view = await org.run(async (tx) => migration.jobView(tx, await migration.loadJob(tx, jobId)), lead);
    expect(view.state).toBe('rehearsed');
    expect(view.status.rehearsal).toBe('certified');
    expect(view.headline).toMatch(/Rehearsed twice with zero differences/);
    const reports = await org.run((tx) => migration.latestReports(tx, jobId, 2), lead);
    expect(reports.map((x) => [x.context, x.exact])).toEqual([
      ['certification', true],
      ['rehearsal', true],
    ]);
    expect(reports[0]?.fingerprint).toBe(reports[1]?.fingerprint);
  });

  it('what Portico holds equals the source: bookings once, inventory once, deposits with tax already declared', async () => {
    const lead = org.user('Migration lead', ALL_MIGRATION);
    await org.run(async (tx) => {
      expect(await h.reservations.count(tx, org.propertyId)).toBe(8);
      // Real inventory: rooms sold per night = active source stays (CN1004 in house, CN1008, CN1001, CN1002, CN1003).
      const cells = await h.inventory.getAvailability(asSystem(tx), {
        propertyId: org.propertyId,
        range: { from: '2026-12-01', to: '2026-12-24' },
      });
      const sold = (date: string) => cells.filter((c) => c.date === date).reduce((s, c) => s + c.sold, 0);
      expect(sold('2026-12-01')).toBe(1); // CN1004 (in house)
      expect(sold('2026-12-02')).toBe(2); // CN1004 + CN1008
      expect(sold('2026-12-04')).toBe(2); // CN1001 + CN1008
      expect(sold('2026-12-11')).toBe(1); // CN1002
      expect(sold('2026-12-21')).toBe(1); // CN1003 (tentative holds a room)
      expect(sold('2026-12-06')).toBe(1); // CN1006 cancelled: never consumed
      const ledger = await migration.loadLedger(tx, await migration.loadJob(tx, jobId));
      const b1 = ledger.get('reservation:CN1001')?.targetId as string;
      const dep = await h.finance.getDeposits(asSystem(tx), b1);
      expect(dep?.balance).toEqual({ amountMinor: 10000, currency: 'USD' });
      expect(dep?.movements.map((m) => m.kind)).toEqual(['opening_balance']);
    }, lead);
  });

  it('every source record ends in exactly one state (MG-08) and duplicates are flagged, never merged', async () => {
    await org.run(async (tx) => {
      const rows = await db(tx)
        .selectFrom('migration.import_ledger')
        .select(['data_class', 'state', (eb) => eb.fn.countAll<string>().as('n')])
        .where('property_id', '=', org.propertyId)
        .groupBy(['data_class', 'state'])
        .execute();
      const by = Object.fromEntries(rows.map((r) => [`${r.data_class}:${r.state}`, Number(r.n)]));
      expect(by).toEqual({
        'unit_type:imported': 3,
        'unit:imported': 6,
        'rate_plan:suggested': 2,
        'guest:imported': 6,
        'reservation:imported': 8,
        'deposit:imported': 2,
        'in_house_balance:imported': 1,
        'ar_open_item:imported': 2,
      });
      const ex = await db(tx)
        .selectFrom('migration.exceptions')
        .select(['code', 'source_key', 'severity', 'status'])
        .where('job_id', '=', jobId)
        .where('status', '=', 'open')
        .execute();
      // In the source pack (same email, name and birth date) AND by guests' own scoring against the profile just
      // created — flagged twice, merged never.
      expect(ex.map((e) => `${e.code}:${e.source_key}:${e.severity}`).sort()).toEqual([
        'possible_duplicate_in_portico:G006:warning',
        'possible_duplicate_profile:G002:warning',
        'possible_duplicate_profile:G006:warning',
      ]);
      const guests = await db(tx)
        .selectFrom('migration.import_ledger')
        .select('target_id')
        .where('data_class', '=', 'guest')
        .where('source_key', 'in', ['G002', 'G006'])
        .execute();
      expect(new Set(guests.map((g) => g.target_id)).size).toBe(2);
    }, org.admin);
  });

  it('running again (and again) creates nothing: zero duplicate reservations', async () => {
    const lead = org.user('Migration lead', ALL_MIGRATION);
    const s = await migration.importAll(h.t.db, h.deps, lead, jobId);
    expect(s).toMatchObject({ created: 0, updated: 0, unchanged: 30, exceptions: 0, pending: 0 });
    await org.run(async (tx) => expect(await h.reservations.count(tx, org.propertyId)).toBe(8), lead);
  });

  it('the card re-collection list holds the future stay guaranteed by a card at the old provider (Q142)', async () => {
    const rows = await withTenantTx(h.t.db, org.admin, (tx) =>
      db(tx)
        .selectFrom('migration.card_recollections')
        .select(['source_key', 'status'])
        .where('job_id', '=', jobId)
        .execute(),
    );
    expect(rows).toEqual([{ source_key: 'CN1002', status: 'to_request' }]);
  });
});
