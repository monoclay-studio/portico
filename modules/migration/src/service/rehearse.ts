/**
 * Rehearsal: a rehearsal job imports into its own (trial / sandbox) organization and certifies two consecutive exact
 * reconciliations; a production job rehearses through its linked trial organization. The certificate binds the plan
 * AND the data and decisions (R-P1-2): `rehearseAgain` re-runs the rehearsal whenever what would be cut over no
 * longer matches what was certified (a sync, a re-upload, a final capture, a decision).
 */
import { type PorticoDatabase, type TxContext, withTenantTx } from '@portico/db';
import { DomainError, newId, type RequestContext } from '@portico/kernel';
import { certificateFacts, certificateGap } from '../domain/certificate';
import { currentDataFingerprint, rehearsalPayload } from './certificate';
import { actorKey, db, type Job, loadJob, type MigrationDeps, saveJob } from './context';
import { importAll } from './importer';
import type { StepOutcome } from './pipeline';
import { buildReport, latestReports } from './reconcile';
import { countOpenBlocking, loadSourceRecords } from './state';

/** Rehearsal jobs import into their own (trial / sandbox) organization. */
export async function rehearseHere(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
  opts: { failAfter?: number },
): Promise<StepOutcome> {
  if (ctx.environment === 'live')
    throw new DomainError('rehearsal_in_live', 'Rehearsals never import into a live organization.', {
      status: 409,
    });
  const s = await importAll(
    database,
    deps,
    ctx,
    job.id,
    opts.failAfter === undefined ? {} : { failAfter: opts.failAfter },
  );
  if (ctx.environment === 'trial')
    await withTenantTx(database, ctx, async (tx) => {
      const counts: Record<string, number> = {};
      for (const r of await loadSourceRecords(tx, job.id))
        counts[r.dataClass] = (counts[r.dataClass] ?? 0) + 1;
      await deps.ports.platform.recordTrialImport(tx, {
        sourceSystem: job.sourceSystem,
        copiedAt: tx.now,
        recordCounts: counts,
      });
    });
  const detail = `${s.created} created, ${s.updated} updated, ${s.merged} linked, ${s.unchanged} unchanged, ${s.exceptions} waiting on exceptions, ${s.excluded} excluded.`;
  if (s.unavailable.length)
    return {
      status: 'waiting',
      detail: `${detail} Not available on this server yet: ${s.unavailable.join(', ')} (provider contract requested).`,
      owner: 'Monoclay onboarding lead',
    };
  return { status: 'succeeded', detail };
}

/** The rehearsal's first reconciliation (rehearsal jobs). */
export async function reconcileRehearsal(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  return withTenantTx(database, ctx, async (tx) => {
    const j = await loadJob(tx, job.id, { lock: true });
    const rep = await buildReport(tx, deps, j, 'rehearsal');
    const unexplained = rep.result.differences.filter((d) => !d.explained).length;
    return rep.result.exact
      ? ({
          status: 'succeeded',
          detail: `Report ${rep.seq}: exact (fingerprint ${rep.result.fingerprint}).`,
        } as const)
      : ({
          status: 'waiting',
          detail: `Report ${rep.seq}: ${unexplained} unexplained difference(s). Each is an exception with an owner.`,
          owner: 'Migration lead and finance controller',
        } as const);
  });
}

/** Second rehearsal: re-import (must change nothing) and reconcile again; two exact identical reports certify. */
export async function certify(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  const s = await importAll(database, deps, ctx, job.id);
  return withTenantTx(database, ctx, async (tx) => {
    const j = await loadJob(tx, job.id, { lock: true });
    const prev = (await latestReports(tx, j.id, 1))[0];
    const rep = await buildReport(tx, deps, j, 'certification');
    const changed = s.created + s.updated;
    if (!rep.result.exact || !prev?.exact || prev.fingerprint !== rep.result.fingerprint || changed > 0)
      return {
        status: 'waiting',
        detail: `The second rehearsal ${changed > 0 ? `changed ${changed} record(s)` : 'did not reproduce the first report'}; it must reconcile exactly twice in a row. Run it again after resolving the exceptions.`,
        owner: 'Migration lead',
      } as const;
    const extracts = await db(tx)
      .selectFrom('migration.extracts')
      .select(['seq', 'fingerprint'])
      .where('job_id', '=', j.id)
      .orderBy('seq', 'desc')
      .limit(1)
      .execute();
    const certificate = {
      planFingerprint: j.planFingerprint,
      extractFingerprint: extracts[0]?.fingerprint ?? null,
      // Binds the data and decisions this rehearsal imported (computed the same way the live gate computes it).
      dataFingerprint: await currentDataFingerprint(tx, j),
      extractSeq: extracts[0]?.seq ?? null,
      exact: true,
      reports: [
        {
          seq: prev.seq,
          fingerprint: prev.fingerprint,
          exact: prev.exact,
          generatedAt: prev.generated_at.toISOString(),
        },
        { seq: rep.seq, fingerprint: rep.result.fingerprint, exact: true, generatedAt: tx.now.toISOString() },
      ],
      openBlockingExceptions: await countOpenBlocking(tx, j.id),
      certifiedAt: tx.now.toISOString(),
    };
    // A drill re-certified during sync or freeze keeps its cutover state.
    const preparing = ['draft', 'in_progress', 'waiting', 'rehearsed'].includes(j.state);
    await saveJob(tx, j, { certificate, ...(preparing ? { state: 'rehearsed' as const } : {}) });
    await db(tx)
      .insertInto('migration.signoffs')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        job_id: j.id,
        kind: 'rehearsal_certificate',
        report_id: rep.id,
        report_fingerprint: rep.result.fingerprint,
        signer: actorKey(tx),
        signer_name: null,
        note: 'Two consecutive exact reconciliations of the same plan, data and decisions (automatic).',
        evidence: JSON.stringify(certificate),
        signed_at: tx.now,
      })
      .execute();
    await tx.emit({
      type: 'migration.rehearsal.certified',
      propertyId: j.propertyId,
      aggregate: { type: 'migration_job', id: j.id },
      payload: {
        jobId: j.id,
        planFingerprint: j.planFingerprint,
        reports: certificate.reports.map((r) => r.seq),
      },
    });
    return {
      status: 'succeeded',
      detail: `Rehearsed twice with zero differences (reports ${prev.seq} and ${rep.seq}).`,
    } as const;
  });
}

