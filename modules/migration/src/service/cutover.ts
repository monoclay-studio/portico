/**
 * Delta sync, freeze, cutover, verification, rollback window and rollback (acceptance criteria M6–M9; INT-R33).
 *
 * Sequence: the source is declared the system of record in Portico (read-only here) and the switch back to Portico
 * is planned as a platform authority transition (planned → approved by a second person → frozen → effective). At
 * the freeze a person confirms the old system is frozen; Portico takes the final capture, re-checks every gate and
 * only then freezes and completes the transition, imports, and verifies by reconciliation. The freeze is measured
 * from the person's confirmation to the verified opening (TARGET ≤ 15 minutes). Rollback inside the window moves the
 * system of record back and hands over the cutover journal as a worklist: nothing done after the switch is erased.
 */
import { type PorticoDatabase, type TxContext, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  type DomainEvent,
  newId,
  type RequestContext,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import { certificateFacts } from '../domain/certificate';
import {
  evaluateCutoverGate,
  FREEZE_TARGET_MINUTES,
  freezeMinutes,
  rollbackWindowEnds,
} from '../domain/cutover';
import { deltaSize } from '../domain/delta';
import { pendingReview, planFingerprint } from '../domain/mapping';
import { P } from '../manifest';
import { MIGRATION_PROCESS, type MigratedDomain } from '../ports';
import { currentDataFingerprint, currentMoneyFingerprint } from './certificate';
import { loadChecklist, markCutoverWindow } from './checklist';
import {
  actorKey,
  actorName,
  assertOpen,
  db,
  type Job,
  loadJob,
  loadJobFor,
  type MigrationDeps,
  saveJob,
} from './context';
import { extractFromSimulator } from './extract';
import { importAll } from './importer';
import { acquireLease, releaseLease } from './lease';
import type { StepOutcome } from './pipeline';
import { computePlan, runValidateStep } from './plan';
import { buildReport } from './reconcile';
import { closeRehearsalCopy, rehearseAgain } from './rehearse';
import { countOpenBlocking } from './state';

const migrated = (job: Job) => job.domains as MigratedDomain[];

// ───────────────────────────── planning and authorization ─────────────────────────────

/**
 * Choose the cutover time: the source is declared the system of record (restricting — Portico read-only for these
 * domains until the switch) and the switch back is planned for a second person to approve.
 */
export async function planCutover(
  tx: TxContext,
  deps: MigrationDeps,
  jobId: string,
  input: { plannedStartAt: string; freezeMinutes: number },
): Promise<Job> {
  let job = await loadJobFor(tx, jobId, P.cutoverExecute, { lock: true });
  assertOpen(job);
  if (job.frozenAt) throw new ConflictError('cutover_started', 'The cutover has already started.');
  const prepared =
    job.purpose === 'rehearsal'
      ? job.steps.signoff === 'succeeded'
      : job.steps.reconcile === 'succeeded' && job.steps.rehearse === 'succeeded';
  if (!prepared)
    throw new BusinessRuleError(
      'not_rehearsed',
      'Plan the cutover after the rehearsal has reconciled exactly (twice in a row).',
    );
  const start = new Date(input.plannedStartAt);
  if (Number.isNaN(start.getTime()))
    throw new ValidationError('invalid_time', 'The cutover time is not a valid time.');
  if (job.transitionId) {
    const t = await deps.ports.platform.getTransition(tx, job.propertyId, job.transitionId);
    if (t && (t.status === 'planned' || t.status === 'frozen'))
      await deps.ports.platform.cancelTransition(tx, job.transitionId, 'Cutover re-planned');
  }
  for (const domain of migrated(job)) {
    const a = await deps.ports.platform.getDataAuthority(tx, job.propertyId, domain);
    if (a.authority === 'portico')
      await deps.ports.platform.declareExternalAuthority(tx, {
        propertyId: job.propertyId,
        domain,
        systemName: job.sourceSystem,
        // Platform links an external system of record to a connection: the migration source's identity is that
        // link (MIG-CR-6 asks integration to register migration sources as file-exchange connections).
        connectionId: job.sourceIdentity,
        reason: `Migration ${job.id}: ${job.sourceSystem} stays the system of record until the cutover.`,
      });
  }
  const transition = await deps.ports.platform.planTransition(tx, {
    propertyId: job.propertyId,
    changes: migrated(job).map((domain) => ({
      domain,
      authority: 'portico' as const,
      writeMode: 'exclusive' as const,
    })),
    reason: `Cutover of migration ${job.id} from ${job.sourceSystem}`,
    rollbackCriteria:
      'Reconciliation cannot be completed within 4 hours, Day Close cannot complete, or the decision-maker calls it; rollback replays the cutover journal into the old system.',
    freezeMinutes: input.freezeMinutes,
    plannedStartAt: start,
  });
  job = await saveJob(tx, job, { transitionId: transition.id, cutoverPlannedAt: start });
  await markCutoverWindow(tx, job, start);
  await tx.audit({
    action: 'migration.cutover.plan',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    after: {
      transitionId: transition.id,
      plannedStartAt: start.toISOString(),
      freezeMinutes: input.freezeMinutes,
    },
  });
  await tx.emit({
    type: 'migration.cutover.planned',
    propertyId: job.propertyId,
    aggregate: { type: 'migration_job', id: job.id },
    payload: { jobId: job.id, transitionId: transition.id, plannedStartAt: start.toISOString() },
  });
  return job;
}

/** The second person approves the switch of system of record (platform enforces planner ≠ approver). */
export async function approveCutover(tx: TxContext, deps: MigrationDeps, jobId: string, note?: string) {
  const job = await loadJobFor(tx, jobId, P.productionAuthorize, { lock: true });
  assertOpen(job);
  if (!job.transitionId) throw new BusinessRuleError('no_transition', 'Plan the cutover first.');
  await deps.ports.platform.approveTransition(tx, job.transitionId, note);
  await tx.audit({
    action: 'migration.cutover.approve',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    reason: note ?? null,
  });
  return job;
}

/**
 * The production gate's authorization record (CLAUDE.md §1: a production migration needs explicit authorization).
 * Portico builds the gate; a person other than the one who started the migration records the authorization,
 * naming the plan it authorizes and the hotel's signed authorization document. It expires.
 */
export async function authorizeProduction(
  tx: TxContext,
  jobId: string,
  input: { evidenceRef: string; note?: string | undefined; validHours: number },
): Promise<void> {
  const job = await loadJobFor(tx, jobId, P.productionAuthorize, { lock: true });
  assertOpen(job);
  if (job.purpose !== 'production' || tx.environment !== 'live')
    throw new BusinessRuleError(
      'authorization_production_only',
      'Only a production migration in the live organization is authorized. Rehearsals and drills need no authorization.',
    );
  if (tx.actor.kind !== 'user')
    throw new BusinessRuleError(
      'authorization_by_person',
      'A production migration is authorized by a person.',
    );
  if (actorKey(tx) === job.createdBy)
    throw new BusinessRuleError(
      'authorization_same_person',
      'The person who started the migration cannot authorize it. Ask another authorized person.',
    );
  if (!job.planFingerprint)
    throw new BusinessRuleError(
      'no_plan',
      'Map the source first: the authorization names the plan it approves.',
    );
  await db(tx)
    .insertInto('migration.authorizations')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      job_id: job.id,
      kind: 'production',
      plan_fingerprint: job.planFingerprint,
      granted_by: actorKey(tx),
      granted_by_name: actorName(tx),
      evidence_ref: input.evidenceRef,
      note: input.note ?? null,
      granted_at: tx.now,
      expires_at: new Date(tx.now.getTime() + input.validHours * 3_600_000),
    })
    .execute();
  await tx.audit({
    action: 'migration.production.authorize',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    after: {
      planFingerprint: job.planFingerprint,
      evidenceRef: input.evidenceRef,
      validHours: input.validHours,
    },
  });
  await tx.emit({
    type: 'migration.production.authorized',
    propertyId: job.propertyId,
    aggregate: { type: 'migration_job', id: job.id },
    payload: { jobId: job.id, planFingerprint: job.planFingerprint },
  });
}

