/**
 * The seven irreducible human steps (DD11 §6.2) — never hidden, never faked. Each has an owner role, a due time and
 * reminders; each completes only with its evidence, by a person holding the right permission, or (source access)
 * from a fact Portico observed. The cutover gate reads them.
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, ConflictError, newId, requirePermission, ValidationError } from '@portico/kernel';
import type { ChecklistInput } from '../contracts';
import {
  CHECKLIST,
  type ChecklistDefinition,
  type ChecklistKey,
  REMINDER_INTERVAL_HOURS,
} from '../domain/cutover';
import { FINANCIAL_CLASSES } from '../domain/records';
import { currentMoneyFingerprint } from './certificate';
import { actorKey, actorName, assertOpen, db, type Job, loadJobFor } from './context';
import { latestReports } from './reconcile';

export async function initChecklist(tx: TxContext, job: Job): Promise<void> {
  if (job.purpose !== 'production') return;
  for (const item of CHECKLIST)
    await db(tx)
      .insertInto('migration.checklist')
      .values({
        tenant_id: tx.tenantId,
        job_id: job.id,
        key: item.key,
        status: 'waiting',
        owner_user_id: null,
        due_at: new Date(tx.now.getTime() + item.dueAfterDays * 86_400_000),
        evidence: null,
        completed_by: null,
        completed_at: null,
        last_reminded_at: null,
      })
      .onConflict((oc) => oc.columns(['job_id', 'key']).doNothing())
      .execute();
}

/** Source access is observed, not declared: it completes when Portico has read the source. */
export async function observeSourceAccess(tx: TxContext, job: Job, extractSeq: number): Promise<void> {
  if (job.purpose !== 'production') return;
  await db(tx)
    .updateTable('migration.checklist')
    .set((eb) => ({
      status: 'done',
      evidence: JSON.stringify({ observed: `Portico read extract ${extractSeq} of ${job.sourceSystem}.` }),
      completed_by: 'system:migration',
      completed_at: tx.now,
      version: eb('version', '+', 1),
    }))
    .where('job_id', '=', job.id)
    .where('key', '=', 'source_access')
    .where('status', '=', 'waiting')
    .execute();
}

export async function loadChecklist(tx: TxContext, jobId: string) {
  return db(tx).selectFrom('migration.checklist').selectAll().where('job_id', '=', jobId).execute();
}

export async function waitingChecklist(
  tx: TxContext,
  job: Job,
  opts: { except?: ChecklistKey[] } = {},
): Promise<ChecklistDefinition[]> {
  if (job.purpose !== 'production') return [];
  const rows = await loadChecklist(tx, job.id);
  return CHECKLIST.filter(
    (d) => !(opts.except ?? []).includes(d.key) && rows.find((r) => r.key === d.key)?.status === 'waiting',
  );
}

