/**
 * Cross-organization rehearsal ("one button" from the live organization): a production job rehearses in the hotel's
 * linked TRIAL organization with the same importer, plan and extract — so the trial copy (provenance `copied`) is
 * reconciled exactly twice before anything touches the live organization.
 *
 * Like trial provisioning, this spans two tenants, so it is bound only in the composition root. It never reads the
 * live organization's data from the trial side or vice versa: the live job passes its plan, decisions and extract;
 * the trial side returns evidence (fingerprints, exactness). It is refused unless the trial organization is a trial
 * that belongs to the calling live organization (platform's trial lifecycle record), and it runs inside the trial
 * organization with environment `trial` (every effect simulated or blocked by the kernel policy).
 */
import { type PorticoDatabase, sql, type TxContext, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  ForbiddenError,
  newId,
  type RequestContext,
  systemContext,
} from '@portico/kernel';
import type { MigrationPlan } from './domain/mapping';
import { initialSteps } from './domain/pipeline';
import { DATA_CLASSES, type SourceRecord } from './domain/records';
import type { MigrationPorts, RehearsalEvidence, RehearsalPort, RehearsalRequest } from './ports';
import { db, loadJob, type MigrationDeps, saveJob, toJob } from './service/context';
import { storeExtract } from './service/extract';
import { runPipeline } from './service/pipeline';
import { latestReports } from './service/reconcile';

async function trialContext(
  database: PorticoDatabase,
  ports: MigrationPorts,
  live: TxContext,
  trialOrganizationId: string,
): Promise<RequestContext> {
  if (live.environment !== 'live' || trialOrganizationId === live.tenantId)
    throw new BusinessRuleError(
      'rehearsal_link_invalid',
      'A live migration rehearses in a separate trial organization.',
    );
  const { rows } = await sql<{
    env: string | null;
  }>`select platform.tenant_environment(${trialOrganizationId}::uuid) as env`.execute(database.kysely);
  if (rows[0]?.env !== 'trial')
    throw new BusinessRuleError(
      'rehearsal_org_not_trial',
      'The linked organization is not an open trial organization. Link the trial created for this hotel.',
    );
  const ctx = systemContext(trialOrganizationId, 'migration-rehearsal', 'trial', live.correlationId);
  const owner = await withTenantTx(database, ctx, (tx) => ports.platform.trialSourceOrganization(tx));
  if (!owner || owner.organizationId !== live.tenantId || owner.status !== 'active')
    throw new ForbiddenError('migration.rehearsal.trial', { trialOrganizationId });
  return ctx;
}

/** Map the live plan's reviewed decisions onto the trial organization (targets by CODE, ids re-resolved there). */
async function trialPlan(
  tx: TxContext,
  ports: MigrationPorts,
  propertyId: string,
  live: MigrationPlan,
): Promise<MigrationPlan> {
  const types = await ports.inventory.listUnitTypes(tx, propertyId);
  const plans = await ports.rates.listRatePlans(tx, propertyId);
  return {
    ...live,
    unitTypes: live.unitTypes.map((u) => ({
      ...u,
      targetId: u.action === 'map' ? (types.find((t) => t.code === u.targetCode)?.id ?? null) : null,
    })),
    ratePlans: live.ratePlans.map((r) => ({
      ...r,
      targetId: r.action === 'map' ? (plans.find((p) => p.code === r.targetCode)?.id ?? null) : null,
    })),
  };
}

