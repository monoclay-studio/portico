import { withTenantTx } from '@portico/db';
import { newId, type RequestContext, type TenantEnvironment } from '@portico/kernel';
import { type TestDatabase, testContext } from '@portico/testing';
import { platform } from '../src';

export type Grants = Array<{ permission: string; propertyIds: string[] | 'all' }>;

/** A provisioned organization with a legal entity, and helpers to act as different people in it. */
export async function makeOrg(
  t: TestDatabase,
  opts: { planCode?: string; environment?: TenantEnvironment; name?: string } = {},
) {
  const root = testContext({ environment: opts.environment ?? 'live' });
  const name = opts.name ?? `Org ${root.tenantId.slice(-6)}`;
  await withTenantTx(t.db, root, (tx) =>
    platform.provisionOrganization(tx, {
      name,
      slug: `org-${root.tenantId.slice(-12)}`,
      environment: opts.environment ?? 'live',
      planCode: opts.planCode ?? 'enterprise',
    }),
  );
  const le = await withTenantTx(t.db, root, (tx) =>
    platform.createLegalEntity(tx, {
      name: 'Lagoon Ltd',
      legalName: 'Lagoon Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    }),
  );
  /** Act as a named person with the given grants (default: everything). */
  const as = (userId: string = newId(), grants?: Grants): RequestContext =>
    testContext({
      tenantId: root.tenantId,
      environment: opts.environment ?? 'live',
      actor: { kind: 'user', userId, displayName: `User ${userId.slice(-4)}` },
      ...(grants ? { grants } : {}),
    });
  const system: RequestContext = {
    ...root,
    actor: { kind: 'system', process: 'operator:test' },
  };
  const property = (code: string, extra: Record<string, unknown> = {}) =>
    withTenantTx(t.db, root, (tx) =>
      platform.createProperty(tx, {
        code,
        name: `Property ${code}`,
        profile: 'resort',
        legalEntityId: le.id,
        countryCode: 'MV',
        timezone: 'Indian/Maldives',
        baseCurrency: 'USD',
        businessDate: '2026-11-07',
        ...extra,
      }),
    );
  return { tenantId: root.tenantId, name, root, system, as, le, property };
}
