import { type PorticoDatabase, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import {
  assertExternalEffectAllowed,
  BusinessRuleError,
  ConflictError,
  DomainError,
  type EffectMode,
  type ExternalEffect,
  localDateIn,
  NotFoundError,
  newId,
  type RequestContext,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import {
  type ActivationScopeContent,
  type ChecklistItem,
  canTransition,
  checklistBlocks,
  decideEffect,
  decideWorkflow,
  type PropertyStatus,
  requiresApproval,
  type ScopeStage,
  validateScope,
} from '../domain/activation';
import type { PlatformPorts } from '../ports';
import { actorKey, assertHumanApprover, getLimit, responsiblePerson } from '../service';
import type { ActivationRequestsTable, PlatformDB } from '../tables';

/**
 * Property activation (adoption brief §3 stages 4–5, §11; PLT-R14; gap G-04; evaluation-and-trial.md §6).
 * `setup → pilot` and `→ active` need a request by one person and approval by a different person holding
 * `platform.property.activate` (sensitive). Each activation installs an approved, versioned scope document that
 * `assertEffectInScope` / `assertWorkflowInScope` enforce. One property's activation never changes another's.
 */
const db = (tx: TxContext) => typed<PlatformDB>(tx.db);

type RequestRow = Omit<ActivationRequestsTable, 'version'> & { version: number };

function toRequest(r: RequestRow) {
  return {
    id: r.id,
    propertyId: r.property_id,
    kind: r.kind,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    scopeStage: r.scope_stage,
    scope: (r.scope_content ?? null) as ActivationScopeContent | null,
    reason: r.reason,
    checklist: (r.checklist ?? []) as ChecklistItem[],
    status: r.status,
    requestedBy: r.requested_by,
    decidedBy: r.decided_by,
    decisionNote: r.decision_note,
    version: r.version,
  };
}

async function loadProperty(tx: TxContext, propertyId: string) {
  const p = await db(tx)
    .selectFrom('platform.properties')
    .select(['id', 'status', 'timezone', 'name'])
    .where('id', '=', propertyId)
    .executeTakeFirst();
  if (!p) throw new NotFoundError('property', propertyId);
  return p;
}

/** Latest approved scope of a stage (pilot / production), or null. */
export async function getApprovedScope(tx: TxContext, propertyId: string, stage: ScopeStage) {
  const row = await db(tx)
    .selectFrom('platform.activation_scopes')
    .select(['version', 'content', 'approved_by', 'approved_at', 'id'])
    .where('property_id', '=', propertyId)
    .where('stage', '=', stage)
    .orderBy('version', 'desc')
    .executeTakeFirst();
  return row
    ? {
        id: row.id,
        version: row.version,
        content: row.content as ActivationScopeContent,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
      }
    : null;
}

/** The scope currently governing a property: pilot scope while in pilot, production scope when active. */
export async function getActivationScope(tx: TxContext, propertyId: string) {
  const p = await loadProperty(tx, propertyId);
  const stage: ScopeStage | null =
    p.status === 'pilot' ? 'pilot' : p.status === 'active' ? 'production' : null;
  const scope = stage ? await getApprovedScope(tx, propertyId, stage) : null;
  return { propertyId, status: p.status as PropertyStatus, stage, scope };
}

/** Pilot scope settings of a property (which modules/workflows are live in the pilot). */
export async function getPilotScope(tx: TxContext, propertyId: string) {
  requirePermission(tx, 'platform.property.read', { propertyId });
  return getApprovedScope(tx, propertyId, 'pilot');
}

async function checklist(
  tx: TxContext,
  ports: PlatformPorts,
  propertyId: string,
  fromStatus: PropertyStatus,
  toStatus: 'pilot' | 'active',
  scope: ActivationScopeContent | null,
): Promise<ChecklistItem[]> {
  const items: ChecklistItem[] = [];
  items.push({
    key: 'platform.liveEnvironment',
    label: 'Organization is the live environment',
    level: 'blocker',
    passed: tx.environment === 'live',
    ...(tx.environment === 'live'
      ? {}
      : {
          detail: `This is a ${tx.environment} organization; pilots and production activation happen only in live.`,
        }),
  });
  if (fromStatus === 'setup') {
    const limit = await getLimit(tx, 'limits.properties');
    const { n } = await db(tx)
      .selectFrom('platform.properties')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('status', 'in', ['pilot', 'active'])
      .executeTakeFirstOrThrow();
    items.push({
      key: 'platform.propertyLimit',
      label: 'Plan allows another pilot or active property',
      level: 'blocker',
      passed: limit === null || n < limit,
      ...(limit !== null && n >= limit
        ? { detail: `Your plan allows ${limit} pilot or active propert${limit === 1 ? 'y' : 'ies'}.` }
        : {}),
    });
  }
  const stage: ScopeStage = toStatus === 'pilot' ? 'pilot' : 'production';
  const effectiveScope = scope ?? (await getApprovedScope(tx, propertyId, stage))?.content ?? null;
  if (toStatus === 'pilot') {
    items.push({
      key: 'platform.pilotScope',
      label: 'Pilot scope defined (effects, workflows, window, success criteria, rollback)',
      level: 'blocker',
      passed: effectiveScope !== null && validateScope('pilot', effectiveScope).length === 0,
      ...(effectiveScope ? { detail: validateScope('pilot', effectiveScope).join(' ') || undefined } : {}),
    });
  } else if (effectiveScope) {
    const problems = validateScope('production', effectiveScope);
    items.push({
      key: 'platform.productionScope',
      label: 'Production scope is valid',
      level: 'blocker',
      passed: problems.length === 0,
      ...(problems.length ? { detail: problems.join(' ') } : {}),
    });
  }
  if (fromStatus === 'pilot' && toStatus === 'active') {
    const pilot = await getApprovedScope(tx, propertyId, 'pilot');
    const p = await loadProperty(tx, propertyId);
    const today = localDateIn(tx.now, p.timezone);
    items.push({
      key: 'platform.pilotWindowCompleted',
      label: 'Pilot window has ended and results were reviewed',
      level: 'warning',
      passed: !!pilot?.content.endsOn && today > pilot.content.endsOn,
    });
  }
  for (const provider of ports.activationChecks ?? [])
    items.push(...(await provider.check(tx, propertyId, toStatus)));
  return items.map((i) =>
    i.detail === undefined ? { key: i.key, label: i.label, level: i.level, passed: i.passed } : i,
  );
}

/** Activation page: status, allowed transitions, current scopes, pending request, history. */
export async function getActivationOverview(tx: TxContext, propertyId: string) {
  requirePermission(tx, 'platform.property.read', { propertyId });
  const p = await loadProperty(tx, propertyId);
  const status = p.status as PropertyStatus;
  const pending = await db(tx)
    .selectFrom('platform.activation_requests')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  const history = await db(tx)
    .selectFrom('platform.property_status_history')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('changed_at')
    .execute();
  const scope = async (stage: ScopeStage) => {
    const s = await getApprovedScope(tx, propertyId, stage);
    return s ? { version: s.version, content: s.content, approvedBy: s.approvedBy } : null;
  };
  return {
    propertyId,
    status,
    allowedTransitions: (['setup', 'pilot', 'active', 'inactive'] as const).filter((t) =>
      canTransition(status, t),
    ),
    scopes: { pilot: await scope('pilot'), production: await scope('production') },
    pendingRequest: pending ? toRequest(pending) : null,
    history: history.map((h) => ({
      fromStatus: h.from_status,
      toStatus: h.to_status,
      requestedBy: h.requested_by,
      approvedBy: h.approved_by,
      reason: h.reason,
      changedAt: h.changed_at.toISOString(),
    })),
  };
}

async function insertRequest(tx: TxContext, values: Omit<RequestRow, 'id' | 'tenant_id' | 'version'>) {
  try {
    return await db(tx)
      .insertInto('platform.activation_requests')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        ...values,
        scope_content: values.scope_content === null ? null : JSON.stringify(values.scope_content),
        checklist: JSON.stringify(values.checklist),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new BusinessRuleError(
        'activation_request_pending',
        'This property already has an activation request waiting for a decision. Decide or cancel it first.',
      );
    }
    throw err;
  }
}

/** Request `setup → pilot`, `setup → active` or `pilot → active` (approved later by someone else). */
export async function requestStatusChange(
  tx: TxContext,
  ports: PlatformPorts,
  propertyId: string,
  input: { toStatus: 'pilot' | 'active'; reason: string; scope?: ActivationScopeContent | undefined },
) {
  requirePermission(tx, 'platform.property.update', { propertyId });
  const p = await loadProperty(tx, propertyId);
  const from = p.status as PropertyStatus;
  if (!canTransition(from, input.toStatus)) {
    throw new BusinessRuleError(
      'invalid_status_transition',
      `A property in ${from} cannot move to ${input.toStatus}.`,
      { from, to: input.toStatus },
    );
  }
  const stage: ScopeStage = input.toStatus === 'pilot' ? 'pilot' : 'production';
  if (input.scope) {
    const problems = validateScope(stage, input.scope);
    if (problems.length) throw new ValidationError('invalid_scope', problems.join(' '), { problems });
  }
  const items = await checklist(tx, ports, propertyId, from, input.toStatus, input.scope ?? null);
  const row = await insertRequest(tx, {
    property_id: propertyId,
    kind: 'status_change',
    from_status: from,
    to_status: input.toStatus,
    scope_stage: input.scope ? stage : null,
    scope_content: input.scope ?? null,
    reason: input.reason,
    checklist: items,
    status: 'pending',
    requested_by: responsiblePerson(tx.actor),
    requested_at: tx.now,
    decided_by: null,
    decided_at: null,
    decision_note: null,
  });
  await tx.audit({
    action: 'platform.activation.request',
    target: { type: 'property', id: propertyId },
    propertyId,
    reason: input.reason,
    after: { from, to: input.toStatus, scope: input.scope ?? null, checklist: items },
  });
  return toRequest(row);
}

/** Propose a new version of the pilot or production scope (a scope change is a new version with approval). */
export async function requestScopeChange(
  tx: TxContext,
  propertyId: string,
  input: { stage: ScopeStage; scope: ActivationScopeContent; reason: string },
) {
  requirePermission(tx, 'platform.property.update', { propertyId });
  const p = await loadProperty(tx, propertyId);
  const problems = validateScope(input.stage, input.scope);
  if (problems.length) throw new ValidationError('invalid_scope', problems.join(' '), { problems });
  const row = await insertRequest(tx, {
    property_id: propertyId,
    kind: 'scope_change',
    from_status: p.status,
    to_status: null,
    scope_stage: input.stage,
    scope_content: input.scope,
    reason: input.reason,
    checklist: [],
    status: 'pending',
    requested_by: responsiblePerson(tx.actor),
    requested_at: tx.now,
    decided_by: null,
    decided_at: null,
    decision_note: null,
  });
  await tx.audit({
    action: 'platform.activationScope.request',
    target: { type: 'property', id: propertyId },
    propertyId,
    reason: input.reason,
    after: { stage: input.stage, scope: input.scope },
  });
  return toRequest(row);
}

async function loadPending(tx: TxContext, requestId: string) {
  const r = await db(tx)
    .selectFrom('platform.activation_requests')
    .selectAll()
    .where('id', '=', requestId)
    .forUpdate()
    .executeTakeFirst();
  if (!r || !tx.authz.can('platform.property.read', { propertyId: r.property_id }))
    throw new NotFoundError('activation_request', requestId);
  if (r.status !== 'pending')
    throw new BusinessRuleError('request_not_pending', `This activation request is already ${r.status}.`);
  return r;
}

async function recordStatusChange(
  tx: TxContext,
  input: {
    propertyId: string;
    from: string;
    to: PropertyStatus;
    requestId: string | null;
    requestedBy: string;
    approvedBy: string | null;
    reason: string;
  },
) {
  const res = await db(tx)
    .updateTable('platform.properties')
    .set({ status: input.to, version: sql`version + 1` })
    .where('id', '=', input.propertyId)
    .where('status', '=', input.from as PropertyStatus)
    .executeTakeFirst();
  // P3-7: never record a status change that did not happen (the property moved concurrently).
  if (Number(res.numUpdatedRows) !== 1)
    throw new ConflictError(
      'property_status_changed',
      `The property is no longer ${input.from}; someone changed it at the same time. Reload and try again.`,
    );
  await db(tx)
    .insertInto('platform.property_status_history')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      from_status: input.from,
      to_status: input.to,
      request_id: input.requestId,
      requested_by: input.requestedBy,
      approved_by: input.approvedBy,
      reason: input.reason,
      changed_at: tx.now,
    })
    .execute();
  await tx.audit({
    action: 'platform.property.statusChange',
    target: { type: 'property', id: input.propertyId },
    propertyId: input.propertyId,
    reason: input.reason,
    before: { status: input.from },
    after: { status: input.to, approvedBy: input.approvedBy, requestId: input.requestId },
  });
  await tx.emit({
    type: 'platform.property.statusChanged',
    propertyId: input.propertyId,
    aggregate: { type: 'property', id: input.propertyId },
    payload: { propertyId: input.propertyId, from: input.from, to: input.to, approvedBy: input.approvedBy },
  });
}

