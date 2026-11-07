/**
 * Security and privacy: card numbers never stored (MG-02), masked exports never imported as truth, tenant isolation
 * (S17: another organization cannot see or touch a migration by id), deny-by-default permissions with property scope,
 * and no personal data in the events migration emits.
 */
import { sql, withTenantTx } from '@portico/db';
import { testContext } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migration, sampleGuesthouseFiles, sampleGuesthousePack } from '../src';
import { db } from '../src/service/context';
import { ALL_MIGRATION, type Harness, type Org, setupOrg, startHarness } from './harness';

let h: Harness;
let a: Org;
let b: Org;
let jobId: string;
beforeAll(async () => {
  h = await startHarness();
  a = await setupOrg(h, { environment: 'trial' });
  b = await setupOrg(h, { environment: 'trial' });
  const job = await a.run((tx) =>
    migration.createJob(tx, h.deps, {
      propertyId: a.propertyId,
      sourceAdapter: 'portico.pack.v1',
      sourceSystem: 'Sheets',
    }),
  );
  jobId = job.id;
});
afterAll(async () => h?.close());

describe('MG-02: a file containing a card number is refused before anything is stored', () => {
  it('refuses the whole upload, stores nothing, audits the refusal with positions only', async () => {
    const pack = sampleGuesthousePack(a.businessDate);
    const files = sampleGuesthouseFiles(a.businessDate, {
      guests: pack.guests.map((g, i) =>
        i === 2 ? [...g.slice(0, 4), 'Visa 4111 1111 1111 1111', ...g.slice(5)] : g,
      ),
    });
    await expect(migration.uploadFiles(h.t.db, h.deps, a.admin, jobId, { files })).rejects.toMatchObject({
      code: 'card_data_in_file',
      message: expect.stringMatching(/guests\.csv, row 3, column "phone".*Nothing from it was stored/),
    });
    const stored = await withTenantTx(h.t.db, a.admin, async (tx) => ({
      extracts: await db(tx)
        .selectFrom('migration.extracts')
        .select('seq')
        .where('job_id', '=', jobId)
        .execute(),
      records: await db(tx)
        .selectFrom('migration.source_records')
        .select('source_key')
        .where('job_id', '=', jobId)
        .execute(),
    }));
    expect(stored).toEqual({ extracts: [], records: [] });
    const { rows } = await sql<{ action: string; metadata: unknown }>`
      select action, metadata from core.audit_log where tenant_id = ${a.tenantId} and action = 'migration.upload.refusedCardData'`.execute(
      h.t.admin.kysely,
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.metadata)).toContain('"row":3');
    expect(JSON.stringify(rows[0]?.metadata)).not.toMatch(/4111/);
    // The preview refuses it too (it never returns data from such a file).
    await expect(
      migration.uploadFiles(h.t.db, h.deps, a.admin, jobId, { files, preview: true }),
    ).rejects.toMatchObject({
      code: 'card_data_in_file',
    });
  });
});

describe('masked exports', () => {
  it('a masked export is refused as truth: masked records wait, the whole export is flagged', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const lead = org.user('Lead', ALL_MIGRATION);
    const job = await org.run(
      (tx) =>
        migration.createJob(tx, h.deps, {
          propertyId: org.propertyId,
          sourceAdapter: 'portico.pack.v1',
          sourceSystem: 'OPERA export (masked)',
        }),
      lead,
    );
    const pack = sampleGuesthousePack(org.businessDate);
    await migration.uploadFiles(h.t.db, h.deps, lead, job.id, {
      files: sampleGuesthouseFiles(org.businessDate, {
        guests: pack.guests.map((g) => [g[0] as string, 'X****', 'XXXXXXXX', '', '', ...g.slice(5)]),
        reservations: pack.reservations.map((r) => [...r.slice(0, 7), '********', ...r.slice(8)]),
      }),
    });
    await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    await org.run(
      (tx) =>
        migration.reviewMapping(tx, h.deps, job.id, {
          taxAccounts: [{ sourceCode: 'TGST', accountKey: 'tgst' }],
        }),
      lead,
    );
    await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    const ex = await withTenantTx(h.t.db, org.admin, (tx) =>
      db(tx)
        .selectFrom('migration.exceptions')
        .select(['code', 'severity'])
        .where('job_id', '=', job.id)
        .where('status', '=', 'open')
        .execute(),
    );
    expect(ex).toContainEqual({ code: 'masked_export', severity: 'blocking' });
    expect(ex.filter((e) => e.code === 'masked_identity').length).toBe(14);
    expect(await org.run((tx) => h.reservations.count(tx, org.propertyId))).toBe(0);
  });
});

