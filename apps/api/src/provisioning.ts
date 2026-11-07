import { type PorticoDatabase, withTenantTx } from '@portico/db';
import { identity } from '@portico/identity';
import { newId, type RequestContext, systemAuthorizer, type TenantEnvironment } from '@portico/kernel';
import { platform } from '@portico/platform';

export interface ProvisionInput {
  name: string;
  slug: string;
  environment: TenantEnvironment;
  planCode: string;
  admin: { email: string; displayName: string; password?: string };
  liveTenantId?: string;
}

/**
 * Create an organization with system roles and its first administrator — one transaction.
 * Called by Monoclay operators (internal endpoint / CLI) and by demo/test seeding.
 */
export async function provisionOrganization(
  database: PorticoDatabase,
  input: ProvisionInput,
  operator = 'operator',
): Promise<{ tenantId: string; adminUserId: string }> {
  const tenantId = newId();
  const ctx: RequestContext = {
    tenantId,
    environment: input.environment,
    actor: { kind: 'system', process: `provisioning:${operator}` },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
  return withTenantTx(database, ctx, async (tx) => {
    await platform.provisionOrganization(tx, {
      id: tenantId,
      name: input.name,
      slug: input.slug,
      environment: input.environment,
      planCode: input.planCode,
      ...(input.liveTenantId ? { liveTenantId: input.liveTenantId } : {}),
    });
    await identity.seedSystemRoles(tx);
    const { userId } = await identity.createUser(tx, {
      email: input.admin.email,
      displayName: input.admin.displayName,
      ...(input.admin.password ? { initialPassword: input.admin.password } : {}),
      roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
    });
    return { tenantId, adminUserId: userId };
  });
}