/**
 * Approve an activation or scope request. The approver must hold `platform.property.activate` for the property and
 * must not be the requester. Blockers on a fresh checklist prevent approval.
 */
export async function approveActivationRequest(
  tx: TxContext,
  ports: PlatformPorts,
  requestId: string,
  input: { note?: string | undefined } = {},
) {
  const r = await loadPending(tx, requestId);
  requirePermission(tx, 'platform.property.activate', { propertyId: r.property_id });
  assertHumanApprover(tx, 'A property status or scope change');
  // P2-8: one approval at a time per organization, so two concurrent approvals cannot exceed the property limit.
  await sql`select pg_advisory_xact_lock(hashtextextended(${`platform.activation:${tx.tenantId}`}, 0))`.execute(
    tx.db,
  );
  if (r.requested_by === responsiblePerson(tx.actor) || r.requested_by === actorKey(tx)) {
    throw new BusinessRuleError(
      'segregation_of_duties',
      'The person who requested an activation cannot approve it. Ask another manager with activation rights.',
      { requestedBy: r.requested_by },
    );
  }
  const p = await loadProperty(tx, r.property_id);
  if (p.status !== r.from_status) {
    throw new BusinessRuleError(
      'property_status_changed',
      `The property is now ${p.status}, not ${r.from_status} as when this was requested. Cancel this request and create a new one.`,
    );
  }
  let items: ChecklistItem[] = [];
  if (r.kind === 'status_change' && r.to_status && (r.to_status === 'pilot' || r.to_status === 'active')) {
    items = await checklist(
      tx,
      ports,
      r.property_id,
      r.from_status as PropertyStatus,
      r.to_status,
      (r.scope_content ?? null) as ActivationScopeContent | null,
    );
    if (checklistBlocks(items)) {
      throw new BusinessRuleError(
        'activation_blocked',
        `Activation is blocked: ${items
          .filter((i) => i.level === 'blocker' && !i.passed)
          .map((i) => i.label + (i.detail ? ` (${i.detail})` : ''))
          .join('; ')}. Resolve the blockers, then approve again.`,
        { checklist: items },
      );
    }
  }
  if (r.scope_stage && r.scope_content) {
    const prev = await getApprovedScope(tx, r.property_id, r.scope_stage);
    await db(tx)
      .insertInto('platform.activation_scopes')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        property_id: r.property_id,
        stage: r.scope_stage,
        version: (prev?.version ?? 0) + 1,
        content: JSON.stringify(r.scope_content),
        request_id: r.id,
        approved_by: actorKey(tx),
        approved_at: tx.now,
      })
      .execute();
    await tx.audit({
      action: 'platform.activationScope.approve',
      target: { type: 'property', id: r.property_id },
      propertyId: r.property_id,
      before: prev?.content ?? null,
      after: r.scope_content,
      metadata: { stage: r.scope_stage, version: (prev?.version ?? 0) + 1, requestId: r.id },
    });
    await tx.emit({
      type: 'platform.activationScope.approved',
      propertyId: r.property_id,
      aggregate: { type: 'property', id: r.property_id },
      payload: { propertyId: r.property_id, stage: r.scope_stage, version: (prev?.version ?? 0) + 1 },
    });
  }
  if (r.kind === 'status_change' && r.to_status) {
    await recordStatusChange(tx, {
      propertyId: r.property_id,
      from: r.from_status,
      to: r.to_status,
      requestId: r.id,
      requestedBy: r.requested_by,
      approvedBy: actorKey(tx),
      reason: r.reason,
    });
  }
  const row = await db(tx)
    .updateTable('platform.activation_requests')
    .set({
      status: 'approved',
      decided_by: actorKey(tx),
      decided_at: tx.now,
      decision_note: input.note ?? null,
      checklist: JSON.stringify(items.length ? items : (r.checklist ?? [])),
      version: sql`version + 1`,
    })
    .where('id', '=', requestId)
    .returningAll()
    .executeTakeFirstOrThrow();
  return toRequest(row);
}

