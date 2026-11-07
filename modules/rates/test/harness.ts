/**
 * Integration-test harness: real Postgres with platform + rates migrations; real platform provider bound to the
 * rates ports exactly as the composition root does; one organization per test (no shared mutable fixtures).
 */
import { sourcesFromManifests, type TxContext, withTenantTx } from '@portico/db';
import { newId, type RequestContext, systemAuthorizer, type TenantEnvironment } from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import { type RatesPorts, type RatesService, ratesManifest, ratesService } from '../src';

/** Test-only seal key (never a production key). */
export const TEST_SEAL_KEY = Buffer.from('rates-integration-test-seal-key').toString('base64');

export async function startDb(): Promise<TestDatabase> {
  return createTestDatabase(sourcesFromManifests([platformManifest, ratesManifest]));
}

/** The same binding apps/api/src/composition.ts uses. */
export function platformPorts(extra: Partial<RatesPorts> = {}): RatesPorts {
  return {
    async getProperty(tx, propertyId) {
      const p = await platform.getProperty({ ...tx, authz: systemAuthorizer }, propertyId);
      return {
        id: p.id,
        countryCode: p.countryCode,
        timezone: p.timezone,
        baseCurrency: p.baseCurrency,
        checkInTime: p.checkInTime,
        classification: p.classification,
      };
    },
    assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
    resolvePolicy: (tx, propertyId, key, defaultValue) =>
      platform.resolvePolicy(tx, propertyId, key, defaultValue),
    getBusinessDate: (tx, propertyId) => platform.getBusinessDate(tx, propertyId),
    ...extra,
  };
}

export const RESORT_CLASSIFICATION = {
  'mv.establishmentType': 'resort',
  'mv.inhabitedIsland': false,
  'mv.registeredRooms': 120,
};
export const GUESTHOUSE_CLASSIFICATION = {
  'mv.establishmentType': 'guesthouse',
  'mv.inhabitedIsland': true,
  'mv.registeredRooms': 12,
};

export interface Org {
  ctx: RequestContext;
  rates: RatesService;
  ports: RatesPorts;
  propertyId: string;
  /** Run as the all-powerful setup context. */
  run<T>(fn: (tx: TxContext, rates: RatesService) => Promise<T>): Promise<T>;
  /** Run with a restricted context (permissions per property). */
  as<T>(
    grants: Array<{ permission: string; propertyIds: string[] | 'all' }>,
    fn: (tx: TxContext, rates: RatesService) => Promise<T>,
  ): Promise<T>;
  addProperty(
    code: string,
    classification?: Record<string, string | number | boolean>,
    profile?: 'resort' | 'guesthouse',
  ): Promise<string>;
}

export async function newOrg(
  t: TestDatabase,
  opts: {
    profile?: 'resort' | 'guesthouse';
    environment?: TenantEnvironment;
    ports?: Partial<RatesPorts>;
  } = {},
): Promise<Org> {
  const ctx = testContext({ environment: opts.environment ?? 'live' });
  await withTenantTx(t.db, ctx, (tx) =>
    platform.provisionOrganization(tx, {
      name: 'Azure Atoll',
      slug: `azure-${ctx.tenantId.slice(-12)}`,
      environment: opts.environment ?? 'live',
      planCode: 'enterprise',
    }),
  );
  const le = await withTenantTx(t.db, ctx, (tx) =>
    platform.createLegalEntity(tx, {
      name: 'Azure Atoll',
      legalName: 'Azure Atoll Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    }),
  );
  const ports = platformPorts(opts.ports);
  const rates = ratesService(ports, { termsSealKey: TEST_SEAL_KEY });
  const addProperty = async (
    code: string,
    classification?: Record<string, string | number | boolean>,
    profile = opts.profile ?? 'resort',
  ) => {
    const p = await withTenantTx(t.db, ctx, (tx) =>
      platform.createProperty(tx, {
        code,
        name: `Property ${code}`,
        profile,
        legalEntityId: le.id,
        countryCode: 'MV',
        timezone: 'Indian/Maldives',
        baseCurrency: 'USD',
        businessDate: '2026-11-07',
        classification:
          classification ?? (profile === 'resort' ? RESORT_CLASSIFICATION : GUESTHOUSE_CLASSIFICATION),
      }),
    );
    return p.id;
  };
  const propertyId = await addProperty(`P${newId().slice(-6).toUpperCase()}`);
  return {
    ctx,
    rates,
    ports,
    propertyId,
    run: (fn) => withTenantTx(t.db, ctx, (tx) => fn(tx, rates)),
    as: (grants, fn) =>
      withTenantTx(
        t.db,
        {
          ...ctx,
          actor: { kind: 'user', userId: newId(), displayName: 'Limited' },
          authz: testContext({ grants }).authz,
        },
        (tx) => fn(tx, rates),
      ),
    addProperty,
  };
}

/** Fixed unit type ids (inventory owns unit types; rates references them by id only). */
export const unitTypes = () => [
  { id: newId(), code: 'BV', name: 'Beach Villa' },
  { id: newId(), code: 'WV', name: 'Water Villa' },
];

export const sum = (xs: ReadonlyArray<{ amountMinor: number }>) => xs.reduce((s, x) => s + x.amountMinor, 0);
