/**
 * S18 extended (migration): imported opening balances vs the previous system's closing balances — deposits (with the
 * tax the previous system already declared), in-house folio balances and receivables. A 1-minor-unit difference
 * fails reconciliation and becomes a finance exception; nothing is ever plugged or posted twice; orphan money is
 * held back as an exception that only finance (or, for a loss, the decision-maker) can close.
 */
import { sql, withTenantTx } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migration, sampleGuesthouseFiles, sampleGuesthousePack } from '../src';
import { db } from '../src/service/context';
import { ALL_MIGRATION, asSystem, type Harness, type Org, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const FIN = ['migration.job.read', 'migration.mapping.review', 'migration.finance.signoff'];

async function rehearse(org: Org, override: Record<string, string[][]>) {
  const lead = org.user(
    'Lead',
    ALL_MIGRATION.filter((p) => p !== 'migration.finance.signoff' && p !== 'migration.production.authorize'),
  );
  const job = await org.run(
    (tx) =>
      migration.createJob(tx, h.deps, {
        propertyId: org.propertyId,
        sourceAdapter: 'portico.pack.v1',
        sourceSystem: 'Sheets',
      }),
    lead,
  );
  await migration.uploadFiles(h.t.db, h.deps, lead, job.id, {
    files: sampleGuesthouseFiles(org.businessDate, override),
  });
  await migration.runPipeline(h.t.db, h.deps, lead, job.id);
  await org.run(
    (tx) =>
      migration.reviewMapping(tx, h.deps, job.id, {
        taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }],
      }),
    org.user('Finance', FIN),
  );
  const run = await migration.runPipeline(h.t.db, h.deps, lead, job.id);
  return { lead, jobId: job.id, run };
}

const openExceptions = (org: Org, jobId: string) =>
  withTenantTx(h.t.db, org.admin, (tx) =>
    db(tx)
      .selectFrom('migration.exceptions')
      .select(['id', 'code', 'source_key', 'severity', 'financial', 'owner_role', 'version'])
      .where('job_id', '=', jobId)
      .where('status', 'in', ['open', 'in_progress'])
      .where('severity', '=', 'blocking')
      .execute(),
  );