export async function rejectActivationRequest(
  tx: TxContext,
  requestId: string,
  input: { note?: string | undefined },
) {
  const r = await loadPending(tx, requestId);
  requirePermission(tx, 'platform.property.activate', { propertyId: r.property_id });
  return closeRequest(tx, r.id, r.property_id, 'rejected', input.note);
}

export async function cancelActivationRequest(
  tx: TxContext,
  requestId: string,
  input: { note?: string | undefined },
) {
  const r = await loadPending(tx, requestId);
  if (r.requested_by !== responsiblePerson(tx.actor))
    requirePermission(tx, 'platform.property.activate', { propertyId: r.property_id });
  return closeRequest(tx, r.id, r.property_id, 'cancelled', input.note);
}

async function closeRequest(
  tx: TxContext,
  id: string,
  propertyId: string,
  status: 'rejected' | 'cancelled',
  note: string | undefined,
) {
  const row = await db(tx)
    .updateTable('platform.activation_requests')
    .set({
      status,
      decided_by: actorKey(tx),
      decided_at: tx.now,
      decision_note: note ?? null,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: `platform.activation.${status === 'rejected' ? 'reject' : 'cancel'}`,
    target: { type: 'property', id: propertyId },
    propertyId,
    reason: note ?? null,
  });
  return toRequest(row);
}

