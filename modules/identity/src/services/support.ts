import { type PorticoDatabase, type Selectable, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import {
  type Actor,
  BusinessRuleError,
  constantTimeEqual,
  ForbiddenError,
  isUuid,
  NotFoundError,
  newId,
  type PermissionDefinition,
  type RequestContext,
  randomToken,
  requirePermission,
  sha256Hex,
  staticAuthorizer,
  systemAuthorizer,
  type TenantEnvironment,
  ValidationError,
} from '@portico/kernel';
import { isReadPermission } from '../domain/permissions';
import type { Operator, OperatorDirectory } from '../ports';
import type { IdentityDB } from '../tables';
import { assertHumanApprover } from './guard';
import { getSecurityPolicy } from './policy';
import { raiseSecurityAlert } from './security';

/**
 * Monoclay support access (readiness brief §13; security-privacy-readiness §5; IDN-R20, IDN-I06).
 *  - No standing access: an operator requests a time-boxed, reasoned session for one organization (ticket ref,
 *    scope read_only | read_write, optional property list).
 *  - The organization approves (default), or its policy pre-approves read-only sessions. Write access always needs
 *    approval. The organization sees every session and its access log, and can revoke at any time.
 *  - The session token (`pss.<tenant>.<secret>`) works only while approved and inside [starts_at, ends_at).
 *  - Every request made with it is logged; every audit record carries the operator marker on the actor.
 *  - Sensitive (⚑) permissions are never available to support; read-only sessions get only `*.read` permissions.
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

/**
 * Operator principals are separate from tenant users. Interim implementation: operators and the SHA-256 of their
 * console tokens come from configuration (`PORTICO_OPERATORS`, JSON array of { id, name, email, tokenSha256 }), so
 * the server never holds the tokens themselves. To be replaced by AWS IAM Identity Center (SSO with MFA) before any
 * live hotel data exists (see README "Operator authentication").
 */
export function operatorDirectoryFromConfig(raw: string | undefined): OperatorDirectory {
  const entries: Array<Operator & { tokenSha256: string }> = [];
  if (raw?.trim()) {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('PORTICO_OPERATORS must be a JSON array');
    for (const e of parsed as Array<Record<string, unknown>>) {
      const { id, name, email, tokenSha256 } = e;
      if (
        typeof id !== 'string' ||
        !isUuid(id) ||
        typeof name !== 'string' ||
        typeof email !== 'string' ||
        typeof tokenSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(tokenSha256)
      ) {
        throw new Error(
          'Each PORTICO_OPERATORS entry needs id (uuid), name, email and tokenSha256 (64 hex chars)',
        );
      }
      entries.push({ id, name, email, tokenSha256 });
    }
  }
  return {
    authenticate(token) {
      const [kind, operatorId, secret] = token.split('.');
      if (kind !== 'pto' || !operatorId || !secret || secret.length < 32) return null;
      const op = entries.find((o) => o.id === operatorId);
      if (!op || !constantTimeEqual(sha256Hex(token), op.tokenSha256)) return null;
      return { id: op.id, name: op.name, email: op.email };
    },
  };
}

/** The actor recorded for everything done in a support session (distinct marker on every audit record). */
export function supportActor(operator: { id: string; name: string }, supportSessionId: string): Actor {
  const actor: Actor & { via: 'support'; supportSessionId: string; operatorId: string } = {
    kind: 'user',
    userId: operator.id,
    displayName: `Monoclay support: ${operator.name}`,
    sessionId: supportSessionId,
    impersonatedBy: `monoclay-operator:${operator.id}`,
    via: 'support',
    supportSessionId,
    operatorId: operator.id,
  };
  return actor;
}

export function isSupportActor(actor: Actor): boolean {
  return actor.kind === 'user' && !!actor.impersonatedBy?.startsWith('monoclay-operator:');
}

async function operatorContext(
  database: PorticoDatabase,
  operator: Operator,
  organizationId: string,
): Promise<RequestContext> {
  const { rows } = await sql<{ environment: string; status: string }>`
    select environment, status from platform.tenant_summaries(${[organizationId]}::uuid[])`.execute(
    database.kysely,
  );
  const org = rows[0];
  if (!org || org.status === 'closed') throw new NotFoundError('organization', organizationId);
  return {
    tenantId: organizationId,
    environment: org.environment as TenantEnvironment,
    actor: {
      kind: 'user',
      userId: operator.id,
      displayName: `Monoclay support: ${operator.name}`,
      impersonatedBy: `monoclay-operator:${operator.id}`,
    },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
}

export interface SupportSessionView {
  id: string;
  operatorId: string;
  operatorName: string;
  reason: string;
  ticketRef: string;
  scope: 'read_only' | 'read_write';
  propertyIds: string[] | null;
  durationMinutes: number;
  status: 'pending_approval' | 'active' | 'declined' | 'ended' | 'revoked' | 'expired';
  requestedAt: string;
  approvedBy: string | null;
  approvalMode: string | null;
  startsAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
}

function view(r: Selectable<IdentityDB['identity.support_sessions']>, now: Date): SupportSessionView {
  const expired = r.status === 'active' && r.ends_at !== null && r.ends_at <= now;
  return {
    id: r.id,
    operatorId: r.operator_id,
    operatorName: r.operator_name,
    reason: r.reason,
    ticketRef: r.ticket_ref,
    scope: r.access_scope,
    propertyIds: r.property_ids,
    durationMinutes: r.duration_minutes,
    status: expired ? 'expired' : r.status,
    requestedAt: r.requested_at.toISOString(),
    approvedBy: r.approved_by,
    approvalMode: r.approval_mode,
    startsAt: r.starts_at?.toISOString() ?? null,
    endsAt: r.ends_at?.toISOString() ?? null,
    endedAt: r.ended_at?.toISOString() ?? null,
  };
}

/** Operator: request access to one organization. Returns the session token once (store it in the console only). */
export async function requestSupportSession(
  database: PorticoDatabase,
  operator: Operator,
  input: {
    organizationId: string;
    reason: string;
    ticketRef: string;
    scope: 'read_only' | 'read_write';
    durationMinutes: number;
    propertyIds?: string[] | undefined;
  },
): Promise<{ session: SupportSessionView; token: string }> {
  const ctx = await operatorContext(database, operator, input.organizationId);
  return withTenantTx(database, ctx, async (tx) => {
    const policy = await getSecurityPolicy(tx);
    if (input.durationMinutes > policy.supportMaxMinutes) {
      throw new ValidationError(
        'support_duration_too_long',
        `This organization allows support sessions of at most ${policy.supportMaxMinutes} minutes.`,
      );
    }
    const auto = input.scope === 'read_only' && policy.supportAccessApproval === 'auto_approve_read_only';
    const id = newId();
    const token = `pss.${input.organizationId}.${randomToken(32)}`;
    const ends = new Date(tx.now.getTime() + input.durationMinutes * 60_000);
    await db(tx)
      .insertInto('identity.support_sessions')
      .values({
        id,
        tenant_id: tx.tenantId,
        operator_id: operator.id,
        operator_name: operator.name,
        reason: input.reason,
        ticket_ref: input.ticketRef,
        access_scope: input.scope,
        property_ids: input.propertyIds?.length ? input.propertyIds : null,
        duration_minutes: input.durationMinutes,
        status: auto ? 'active' : 'pending_approval',
        token_hash: sha256Hex(token),
        requested_at: tx.now,
        approved_by: auto ? 'policy:auto_approve_read_only' : null,
        approved_at: auto ? tx.now : null,
        approval_mode: auto ? 'policy_auto_read_only' : null,
        starts_at: auto ? tx.now : null,
        ends_at: auto ? ends : null,
        ended_at: null,
        ended_by: null,
        end_reason: null,
      })
      .execute();
    await tx.audit({
      action: 'identity.supportSession.request',
      target: { type: 'support_session', id },
      reason: input.reason,
      after: { ticketRef: input.ticketRef, scope: input.scope, durationMinutes: input.durationMinutes, auto },
    });
    await tx.emit({
      type: auto ? 'identity.supportSession.started' : 'identity.supportSession.requested',
      aggregate: { type: 'support_session', id },
      payload: {
        supportSessionId: id,
        operatorName: operator.name,
        scope: input.scope,
        ticketRef: input.ticketRef,
      },
    });
    await raiseSecurityAlert(tx, {
      rule: 'support_session_started',
      severity: 'low',
      summary: `Monoclay support (${operator.name}) ${auto ? 'started' : 'requested'} a ${input.scope.replace('_', '-')} session: ${input.reason}`,
      details: { supportSessionId: id, ticketRef: input.ticketRef },
      dedupeKey: `support:${id}`,
    });
    const row = await db(tx)
      .selectFrom('identity.support_sessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return { session: view(row, tx.now), token };
  });
}

async function loadForDecision(tx: TxContext, id: string) {
  const r = await db(tx)
    .selectFrom('identity.support_sessions')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!r) throw new NotFoundError('support_session', id);
  return r;
}

/** Customer: approve a pending request. The time box starts now. */
export async function approveSupportSession(
  tx: TxContext,
  id: string,
  note?: string,
): Promise<SupportSessionView> {
  requirePermission(tx, 'identity.supportAccess.approve');
  if (isSupportActor(tx.actor)) throw new ForbiddenError('identity.supportAccess.approve');
  assertHumanApprover(tx, 'Monoclay support access');
  const r = await loadForDecision(tx, id);
  if (r.status !== 'pending_approval')
    throw new BusinessRuleError(
      'support_session_not_pending',
      `This support session is ${r.status.replace('_', ' ')}.`,
    );
  const row = await db(tx)
    .updateTable('identity.support_sessions')
    .set({
      status: 'active',
      approved_by: `${tx.actor.kind}:${tx.actor.kind === 'user' ? tx.actor.userId : 'system'}`,
      approved_at: tx.now,
      approval_mode: 'customer',
      starts_at: tx.now,
      ends_at: new Date(tx.now.getTime() + r.duration_minutes * 60_000),
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'identity.supportSession.approve',
    target: { type: 'support_session', id },
    reason: note ?? null,
  });
  await tx.emit({
    type: 'identity.supportSession.started',
    aggregate: { type: 'support_session', id },
    payload: { supportSessionId: id, operatorName: r.operator_name, scope: r.access_scope },
  });
  return view(row, tx.now);
}

async function close(
  tx: TxContext,
  id: string,
  to: 'declined' | 'revoked' | 'ended',
  reason: string | undefined,
  allowed: ReadonlyArray<IdentityDB['identity.support_sessions']['status']>,
) {
  const r = await loadForDecision(tx, id);
  if (!allowed.includes(r.status))
    throw new BusinessRuleError(
      'support_session_not_open',
      `This support session is already ${r.status.replace('_', ' ')}.`,
    );
  const row = await db(tx)
    .updateTable('identity.support_sessions')
    .set({
      status: to,
      ended_at: tx.now,
      ended_by: `${tx.actor.kind}:${tx.actor.kind === 'user' ? tx.actor.userId : 'system'}`,
      end_reason: reason ?? null,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: `identity.supportSession.${to}`,
    target: { type: 'support_session', id },
    reason: reason ?? null,
  });
  await tx.emit({
    type: 'identity.supportSession.ended',
    aggregate: { type: 'support_session', id },
    payload: { supportSessionId: id, outcome: to },
  });
  return view(row, tx.now);
}

export async function declineSupportSession(tx: TxContext, id: string, note?: string) {
  requirePermission(tx, 'identity.supportAccess.approve');
  return close(tx, id, 'declined', note, ['pending_approval']);
}

/** Customer: stop a pending or running support session immediately. */
export async function revokeSupportSession(tx: TxContext, id: string, reason?: string) {
  requirePermission(tx, 'identity.supportAccess.approve');
  return close(tx, id, 'revoked', reason, ['pending_approval', 'active']);
}

/** Operator: end their session early. */
export async function endSupportSession(
  database: PorticoDatabase,
  operator: Operator,
  organizationId: string,
  id: string,
) {
  const ctx = await operatorContext(database, operator, organizationId);
  return withTenantTx(database, ctx, async (tx) => {
    const r = await loadForDecision(tx, id);
    if (r.operator_id !== operator.id) throw new NotFoundError('support_session', id);
    return close(tx, id, 'ended', 'ended by operator', ['pending_approval', 'active']);
  });
}

export async function getSupportSessionForOperator(
  database: PorticoDatabase,
  operator: Operator,
  organizationId: string,
  id: string,
) {
  const ctx = await operatorContext(database, operator, organizationId);
  return withTenantTx(database, ctx, async (tx) => {
    const r = await db(tx)
      .selectFrom('identity.support_sessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r || r.operator_id !== operator.id) throw new NotFoundError('support_session', id);
    return view(r, tx.now);
  });
}

/** Customer: every support session (the support-access log visible to organization admins). */
export async function listSupportSessions(tx: TxContext): Promise<SupportSessionView[]> {
  requirePermission(tx, 'identity.supportAccess.read');
  const rows = await db(tx)
    .selectFrom('identity.support_sessions')
    .selectAll()
    .orderBy('requested_at', 'desc')
    .execute();
  return rows.map((r) => view(r, tx.now));
}

export async function getSupportAccessLog(tx: TxContext, id: string) {
  requirePermission(tx, 'identity.supportAccess.read');
  const rows = await db(tx)
    .selectFrom('identity.support_access_log')
    .select(['occurred_at', 'method', 'path'])
    .where('support_session_id', '=', id)
    .orderBy('occurred_at')
    .execute();
  return rows.map((r) => ({ occurredAt: r.occurred_at.toISOString(), method: r.method, path: r.path }));
}

/** Permissions a support session may use: never sensitive ones; read-only sessions only `*.read`. */
export function supportGrants(
  catalog: readonly PermissionDefinition[],
  scope: 'read_only' | 'read_write',
  propertyIds: string[] | null,
) {
  const allowed = catalog.filter((p) => !p.sensitive && (scope === 'read_write' || isReadPermission(p.key)));
  return allowed.map((p) => ({ permission: p.key, propertyIds: propertyIds ?? ('all' as const) }));
}

/**
 * Resolve a support token inside the organization's transaction. Null unless the session is active and inside its
 * window. Logs the request in the support access log.
 */
export async function authenticateSupportToken(
  tx: TxContext,
  token: string,
  catalog: readonly PermissionDefinition[] | undefined,
  request?: { method: string; path: string },
) {
  const r = await db(tx)
    .selectFrom('identity.support_sessions')
    .selectAll()
    .where('token_hash', '=', sha256Hex(token))
    .executeTakeFirst();
  if (r?.status !== 'active' || !r.starts_at || !r.ends_at || r.starts_at > tx.now || r.ends_at <= tx.now)
    return null;
  if (request) {
    await db(tx)
      .insertInto('identity.support_access_log')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        support_session_id: r.id,
        occurred_at: tx.now,
        method: request.method.slice(0, 10),
        path: request.path.split('?')[0]?.slice(0, 500) ?? '',
      })
      .execute();
  }
  return {
    actor: supportActor({ id: r.operator_id, name: r.operator_name }, r.id),
    authz: staticAuthorizer(supportGrants(catalog ?? [], r.access_scope, r.property_ids)),
  };
}