export async function revokeAuthorization(tx: TxContext, jobId: string, reason: string): Promise<void> {
  const job = await loadJobFor(tx, jobId, P.productionAuthorize, { lock: true });
  await db(tx)
    .insertInto('migration.authorizations')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      job_id: job.id,
      kind: 'revocation',
      plan_fingerprint: null,
      granted_by: actorKey(tx),
      granted_by_name: actorName(tx),
      evidence_ref: null,
      note: reason,
      granted_at: tx.now,
      expires_at: null,
    })
    .execute();
  await tx.audit({
    action: 'migration.production.revoke',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    reason,
  });
}

async function currentAuthorization(tx: TxContext, job: Job) {
  const a = await db(tx)
    .selectFrom('migration.authorizations')
    .selectAll()
    .where('job_id', '=', job.id)
    .orderBy('granted_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (a?.kind !== 'production' || !a.expires_at) return null;
  return { planFingerprint: a.plan_fingerprint ?? '', grantedBy: a.granted_by, expiresAt: a.expires_at };
}

// ───────────────────────────── pipeline steps ─────────────────────────────

export async function runDeltaSyncStep(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  if (!job.transitionId)
    return {
      status: 'waiting',
      detail: 'Choose the cutover time ("Plan cutover"); Portico keeps the copy in sync until then.',
      owner: 'General manager',
    };
  const res = await withTenantTx(database, ctx, async (tx) => {
    let j = await loadJob(tx, job.id, { lock: true });
    let changes = 0;
    if (j.sourceAdapter === 'pms.simulator') {
      const out = await extractFromSimulator(tx, deps, j, 'sync');
      j = out.job;
      changes = deltaSize(out.delta);
    }
    j = await saveJob(tx, j, { state: 'in_sync' });
    return { job: j, changes };
  });
  // Whatever changed since the rehearsal — a sync, a re-uploaded export, a decision — is rehearsed again now, so the
  // certificate always covers exactly what the cutover would import (R-P1-2).
  const again = await rehearseAgain(database, deps, ctx, res.job);
  if (!again.covered)
    return {
      status: 'waiting',
      detail: `In sync, but the rehearsal does not cover the current data yet: ${again.detail}`,
      owner: 'Migration lead',
    };
  return {
    status: 'succeeded',
    detail: `In sync: ${res.changes} change(s) read from ${job.sourceSystem} at this pass.${again.rehearsed ? ' The changes since the rehearsal were rehearsed again and reconcile exactly.' : ''} Start the cutover when the old system is frozen.`,
  };
}

/**
 * Freeze (started by a person who confirms the old system is frozen): final capture; anything that differs from
 * what was rehearsed is rehearsed again (inside the measured freeze); then mapping, quality and every gate are
 * evaluated on the state as it is now. A failed gate unfreezes (nothing changed in Portico) and lists the blockers.
 */
export async function runFreezeStep(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
  _opts: unknown,
): Promise<StepOutcome> {
  const capture = await withTenantTx(database, ctx, async (tx) => {
    let j = await loadJob(tx, job.id, { lock: true });
    if (j.state !== 'in_sync')
      throw new BusinessRuleError(
        'not_in_sync',
        'The cutover starts from "in sync" (after the delta sync step).',
      );
    if (j.sourceAdapter === 'pms.simulator') j = (await extractFromSimulator(tx, deps, j, 'final')).job;
    // The person confirmed the old system is frozen when starting this step: the freeze is measured from here.
    return { job: j, startedAt: tx.now };
  });
  const again = await rehearseAgain(database, deps, ctx, capture.job);
  return withTenantTx(database, ctx, async (tx) => {
    let j = await loadJob(tx, job.id, { lock: true });
    if (j.state !== 'in_sync')
      throw new BusinessRuleError(
        'not_in_sync',
        'The cutover starts from "in sync" (after the delta sync step).',
      );
    const startedAt = capture.startedAt;
    // New codes in the final capture need a decision: never imported unmapped.
    const plan = await computePlan(tx, deps, j);
    const pending = pendingReview(plan);
    const fingerprint = planFingerprint(plan);
    const quality = await runValidateStep(tx, deps, j);
    const transition = j.transitionId
      ? await deps.ports.platform.getTransition(tx, j.propertyId, j.transitionId)
      : null;
    if (j.purpose === 'production' && j.rehearsalLink) {
      const link = j.rehearsalLink;
      const evidence = await deps.ports.rehearsal.evidence(tx, {
        trialOrganizationId: link.trialOrganizationId,
        liveJobId: j.id,
      });
      j = await saveJob(tx, j, { certificate: evidence ? { ...evidence } : null });
    }
    const checklist = await loadChecklist(tx, j.id);
    const gate = evaluateCutoverGate({
      purpose: j.purpose,
      environment: tx.environment,
      checklist: checklist.map((c) => ({
        key: c.key as Parameters<typeof evaluateCutoverGate>[0]['checklist'][number]['key'],
        status: c.status,
      })),
      money: {
        confirmed:
          ((
            checklist.find((c) => c.key === 'opening_balances')?.evidence as {
              moneyFingerprint?: string;
            } | null
          )?.moneyFingerprint as string | undefined) ?? null,
        current: await currentMoneyFingerprint(tx, j),
      },
      certificate: certificateFacts(j.certificate),
      planFingerprint: fingerprint,
      // Computed now, under the job lock: an upload that raced the re-rehearsal makes the certificate stale.
      dataFingerprint: await currentDataFingerprint(tx, j),
      authorization: await currentAuthorization(tx, j),
      jobCreatedBy: j.createdBy,
      transition: transition
        ? { status: transition.status, approved: !transition.approvalRequired || !!transition.approvedBy }
        : null,
      openBlockingExceptions: await countOpenBlocking(tx, j.id),
      finalExtractBlocking: quality.undecided,
      now: tx.now,
    });
    if (pending.length)
      gate.blockers.unshift({
        code: 'final_capture_needs_mapping',
        message: `The final capture contains ${pending.length} code(s) that need a mapping decision.`,
      });
    if (j.purpose === 'production') {
      try {
        await deps.ports.platform.assertWorkflowInScope(tx, j.propertyId, 'migration.cutover');
      } catch (err) {
        gate.blockers.push({
          code: 'outside_activation_scope',
          message: err instanceof Error ? err.message : 'Migration is not in the approved activation scope.',
        });
      }
    }
    if (gate.blockers.length) {
      await tx.audit({
        action: 'migration.cutover.refused',
        target: { type: 'migration_job', id: j.id },
        propertyId: j.propertyId,
        reason: gate.blockers.map((b) => b.code).join(', '),
        after: { blockers: gate.blockers, rehearsedAgain: again.rehearsed },
      });
      return {
        status: 'waiting',
        detail: `Cutover not started — nothing changed in Portico, unfreeze the old system: ${gate.blockers
          .map((b) => b.message)
          .join(' ')}`,
        owner: 'Migration lead',
      } as const;
    }
    await deps.ports.platform.freezeTransition(tx, j.transitionId as string);
    await saveJob(tx, j, { frozenAt: startedAt, state: 'frozen' });
    await tx.audit({
      action: 'migration.cutover.freeze',
      target: { type: 'migration_job', id: j.id },
      propertyId: j.propertyId,
      after: {
        frozenAt: startedAt.toISOString(),
        transitionId: j.transitionId,
        rehearsedAgain: again.rehearsed,
      },
    });
    await tx.emit({
      type: 'migration.cutover.frozen',
      propertyId: j.propertyId,
      aggregate: { type: 'migration_job', id: j.id },
      payload: { jobId: j.id, frozenAt: startedAt.toISOString() },
    });
    return {
      status: 'succeeded',
      detail: `Frozen. Final capture taken${again.rehearsed ? ', its changes rehearsed again,' : ''} and every gate passed.`,
    } as const;
  });
}

/** Switch: the transition becomes effective (Portico is the system of record), then everything is imported. */
export async function runCutoverStep(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
  opts: { failAfter?: number },
): Promise<StepOutcome> {
  await withTenantTx(database, ctx, async (tx) => {
    const j = await loadJob(tx, job.id, { lock: true });
    if (j.switchedAt) return; // resumed after a crash: already switched
    const t = await deps.ports.platform.getTransition(tx, j.propertyId, j.transitionId as string);
    if (t?.status !== 'effective') await deps.ports.platform.completeTransition(tx, j.transitionId as string);
    await saveJob(tx, j, { switchedAt: tx.now, state: 'switched' });
    await tx.audit({
      action: 'migration.cutover.switch',
      target: { type: 'migration_job', id: j.id },
      propertyId: j.propertyId,
      after: { domains: j.domains, transitionId: j.transitionId },
    });
    await tx.emit({
      type: 'migration.cutover.switched',
      propertyId: j.propertyId,
      aggregate: { type: 'migration_job', id: j.id },
      payload: { jobId: j.id, domains: j.domains },
    });
  });
  const s = await importAll(
    database,
    deps,
    ctx,
    job.id,
    opts.failAfter === undefined ? {} : { failAfter: opts.failAfter },
  );
  const detail = `Portico is the system of record for ${job.domains.join(', ')}. Imported: ${s.created} created, ${s.updated} updated, ${s.merged} linked, ${s.unchanged} unchanged, ${s.exceptions} on exceptions.`;
  if (s.unavailable.length)
    return {
      status: 'waiting',
      detail: `${detail} Waiting for providers: ${s.unavailable.join(', ')}.`,
      owner: 'Monoclay onboarding lead',
    };
  return { status: 'succeeded', detail };
}

/** Verify by reconciliation; exact → Portico opens for staff (freeze measured) and the rollback window starts. */
export async function runVerifyStep(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  return withTenantTx(database, ctx, async (tx) => {
    const j = await loadJob(tx, job.id, { lock: true });
    const rep = await buildReport(tx, deps, j, 'verify');
    if (!rep.result.exact)
      return {
        status: 'waiting',
        detail: `After the switch, report ${rep.seq} shows ${rep.result.differences.filter((d) => !d.explained).length} unexplained difference(s). Fix forward or roll back within the window.`,
        owner: 'Migration lead',
      } as const;
    const openedAt = tx.now;
    const minutes = j.frozenAt ? freezeMinutes(j.frozenAt, openedAt) : null;
    const switchedAt = j.switchedAt ?? openedAt;
    await saveJob(tx, j, {
      openedAt,
      freezeMinutes: minutes,
      rollbackWindowEndsAt: rollbackWindowEnds(switchedAt),
      state: 'rollback_window',
    });
    await tx.audit({
      action: 'migration.cutover.verified',
      target: { type: 'migration_job', id: j.id },
      propertyId: j.propertyId,
      after: { reportSeq: rep.seq, freezeMinutes: minutes, targetMinutes: FREEZE_TARGET_MINUTES },
    });
    await tx.emit({
      type: 'migration.cutover.verified',
      propertyId: j.propertyId,
      aggregate: { type: 'migration_job', id: j.id },
      payload: { jobId: j.id, freezeMinutes: minutes, reportId: rep.id },
    });
    return {
      status: 'succeeded',
      detail: `Reconciled exactly after the switch. Freeze measured: ${minutes ?? '–'} min (target ≤ ${FREEZE_TARGET_MINUTES}).`,
    } as const;
  });
}

export async function runWindowStep(
  database: PorticoDatabase,
  _deps: MigrationDeps,
  ctx: RequestContext,
  job: Job,
): Promise<StepOutcome> {
  return withTenantTx(database, ctx, async (tx) => {
    const j = await loadJob(tx, job.id, { lock: true });
    if (j.state === 'rolled_back') return { status: 'succeeded', detail: 'Rolled back.' } as const;
    if (j.rollbackWindowEndsAt && tx.now.getTime() >= j.rollbackWindowEndsAt.getTime()) {
      await saveJob(tx, j, { state: 'completed' });
      closeRehearsalCopy(tx, _deps, j, 'completed');
      await tx.emit({
        type: 'migration.job.completed',
        propertyId: j.propertyId,
        aggregate: { type: 'migration_job', id: j.id },
        payload: { jobId: j.id },
      });
      return { status: 'succeeded', detail: 'The rollback window has closed. Migration completed.' } as const;
    }
    return {
      status: 'waiting',
      detail: `Rollback window open until ${j.rollbackWindowEndsAt?.toISOString() ?? 'verification'}; every change made in Portico is journaled for a possible rollback.`,
      owner: 'General manager',
    } as const;
  });
}

// ───────────────────────────── post-capture sweep ─────────────────────────────

/**
 * After the switch, read the old system once more (or the hotel uploads its latest export): records created there
 * after the final capture are imported once; records changed there are exceptions (never silently applied).
 */
export async function sweep(
  database: PorticoDatabase,
  deps: MigrationDeps,
  ctx: RequestContext,
  jobId: string,
): Promise<{ imported: number; exceptions: number; reportSeq: number; exact: boolean }> {
  // One runner at a time: the sweep holds the same lease as a pipeline run.
  await acquireLease(database, ctx, jobId);
  try {
    const job = await withTenantTx(database, ctx, async (tx) => {
      let j = await loadJobFor(tx, jobId, P.manage, { lock: true });
      if (j.state !== 'switched' && j.state !== 'rollback_window')
        throw new BusinessRuleError('not_switched', 'The post-cutover sweep runs after the switch.');
      if (j.sourceAdapter === 'pms.simulator') j = (await extractFromSimulator(tx, deps, j, 'sweep')).job;
      // The same quality checks as before the switch, plus: a re-keyed copy of an imported record is never imported
      // automatically (R-P1-5) and opening money waits for finance (R-P1-8).
      await runValidateStep(tx, deps, j);
      return j;
    });
    const s = await importAll(database, deps, ctx, job.id, { onlyNew: true });
    const rep = await withTenantTx(database, ctx, async (tx) =>
      buildReport(tx, deps, await loadJob(tx, job.id), 'sweep'),
    );
    return { imported: s.created, exceptions: s.exceptions, reportSeq: rep.seq, exact: rep.result.exact };
  } finally {
    await releaseLease(database, ctx, jobId);
  }
}

export async function requestRollback(
  tx: TxContext,
  deps: MigrationDeps,
  jobId: string,
  input: { reason: string },
): Promise<{ transitionId: string; worklist: number }> {
  const job = await loadJobFor(tx, jobId, P.cutoverExecute, { lock: true });
  if (job.state !== 'switched' && job.state !== 'rollback_window')
    throw new BusinessRuleError(
      'not_switched',
      'A rollback is only possible after the switch, inside the rollback window.',
    );
  if (job.rollbackWindowEndsAt && tx.now.getTime() >= job.rollbackWindowEndsAt.getTime())
    throw new BusinessRuleError(
      'rollback_window_closed',
      'The rollback window has closed. Problems are now fixed forward in Portico.',
    );
  if (job.rollbackTransitionId) {
    const t = await deps.ports.platform.getTransition(tx, job.propertyId, job.rollbackTransitionId);
    if (t && (t.status === 'planned' || t.status === 'frozen'))
      throw new ConflictError(
        'rollback_requested',
        'A rollback is already requested and waiting for approval.',
      );
  }
  const t = await deps.ports.platform.planTransition(tx, {
    propertyId: job.propertyId,
    changes: migrated(job).map((domain) => ({
      domain,
      authority: 'external' as const,
      writeMode: 'read_only' as const,
      systemName: job.sourceSystem,
      connectionId: job.sourceIdentity,
    })),
    reason: `Rollback of migration ${job.id}: ${input.reason}`,
    rollbackCriteria: 'Not applicable (this is the rollback).',
    freezeMinutes: 60,
  });
  await saveJob(tx, job, { rollbackTransitionId: t.id });
  const worklist = await db(tx)
    .selectFrom('migration.cutover_journal')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('job_id', '=', job.id)
    .executeTakeFirst();
  await tx.audit({
    action: 'migration.rollback.request',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    reason: input.reason,
    after: { transitionId: t.id, worklist: Number(worklist?.n ?? 0) },
  });
  await tx.emit({
    type: 'migration.rollback.requested',
    propertyId: job.propertyId,
    aggregate: { type: 'migration_job', id: job.id },
    payload: { jobId: job.id, transitionId: t.id },
  });
  return { transitionId: t.id, worklist: Number(worklist?.n ?? 0) };
}

/**
 * A second person approves the rollback: the old system becomes the system of record again. Nothing in Portico is
 * deleted or restored over; the cutover journal is the worklist to replay in the old system.
 */
export async function approveRollback(tx: TxContext, deps: MigrationDeps, jobId: string, note?: string) {
  const job = await loadJobFor(tx, jobId, P.productionAuthorize, { lock: true });
  if (!job.rollbackTransitionId)
    throw new BusinessRuleError('no_rollback', 'No rollback has been requested.');
  const t = await deps.ports.platform.getTransition(tx, job.propertyId, job.rollbackTransitionId);
  if (!t || t.status === 'cancelled')
    throw new BusinessRuleError('no_rollback', 'The rollback request was cancelled.');
  if (t.status === 'planned' && t.approvalRequired && !t.approvedBy)
    await deps.ports.platform.approveTransition(tx, job.rollbackTransitionId, note);
  if (t.status === 'planned') await deps.ports.platform.freezeTransition(tx, job.rollbackTransitionId);
  if (t.status !== 'effective') await deps.ports.platform.completeTransition(tx, job.rollbackTransitionId);
  const next = await saveJob(tx, job, { state: 'rolled_back', rolledBackAt: tx.now });
  closeRehearsalCopy(tx, deps, job, 'cancelled');
  await tx.audit({
    action: 'migration.rollback.complete',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    reason: note ?? null,
  });
  await tx.emit({
    type: 'migration.cutover.rolledBack',
    propertyId: job.propertyId,
    aggregate: { type: 'migration_job', id: job.id },
    payload: { jobId: job.id },
  });
  return next;
}

export async function tickJournal(
  tx: TxContext,
  jobId: string,
  entryId: string,
  status: 'replayed' | 'not_needed',
): Promise<void> {
  const job = await loadJobFor(tx, jobId, P.cutoverExecute, { lock: true });
  const res = await db(tx)
    .updateTable('migration.cutover_journal')
    .set({ worklist_status: status, ticked_by: actorKey(tx), ticked_at: tx.now })
    .where('job_id', '=', job.id)
    .where('id', '=', entryId)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0)
    throw new ValidationError(
      'unknown_journal_entry',
      'That journal entry does not belong to this migration.',
    );
  await tx.audit({
    action: 'migration.journal.tick',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    after: { entryId, status },
  });
}

