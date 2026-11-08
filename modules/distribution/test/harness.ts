/**
 * Integration-test harness: a real migrated database (platform, integration secrets, inventory, rates,
 * distribution), the REAL platform, inventory and rates providers bound exactly like apps/api/src/composition.ts
 * binds them, the integration module's real encrypted secret store, the persisted Channex simulator, a fixed clock,
 * and the strict reservations fake (README: the real channel ingestion is blocked by the rates binding on main).
 */
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drainOutbox, sourcesFromManifests, type TxContext, withTenantTx } from '@portico/db';
import { integrationManifest, localSecretStore } from '@portico/integration';
import { createInventoryService, type InventoryService, inventoryManifest } from '@portico/inventory';
import {
  addDays,
  fixedClock,
  localFieldCipher,
  NotFoundError,
  newId,
  type RequestContext,
  staticAuthorizer,
  systemAuthorizer,
  type TenantEnvironment,
} from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { type RatesService, ratesManifest, ratesService } from '@portico/rates';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import { requestInstants, type SimState } from '../src/adapters/channex/simulator';
import type { HubHttpRequest, HubTransport } from '../src/adapters/hub';
import { maxInAnyWindow } from '../src/domain/budget';
import { distributionManifest } from '../src/manifest';
import { createDistribution, type DistributionModule } from '../src/module';
import type { DistributionPorts } from '../src/ports';
import * as svc from '../src/services';
import { FakeReservations } from './fakes/reservations';

export const START = '2026-11-07T06:00:00.000Z';
export const BUSINESS_DATE = '2026-11-07';
const here = dirname(fileURLToPath(import.meta.url));
const asSystem = <T extends { authz: unknown }>(tx: T): T => ({ ...tx, authz: systemAuthorizer });

export interface Harness {
  t: TestDatabase;
  clock: ReturnType<typeof fixedClock>;
  inventory: InventoryService;
  rates: RatesService;
  reservations: FakeReservations;
  dist: DistributionModule;
  /** Requests the real HTTPS transport would have sent (never sent: tests never reach a real hub). */
  httpSent: HubHttpRequest[];
  drain(): Promise<void>;
  close(): Promise<void>;
}

/** The same port bindings as apps/api/src/composition.ts (kept identical; the API test proves the real one). */
export function bindPorts(
  inventory: InventoryService,
  rates: RatesService,
  reservations: DistributionPorts['reservations'],
  secrets: DistributionPorts['secrets'],
): DistributionPorts {
  return {
    platform: {
      async getProperty(tx, propertyId) {
        const p = await platform.getProperty(asSystem(tx), propertyId);
        return { id: p.id, timezone: p.timezone, baseCurrency: p.baseCurrency, businessDate: p.businessDate };
      },
      async getDataAuthority(tx, propertyId, domain) {
        const a = await platform.getDataAuthority(asSystem(tx), propertyId, domain);
        return { authority: a.authority, systemName: a.systemName };
      },
    },
    inventory: {
      listUnitTypes: async (tx, propertyId) =>
        (await inventory.listUnitTypes(asSystem(tx), propertyId)).map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          sellable: t.sellable && t.status === 'active',
        })),
      sellable: async (tx, input) =>
        (await inventory.getAvailability(asSystem(tx), input)).map((c) => ({
          unitTypeId: c.unitTypeId,
          date: c.date,
          sellable: c.sellable,
        })),
      createHold: async (tx, input) => ({ holdId: (await inventory.createHold(asSystem(tx), input)).holdId }),
      async releaseHold(tx, input) {
        const h = await inventory.getHold(asSystem(tx), input.holdId);
        if (h.propertyId !== input.propertyId) throw new NotFoundError('inventory_hold', input.holdId);
        await inventory.releaseHold(asSystem(tx), { holdId: input.holdId, reason: input.reason });
      },
    },
    rates: {
      listRatePlans: async (tx, propertyId) =>
        (await rates.listRatePlans(asSystem(tx), { propertyId })).map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          currency: r.currency,
          status: r.status,
          channels: r.eligibility.channels ?? null,
        })),
      async ariValues(tx, input) {
        const plan = await rates.getRatePlan(asSystem(tx), input.ratePlanId);
        if (plan.propertyId !== input.propertyId) throw new NotFoundError('rate_plan', input.ratePlanId);
        const [cal, restr] = await Promise.all([
          rates.getPriceCalendar(asSystem(tx), {
            ratePlanId: input.ratePlanId,
            unitTypeId: input.unitTypeId,
            from: input.range.from,
            to: input.range.to,
          }),
          rates.getEffectiveRestrictions(asSystem(tx), {
            ratePlanId: input.ratePlanId,
            unitTypeId: input.unitTypeId,
            from: input.range.from,
            to: input.range.to,
          }),
        ]);
        const prices = new Map(
          cal.cells.map((c) => [c.date, { amountMinor: c.baseAmountMinor, currency: c.currency }]),
        );
        const restrictions = new Map(
          restr.map((r) => [
            r.date,
            Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, v.value])),
          ]),
        );
        const out = [];
        for (let d = input.range.from; d < input.range.to; d = addDays(d, 1)) {
          out.push({ date: d, price: prices.get(d) ?? null, restrictions: restrictions.get(d) ?? {} });
        }
        return out;
      },
    },
    reservations: {
      ingestChannelBooking: (tx, input) => reservations.ingestChannelBooking(asSystem(tx), input),
    },
    secrets,
    liveScope: {
      async assertLiveChannelAllowed() {
        throw new Error('live channel connections are not allowed in tests');
      },
    },
  };
}

