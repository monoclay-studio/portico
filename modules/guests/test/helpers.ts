import { sourcesFromManifests, type TxContext, withTenantTx } from '@portico/db';
import { fieldCryptoFromEnv, newId, type RequestContext, systemAuthorizer } from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import { createGuestsService, type GuestsPorts, type GuestsService, guestsManifest } from '../src';

export async function startDb(): Promise<TestDatabase> {
  return createTestDatabase(sourcesFromManifests([platformManifest, guestsManifest]));
}

const asSystem = (tx: TxContext): TxContext => ({ ...tx, authz: systemAuthorizer });

/** The real platform module bound to the guests platform port (as in apps/api composition). */
export function platformPort(): GuestsPorts['platform'] {
  return {
    assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
    hasEntitlement: (tx, feature) => platform.hasEntitlement(tx, feature),
    resolvePolicy: (tx, propertyId, key, def) => platform.resolvePolicy(tx, propertyId, key, def),
    listPropertyIds: async (tx) => (await platform.listProperties(asSystem(tx))).map((p) => p.id),
    getPropertyCountry: async (tx, id) => (await platform.getProperty(asSystem(tx), id)).countryCode,
    getPropertyLegalEntityId: async (tx, id) => (await platform.getProperty(asSystem(tx), id)).legalEntityId,
    legalEntityExists: async (tx, id) =>
      platform.getLegalEntity(tx, id).then(
        () => true,
        () => false,
      ),
    getBusinessDate: (tx, id) => platform.getBusinessDate(tx, id),
  };
}

export function makeService(extra: Partial<GuestsPorts> = {}): GuestsService {
  return createGuestsService({
    platform: platformPort(),
    crypto: fieldCryptoFromEnv({}), // development keys (never valid in production)
    ...extra,
  });
}

export interface TestOrg {
  tenantId: string;
  admin: RequestContext;
  legalEntityId: string;
  properties: string[];
  svc: GuestsService;
  run<T>(ctx: RequestContext, fn: (tx: TxContext) => Promise<T>): Promise<T>;
  /** Run as the organization admin (all permissions). */
  sys<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
  user(grants: Array<{ permission: string; propertyIds: string[] | 'all' }>, userId?: string): RequestContext;
}

export async function setupOrg(
  t: TestDatabase,
  opts: { plan?: string; properties?: number; svc?: GuestsService } = {},
): Promise<TestOrg> {
  const admin = testContext();
  const run = <T>(ctx: RequestContext, fn: (tx: TxContext) => Promise<T>) => withTenantTx(t.db, ctx, fn);
  await run(admin, (tx) =>
    platform.provisionOrganization(tx, {
      name: 'Azure Atoll Collection',
      slug: `azure-${admin.tenantId.slice(-12)}`,
      environment: 'live',
      planCode: opts.plan ?? 'enterprise',
    }),
  );
  const le = await run(admin, (tx) =>
    platform.createLegalEntity(tx, {
      name: 'Azure Atoll',
      legalName: 'Azure Atoll Hospitality Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    }),
  );
  const properties: string[] = [];
  for (let i = 0; i < (opts.properties ?? 2); i++) {
    const p = await run(admin, (tx) =>
      platform.createProperty(tx, {
        code: `P${i}${newId().slice(-4).toUpperCase()}`,
        name: `Property ${i}`,
        profile: 'resort',
        legalEntityId: le.id,
        countryCode: 'MV',
        timezone: 'Indian/Maldives',
        baseCurrency: 'USD',
        businessDate: '2026-11-07',
      }),
    );
    properties.push(p.id);
  }
  return {
    tenantId: admin.tenantId,
    admin,
    legalEntityId: le.id,
    properties,
    svc: opts.svc ?? makeService(),
    run,
    sys: (fn) => run(admin, fn),
    user: (grants, userId) =>
      testContext({
        tenantId: admin.tenantId,
        grants,
        actor: { kind: 'user', userId: userId ?? newId(), displayName: 'Staff' },
      }),
  };
}

/** Front-desk style grants at the given properties. */
export function deskGrants(propertyIds: string[], extra: string[] = []) {
  return ['guests.profile.read', 'guests.profile.update', 'guests.alert.manage', ...extra].map(
    (permission) => ({
      permission,
      propertyIds,
    }),
  );
}

export async function auditRows(
  t: TestDatabase,
  tenantId: string,
  where: { action?: string; targetId?: string } = {},
) {
  let q = t.admin.kysely
    .selectFrom('core.audit_log')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('occurred_at');
  if (where.action) q = q.where('action', '=', where.action);
  if (where.targetId) q = q.where('target_id', '=', where.targetId);
  return q.execute();
}

export async function outboxRows(t: TestDatabase, tenantId: string, type?: string) {
  let q = t.admin.kysely
    .selectFrom('core.outbox')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('created_at');
  if (type) q = q.where('type', '=', type);
  return q.execute();
}