// ───────────────────────────── cutover journal (event consumer) ─────────────────────────────

/** Event families journaled after the switch (business changes in the migrated domains). */
export const JOURNALED_EVENTS = [
  'reservations.*',
  'finance.*',
  'payments.*',
  'guests.profile.*',
  'inventory.unit.*',
  'inventory.assignment.*',
  'operations.unit.*',
  'operations.workOrder.*',
];

export async function journalEvent(tx: TxContext, event: DomainEvent): Promise<boolean> {
  // The outbox consumer runs as the system; anyone else needs cutover rights at the event's property.
  if (tx.actor.kind !== 'system')
    requirePermission(tx, P.cutoverExecute, { propertyId: event.propertyId ?? null });
  const propertyId =
    event.propertyId ??
    (typeof (event.payload as { propertyId?: unknown }).propertyId === 'string'
      ? ((event.payload as { propertyId: string }).propertyId as string)
      : null);
  if (!propertyId) return false;
  const job = await db(tx)
    .selectFrom('migration.jobs')
    .select(['id', 'switched_at', 'rollback_window_ends_at', 'run_correlations', 'state'])
    .where('property_id', '=', propertyId)
    .where('state', 'in', ['switched', 'rollback_window'])
    .executeTakeFirst();
  if (!job?.switched_at) return false;
  const at = new Date(event.occurredAt);
  if (at.getTime() < job.switched_at.getTime()) return false;
  if (job.rollback_window_ends_at && at.getTime() >= job.rollback_window_ends_at.getTime()) return false;
  // The migration's own writes (run, cutover, sweep) are not post-cutover activity. They are recognised by the
  // server-issued actor every migration write carries — the providers are called as the system process
  // `migration` — never by a request or correlation id a client can choose (R-P2-3).
  if (event.actor.kind === 'system' && event.actor.process === MIGRATION_PROCESS) return false;
  const res = await db(tx)
    .insertInto('migration.cutover_journal')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      job_id: job.id,
      property_id: propertyId,
      event_id: event.id,
      event_type: event.type,
      occurred_at: at,
      record_type: event.aggregate.type,
      record_id: event.aggregate.id,
      // Never personal data: the type and the record reference only (the worklist links to the record).
      summary: `${event.type} on ${event.aggregate.type} ${event.aggregate.id}`,
      ticked_by: null,
      ticked_at: null,
    })
    .onConflict((oc) => oc.columns(['job_id', 'event_id']).doNothing())
    .executeTakeFirst();
  return Number(res.numInsertedOrUpdatedRows ?? 0) > 0;
}