export async function openFinancialBlocking(tx: TxContext, jobId: string): Promise<number> {
  const row = await db(tx)
    .selectFrom('migration.exceptions')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('job_id', '=', jobId)
    .where('severity', '=', 'blocking')
    .where('status', 'in', ['open', 'in_progress'])
    .where((eb) => eb.or([eb('financial', '=', true), eb('data_class', 'in', [...FINANCIAL_CLASSES])]))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** Complete (or mark not applicable) one checklist step with its evidence. */
export async function completeChecklistItem(
  tx: TxContext,
  jobId: string,
  key: string,
  input: ChecklistInput,
): Promise<void> {
  const def = CHECKLIST.find((d) => d.key === key);
  if (!def) throw new ValidationError('unknown_checklist_item', `There is no checklist step "${key}".`);
  const job = await loadJobFor(tx, jobId, def.permission, { lock: true });
  assertOpen(job);
  if (job.purpose !== 'production')
    throw new BusinessRuleError(
      'checklist_production_only',
      'The checklist belongs to the production migration in the live organization.',
    );
  if (def.key === 'source_access')
    throw new BusinessRuleError(
      'checklist_observed',
      'Portico confirms source access itself once it has read the data (upload the export or connect the system).',
    );
  if (def.key === 'cutover_window')
    throw new BusinessRuleError(
      'checklist_use_plan_cutover',
      'Choose the cutover time with "Plan cutover": it books the switch of system of record for a second person to approve.',
    );
  const row = (await loadChecklist(tx, job.id)).find((r) => r.key === key);
  if (!row) throw new ValidationError('unknown_checklist_item', `There is no checklist step "${key}".`);
  if (row.status !== 'waiting')
    throw new ConflictError(
      'checklist_already_done',
      `"${def.title}" is already ${row.status.replace('_', ' ')}.`,
    );
  const evidence: Record<string, unknown> = { ...input.evidence };
  let signoffKind: string | null = null;
  let report: { id: string; fingerprint: string } | null = null;
  switch (def.key) {
    case 'data_authorization':
      if (input.status !== 'done' || !input.evidence.reference)
        throw new ValidationError(
          'evidence_required',
          "Record the reference of the hotel's signed data authorization (document id). This step cannot be skipped.",
        );
      break;
    case 'card_transfer':
      if (input.status === 'done') {
        if (input.evidence.decision === 'psp_transfer')
          throw new BusinessRuleError(
            'psp_transfer_unavailable',
            'A provider-to-provider card transfer is not available yet (no payment provider chosen, Q142). Choose re-collection: guests are asked for a card again; no card data is handled by Portico.',
          );
        if (input.evidence.decision !== 're_collect')
          throw new ValidationError('decision_required', 'Choose how stored cards move: "re_collect".');
      } else if (!input.evidence.note)
        throw new ValidationError(
          'evidence_required',
          'Say why no card plan is needed (for example: no stored cards).',
        );
      break;
    case 'opening_balances': {
      if (input.status !== 'done')
        throw new ValidationError(
          'evidence_required',
          'Opening balances must be confirmed; they cannot be skipped.',
        );
      const ev = job.certificate as { exact?: boolean; reports?: Array<{ fingerprint: string }> } | null;
      const last = (await latestReports(tx, job.id, 1))[0];
      const exact = job.purpose === 'production' ? !!ev?.exact : !!last?.exact;
      if (!exact)
        throw new BusinessRuleError(
          'not_reconciled',
          'The latest rehearsal does not reconcile exactly yet. Opening balances are confirmed on an exact reconciliation report.',
        );
      const open = await openFinancialBlocking(tx, job.id);
      if (open > 0)
        throw new BusinessRuleError(
          'financial_exceptions_open',
          `${open} financial exception(s) are still open. Resolve them (or record each as an accepted loss) before confirming the opening balances.`,
        );
      const fp = ev?.reports?.[ev.reports.length - 1]?.fingerprint ?? last?.fingerprint ?? null;
      evidence.reportFingerprint = fp;
      // Binds the confirmation to the money it covers: any later change re-opens it and the gate refuses it.
      evidence.moneyFingerprint = await currentMoneyFingerprint(tx, job);
      signoffKind = 'opening_balances';
      report = last ? { id: last.id, fingerprint: last.fingerprint } : null;
      break;
    }
    case 'channel_switch':
      if (!input.evidence.note && !input.evidence.reference)
        throw new ValidationError(
          'evidence_required',
          'Describe the agreed switch order (old channel manager off, Portico mappings on) or why there is none.',
        );
      break;
    case 'staff_acceptance': {
      if (input.status !== 'done')
        throw new ValidationError('evidence_required', 'Staff acceptance cannot be skipped.');
      const ev = job.certificate as { exact?: boolean } | null;
      if (!ev?.exact)
        throw new BusinessRuleError(
          'not_rehearsed',
          'Staff accept workflows on the rehearsed copy: the rehearsal must reconcile exactly first.',
        );
      if (!input.evidence.note)
        throw new ValidationError(
          'evidence_required',
          'Record which workflows were checked (arrivals, check-in, posting, payment, check-out, Day Close) and by whom.',
        );
      signoffKind = 'staff_acceptance';
      break;
    }
  }
  requirePermission(tx, def.permission, { propertyId: job.propertyId });
  await db(tx)
    .updateTable('migration.checklist')
    .set((eb) => ({
      status: input.status,
      evidence: JSON.stringify(evidence),
      completed_by: actorKey(tx),
      completed_at: tx.now,
      version: eb('version', '+', 1),
    }))
    .where('job_id', '=', job.id)
    .where('key', '=', key)
    .where('status', '=', 'waiting')
    .execute();
  if (signoffKind)
    await db(tx)
      .insertInto('migration.signoffs')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        job_id: job.id,
        kind: signoffKind,
        report_id: report?.id ?? null,
        report_fingerprint:
          (evidence.reportFingerprint as string | null | undefined) ?? report?.fingerprint ?? null,
        signer: actorKey(tx),
        signer_name: actorName(tx),
        note: input.evidence.note ?? null,
        evidence: JSON.stringify(evidence),
        signed_at: tx.now,
      })
      .execute();
  await tx.audit({
    action: 'migration.checklist.complete',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    after: { key, status: input.status, evidence },
  });
  await tx.emit({
    type: 'migration.checklist.completed',
    propertyId: job.propertyId,
    aggregate: { type: 'migration_job', id: job.id },
    payload: { jobId: job.id, key, status: input.status },
  });
}