/**
 * Stop a pilot (`pilot → setup`) or deactivate (`active → inactive`). These reduce what is live, so they take
 * effect immediately (no second approver) but still need `platform.property.activate` and are recorded.
 */
export async function changePropertyStatusDirect(
  tx: TxContext,
  propertyId: string,
  input: { toStatus: 'setup' | 'inactive'; reason: string },
) {
  requirePermission(tx, 'platform.property.activate', { propertyId });
  const p = await loadProperty(tx, propertyId);
  const from = p.status as PropertyStatus;
  if (!canTransition(from, input.toStatus) || requiresApproval(input.toStatus)) {
    throw new BusinessRuleError(
      'invalid_status_transition',
      `A property in ${from} cannot move to ${input.toStatus} directly.`,
      { from, to: input.toStatus },
    );
  }
  await recordStatusChange(tx, {
    propertyId,
    from,
    to: input.toStatus,
    requestId: null,
    requestedBy: responsiblePerson(tx.actor),
    approvedBy: null,
    reason: input.reason,
  });
  return getActivationOverview(tx, propertyId);
}

/**
 * Activation-scope check for adapters, in addition to the kernel environment check (which it performs first).
 * Returns the effect mode to use. In non-live modes (simulate/sandbox) the scope adds nothing.
 * A refusal is always audited (EV-05). Pass `database` so the audit row is written in its own committed
 * transaction and survives the caller's rollback (P2-6); without it the row is part of the caller's transaction,
 * which is right only for callers that record a "blocked" outcome and commit.
 */