describe('S18: opening balances against the previous system’s closing balances', () => {
  it('deposits 1 minor unit off the reported closing balance: not reconciled, a finance exception, never plugged', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const control = sampleGuesthousePack(org.businessDate).control_totals.map((r) =>
      r[0] === 'deposit' ? ['deposit', 'USD', '2', '300.01'] : r,
    );
    const { jobId, run } = await rehearse(org, { control_totals: control });
    expect(run.executed.at(-1)).toMatchObject({ step: 'reconcile', status: 'waiting' });
    const ex = await openExceptions(org, jobId);
    expect(ex.map((e) => [e.code, e.owner_role])).toEqual(
      expect.arrayContaining([
        ['closing_balance_difference_USD', 'Finance controller'],
        ['reconcile_closing_balance', 'Finance controller'],
      ]),
    );
    const [report] = await org.run((tx) => migration.latestReports(tx, jobId, 1));
    const full = await withTenantTx(h.t.db, org.admin, (tx) =>
      db(tx)
        .selectFrom('migration.reports')
        .select('result')
        .where('id', '=', report?.id as string)
        .executeTakeFirstOrThrow(),
    );
    expect((full.result as { controlTotals: unknown[] }).controlTotals).toContainEqual({
      dataClass: 'deposit',
      currency: 'USD',
      reported: 30001,
      sourceDetail: 30000,
      portico: 30000,
      excluded: 0,
      unexplainedMinor: 1,
    });
    // Finance itself also reports the difference (its own S18 exception) and posted exactly the source amounts.
    const finEx = await org.run((tx) =>
      h.finance.listExceptions(asSystem(tx), { propertyId: org.propertyId }),
    );
    expect(finEx.map((e) => e.kind)).toContain('opening_balance_difference');
    // Opening balances cannot be confirmed on a report that does not reconcile.
    await expect(
      org.run(
        (tx) =>
          migration.completeChecklistItem(tx, jobId, 'opening_balances', { status: 'done', evidence: {} }),
        org.user('Finance', FIN),
      ),
    ).rejects.toBeTruthy();
  });

  it('no double tax: the tax the previous system declared on a deposit is carried as declared, not declared again', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const { jobId } = await rehearse(org, {});
    const bookingId = await org.run(
      async (tx) =>
        (await migration.loadLedger(tx, await migration.getJob(tx, jobId))).get('reservation:CN1001')
          ?.targetId as string,
    );
    const rows = await sql<{
      declared_tax: Record<string, number>;
      balance_minor: string | number;
      tgst_posted: string | number;
    }>`
      select d.declared_tax, d.balance_minor,
             (select coalesce(sum(l.amount_minor), 0) from finance.journal_lines l join finance.accounts a on a.id = l.account_id
               where a.system_key = 'tax:tgst' and a.tenant_id = ${org.tenantId}) as tgst_posted
        from finance.deposit_accounts d where d.booking_id = ${bookingId}`.execute(h.t.admin.kysely);
    const row = rows.rows[0];
    expect(row?.declared_tax).toEqual({ tgst: 1453 });
    expect(Number(row?.balance_minor)).toBe(10000);
    expect(Number(row?.tgst_posted)).toBe(0); // nothing declared again on the TGST payable account
  });

  it('in-house folio balances and receivables reconcile per item, per account and per aging bucket', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const { jobId, run } = await rehearse(org, {});
    expect(run.executed.map((e) => e.status).at(-2)).toBe('succeeded');
    const [report] = await org.run((tx) => migration.latestReports(tx, jobId, 1));
    const full = await withTenantTx(h.t.db, org.admin, (tx) =>
      db(tx)
        .selectFrom('migration.reports')
        .select('result')
        .where('id', '=', report?.id as string)
        .executeTakeFirstOrThrow(),
    );
    const measures = (
      full.result as {
        measures: Array<{
          dataClass: string;
          measure: string;
          source: number;
          portico: number;
          equal: boolean;
        }>;
      }
    ).measures;
    expect(
      measures.filter(
        (m) =>
          m.dataClass !== 'reservation' &&
          m.dataClass !== 'unit' &&
          m.dataClass !== 'unit_type' &&
          m.dataClass !== 'guest',
      ),
    ).toEqual([
      {
        dataClass: 'ar_open_item',
        measure: 'aging TRAVCO 1-30',
        currency: 'USD',
        source: 125000,
        portico: 125000,
        equal: true,
      },
      {
        dataClass: 'ar_open_item',
        measure: 'aging TRAVCO current',
        currency: 'USD',
        source: 64000,
        portico: 64000,
        equal: true,
      },
      {
        dataClass: 'ar_open_item',
        measure: 'total held',
        currency: 'USD',
        source: 189000,
        portico: 189000,
        equal: true,
      },
      {
        dataClass: 'deposit',
        measure: 'total held',
        currency: 'USD',
        source: 30000,
        portico: 30000,
        equal: true,
      },
      {
        dataClass: 'in_house_balance',
        measure: 'total held',
        currency: 'USD',
        source: 34000,
        portico: 34000,
        equal: true,
      },
    ]);
  });

  it('a deposit for a booking that is not in the export is held back; only finance decides; a loss needs the decision-maker', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const pack = sampleGuesthousePack(org.businessDate);
    const { jobId, run } = await rehearse(org, {
      deposits: [...pack.deposits, ['CN9999', '50.00', 'USD', '', '', '']],
      control_totals: pack.control_totals.map((r) =>
        r[0] === 'deposit' ? ['deposit', 'USD', '3', '350.00'] : r,
      ),
    });
    // The orphan is a listed exclusion: the closing balance still agrees, the rehearsal is exact …
    expect(run.executed.find((e) => e.step === 'reconcile')?.status).toBe('succeeded');
    // … but the money is not called migrated: a blocking financial exception stays open for the cutover gate.
    const [orphan] = (await openExceptions(org, jobId)).filter((e) => e.code === 'deposit_without_booking');
    expect(orphan).toMatchObject({ source_key: 'CN9999', financial: true, owner_role: 'Finance controller' });
    const lead = org.user('Lead', ['migration.job.read', 'migration.exception.manage']);
    await expect(
      org.run(
        (tx) =>
          migration.resolveException(tx, orphan?.id as string, {
            outcome: 'excluded',
            resolution: 'not ours',
          }),
        lead,
      ),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      org.run(
        (tx) =>
          migration.resolveException(tx, orphan?.id as string, {
            outcome: 'accepted_as_loss',
            resolution: 'write off',
          }),
        org.user('Finance', FIN),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      org.run(
        (tx) =>
          migration.resolveException(tx, orphan?.id as string, {
            outcome: 'import_as_is',
            resolution: 'import',
          }),
        org.user('Finance', FIN),
      ),
    ).rejects.toMatchObject({ code: 'cannot_import_as_is' });
    const decided = await org.run(
      (tx) =>
        migration.resolveException(tx, orphan?.id as string, {
          outcome: 'excluded',
          resolution: 'Refunded in the old system before the export; bank statement 2026-11-28.',
        }),
      org.user('Finance', FIN),
    );
    expect(decided).toMatchObject({ state: 'excluded' });
    await migration.runPipeline(h.t.db, h.deps, org.user('Lead', ALL_MIGRATION), jobId);
    const l = await org.run(async (tx) =>
      (await migration.loadLedger(tx, await migration.getJob(tx, jobId))).get('deposit:CN9999'),
    );
    expect(l?.state).toBe('excluded');
  });

  it('a deposit that changes in the source after it was posted is an exception — never posted a second time', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const { lead, jobId } = await rehearse(org, {});
    const pack = sampleGuesthousePack(org.businessDate);
    await migration.uploadFiles(h.t.db, h.deps, lead, jobId, {
      files: sampleGuesthouseFiles(org.businessDate, {
        deposits: pack.deposits.map((r) =>
          r[0] === 'CN1001' ? ['CN1001', '150.00', 'USD', '14.53', 'TGST', r[5] as string] : r,
        ),
      }),
    });
    await migration.runPipeline(h.t.db, h.deps, lead, jobId);
    const ex = await openExceptions(org, jobId);
    expect(ex.map((e) => `${e.code}:${e.source_key}`)).toContain('opening_balance_changed:CN1001');
    const bookingId = await org.run(
      async (tx) =>
        (await migration.loadLedger(tx, await migration.getJob(tx, jobId))).get('reservation:CN1001')
          ?.targetId as string,
    );
    expect((await org.run((tx) => h.finance.getDeposits(asSystem(tx), bookingId)))?.balance.amountMinor).toBe(
      10000,
    );
  });
});