/** Mark the cutover-window step done (by `planCutover`). */
/**
 * Finance confirmed the opening balances on the money it saw. When the source's money changes afterwards (a sync, a
 * re-upload, a final capture before the switch), that confirmation no longer covers what the cutover would post: it
 * re-opens and the gate waits for finance again (R-P1-8). After the switch, new money is staged per record instead.
 */
export async function reopenOpeningBalances(tx: TxContext, job: Job, changedMoney: number): Promise<boolean> {
  if (job.purpose !== 'production' || job.switchedAt || changedMoney === 0) return false;
  const row = (await loadChecklist(tx, job.id)).find((r) => r.key === 'opening_balances');
  if (row?.status !== 'done') return false;
  await db(tx)
    .updateTable('migration.checklist')
    .set((eb) => ({
      status: 'waiting',
      evidence: JSON.stringify({
        ...((row.evidence as Record<string, unknown> | null) ?? {}),
        reopened: { at: tx.now.toISOString(), changedRecords: changedMoney },
      }),
      completed_by: null,
      completed_at: null,
      version: eb('version', '+', 1),
    }))
    .where('job_id', '=', job.id)
    .where('key', '=', 'opening_balances')
    .execute();
  await tx.audit({
    action: 'migration.checklist.reopen',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    reason: `${changedMoney} money record(s) changed in the source after finance confirmed the opening balances.`,
    after: { key: 'opening_balances' },
  });
  return true;
}

export async function markCutoverWindow(tx: TxContext, job: Job, plannedStartAt: Date): Promise<void> {
  if (job.purpose !== 'production') return;
  await db(tx)
    .updateTable('migration.checklist')
    .set((eb) => ({
      status: 'done',
      evidence: JSON.stringify({ plannedStartAt: plannedStartAt.toISOString() }),
      completed_by: actorKey(tx),
      completed_at: tx.now,
      version: eb('version', '+', 1),
    }))
    .where('job_id', '=', job.id)
    .where('key', '=', 'cutover_window')
    .execute();
}

/** Reminders for overdue steps (at most one per item per REMINDER_INTERVAL_HOURS). */
export async function remindOverdue(tx: TxContext, job: Job): Promise<number> {
  const rows = await loadChecklist(tx, job.id);
  let n = 0;
  for (const r of rows) {
    if (r.status !== 'waiting' || r.due_at.getTime() > tx.now.getTime()) continue;
    if (
      r.last_reminded_at &&
      tx.now.getTime() - r.last_reminded_at.getTime() < REMINDER_INTERVAL_HOURS * 3_600_000
    )
      continue;
    const def = CHECKLIST.find((d) => d.key === r.key);
    await db(tx)
      .updateTable('migration.checklist')
      .set((eb) => ({ reminders: eb('reminders', '+', 1), last_reminded_at: tx.now }))
      .where('job_id', '=', job.id)
      .where('key', '=', r.key)
      .execute();
    await tx.emit({
      type: 'migration.checklist.reminderDue',
      propertyId: job.propertyId,
      aggregate: { type: 'migration_job', id: job.id },
      payload: {
        jobId: job.id,
        key: r.key,
        title: def?.title ?? r.key,
        ownerRole: def?.ownerRole ?? null,
        ownerUserId: r.owner_user_id,
        dueAt: r.due_at.toISOString(),
        reminders: r.reminders + 1,
      },
    });
    n++;
  }
  return n;
}

export async function assignChecklistOwner(tx: TxContext, jobId: string, key: string, ownerUserId: string) {
  const job = await loadJobFor(tx, jobId, 'migration.job.manage', { lock: true });
  const res = await db(tx)
    .updateTable('migration.checklist')
    .set((eb) => ({ owner_user_id: ownerUserId, version: eb('version', '+', 1) }))
    .where('job_id', '=', job.id)
    .where('key', '=', key)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0)
    throw new ValidationError('unknown_checklist_item', `There is no checklist step "${key}".`);
  await tx.audit({
    action: 'migration.checklist.assign',
    target: { type: 'migration_job', id: job.id },
    propertyId: job.propertyId,
    after: { key, ownerUserId },
  });
}
