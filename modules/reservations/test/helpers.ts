import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourcesFromManifests, type TxContext, withTenantTx } from '@portico/db';
import {
  createInventoryService,
  type InventoryService,
  inventoryManifest,
  inventoryProvider,
} from '@portico/inventory';
import {
  type Clock,
  newId,
  type RequestContext,
  staticAuthorizer,
  systemAuthorizer,
  type TenantEnvironment,
} from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import { inventoryPortFrom } from '../src/adapters/inventory';
import type { NewBookingInput, StayInput } from '../src/contracts';
import { reservationsManifest } from '../src/manifest';
import type { InventoryPort, ReservationsPorts } from '../src/ports';
import { type ForwardedResult, type ReservationsService, reservationsService } from '../src/service';
import { FakeFinance } from './fakes/finance';
import { FakeInventory } from './fakes/inventory';
import { FakeAccess, FakeGuests, FakeOperations, FakePayments, realPlatformPort } from './fakes/others';
import { type FakeRatePlan, FakeRates } from './fakes/rates';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Real Postgres with platform + reservations migrations and the test-only fake schemas. `realInventory` also
 * migrates the REAL inventory module, so a test can bind InventoryPort to it (setupOrg `inventory: 'real'`).
 */
export async function startDb(opts: { clock?: Clock; realInventory?: boolean } = {}): Promise<TestDatabase> {
  const t = await createTestDatabase(
    [
      ...sourcesFromManifests([
        platformManifest,
        ...(opts.realInventory ? [inventoryManifest] : []),
        reservationsManifest,
      ]),
      { module: 'zz_test_fakes', dir: join(here, 'fakes', 'sql') },
    ],
    opts.clock ? { clock: opts.clock } : {},
  );
  return t;
}

export const BUSINESS_DATE = '2026-12-10';

export interface Fakes {
  inventory: FakeInventory;
  rates: FakeRates;
  guests: FakeGuests;
  finance: FakeFinance;
  payments: FakePayments;
  operations: FakeOperations;
  access: FakeAccess;
}

export interface Org {
  t: TestDatabase;
  ctx: RequestContext;
  tenantId: string;
  propertyId: string;
  svc: ReservationsService;
  fakes: Fakes;
  types: { beach: string; overwater: string; family: string };
  units: Record<string, string>;
  plans: { bar: string; nonRef: string };
  /** The InventoryPort reservations is bound to (the fake, or the real inventory module through the adapter). */
  inventory: InventoryPort;
  /** A tokenized card registered with the fake payments module for this property. */
  cardMethodId: string;
  /** A staff member of this organization (all permissions unless grants are given). */
  user(name: string, grants?: Array<{ permission: string; propertyIds: string[] | 'all' }>): RequestContext;
  run<T>(fn: (tx: TxContext) => Promise<T>, ctx?: RequestContext): Promise<T>;
  stay(overrides?: Partial<StayInput>): StayInput;
  booking(overrides?: Partial<NewBookingInput>, stay?: Partial<StayInput>): NewBookingInput;
}

