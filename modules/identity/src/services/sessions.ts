import { type TxContext, typed } from '@portico/db';
import {
  actorId,
  ForbiddenError,
  NotFoundError,
  newId,
  randomToken,
  requirePermission,
  sha256Hex,
} from '@portico/kernel';
import type { IdentityDB } from '../tables';

const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export const SESSION_ABSOLUTE_HOURS = 12;
export const SESSION_IDLE_MINUTES = 120;

/** Create a staff session (token `pts.<tenant>.<secret>`; only the hash is stored). */
export async function createSession(
  tx: TxContext,
  input: {
    userId: string;
    authMethod: 'password' | 'sso';
    mfaVerifiedAt: Date | null;
    idpMfa?: boolean;
    ip?: string | undefined;
    userAgent?: string | undefined;
  },
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = `pts.${tx.tenantId}.${randomToken(32)}`;
  const expiresAt = new Date(tx.now.getTime() + SESSION_ABSOLUTE_HOURS * 3600_000);
  const sessionId = newId();
  await db(tx)
    .insertInto('identity.sessions')
    .values({
      id: sessionId,
      tenant_id: tx.tenantId,
      user_id: input.userId,
      token_hash: sha256Hex(token),
      expires_at: expiresAt,
      idle_expires_at: new Date(
        Math.min(expiresAt.getTime(), tx.now.getTime() + SESSION_IDLE_MINUTES * 60_000),
      ),
      ip: input.ip ?? null,
      user_agent: input.userAgent?.slice(0, 500) ?? null,
      mfa_verified: input.mfaVerifiedAt !== null,
      mfa_verified_at: input.mfaVerifiedAt,
      auth_method: input.authMethod,
      idp_mfa: input.idpMfa ?? false,
    })
    .execute();
  await tx.audit({
    action: 'identity.session.create',
    target: { type: 'user', id: input.userId },
    metadata: { ip: input.ip ?? null, method: input.authMethod, mfa: input.mfaVerifiedAt !== null },
  });
  return { token, sessionId, expiresAt };
}

export interface SessionSummary {
  id: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  authMethod: 'password' | 'sso';
  mfaVerifiedAt: string | null;
  current: boolean;
}

function currentSessionId(tx: TxContext): string | undefined {
  return tx.actor.kind === 'user' ? tx.actor.sessionId : undefined;
}

/** Active sessions (device list): for oneself, or (with identity.user.manage) for another member. */
export async function listSessions(tx: TxContext, userId: string): Promise<SessionSummary[]> {
  const self = tx.actor.kind === 'user' && tx.actor.userId === userId;
  if (!self) requirePermission(tx, 'identity.user.manage');
  const rows = await db(tx)
    .selectFrom('identity.sessions')
    .selectAll()
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', tx.now)
    .where('idle_expires_at', '>', tx.now)
    .orderBy('last_seen_at', 'desc')
    .execute();
  const current = currentSessionId(tx);
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    ip: r.ip,
    userAgent: r.user_agent,
    authMethod: r.auth_method,
    mfaVerifiedAt: r.mfa_verified_at?.toISOString() ?? null,
    current: r.id === current,
  }));
}

/** Revoke one session (remote sign-out). Self for own sessions; identity.user.manage for others'. */
export async function revokeSessionById(tx: TxContext, sessionId: string, reason: string): Promise<void> {
  const s = await db(tx)
    .selectFrom('identity.sessions')
    .select(['id', 'user_id', 'revoked_at'])
    .where('id', '=', sessionId)
    .executeTakeFirst();
  if (!s) throw new NotFoundError('session', sessionId);
  const self = tx.actor.kind === 'user' && tx.actor.userId === s.user_id;
  if (!self && !tx.authz.can('identity.user.manage')) throw new ForbiddenError('identity.user.manage');
  if (s.revoked_at) return;
  await db(tx)
    .updateTable('identity.sessions')
    .set({ revoked_at: tx.now, revoked_reason: reason, revoked_by: `${tx.actor.kind}:${actorId(tx.actor)}` })
    .where('id', '=', sessionId)
    .execute();
  await tx.audit({
    action: 'identity.session.revoke',
    target: { type: 'user', id: s.user_id },
    reason,
    metadata: { sessionId },
  });
}

/** Revoke all of a member's sessions in this organization (optionally keeping the caller's own). */
export async function revokeAllSessions(
  tx: TxContext,
  userId: string,
  reason: string,
  opts: { exceptCurrent?: boolean } = {},
): Promise<number> {
  const self = tx.actor.kind === 'user' && tx.actor.userId === userId;
  if (!self) requirePermission(tx, 'identity.user.manage');
  let q = db(tx)
    .updateTable('identity.sessions')
    .set({ revoked_at: tx.now, revoked_reason: reason, revoked_by: `${tx.actor.kind}:${actorId(tx.actor)}` })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null);
  const current = currentSessionId(tx);
  if (opts.exceptCurrent && current) q = q.where('id', '<>', current);
  const res = await q.executeTakeFirst();
  const n = Number(res.numUpdatedRows);
  await tx.audit({
    action: 'identity.session.revokeAll',
    target: { type: 'user', id: userId },
    reason,
    metadata: { n },
  });
  return n;
}