export async function startHarness(opts: { http?: HubTransport } = {}): Promise<Harness> {
  const clock = fixedClock(START);
  const t = await createTestDatabase(
    [
      ...sourcesFromManifests([
        platformManifest,
        integrationManifest,
        inventoryManifest,
        ratesManifest,
        distributionManifest,
      ]),
      { module: 'zz_test_fakes', dir: join(here, 'fakes', 'sql') },
    ],
    { clock },
  );
  const inventory = createInventoryService({
    platform: {
      getBusinessDate: platform.getBusinessDate,
      getDataAuthority: platform.getDataAuthority,
      assertWritable: platform.assertWritable,
      getLimit: platform.getLimit,
      resolvePolicy: platform.resolvePolicy,
    },
  });
  const rates = ratesService(
    {
      async getProperty(tx, propertyId) {
        const p = await platform.getProperty(asSystem(tx), propertyId);
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
      resolvePolicy: (tx, propertyId, key, def) => platform.resolvePolicy(tx, propertyId, key, def),
      getBusinessDate: (tx, propertyId) => platform.getBusinessDate(tx, propertyId),
      listUnitTypes: async (tx, propertyId) =>
        (await inventory.listUnitTypes(asSystem(tx), propertyId)).map((u) => ({
          id: u.id,
          code: u.code,
          name: u.name,
        })),
    },
    { termsSealKey: Buffer.from('distribution-test-seal-key-000000').toString('base64') },
  );
  const reservations = new FakeReservations();
  const store = localSecretStore(localFieldCipher(randomBytes(32).toString('base64'), 'test'), 'test');
  const secrets: DistributionPorts['secrets'] = {
    put: (tx, value) => store.put(tx, { purpose: 'connection_credential', value }),
    get: (tx, ref) => store.get(tx, ref),
    destroy: (tx, ref) => store.destroy(tx, ref),
  };
  const httpSent: HubHttpRequest[] = [];
  const http: HubTransport = opts.http ?? {
    async send(req) {
      httpSent.push(req);
      return { status: 503, headers: {}, body: '{"errors":{"title":"test transport: no real hub"}}' };
    },
  };
  const dist = createDistribution({
    database: t.db,
    ports: bindPorts(inventory, rates, reservations, secrets),
    http,
    // Simulated time: the budget is accounted on the transaction's (fixed, advanced) clock. The production default,
    // the database clock, is exercised by test/budget-clock.test.ts.
    config: { publicApiBaseUrl: 'https://api.portico.test', budgetClock: 'transaction' },
  });
  const environmentCache = new Map<string, TenantEnvironment>();
  return {
    t,
    clock,
    inventory,
    rates,
    reservations,
    dist,
    httpSent,
    async drain() {
      await drainOutbox(t.db, {
        subscriptions: dist.subscriptions,
        environmentOf: async (tenantId) => environmentCache.get(tenantId) ?? 'demo',
      });
    },
    async close() {
      await t.drop();
    },
  };
  // (environmentCache is filled by setupOrg)
}

export interface Org {
  h: Harness;
  ctx: RequestContext;
  tenantId: string;
  propertyId: string;
  water: string;
  beach: string;
  bar: string;
  run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
  as<T>(permissions: string[], fn: (tx: TxContext) => Promise<T>, scope?: string[] | 'all'): Promise<T>;
  ctxWith(permissions: string[], scope?: string[] | 'all'): RequestContext;
}

export async function setupOrg(
  h: Harness,
  opts: { environment?: TenantEnvironment; water?: number; beach?: number; priceDays?: number } = {},
): Promise<Org> {
  const environment = opts.environment ?? 'demo';
  const ctx = testContext({
    environment,
    actor: { kind: 'user', userId: newId(), displayName: 'Revenue Manager' },
  });
  const run = <T>(fn: (tx: TxContext) => Promise<T>) => withTenantTx(h.t.db, ctx, fn);
  await run((tx) =>
    platform.provisionOrganization(tx, {
      name: 'Kandu Atoll Resort',
      slug: `kandu-${ctx.tenantId.slice(-12)}`,
      environment,
      planCode: 'enterprise',
    }),
  );
  const property = await run(async (tx) => {
    const le = await platform.createLegalEntity(tx, {
      name: 'Kandu',
      legalName: 'Kandu Atoll Resort Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    });
    return platform.createProperty(tx, {
      code: 'KAR',
      name: 'Kandu Atoll Resort',
      profile: 'resort',
      legalEntityId: le.id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: BUSINESS_DATE,
      classification: {
        'mv.establishmentType': 'resort',
        'mv.inhabitedIsland': false,
        'mv.registeredRooms': 120,
      },
    });
  });
  const unitType = async (code: string, name: string, count: number) =>
    run(async (tx) => {
      const type = await h.inventory.createUnitType(tx, property.id, {
        code,
        name,
        kind: 'villa',
        baseOccupancy: 2,
        maxAdults: 2,
        maxChildren: 1,
        maxOccupancy: 3,
      });
      for (let i = 1; i <= count; i++) {
        await h.inventory.createUnit(tx, property.id, {
          unitTypeId: type.id,
          number: `${code}${i}`,
          sortOrder: i,
        });
      }
      return type.id;
    });
  const water = await unitType('WV', 'Water Villa', opts.water ?? 2);
  const beach = await unitType('BV', 'Beach Villa', opts.beach ?? 4);
  const bar = await run(async (tx) => {
    const cancel = await h.rates.createPolicy(tx, {
      kind: 'cancellation',
      propertyId: property.id,
      code: 'FLEX7',
      name: 'Flexible',
      structure: {
        tiers: [{ from: { kind: 'days_before_arrival', days: 7 }, penalty: { kind: 'first_night' } }],
      },
    });
    const plan = await h.rates.createRatePlan(tx, {
      propertyId: property.id,
      code: 'BAR',
      name: 'Best Available Rate',
      cancellationPolicyId: cancel.id,
    });
    await h.rates.applyPriceUpdate(tx, {
      propertyId: property.id,
      ratePlanId: plan.id,
      unitTypeIds: [water, beach],
      ranges: [{ from: BUSINESS_DATE, to: addDays(BUSINESS_DATE, opts.priceDays ?? 420) }],
      set: { baseOccupancy: 2, baseAmountMinor: 50_000 },
    });
    const fresh = await h.rates.getRatePlan(tx, plan.id);
    await h.rates.changeRatePlanStatus(tx, plan.id, fresh.version, { status: 'active' });
    return plan.id;
  });
  // Setup emitted availability/price events: consume them now so each test starts from a clean outbox.
  await h.drain();
  const ctxWith = (permissions: string[], scope: string[] | 'all' = [property.id]): RequestContext => ({
    ...ctx,
    actor: { kind: 'user', userId: newId(), displayName: 'Limited User' },
    authz: staticAuthorizer(permissions.map((permission) => ({ permission, propertyIds: scope }))),
    correlationId: newId(),
  });
  return {
    h,
    ctx,
    tenantId: ctx.tenantId,
    propertyId: property.id,
    water,
    beach,
    bar,
    run,
    as: (permissions, fn, scope) => withTenantTx(h.t.db, ctxWith(permissions, scope), fn),
    ctxWith,
  };
}

export interface Connected {
  connectionId: string;
  externalPropertyId: string;
  webhookToken: string;
  endpointId: string;
}

/** A simulated Channex connection, verified (key + webhook registration through the simulator), mapped, active. */
export async function connect(
  org: Org,
  opts: {
    settings?: Record<string, unknown>;
    activate?: boolean;
    simRatePlans?: Array<{ id: string; roomTypeId: string; minRate?: string | null }>;
  } = {},
): Promise<Connected> {
  const { h } = org;
  const deps = h.dist.deps;
  const created = await org.run((tx) =>
    svc.createConnection(tx, deps, {
      propertyId: org.propertyId,
      name: 'Channex',
      ...(opts.settings ? { settings: opts.settings } : {}),
      simulator: {
        roomTypes: ['RT-WV', 'RT-BV'],
        ratePlans: opts.simRatePlans ?? [
          { id: 'RP-WV-BAR', roomTypeId: 'RT-WV' },
          { id: 'RP-BV-BAR', roomTypeId: 'RT-BV' },
        ],
      },
    }),
  );
  const id = created.connection.id;
  await svc.verifyConnection(h.t.db, deps, org.ctx, id);
  await org.run(async (tx) => {
    await svc.setRoomMapping(tx, deps, id, { unitTypeId: org.water, channelRoomTypeId: 'RT-WV' });
    await svc.setRoomMapping(tx, deps, id, { unitTypeId: org.beach, channelRoomTypeId: 'RT-BV' });
    await svc.setRateMapping(tx, deps, id, {
      unitTypeId: org.water,
      ratePlanId: org.bar,
      channelRatePlanId: 'RP-WV-BAR',
    });
    await svc.setRateMapping(tx, deps, id, {
      unitTypeId: org.beach,
      ratePlanId: org.bar,
      channelRatePlanId: 'RP-BV-BAR',
    });
  });
  if (opts.activate !== false) {
    const v = await org.run((tx) => svc.getConnection(tx, deps, id));
    await org.run((tx) => svc.activateConnection(tx, deps, id, v.version));
  }
  const endpointId = /([0-9a-f-]{36})$/.exec(created.connection.webhook.url)?.[1] as string;
  return {
    connectionId: id,
    externalPropertyId: created.connection.externalPropertyId,
    webhookToken: created.webhookToken,
    endpointId,
  };
}

/** One scheduler pass for the organization (what the worker job does when the organization is due). */
export function tick(org: Org) {
  return svc.runTenantWork(org.h.t.db, org.h.dist.deps, {
    ...org.ctx,
    actor: { kind: 'system', process: 'test-scheduler' },
    authz: systemAuthorizer,
  });
}

/** Advance the clock in steps, running the scheduler after each step (simulated wall-clock time). */
export async function runFor(org: Org, ms: number, stepMs = 1000) {
  for (let elapsed = 0; elapsed < ms; elapsed += stepMs) {
    org.h.clock.advance(stepMs);
    await tick(org);
  }
}

export function simState(org: Org, c: Connected): Promise<SimState> {
  return org.h.dist.deps.simulator.read(org.tenantId, c.externalPropertyId);
}

export function maxPerMinute(state: SimState, endpoint: 'availability' | 'restrictions'): number {
  return maxInAnyWindow(requestInstants(state, endpoint));
}

export const sys = (org: Org) => ({
  ...org.ctx,
  actor: { kind: 'system' as const, process: 'test' },
  authz: systemAuthorizer,
});