export async function assertEffectInScope(
  tx: TxContext,
  propertyId: string,
  effect: ExternalEffect,
  opts: { connectionId?: string; workflow?: string; database?: PorticoDatabase } = {},
): Promise<Exclude<EffectMode, 'blocked'>> {
  const mode = assertExternalEffectAllowed(tx, effect);
  if (mode !== 'live') return mode;
  const p = await loadProperty(tx, propertyId);
  const status = p.status as PropertyStatus;
  const stage: ScopeStage | null = status === 'pilot' ? 'pilot' : status === 'active' ? 'production' : null;
  const scope = stage ? await getApprovedScope(tx, propertyId, stage) : null;
  const decision = decideEffect({
    status,
    mode,
    effect,
    scope: scope?.content ?? null,
    today: localDateIn(tx.now, p.timezone),
    connectionId: opts.connectionId,
    workflow: opts.workflow,
  });
  if (decision.allowed) return mode;
  const scopeRef = scope ? `${stage} scope v${scope.version}` : `${status} status`;
  const refusal = {
    action: 'platform.activationScope.refuse',
    target: { type: 'property', id: propertyId },
    propertyId,
    reason: decision.reason,
    metadata: { effect, connectionId: opts.connectionId ?? null, workflow: opts.workflow ?? null, scopeRef },
  };
  if (opts.database) {
    const ctx: RequestContext = {
      tenantId: tx.tenantId,
      environment: tx.environment,
      actor: tx.actor,
      authz: tx.authz,
      correlationId: tx.correlationId,
    };
    await withTenantTx(opts.database, ctx, (audit) => audit.audit(refusal));
  } else {
    await tx.audit(refusal);
  }
  throw new DomainError(
    'effect_outside_activation_scope',
    `${p.name} is in ${status}; its approved ${scopeRef} does not allow "${effect}"${opts.workflow ? ` for ${opts.workflow}` : ''} (${decision.reason.replace(/_/g, ' ')}). Nothing was sent. Change the scope through an approved activation request if this should be live.`,
    {
      status: 403,
      details: {
        effect,
        propertyStatus: status,
        reason: decision.reason,
        scopeRef,
        connectionId: opts.connectionId ?? null,
        workflow: opts.workflow ?? null,
      },
    },
  );
}

/** Workflow-scope check: in a pilot only the approved workflows are live (e.g. `operations.housekeepingBoard`). */
export async function assertWorkflowInScope(
  tx: TxContext,
  propertyId: string,
  workflow: string,
): Promise<void> {
  const p = await loadProperty(tx, propertyId);
  const status = p.status as PropertyStatus;
  const stage: ScopeStage | null = status === 'pilot' ? 'pilot' : status === 'active' ? 'production' : null;
  const scope = stage ? await getApprovedScope(tx, propertyId, stage) : null;
  const d = decideWorkflow({
    status,
    scope: scope?.content ?? null,
    workflow,
    today: localDateIn(tx.now, p.timezone),
  });
  if (d.allowed) return;
  throw new BusinessRuleError(
    'workflow_outside_activation_scope',
    `"${workflow}" is not live at ${p.name} (${status}; ${d.reason.replace(/_/g, ' ')}). Ask a manager to add it to the approved scope.`,
    { workflow, propertyStatus: status, reason: d.reason },
  );
}