export function createRehearsalBridge(
  database: PorticoDatabase,
  deps: () => MigrationDeps & { decisions?: (tx: TxContext, jobId: string) => Promise<unknown[]> },
): RehearsalPort {
  return {
    async rehearse(live, input: RehearsalRequest): Promise<RehearsalEvidence> {
      const d = deps();
      const ctx = await trialContext(database, d.ports, live, input.trialOrganizationId);
      const jobId = await withTenantTx(database, ctx, async (tx) => {
        await d.ports.platform.getProperty(tx, input.trialPropertyId);
        const plan = await trialPlan(tx, d.ports, input.trialPropertyId, input.plan as MigrationPlan);
        let row = await db(tx)
          .selectFrom('migration.jobs')
          .selectAll()
          .where(sql<boolean>`live_job_ref ->> 'jobId' = ${input.liveJobId}`)
          .forUpdate()
          .executeTakeFirst();
        if (!row) {
          const id = newId(tx.now.getTime());
          row = await db(tx)
            .insertInto('migration.jobs')
            .values({
              id,
              tenant_id: tx.tenantId,
              property_id: input.trialPropertyId,
              purpose: 'rehearsal',
              environment: 'trial',
              source_adapter: input.sourceAdapter,
              source_system: input.sourceSystem,
              source_ref: null,
              source_identity: id,
              state: 'draft',
              steps: JSON.stringify(initialSteps()),
              step_detail: '{}',
              plan: JSON.stringify(plan),
              plan_fingerprint: null,
              domains: [],
              rehearsal_link: null,
              live_job_ref: JSON.stringify({ organizationId: live.tenantId, jobId: input.liveJobId }),
              certificate: null,
              transition_id: null,
              rollback_transition_id: null,
              cutover_planned_at: null,
              frozen_at: null,
              switched_at: null,
              opened_at: null,
              freeze_minutes: null,
              rollback_window_ends_at: null,
              rolled_back_at: null,
              running_until: null,
              running_by: null,
              owner_user_id: null,
              created_by: 'system:migration-rehearsal',
              created_at: tx.now,
              updated_at: tx.now,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          await tx.audit({
            action: 'migration.job.create',
            target: { type: 'migration_job', id },
            propertyId: input.trialPropertyId,
            after: { purpose: 'rehearsal', liveJobId: input.liveJobId, liveOrganizationId: live.tenantId },
          });
        }
        let job = toJob(row);
        job = await saveJob(tx, job, { plan });
        await storeExtract(tx, job, {
          kind: (await db(tx)
            .selectFrom('migration.extracts')
            .select('seq')
            .where('job_id', '=', job.id)
            .executeTakeFirst())
            ? 'delta'
            : 'initial',
          source: {
            type: 'records',
            name: `live job ${input.liveJobId}, extract ${input.extract.seq}`,
            records: input.extract.records as SourceRecord[],
            controlTotals: input.extract.controlTotals as never[],
            // The live state is complete: a class it no longer holds is gone from the rehearsal too.
            classes: [...DATA_CLASSES],
          },
        });
        // Decisions mirror the live job exactly: a decision the live job no longer holds is withdrawn here.
        const liveDecisions = new Set(input.decisions.map((x) => `${x.dataClass}|${x.sourceKey}|${x.code}`));
        const trialDecided = await db(tx)
          .selectFrom('migration.exceptions')
          .select(['id', 'data_class', 'source_key', 'code'])
          .where('job_id', '=', job.id)
          .where('outcome', 'in', ['import_as_is', 'excluded', 'accepted_as_loss', 'deferred'])
          .execute();
        for (const t of trialDecided)
          if (!liveDecisions.has(`${t.data_class}|${t.source_key}|${t.code}`))
            await db(tx)
              .updateTable('migration.exceptions')
              .set((eb) => ({
                status: 'open',
                outcome: null,
                resolution: null,
                closed_by: null,
                closed_at: null,
                version: eb('version', '+', 1),
              }))
              .where('id', '=', t.id)
              .execute();
        for (const dec of input.decisions) {
          await db(tx)
            .insertInto('migration.exceptions')
            .values({
              id: newId(tx.now.getTime()),
              tenant_id: tx.tenantId,
              job_id: job.id,
              property_id: job.propertyId,
              data_class: dec.dataClass,
              source_key: dec.sourceKey,
              code: dec.code,
              severity: 'blocking',
              financial: false,
              problem: 'Decided in the live migration.',
              impact: 'Applied to the rehearsal so it imports exactly what the cutover will.',
              proposed_resolution: '—',
              owner_role: 'Migration lead',
              owner_user_id: null,
              due_at: null,
              status: dec.outcome === 'import_as_is' ? 'resolved' : dec.outcome,
              outcome: dec.outcome as 'import_as_is' | 'excluded' | 'accepted_as_loss' | 'deferred',
              resolution: dec.resolution ?? 'Decided in the live migration',
              closed_by: 'system:migration-rehearsal',
              closed_at: tx.now,
              first_seen_at: tx.now,
              last_seen_at: tx.now,
            })
            .onConflict((oc) =>
              oc.columns(['job_id', 'data_class', 'source_key', 'code']).doUpdateSet({
                status: dec.outcome === 'import_as_is' ? 'resolved' : dec.outcome,
                outcome: dec.outcome as 'import_as_is' | 'excluded' | 'accepted_as_loss' | 'deferred',
                resolution: dec.resolution ?? 'Decided in the live migration',
                closed_at: tx.now,
              }),
            )
            .execute();
        }
        return job.id;
      });
      await runPipeline(database, d, ctx, jobId, { maxSteps: 12 });
      return evidenceOf(database, ctx, jobId);
    },
    async evidence(live, input) {
      const d = deps();
      const ctx = await trialContext(database, d.ports, live, input.trialOrganizationId);
      const jobId = await withTenantTx(database, ctx, async (tx) => {
        const row = await db(tx)
          .selectFrom('migration.jobs')
          .select('id')
          .where(sql<boolean>`live_job_ref ->> 'jobId' = ${input.liveJobId}`)
          .executeTakeFirst();
        return row?.id ?? null;
      });
      return jobId ? evidenceOf(database, ctx, jobId) : null;
    },
  };
}

async function evidenceOf(
  database: PorticoDatabase,
  ctx: RequestContext,
  jobId: string,
): Promise<RehearsalEvidence> {
  return withTenantTx(database, ctx, async (tx) => {
    const job = await loadJob(tx, jobId);
    const reports = await latestReports(tx, jobId, 2);
    const cert = job.certificate as {
      planFingerprint?: string;
      extractFingerprint?: string;
      dataFingerprint?: string;
      certifiedAt?: string;
    } | null;
    return {
      organizationId: ctx.tenantId,
      jobId,
      planFingerprint: cert?.planFingerprint ?? job.planFingerprint ?? '',
      extractFingerprint: cert?.extractFingerprint ?? '',
      dataFingerprint: cert?.dataFingerprint ?? '',
      exact: !!cert?.certifiedAt,
      reports: reports
        .map((r) => ({
          seq: r.seq,
          fingerprint: r.fingerprint,
          exact: r.exact,
          generatedAt: r.generated_at.toISOString(),
        }))
        .reverse(),
      certifiedAt: cert?.certifiedAt ?? null,
    };
  });
}
