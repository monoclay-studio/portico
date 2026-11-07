import { sql, type TxContext, typed } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { AuthorityTransition, DataDomain } from '../contracts';
import {
  authorityCombinationProblem,
  canMoveTransition,
  type Domain,
  needsSecondApprover,
  type TransitionStatus,
} from '../domain/data-authority';
import type { PlatformPorts } from '../ports';
import {
  actorKey,
  assertHumanApprover,
  getDataAuthority,
  responsiblePerson,
  writeAuthorityVersion,
} from '../service';
import type { DataAuthorityTransitionsTable, PlatformDB } from '../tables';

/**
 * Moving the system of record (docs/adoption/source-of-truth-matrix.md §6; G-02): planned → frozen → effective
 * (or cancelled). While frozen, `assertWritable` refuses writes in the moved domains with
 * `authority_transition_in_progress`. Moving charges, payments, accounting or availability needs approval by a
 * second person before the freeze (CR-10).
 */
const db = (tx: TxContext) => typed<PlatformDB>(tx.db);

interface Change {
  domain: DataDomain;
  authority: 'portico' | 'external';
  connectionId?: string | undefined;
  systemName?: string | undefined;
  writeMode: 'exclusive' | 'forward' | 'read_only';
}

function toTransition(
  r: Omit<DataAuthorityTransitionsTable, 'version'> & { version: number },
): AuthorityTransition {
  return {
    id: r.id,
    propertyId: r.property_id,
    status: r.status,
    changes: r.changes as Change[],
    reason: r.reason,
    rollbackCriteria: r.rollback_criteria,
    freezeMinutes: r.freeze_minutes,
    approvalRequired: r.approval_required,
    plannedBy: r.planned_by,
    approvedBy: r.approved_by,
    frozenAt: r.frozen_at?.toISOString() ?? null,
    expectedEndAt: r.expected_end_at?.toISOString() ?? null,
    effectiveAt: r.effective_at?.toISOString() ?? null,
    cancelledAt: r.cancelled_at?.toISOString() ?? null,
    version: r.version,
  };
}

export async function planAuthorityTransition(
  tx: TxContext,
  propertyId: string,
  input: {
    changes: Change[];
    reason: string;
    rollbackCriteria?: string | undefined;
    plannedStartAt?: Date | undefined;
    freezeMinutes: number;
  },
): Promise<AuthorityTransition> {
  requirePermission(tx, 'platform.dataAuthority.manage', { propertyId });
  const domains = input.changes.map((c) => c.domain);
  if (new Set(domains).size !== domains.length)
    throw new ValidationError('duplicate_domain', 'Each domain may appear only once in a transition.');
  for (const c of input.changes) {
    const problem = authorityCombinationProblem(c);
    if (problem)
      throw new ValidationError(problem.code, `${c.domain}: ${problem.message}`, { domain: c.domain });
  }
  const prop = await db(tx)
    .selectFrom('platform.properties')
    .select('id')
    .where('id', '=', propertyId)
    .executeTakeFirst();
  if (!prop) throw new NotFoundError('property', propertyId);
  const id = newId();
  const row = await db(tx)
    .insertInto('platform.data_authority_transitions')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: propertyId,
      changes: JSON.stringify(input.changes),
      status: 'planned',
      reason: input.reason,
      rollback_criteria: input.rollbackCriteria ?? null,
      planned_start_at: input.plannedStartAt ?? null,
      freeze_minutes: input.freezeMinutes,
      approval_required: needsSecondApprover(domains as Domain[]),
      planned_by: responsiblePerson(tx.actor),
      planned_at: tx.now,
      approved_by: null,
      approved_at: null,
      frozen_at: null,
      expected_end_at: null,
      effective_at: null,
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  try {
    for (const domain of domains) {
      await db(tx)
        .insertInto('platform.data_authority_transition_domains')
        .values({ tenant_id: tx.tenantId, transition_id: id, property_id: propertyId, domain })
        .execute();
    }
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError(
        'transition_already_open',
        'Another authority transition for one of these domains is already planned or frozen at this property. Complete or cancel it first.',
        { domains },
      );
    }
    throw err;
  }
  await tx.audit({
    action: 'platform.authorityTransition.plan',
    target: { type: 'authority_transition', id },
    propertyId,
    reason: input.reason,
    after: input,
  });
  await tx.emit({
    type: 'platform.authorityTransition.planned',
    propertyId,
    aggregate: { type: 'authority_transition', id },
    payload: { transitionId: id, propertyId, domains },
  });
  return toTransition(row);
}

async function load(tx: TxContext, id: string) {
  const r = await db(tx)
    .selectFrom('platform.data_authority_transitions')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!r) throw new NotFoundError('authority_transition', id);
  requirePermission(tx, 'platform.dataAuthority.manage', { propertyId: r.property_id });
  return r;
}

function assertMove(from: TransitionStatus, to: TransitionStatus) {
  if (!canMoveTransition(from, to))
    throw new BusinessRuleError('invalid_transition_step', `A ${from} transition cannot become ${to}.`, {
      from,
      to,
    });
}