describe('S17: tenant isolation and deny-by-default', () => {
  it('another organization cannot read, run, upload to or list exceptions of a migration by id', async () => {
    await expect(b.run((tx) => migration.loadJobFor(tx, jobId, 'migration.job.read'))).rejects.toMatchObject({
      code: 'migration_job_not_found',
    });
    await expect(migration.runPipeline(h.t.db, h.deps, b.admin, jobId)).rejects.toMatchObject({
      code: 'migration_job_not_found',
    });
    await expect(
      migration.uploadFiles(h.t.db, h.deps, b.admin, jobId, { files: sampleGuesthouseFiles(b.businessDate) }),
    ).rejects.toMatchObject({ code: 'migration_job_not_found' });
    await expect(
      b.run((tx) => migration.listExceptions(tx, jobId, { status: 'all', limit: 10 })),
    ).rejects.toMatchObject({ code: 'migration_job_not_found' });
    // Raw SQL under RLS sees nothing either.
    const rows = await withTenantTx(h.t.db, b.admin, (tx) =>
      sql`select id from migration.jobs where id = ${jobId}`.execute(tx.db),
    );
    expect(rows.rows).toEqual([]);
  });

  it('no permission → not found; read-only → refused to change; another property’s grant → not found', async () => {
    const nobody = a.user('Nobody', []);
    await expect(
      a.run((tx) => migration.loadJobFor(tx, jobId, 'migration.job.read'), nobody),
    ).rejects.toMatchObject({
      code: 'migration_job_not_found',
    });
    const reader = a.user('Reader', ['migration.job.read']);
    const view = await a.run(
      async (tx) => migration.jobView(tx, await migration.loadJobFor(tx, jobId, 'migration.job.read')),
      reader,
    );
    expect(view.allowedActions.find((x) => x.action === 'run')).toMatchObject({
      enabled: false,
      reason: 'You need migration.job.manage.',
    });
    await expect(migration.runPipeline(h.t.db, h.deps, reader, jobId)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      a.run(
        (tx) =>
          migration.createJob(tx, h.deps, {
            propertyId: a.propertyId,
            sourceAdapter: 'portico.pack.v1',
            sourceSystem: 'X',
          }),
        reader,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const other = crypto.randomUUID();
    const scoped = testContext({
      tenantId: a.tenantId,
      environment: 'trial',
      grants: ALL_MIGRATION.map((permission) => ({ permission, propertyIds: [other] })),
    });
    await expect(
      a.run((tx) => migration.loadJobFor(tx, jobId, 'migration.job.read'), scoped),
    ).rejects.toMatchObject({
      code: 'migration_job_not_found',
    });
    expect(await a.run((tx) => migration.listJobs(tx, {}), scoped)).toEqual([]);
  });

  it('events carry ids and statuses only — never guest names, emails or amounts per person', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const lead = org.user('Lead', ALL_MIGRATION);
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
      files: sampleGuesthouseFiles(org.businessDate),
    });
    await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    const { rows } = await sql<{ type: string; payload: unknown }>`
      select type, payload from core.outbox where tenant_id = ${org.tenantId} and type like 'migration.%'`.execute(
      h.t.admin.kysely,
    );
    expect(rows.length).toBeGreaterThan(3);
    expect(JSON.stringify(rows)).not.toMatch(/Rasheed|Lindqvist|example\.test|\+960/);
  });
});
