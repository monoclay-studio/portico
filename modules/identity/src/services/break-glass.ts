import { sql, type TxContext, typed } from '@portico/db';
import {
  actorId,
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { IdentityPorts } from '../ports';
import type { IdentityDB } from '../tables';
import { hasActiveTotp, requireRecentStepUp } from './mfa';
import { getSecurityPolicy } from './policy';
import { raiseSecurityAlert } from './security';

/**
 * Break-glass emergency access (readiness brief §13 "controlled emergency access"; IDN-R19; SEC-6):
 *  - only members designated in the organization security policy may elevate;
 *  - elevation grants the policy's emergency role organization-wide on the CURRENT session only, for at most
 *    4 hours (policy maximum), with a mandatory reason (≥ 20 characters);
 *  - an MFA-enrolled member must have verified recently; elevation itself is a high-severity security alert
 *    emitted immediately (`identity.security.alert` + `identity.elevation.started`), and organization
 *    administrators are notified through the staff notifier;
 *  - it expires automatically (the authorizer ignores it after `ends_at`; no job needed);
 *  - every action is tagged on the actor (`via: 'elevation'`, `elevationId`), and each elevation stays flagged
 *    for post-incident review until a different administrator records the review.
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export async function startElevation(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'notifier'>,
  input: { reason: string; durationMinutes: number },
) {
  if (tx.actor.kind !== 'user' || !tx.actor.sessionId || tx.actor.impersonatedBy)
    throw new BusinessRuleError('not_a_user', 'Emergency access is for signed-in staff members.');
  const { userId, sessionId } = tx.actor;
  const policy = await getSecurityPolicy(tx);
  if (!policy.breakGlassUserIds.includes(userId)) throw new ForbiddenError('identity.elevation.use');
  if (input.reason.trim().length < 20)
    throw new ValidationError('reason_required', 'Describe the emergency (at least 20 characters).');
  if (input.durationMinutes < 1 || input.durationMinutes > policy.breakGlassMaxMinutes) {
    throw new ValidationError(
      'invalid_duration',
      `Emergency access lasts between 1 and ${policy.breakGlassMaxMinutes} minutes.`,
    );
  }
  if (await hasActiveTotp(tx, userId)) await requireRecentStepUp(tx);
  const role = await db(tx)
    .selectFrom('identity.roles')
    .select(['id', 'name'])
    .where('key', '=', policy.breakGlassRoleKey)
    .executeTakeFirst();
  if (!role) throw new NotFoundError('role', policy.breakGlassRoleKey);
  const open = await db(tx)
    .selectFrom('identity.elevations')
    .select('id')
    .where('session_id', '=', sessionId)
    .where('ended_at', 'is', null)
    .where('ends_at', '>', tx.now)
    .executeTakeFirst();
  if (open)
    throw new BusinessRuleError('already_elevated', 'Emergency access is already active on this session.');
  const id = newId();
  const endsAt = new Date(tx.now.getTime() + input.durationMinutes * 60_000);
  await db(tx)
    .insertInto('identity.elevations')
    .values({
      id,
      tenant_id: tx.tenantId,
      user_id: userId,
      session_id: sessionId,
      role_id: role.id,
      reason: input.reason,
      started_at: tx.now,
      ends_at: endsAt,
      ended_at: null,
      ended_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
    })
    .execute();
  await tx.audit({
    action: 'identity.elevation.start',
    target: { type: 'user', id: userId },
    reason: input.reason,
    after: { elevationId: id, role: policy.breakGlassRoleKey, endsAt: endsAt.toISOString() },
  });
  await tx.emit({
    type: 'identity.elevation.started',
    aggregate: { type: 'elevation', id },
    payload: {
      elevationId: id,
      userId,
      role: policy.breakGlassRoleKey,
      endsAt: endsAt.toISOString(),
      reason: input.reason,
    },
  });
  await raiseSecurityAlert(tx, {
    rule: 'break_glass_activated',
    severity: 'high',
    summary: `Emergency access (${role.name}) started by ${tx.actor.displayName ?? userId}: ${input.reason}`,
    subjectUserId: userId,
    details: { elevationId: id, endsAt: endsAt.toISOString() },
    dedupeKey: `elevation:${id}`,
  });
  if (ports.notifier) {
    const admins = await db(tx)
      .selectFrom('identity.role_assignments as a')
      .innerJoin('identity.roles as r', 'r.id', 'a.role_id')
      .innerJoin('identity.users as u', 'u.id', 'a.user_id')
      .innerJoin('identity.memberships as m', 'm.user_id', 'a.user_id')
      .select('u.email')
      .distinct()
      .where('r.key', '=', 'org_admin')
      .where('a.revoked_at', 'is', null)
      .where('m.status', '=', 'active')
      .where('a.user_id', '<>', userId)
      .execute();
    for (const a of admins) {
      await ports.notifier.send(tx, {
        kind: 'staff.securityAlert',
        to: a.email,
        subject: 'Emergency access started',
        body: `${tx.actor.displayName ?? 'A staff member'} started emergency access until ${endsAt.toISOString()}. Reason: ${input.reason}`,
      });
    }
  }
  return { elevationId: id, endsAt: endsAt.toISOString(), role: policy.breakGlassRoleKey };
}

export async function endElevation(tx: TxContext, elevationId: string, reason = 'ended by user') {
  const e = await db(tx)
    .selectFrom('identity.elevations')
    .selectAll()
    .where('id', '=', elevationId)
    .executeTakeFirst();
  if (!e) throw new NotFoundError('elevation', elevationId);
  const self = tx.actor.kind === 'user' && tx.actor.userId === e.user_id;
  if (!self) requirePermission(tx, 'identity.user.manage');
  if (e.ended_at || e.ends_at <= tx.now) return;
  await db(tx)
    .updateTable('identity.elevations')
    .set({ ended_at: tx.now, ended_reason: reason, version: sql`version + 1` })
    .where('id', '=', elevationId)
    .execute();
  await tx.audit({ action: 'identity.elevation.end', target: { type: 'user', id: e.user_id }, reason });
  await tx.emit({
    type: 'identity.elevation.ended',
    aggregate: { type: 'elevation', id: elevationId },
    payload: { elevationId, userId: e.user_id },
  });
}

export async function listElevations(tx: TxContext, opts: { pendingReviewOnly?: boolean } = {}) {
  requirePermission(tx, 'identity.securityLog.read');
  let q = db(tx).selectFrom('identity.elevations').selectAll().orderBy('started_at', 'desc');
  if (opts.pendingReviewOnly) q = q.where('review_status', '=', 'pending');
  const rows = await q.execute();
  return rows.map((e) => ({
    id: e.id,
    userId: e.user_id,
    reason: e.reason,
    startedAt: e.started_at.toISOString(),
    endsAt: e.ends_at.toISOString(),
    endedAt: e.ended_at?.toISOString() ?? null,
    active: !e.ended_at && e.ends_at > tx.now,
    reviewStatus: e.review_status,
    reviewedBy: e.reviewed_by,
    reviewNotes: e.review_notes,
  }));
}

/** Post-incident review by a different administrator (the elevated person cannot review their own). */
export async function reviewElevation(tx: TxContext, elevationId: string, notes: string) {
  requirePermission(tx, 'identity.elevation.review');
  const e = await db(tx)
    .selectFrom('identity.elevations')
    .selectAll()
    .where('id', '=', elevationId)
    .executeTakeFirst();
  if (!e) throw new NotFoundError('elevation', elevationId);
  if (tx.actor.kind === 'user' && tx.actor.userId === e.user_id) {
    throw new BusinessRuleError(
      'segregation_of_duties',
      'You cannot review your own emergency access. Ask another administrator.',
    );
  }
  if (!e.ended_at && e.ends_at > tx.now)
    throw new BusinessRuleError('elevation_active', 'Review emergency access after it has ended.');
  if (notes.trim().length < 10)
    throw new ValidationError('notes_required', 'Record what was done and why (at least 10 characters).');
  await db(tx)
    .updateTable('identity.elevations')
    .set({
      review_status: 'reviewed',
      reviewed_by: `${tx.actor.kind}:${actorId(tx.actor)}`,
      reviewed_at: tx.now,
      review_notes: notes,
      version: sql`version + 1`,
    })
    .where('id', '=', elevationId)
    .execute();
  await tx.audit({
    action: 'identity.elevation.review',
    target: { type: 'elevation', id: elevationId },
    reason: notes,
  });
}

/** Active elevation of a session (used by the authenticator). */
export async function activeElevation(tx: TxContext, sessionId: string) {
  return db(tx)
    .selectFrom('identity.elevations as e')
    .innerJoin('identity.roles as r', 'r.id', 'e.role_id')
    .select(['e.id', 'e.ends_at', 'r.permissions'])
    .where('e.session_id', '=', sessionId)
    .where('e.ended_at', 'is', null)
    .where('e.ends_at', '>', tx.now)
    .executeTakeFirst();
}
