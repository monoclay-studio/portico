import { type TxContext, typed } from '@portico/db';
import { ForbiddenError, NotFoundError, requirePermission, ValidationError } from '@portico/kernel';
import { indexCatalog, validateRolePermissions } from '../domain/permissions';
import { isExplainingAuthorizer } from '../domain/step-up';
import { MfaRequiredError } from '../errors';
import type { IdentityPorts } from '../ports';
import { createApiClient } from '../service';
import type { IdentityDB } from '../tables';

/**
 * Administration of API clients (integrations, SCIM provisioning). The token is shown once; only its hash is
 * stored. Permissions are validated against the catalog and the issuer must hold each of them for the same
 * property scope (no escalation through machine credentials). Keys only ever authenticate against the
 * organization that issued them, so a key issued in a trial or sandbox organization cannot reach live data.
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

/** ADR-0017 §9: keys never carry identity administration, except SCIM provisioning. */
const FORBIDDEN_IN_KEYS = (p: string) =>
  p === '*' || ((p === 'identity.*' || p.startsWith('identity.')) && p !== 'identity.scim.provision');
export const MAX_SENSITIVE_KEY_DAYS = 90;

export async function issueApiClient(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'permissionCatalog'>,
  input: {
    name: string;
    permissions: string[];
    propertyIds?: string[] | undefined;
    expiresAt?: Date | undefined;
  },
) {
  requirePermission(tx, 'identity.apiClient.manage');
  const forbidden = input.permissions.filter(FORBIDDEN_IN_KEYS);
  if (forbidden.length) {
    throw new ValidationError(
      'permission_not_allowed_in_keys',
      `API keys cannot carry identity administration (${forbidden.join(', ')}). Only identity.scim.provision is allowed; administrators act as themselves.`,
      { forbidden },
    );
  }
  const catalog = ports.permissionCatalog ? indexCatalog(ports.permissionCatalog()) : null;
  if (catalog) {
    const issues = validateRolePermissions(input.permissions, catalog);
    if (issues.length)
      throw new ValidationError(
        'invalid_permissions',
        'Some permissions are not valid. Choose permissions from the catalog.',
        { issues },
      );
  }
  if (input.expiresAt && input.expiresAt <= tx.now)
    throw new ValidationError('invalid_expiry', 'The expiry must be in the future.');
  const sensitive = catalog ? input.permissions.some((p) => catalog.isSensitive(p)) : true;
  if (sensitive) {
    // ADR-0017 §9: a key with ⚑ permissions expires within 90 days and needs a fresh MFA verification to issue.
    const max = new Date(tx.now.getTime() + MAX_SENSITIVE_KEY_DAYS * 86_400_000);
    if (!input.expiresAt || input.expiresAt > max) {
      throw new ValidationError(
        'expiry_required',
        `A key with sensitive permissions must expire within ${MAX_SENSITIVE_KEY_DAYS} days. Set an expiry date.`,
      );
    }
    if (tx.actor.kind !== 'system') {
      const s = isExplainingAuthorizer(tx.authz) ? tx.authz.stepUp : null;
      const fresh =
        !!s?.mfaVerifiedAt && tx.now.getTime() - s.mfaVerifiedAt.getTime() <= s.stepUpWindowMinutes * 60_000;
      if (!fresh) throw new MfaRequiredError({ stepUpWindowMinutes: s?.stepUpWindowMinutes ?? 15 });
    }
  }
  for (const p of input.permissions) {
    const held = tx.authz.propertyScope(p);
    const ok =
      held === 'all' || (!!input.propertyIds?.length && input.propertyIds.every((id) => held.includes(id)));
    if (!ok)
      throw new ForbiddenError(p, {
        reason: 'An API client can only receive permissions you hold yourself.',
      });
  }
  const res = await createApiClient(tx, {
    name: input.name,
    permissions: input.permissions,
    ...(input.propertyIds?.length ? { propertyIds: input.propertyIds } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  });
  await tx.emit({
    type: 'identity.apiClient.created',
    aggregate: { type: 'api_client', id: res.clientId },
    payload: { clientId: res.clientId, name: input.name, permissions: input.permissions },
  });
  return res;
}

export async function listApiClients(tx: TxContext) {
  requirePermission(tx, 'identity.apiClient.manage');
  const rows = await db(tx)
    .selectFrom('identity.api_clients')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map((c) => ({
    clientId: c.id,
    name: c.name,
    permissions: c.permissions,
    propertyIds: c.property_ids,
    status: c.status,
    createdBy: c.created_by,
    createdAt: c.created_at.toISOString(),
    expiresAt: c.expires_at?.toISOString() ?? null,
    lastUsedAt: c.last_used_at?.toISOString() ?? null,
  }));
}

export async function revokeApiClient(tx: TxContext, clientId: string, reason: string) {
  requirePermission(tx, 'identity.apiClient.manage');
  const res = await db(tx)
    .updateTable('identity.api_clients')
    .set({ status: 'revoked' })
    .where('id', '=', clientId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0) throw new NotFoundError('api_client', clientId);
  await tx.audit({
    action: 'identity.apiClient.revoke',
    target: { type: 'api_client', id: clientId },
    reason,
  });
  await tx.emit({
    type: 'identity.apiClient.revoked',
    aggregate: { type: 'api_client', id: clientId },
    payload: { clientId },
  });
}