describe('finance decides an unclear booking', () => {
  it('a booking marked prepaid without a deposit waits; finance may import it as is; it is then imported once', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const pack = sampleGuesthousePack(org.businessDate);
    const { lead, jobId } = await rehearse(org, {
      deposits: pack.deposits.filter((d) => d[0] !== 'CN1008'),
      control_totals: pack.control_totals.map((r) =>
        r[0] === 'deposit' ? ['deposit', 'USD', '1', '100.00'] : r,
      ),
    });
    const ex = (await openExceptions(org, jobId)).find((e) => e.code === 'prepaid_without_deposit');
    expect(ex).toMatchObject({ source_key: 'CN1008' });
    expect(
      await org.run(
        async (tx) =>
          (await migration.loadLedger(tx, await migration.getJob(tx, jobId))).get('reservation:CN1008')
            ?.state,
      ),
    ).toBe('exception');
    await org.run(
      (tx) =>
        migration.resolveException(tx, ex?.id as string, {
          outcome: 'import_as_is',
          resolution: 'Guaranteed by the company; no deposit was taken (confirmed with the controller).',
        }),
      org.user('Finance', FIN),
    );
    await migration.runPipeline(h.t.db, h.deps, lead, jobId);
    const l = await org.run(async (tx) =>
      (await migration.loadLedger(tx, await migration.getJob(tx, jobId))).get('reservation:CN1008'),
    );
    expect(l?.state).toBe('imported');
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(8);
  });
});