export async function setupOrg(
  t: TestDatabase,
  opts: {
    environment?: TenantEnvironment;
    businessDate?: string;
    units?: Partial<Record<'beach' | 'overwater' | 'family', string[]>>;
    /** 'real': bind InventoryPort to the inventory module (startDb({ realInventory: true }) required). */
    inventory?: 'fake' | 'real';
  } = {},
): Promise<Org> {
  const tenantId = newId();
  const environment = opts.environment ?? 'live';
  const ctx = testContext({
    tenantId,
    environment,
    actor: { kind: 'user', userId: newId(), displayName: 'Aishath (front desk)' },
  });
  const sys = { ...ctx, authz: systemAuthorizer };
  await withTenantTx(t.db, sys, (tx) =>
    platform.provisionOrganization(tx, {
      name: 'Azure Atoll',
      slug: `azr-${tenantId.slice(-12)}`,
      environment,
      planCode: 'enterprise',
    }),
  );
  const le = await withTenantTx(t.db, sys, (tx) =>
    platform.createLegalEntity(tx, {
      name: 'Azure Atoll',
      legalName: 'Azure Atoll Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    }),
  );
  const property = await withTenantTx(t.db, sys, (tx) =>
    platform.createProperty(tx, {
      code: 'AZR',
      name: 'Azure Atoll Resort',
      profile: 'resort',
      legalEntityId: le.id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: opts.businessDate ?? BUSINESS_DATE,
    }),
  );
  const fakes: Fakes = {
    inventory: new FakeInventory(),
    rates: new FakeRates(),
    guests: new FakeGuests(),
    finance: new FakeFinance(),
    payments: new FakePayments(),
    operations: new FakeOperations(),
    access: new FakeAccess(),
  };
  const typeSpecs = [
    {
      code: 'beach',
      name: 'Beach Villa',
      rank: 1,
      maxOccupancy: 3,
      units: opts.units?.beach ?? ['V101', 'V102', 'V103'],
    },
    {
      code: 'overwater',
      name: 'Overwater Villa',
      rank: 2,
      maxOccupancy: 3,
      units: opts.units?.overwater ?? ['W201', 'W202'],
    },
    {
      code: 'family',
      name: 'Family Villa',
      rank: 3,
      maxOccupancy: 6,
      units: opts.units?.family ?? ['F301'],
    },
  ];
  let inventory: InventoryPort = fakes.inventory;
  let seeded: { types: Record<string, string>; units: Record<string, string> };
  if (opts.inventory === 'real') {
    const real = realInventoryService();
    // ADR-0015: the real port surface (property-scoped delegation), exactly as the composition root binds it.
    inventory = inventoryPortFrom(inventoryProvider(real));
    seeded = await withTenantTx(t.db, sys, (tx) => seedRealInventory(real, tx, property.id, typeSpecs));
  } else {
    seeded = await withTenantTx(t.db, sys, (tx) =>
      fakes.inventory.seed(tx, {
        propertyId: property.id,
        from: '2026-12-01',
        to: '2027-02-01',
        types: typeSpecs,
      }),
    );
  }
  const types = {
    beach: seeded.types.beach as string,
    overwater: seeded.types.overwater as string,
    family: seeded.types.family as string,
  };
  const plans = { bar: newId(), nonRef: newId() };
  const flexible: FakeRatePlan = {
    id: plans.bar,
    name: 'Best available (half board)',
    unitTypeIds: [types.beach, types.overwater, types.family],
    base: { [types.beach]: 30_000, [types.overwater]: 50_000, [types.family]: 70_000 },
    extraAdult: 8_000,
    child: 4_000,
    cancellation: {
      tiers: [
        { deadline: { daysBeforeArrival: 7, time: '14:00' }, penalty: { kind: 'nights', nights: 1 } },
        {
          deadline: { daysBeforeArrival: 1, time: '14:00' },
          penalty: { kind: 'percent_of_stay', percent: 100 },
        },
      ],
      noShow: { kind: 'first_night' },
      earlyDeparture: { kind: 'nights', nights: 1 },
      text: 'Free cancellation until 7 days before arrival (14:00 Malé time)',
    },
    deposit: [{ kind: 'deposit', basis: 'percent', value: 30 }],
    guarantee: ['card'],
    inclusions: [{ code: 'HB', name: 'Half board' }],
  };
  fakes.rates.configure(
    property.id,
    [
      flexible,
      {
        ...flexible,
        id: plans.nonRef,
        name: 'Non-refundable',
        base: { [types.beach]: 25_000, [types.overwater]: 42_000, [types.family]: 60_000 },
        cancellation: { tiers: [], nonRefundable: true, noShow: { kind: 'percent_of_stay', percent: 100 } },
        minLos: 2,
      },
    ],
    { taxBp: 1700, levyPerPersonNight: 1_200, levyMinAge: 2 },
  );
  const ports: ReservationsPorts = { ...fakes, inventory, platform: realPlatformPort() };
  const svc = reservationsService(ports);
  const propertyId = property.id;
  // The default guest (primary occupant of org.stay()) owns the default guarantee card (review P1-2 owner check).
  const guestProfileId = newId();
  const cardMethodId = fakes.payments.addMethod(propertyId, { type: 'guest_profile', id: guestProfileId });
  const org: Org = {
    t,
    ctx,
    tenantId,
    propertyId,
    svc,
    fakes,
    types,
    units: seeded.units,
    plans,
    inventory,
    cardMethodId,
    user(name, grants) {
      return {
        ...ctx,
        actor: { kind: 'user', userId: newId(), displayName: name },
        authz: grants ? staticAuthorizer(grants) : systemAuthorizer,
        correlationId: newId(),
      };
    },
    run(fn, c) {
      return withTenantTx(t.db, c ?? ctx, fn);
    },
    stay(overrides = {}) {
      return {
        unitTypeId: types.beach,
        ratePlanId: plans.bar,
        arrival: BUSINESS_DATE,
        departure: '2026-12-13',
        occupancy: { adults: 2, childrenAges: [] },
        commercialType: 'standard',
        occupants: [
          {
            profileId: guestProfileId,
            profile: { firstName: 'Lena', lastName: 'Hoffmann', email: `lena-${newId()}@example.de` },
            kind: 'adult',
            primary: true,
          },
        ],
        requests: [],
        ...overrides,
      };
    },
    booking(overrides = {}, stay = {}) {
      return {
        propertyId,
        intent: 'confirm',
        booker: { kind: 'profile', profile: { firstName: 'Lena', lastName: 'Hoffmann' } },
        source: 'direct_email',
        externalRefs: {},
        marketSegment: 'leisure',
        guarantee: { kind: 'card', paymentMethodId: cardMethodId },
        specialRequests: [],
        tags: [],
        stays: [org.stay(stay)],
        ...overrides,
      };
    },
  };
  return org;
}

/** Narrow a create/commit result that may be a forwarded change. */
export function created<T extends object>(v: T | ForwardedResult): T {
  if ('forwarded' in v && v.forwarded === true) throw new Error('unexpected forwarded result');
  return v as T;
}

/** The REAL inventory module, wired the way the composition root wires it. */
export function realInventoryService(): InventoryService {
  return createInventoryService({
    platform: {
      getBusinessDate: platform.getBusinessDate,
      getDataAuthority: platform.getDataAuthority,
      assertWritable: platform.assertWritable,
      getLimit: platform.getLimit,
      resolvePolicy: platform.resolvePolicy,
    },
  });
}

async function seedRealInventory(
  inventory: InventoryService,
  tx: TxContext,
  propertyId: string,
  specs: Array<{ code: string; name: string; rank: number; maxOccupancy: number; units: string[] }>,
): Promise<{ types: Record<string, string>; units: Record<string, string> }> {
  const types: Record<string, string> = {};
  const units: Record<string, string> = {};
  for (const [i, spec] of specs.entries()) {
    const type = await inventory.createUnitType(tx, propertyId, {
      code: spec.code.toUpperCase(),
      name: spec.name,
      kind: 'villa',
      baseOccupancy: 2,
      maxAdults: spec.maxOccupancy,
      maxChildren: spec.maxOccupancy - 1,
      maxOccupancy: spec.maxOccupancy,
      rank: spec.rank,
      sortOrder: (i + 1) * 10,
    });
    types[spec.code] = type.id;
    for (const number of spec.units) {
      const unit = await inventory.createUnit(tx, propertyId, {
        unitTypeId: type.id,
        number,
        inInventoryFrom: '2026-12-01',
      });
      units[number] = unit.id;
    }
  }
  return { types, units };
}