export async function approveAuthorityTransition(tx: TxContext, id: string, note?: string) {
  const r = await load(tx, id);
  if (r.status !== 'planned')
    throw new BusinessRuleError('invalid_transition_step', 'Only a planned transition can be approved.');
  assertHumanApprover(tx, 'A change of system of record');
  if (r.planned_by === responsiblePerson(tx.actor) || r.planned_by === actorKey(tx)) {
    throw new BusinessRuleError(
      'segregation_of_duties',
      'The person who planned a change of system of record cannot approve it. Ask another manager with data-authority rights.',
      { plannedBy: r.planned_by },
    );
  }
  const row = await db(tx)
    .updateTable('platform.data_authority_transitions')
    .set({ approved_by: actorKey(tx), approved_at: tx.now, version: sql`version + 1` })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'platform.authorityTransition.approve',
    target: { type: 'authority_transition', id },
    propertyId: r.property_id,
    reason: note ?? null,
  });
  return toTransition(row);
}

/** Start the freeze: writes in the moved domains are refused in Portico until the transition completes. */
export async function freezeAuthorityTransition(tx: TxContext, id: string) {
  const r = await load(tx, id);
  assertMove(r.status, 'frozen');
  if (r.approval_required && !r.approved_by) {
    throw new BusinessRuleError(
      'approval_required',
      'This transition moves charges, payments, accounting or availability and must be approved by a second person before the freeze.',
    );
  }
  const expected = new Date(tx.now.getTime() + r.freeze_minutes * 60_000);
  const row = await db(tx)
    .updateTable('platform.data_authority_transitions')
    .set({ status: 'frozen', frozen_at: tx.now, expected_end_at: expected, version: sql`version + 1` })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'platform.authorityTransition.freeze',
    target: { type: 'authority_transition', id },
    propertyId: r.property_id,
    after: { expectedEndAt: expected.toISOString() },
  });
  await tx.emit({
    type: 'platform.authorityTransition.frozen',
    propertyId: r.property_id,
    aggregate: { type: 'authority_transition', id },
    payload: {
      transitionId: id,
      domains: (r.changes as Change[]).map((c) => c.domain),
      expectedEndAt: expected.toISOString(),
    },
  });
  return toTransition(row);
}

/**
 * Make the transition effective: in one transaction every authority row is updated with a history version, the
 * open-transition locks are released and `platform.dataAuthority.changed` is emitted once per domain. Refused while
 * the integration still has pending forwarded operations for these domains (ST-08).
 */
export async function completeAuthorityTransition(tx: TxContext, ports: PlatformPorts, id: string) {
  const r = await load(tx, id);
  assertMove(r.status, 'effective');
  const changes = r.changes as Change[];
  if (!ports.transitionGuard) {
    // P2-5: without the integration's guard nobody can tell whether forwarded changes are still waiting, so a
    // domain that currently forwards writes cannot move (fail closed).
    for (const c of changes) {
      const current = await getDataAuthority(tx, r.property_id, c.domain);
      if (current.writeMode === 'forward' && c.writeMode !== 'forward')
        throw new BusinessRuleError(
          'pending_operations_unknown',
          `Portico cannot check for forwarded ${c.domain} changes still waiting for the other system (the integration check is not available on this server). Try again when it is, or contact support.`,
          { domain: c.domain },
        );
    }
  }
  const pending = ports.transitionGuard
    ? await ports.transitionGuard.pendingOperations(
        tx,
        r.property_id,
        changes.map((c) => c.domain),
      )
    : [];
  if (pending.length) {
    throw new BusinessRuleError(
      'pending_operations',
      `${pending.length} forwarded change(s) are still waiting for the other system to confirm. Resolve them before making the transition effective.`,
      { pending },
    );
  }
  for (const c of changes) {
    await writeAuthorityVersion(tx, {
      propertyId: r.property_id,
      domain: c.domain,
      authority: c.authority,
      connectionId: c.connectionId,
      systemName: c.systemName,
      writeMode: c.writeMode,
      reason: r.reason,
      approvedBy: r.approved_by,
      transitionId: r.id,
    });
  }
  await db(tx)
    .updateTable('platform.data_authority_transition_domains')
    .set({ open: false })
    .where('transition_id', '=', id)
    .execute();
  const row = await db(tx)
    .updateTable('platform.data_authority_transitions')
    .set({ status: 'effective', effective_at: tx.now, version: sql`version + 1` })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'platform.authorityTransition.complete',
    target: { type: 'authority_transition', id },
    propertyId: r.property_id,
  });
  await tx.emit({
    type: 'platform.authorityTransition.completed',
    propertyId: r.property_id,
    aggregate: { type: 'authority_transition', id },
    payload: { transitionId: id, domains: changes.map((c) => c.domain) },
  });
  return toTransition(row);
}

export async function cancelAuthorityTransition(tx: TxContext, id: string, reason: string) {
  const r = await load(tx, id);
  assertMove(r.status, 'cancelled');
  await db(tx)
    .updateTable('platform.data_authority_transition_domains')
    .set({ open: false })
    .where('transition_id', '=', id)
    .execute();
  const row = await db(tx)
    .updateTable('platform.data_authority_transitions')
    .set({
      status: 'cancelled',
      cancelled_at: tx.now,
      cancelled_by: actorKey(tx),
      cancel_reason: reason,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'platform.authorityTransition.cancel',
    target: { type: 'authority_transition', id },
    propertyId: r.property_id,
    reason,
  });
  return toTransition(row);
}

export async function listAuthorityTransitions(tx: TxContext, propertyId: string) {
  requirePermission(tx, 'platform.property.read', { propertyId });
  const rows = await db(tx)
    .selectFrom('platform.data_authority_transitions')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('planned_at', 'desc')
    .execute();
  return rows.map(toTransition);
}
