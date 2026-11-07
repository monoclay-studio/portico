import { type TxContext, typed } from '@portico/db';
import { ForbiddenError, NotFoundError, requirePermission, ValidationError } from '@portico/kernel';
import { indexCatalog, validateRolePermissions } from '../domain/permissions';
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
  if (ports.permissionCatalog) {
    const issues = validateRolePermissions(input.permissions, indexCatalog(ports.permissionCatalog()));
    if (issues.length)
      throw new ValidationError(
        'invalid_permissions',
        'Some permissions are not valid. Choose permissions from the catalog.',
        { issues },
      );
  }
  if (input.expiresAt && input.expiresAt <= tx.now)
    throw new ValidationError('invalid_expiry', 'The expiry must be in the future.');
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
