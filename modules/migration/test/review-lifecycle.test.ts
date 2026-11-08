/**
 * Regression tests from the steward review (fix round 1), end-of-life of copies: the retention purge reaches the
 * rehearsal copy in the trial organization (R-P1-6), housekeeping visits every tenant and reports failures (R-P2-7),
 * and a second production migration of the same property from another source is refused (R-P1-7). PoCs from
 * `docs/orchestration/reviews/migration-poc/zz-review-integration.test.ts.txt`, inverted.
 */
import { sql, withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MigrationDeps, migration, migrationHousekeeping } from '../src';
import { db } from '../src/service/context';
import { productionInSync } from './flows';
import { type Harness, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const DAY = 86_400_000;

async function trialState(f: Awaited<ReturnType<typeof productionInSync>>) {
  return withTenantTx(h.t.db, f.trial.admin, async (tx) => ({
    jobs: await db(tx).selectFrom('migration.jobs').select(['state', 'purged_at']).execute(),
    records: Number(
      (
        await sql<{ n: string }>`select count(*)::text as n from migration.source_records
          where payload::text like '%Rasheed%'`.execute(tx.db)
      ).rows[0]?.n,
    ),
    payloads: Number(
      (
        await sql<{ n: string }>`select count(*)::text as n from migration.extract_payloads
          where content::text like '%aisha.rasheed@example.test%'`.execute(tx.db)
      ).rows[0]?.n,
    ),
  }));
}

async function age(org: { tenantId: string }, days: number) {
  await sql`update migration.jobs set updated_at = now() - ${`${days} days`}::interval
    where tenant_id = ${org.tenantId}`.execute(h.t.admin.kysely);
}

describe('R-P1-6 the 30-day purge reaches the rehearsal copy in the trial organization', () => {
  it('cancelling the live job ends the trial copy at once; 31 days later both are purged', async () => {
    const f = await productionInSync(h, { stopAt: 'signoff' });
    expect((await trialState(f)).jobs).toEqual([{ state: 'rehearsed', purged_at: null }]);
    await f.live.run((tx) => migration.cancelJob(tx, h.deps, f.jobId, 'Hotel postponed the move'), f.lead);
    // Closed through the bridge after the live transaction committed.
    expect((await trialState(f)).jobs).toEqual([{ state: 'cancelled', purged_at: null }]);
    await age(f.live, 31);
    await age(f.trial, 31);
    const out = await migrationHousekeeping(h.t.db);
    expect(out.failedTenants).toEqual([]);
    const after = await trialState(f);
    expect(after.jobs[0]?.purged_at).not.toBeNull();
    expect(after.records).toBe(0);
    expect(after.payloads).toBe(0);
    const liveLeft = await f.live.run((tx) =>
      sql<{ n: string }>`select count(*)::text as n from migration.source_records
        where job_id = ${f.jobId} and payload::text like '%Rasheed%'`.execute(tx.db),
    );
    expect(liveLeft.rows[0]?.n).toBe('0');
  });

  it('when the trial cannot be reached at the end, housekeeping in the trial ends the copy later', async () => {
    const f = await productionInSync(h, { stopAt: 'signoff' });
    const unreachable: MigrationDeps = {
      ...h.deps,
      ports: {
        ...h.deps.ports,
        rehearsal: {
          ...h.deps.ports.rehearsal,
          close: async () => {
            throw new Error('trial unreachable');
          },
        },
      },
    };
    await f.live.run((tx) => migration.cancelJob(tx, unreachable, f.jobId, 'Postponed'), f.lead);
    expect((await trialState(f)).jobs[0]?.state).toBe('rehearsed');
    const out = await migrationHousekeeping(h.t.db);
    expect(out.copiesEnded).toBeGreaterThanOrEqual(1);
    expect((await trialState(f)).jobs[0]?.state).toBe('cancelled');
  });

  it('attack: the live job no longer exists (organization deleted) → the trial copy is ended and purged at once', async () => {
    const f = await productionInSync(h, { stopAt: 'signoff' });
    // The mirror now points at a live job that does not exist (as after the live organization was deleted).
    await sql`update migration.jobs set live_job_ref = jsonb_set(live_job_ref, '{jobId}', to_jsonb(${newId()}::text))
      where tenant_id = ${f.trial.tenantId}`.execute(h.t.admin.kysely);
    await migrationHousekeeping(h.t.db);
    const s = await trialState(f);
    expect(s.jobs[0]?.state).toBe('cancelled');
    expect(s.jobs[0]?.purged_at).not.toBeNull();
    expect(s.records + s.payloads).toBe(0);
  });

  it('a closed trial organization: its migrations source data is purged at once', async () => {
    const f = await productionInSync(h, { stopAt: 'signoff' });
    await sql`update platform.tenant_directory set status = 'closed' where id = ${f.trial.tenantId}`.execute(
      h.t.admin.kysely,
    );
    await migrationHousekeeping(h.t.db);
    const rows = await sql<{ purged_at: Date | null }>`select purged_at from migration.jobs
      where tenant_id = ${f.trial.tenantId}`.execute(h.t.admin.kysely);
    expect(rows.rows.every((r) => r.purged_at !== null)).toBe(true);
    const left = await sql<{ n: string }>`select count(*)::text as n from migration.source_records
      where tenant_id = ${f.trial.tenantId} and payload is not null`.execute(h.t.admin.kysely);
    expect(left.rows[0]?.n).toBe('0');
  });

  it('a failed job is purged after the retention period too', async () => {
    const f = await productionInSync(h, { stopAt: 'signoff' });
    await sql`update migration.jobs set state = 'failed', updated_at = now() - interval '31 days'
      where id = ${f.jobId}`.execute(h.t.admin.kysely);
    await migrationHousekeeping(h.t.db);
    const job = await f.live.run((tx) =>
      db(tx)
        .selectFrom('migration.jobs')
        .select('purged_at')
        .where('id', '=', f.jobId)
        .executeTakeFirstOrThrow(),
    );
    expect(job.purged_at).not.toBeNull();
  });
});

describe('R-P2-7 housekeeping visits every tenant (paged by tenant id) and reports failures', () => {
  it('with a page of one, every tenant with open work is still visited in one run', async () => {
    await productionInSync(h, { stopAt: 'signoff' });
    const { rows } = await sql<{ n: string }>`select count(distinct tenant_id)::text as n from migration.jobs
      where state not in ('completed', 'rolled_back', 'cancelled', 'failed') or purged_at is null`.execute(
      h.t.admin.kysely,
    );
    const out = await migrationHousekeeping(h.t.db, { page: 1 });
    expect(out.tenants).toBeGreaterThanOrEqual(Number(rows[0]?.n) - 1);
    expect(out.tenants).toBeGreaterThanOrEqual(2);
    expect(out.failedTenants).toEqual([]);
  });

  it('a failing tenant does not stop the others, and the scheduled run is recorded as failed', async () => {
    const { migrationJobs } = await import('../src');
    const f = await productionInSync(h, { stopAt: 'signoff' });
    // Break one tenant's housekeeping: a rehearsal reference that is not a job id makes its run throw.
    await sql`update migration.jobs set live_job_ref = '{"organizationId": "x", "jobId": "not-a-uuid"}'::jsonb
      where id = ${f.jobId}`.execute(h.t.admin.kysely);
    const out = await migrationHousekeeping(h.t.db);
    expect(out.failedTenants).toContain(f.live.tenantId);
    expect(out.tenants).toBeGreaterThan(1);
    const job = migrationJobs()[0];
    await expect(job?.run(h.t.db, new Date())).rejects.toThrow(/housekeeping failed/);
    await sql`update migration.jobs set live_job_ref = null, state = 'cancelled' where id = ${f.jobId}`.execute(
      h.t.admin.kysely,
    );
  });
});

describe('R-P1-7 a second production migration of the same property from another source is refused', () => {
  it('after a completed migration, another adapter is refused; the same source may run again (ledger dedupes)', async () => {
    const f = await productionInSync(h);
    await migration.runPipeline(h.t.db, h.deps, f.lead, f.jobId, { start: 'freeze' });
    await f.live.run((tx) =>
      db(tx)
        .updateTable('migration.jobs')
        .set({ rollback_window_ends_at: new Date(Date.now() - 60_000) })
        .where('id', '=', f.jobId)
        .execute(),
    );
    await migrationHousekeeping(h.t.db);
    expect((await f.live.run((tx) => migration.getJob(tx, f.jobId))).state).toBe('completed');
    await expect(
      f.live.run(
        (tx) =>
          migration.createJob(tx, h.deps, {
            propertyId: f.live.propertyId,
            sourceAdapter: 'littlehotelier.csv',
            sourceSystem: 'Little Hotelier (same hotel)',
          }),
        f.lead,
      ),
    ).rejects.toMatchObject({ code: 'property_already_migrated' });
    const same = await f.live.run(
      (tx) =>
        migration.createJob(tx, h.deps, {
          propertyId: f.live.propertyId,
          sourceAdapter: 'portico.pack.v1',
          sourceSystem: 'Coral Nest spreadsheets (late items)',
        }),
      f.lead,
    );
    expect(same.purpose).toBe('production');
    // The closed job says what to do instead of inviting a duplicate migration.
    await expect(
      f.live.run((tx) => migration.cancelJob(tx, h.deps, f.jobId, 'x'), f.lead),
    ).rejects.toMatchObject({ message: expect.stringMatching(/same source/) });
    expect(DAY).toBeGreaterThan(0);
  });
});