// ───────────────────────────── card re-collection (Q142) ─────────────────────────────

export async function requestCardRecollections(
  tx: TxContext,
  deps: MigrationDeps,
  jobId: string,
): Promise<{ requested: number; simulated: number }> {
  const job = await loadJobFor(tx, jobId, P.financeSignoff, { lock: true });
  if (!job.switchedAt && job.purpose === 'production')
    throw new BusinessRuleError(
      'not_switched',
      'Card re-collection requests are sent after the switch, for the migrated bookings that need a card.',
    );
  const rows = await db(tx)
    .selectFrom('migration.card_recollections')
    .selectAll()
    .where('job_id', '=', job.id)
    .where('status', '=', 'to_request')
    .execute();
  let requested = 0;
  let simulated = 0;
  for (const r of rows) {
    const out = await deps.ports.cards.request(tx, {
      propertyId: job.propertyId,
      bookingId: r.booking_id,
      guestProfileId: r.guest_profile_id,
      idempotencyKey: `card-recollect:${job.id}:${r.source_key}`,
    });
    await db(tx)
      .updateTable('migration.card_recollections')
      .set((eb) => ({
        status: out.status,
        reference: out.reference,
        updated_at: tx.now,
        version: eb('version', '+', 1),
      }))
      .where('id', '=', r.id)
      .execute();
    if (out.status === 'simulated') simulated++;
    else requested++;
  }
  await tx.audit({
    action: 'migration.cards.request',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    after: { requested, simulated },
  });
  return { requested, simulated };
}

export async function cancelJob(
  tx: TxContext,
  deps: MigrationDeps,
  jobId: string,
  reason: string,
): Promise<Job> {
  const job = await loadJobFor(tx, jobId, P.manage, { lock: true });
  assertOpen(job);
  if (job.frozenAt || job.switchedAt)
    throw new BusinessRuleError(
      'cutover_started',
      'The cutover has started: use the rollback (inside the window) instead of cancelling.',
    );
  if (job.transitionId) {
    const t = await deps.ports.platform.getTransition(tx, job.propertyId, job.transitionId);
    if (t && (t.status === 'planned' || t.status === 'frozen'))
      await deps.ports.platform.cancelTransition(tx, job.transitionId, `Migration cancelled: ${reason}`);
  }
  const next = await saveJob(tx, job, { state: 'cancelled' });
  closeRehearsalCopy(tx, deps, job, 'cancelled');
  await tx.audit({
    action: 'migration.job.cancel',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    reason,
  });
  return next;
}