/** Production: rehearse through the linked trial organization (same plan, same data, same decisions). */
export async function rehearseInTrial(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  if (!job.rehearsalLink)
    return {
      status: 'waiting',
      detail: 'Link a trial organization (and its property) where the rehearsal runs.',
      owner: 'Migration lead',
    };
  const link = job.rehearsalLink;
  const payload = await withTenantTx(database, ctx, async (tx) =>
    rehearsalPayload(tx, await loadJob(tx, job.id)),
  );
  const evidence = await withTenantTx(database, ctx, (tx) =>
    deps.ports.rehearsal.rehearse(tx, {
      trialOrganizationId: link.trialOrganizationId,
      trialPropertyId: link.trialPropertyId,
      liveJobId: job.id,
      sourceAdapter: job.sourceAdapter,
      sourceSystem: job.sourceSystem,
      plan: job.plan,
      extract: { seq: payload.seq, records: payload.records, controlTotals: payload.controlTotals },
      decisions: payload.decisions,
    }),
  );
  await withTenantTx(database, ctx, async (tx) => {
    const j = await loadJob(tx, job.id, { lock: true });
    await saveJob(tx, j, { certificate: { ...evidence } });
  });
  return {
    status: 'succeeded',
    detail: `Rehearsed in the trial organization (${evidence.reports.length} report(s); ${evidence.exact ? 'exact' : 'not exact yet'}).`,
  };
}

/** Production: the trial's evidence must certify this job's current plan, data and decisions. */
export async function evidenceStep(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  if (!job.rehearsalLink)
    return { status: 'waiting', detail: 'No trial organization is linked.', owner: 'Migration lead' };
  const link = job.rehearsalLink;
  const evidence = await withTenantTx(database, ctx, (tx) =>
    deps.ports.rehearsal.evidence(tx, { trialOrganizationId: link.trialOrganizationId, liveJobId: job.id }),
  );
  const gap = await withTenantTx(database, ctx, async (tx) => {
    const j = await loadJob(tx, job.id, { lock: true });
    await saveJob(tx, j, { certificate: evidence ? { ...evidence } : null });
    return certificateGap(certificateFacts(evidence), {
      planFingerprint: j.planFingerprint ?? '',
      dataFingerprint: await currentDataFingerprint(tx, j),
    });
  });
  if (gap?.code === 'no_rehearsal' || gap?.code === 'rehearsal_not_exact')
    return {
      status: 'waiting',
      detail:
        'The rehearsal in the trial organization has not reconciled exactly twice yet. Resolve its exceptions there and run it again.',
      owner: 'Migration lead',
    };
  if (gap)
    return {
      status: 'waiting',
      detail: `${gap.message} (run the rehearsal again)`,
      owner: 'Migration lead',
    };
  return {
    status: 'succeeded',
    detail: `Rehearsal certified at ${evidence?.certifiedAt} (two exact reconciliations of this plan, data and decisions).`,
  };
}

/**
 * Re-run the rehearsal when what would be cut over no longer matches the certificate (R-P1-2): a production job
 * rehearses again in its trial organization. A drill needs none — its organization is read-only for the migrated
 * domains until its own switch, and its cutover (reconciled at verify) is the rehearsal. Returns whether the
 * certificate now covers the current plan, data and decisions.
 */
export async function rehearseAgain(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<{ covered: boolean; rehearsed: boolean; detail: string }> {
  if (job.purpose !== 'production')
    return { covered: true, rehearsed: false, detail: 'A drill is its own rehearsal.' };
  const gapNow = async () =>
    withTenantTx(database, ctx, async (tx) => {
      const j = await loadJob(tx, job.id);
      return certificateGap(certificateFacts(j.certificate), {
        planFingerprint: j.planFingerprint ?? '',
        dataFingerprint: await currentDataFingerprint(tx, j),
      });
    });
  if (!(await gapNow()))
    return { covered: true, rehearsed: false, detail: 'The rehearsal covers the current data.' };
  const outcome = await rehearseInTrial(database, deps, ctx, job);
  const after = await gapNow();
  if (!after)
    return { covered: true, rehearsed: true, detail: 'Rehearsed again: the changes reconcile exactly.' };
  return {
    covered: false,
    rehearsed: true,
    detail: `${after.message}${outcome.status === 'succeeded' ? '' : ` ${outcome.detail}`}`,
  };
}

/**
 * The live job ended: close its rehearsal copy in the trial organization after this transaction commits (the copy
 * then follows the same retention purge). If the trial cannot be reached now, housekeeping closes it later.
 */
export function closeRehearsalCopy(
  tx: TxContext,
  deps: MigrationDeps,
  job: Job,
  outcome: 'completed' | 'cancelled',
): void {
  const link = job.rehearsalLink;
  if (job.purpose !== 'production' || !link) return;
  tx.afterCommit(async () => {
    try {
      await deps.ports.rehearsal.close(tx, {
        trialOrganizationId: link.trialOrganizationId,
        liveJobId: job.id,
        outcome,
      });
    } catch {
      // The trial side is unavailable (expired, deleted): housekeeping in the trial closes the copy.
    }
  });
}
