/**
 * Test harness: a real migrated database (platform + integration), the REAL platform provider for properties
 * and data authority, fakes for modules not on main (inventory/rates/finance catalogs), a fixed clock, an
 * in-memory simulated PMS and a recording webhook transport.
 */
import { randomBytes } from 'node:crypto';
import { sourcesFromManifests, type TxContext, withTenantTx } from '@portico/db';
import {
  fixedClock,
  localFieldCipher,
  newId,
  type RequestContext,
  type TenantEnvironment,
} from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import {
  type ActivationScopePort,
  type AuthorityTransitionPort,
  createConnectorRegistry,
  type IntegrationDeps,
  type InternalCatalogPort,
  integration,
  integrationManifest,
  localSecretStore,
  PmsSimulatorHub,
  type WebhookTransport,
} from '../src';
import type { InternalCandidate } from '../src/domain/mapping-suggest';
import type { WebhookRequest } from '../src/service/transport';

export const START = '2026-11-07T06:00:00.000Z';

export interface Harness {
  t: TestDatabase;
  clock: ReturnType<typeof fixedClock>;
  deps: IntegrationDeps;
  hub: PmsSimulatorHub;
  sent: WebhookRequest[];
  transport: { respond: (req: WebhookRequest) => Promise<{ status: number }> };
  scopeCalls: Array<{ propertyId: string; effect: string }>;
  transitions: Map<string, 'planned' | 'frozen'>;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const clock = fixedClock(START);
  const t = await createTestDatabase(sourcesFromManifests([platformManifest, integrationManifest]), {
    clock,
  });
  const hub = new PmsSimulatorHub(t.db);
  const sent: WebhookRequest[] = [];
  const transport = { respond: async (_req: WebhookRequest) => ({ status: 200 }) };
  const scopeCalls: Harness['scopeCalls'] = [];
  const transitions = new Map<string, 'planned' | 'frozen'>();
  const recording: WebhookTransport = {
    async post(req) {
      sent.push(req);
      return transport.respond(req);
    },
  };
  const activationScope: ActivationScopePort = {
    async assertEffectInScope(_tx, input) {
      scopeCalls.push({ propertyId: input.propertyId, effect: input.effect });
    },
  };
  const transitionsPort: AuthorityTransitionPort = {
    async activeTransition(_tx, input) {
      const s = transitions.get(`${input.propertyId}:${input.domain}`);
      return s ? { id: 'transition', state: s } : null;
    },
  };
  const deps: IntegrationDeps = {
    ports: {
      platform: {
        async getProperty(tx, id) {
          const p = await platform.getProperty(tx, id);
          return {
            id: p.id,
            name: p.name,
            code: p.code,
            timezone: p.timezone,
            baseCurrency: p.baseCurrency,
            countryCode: p.countryCode,
          };
        },
        getDataAuthority: (tx, propertyId, domain) => platform.getDataAuthority(tx, propertyId, domain),
        setDataAuthority: (tx, input) => platform.setDataAuthority(tx, input),
      },
      catalog: fakeCatalog,
      activationScope,
      transitions: transitionsPort,
    },
    connectors: createConnectorRegistry({ pmsSimulator: hub }),
    secrets: localSecretStore(localFieldCipher(randomBytes(32).toString('base64'), 'test'), 'test'),
    transport: recording,
    simulators: { pms: hub },
    net: {
      // Fake DNS: example partner names resolve to a public documentation-free address; unknown names fail.
      async resolver(host) {
        if (host === 'internal.partner.example.com') return [{ address: '10.1.2.3', family: 4 }];
        if (host.endsWith('.example.com')) return [{ address: '93.184.216.34', family: 4 }];
        throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
      },
      allowedPorts: [443],
    },
  };
  return {
    t,
    clock,
    deps,
    hub,
    sent,
    transport,
    scopeCalls,
    transitions,
    async close() {
      await t.drop();
    },
  };
}

/** Deterministic ids for the fake Portico catalog, per property. */
export function catalogIds(propertyId: string) {
  const id = (k: string) => `${propertyId.slice(0, 8)}-${k}`;
  return {
    bv: id('ut-bv'),
    wv: id('ut-wv'),
    dbv: id('ut-dbv'),
    dwv: id('ut-dwv'),
    bar: id('rp-bar'),
    hb: id('rp-hb'),
    rm: id('cc-rm'),
    fnb: id('cc-fnb'),
    spa: id('cc-spa'),
    unit: (n: string) => id(`unit-${n}`),
  };
}

/** Stands in for inventory / rates / finance (wave-1 modules not yet on main). */
export const fakeCatalog: InternalCatalogPort = {
  async listCandidates(_tx, { kind, propertyId }): Promise<InternalCandidate[]> {
    const ids = catalogIds(propertyId);
    switch (kind) {
      case 'unitType':
        return [
          { id: ids.bv, code: 'BV', name: 'Beach Villa', attributes: { maxOccupancy: 3, unitCount: 2 } },
          { id: ids.wv, code: 'WV', name: 'Water Villa', attributes: { maxOccupancy: 2, unitCount: 2 } },
          { id: ids.dbv, code: 'DBV', name: 'Deluxe Beach Villa', attributes: { maxOccupancy: 3 } },
          { id: ids.dwv, code: 'DWV', name: 'Deluxe Water Villa', attributes: { maxOccupancy: 3 } },
        ];
      case 'unit':
        return [
          ['101', ids.bv],
          ['102', ids.bv],
          ['201', ids.wv],
          ['202', ids.wv],
          ['301', ids.dbv],
        ].map(([n, ut]) => ({
          id: ids.unit(n as string),
          code: n as string,
          name: `Villa ${n}`,
          attributes: { unitTypeId: ut as string },
        }));
      case 'ratePlan':
        return [
          { id: ids.bar, code: 'BAR', name: 'Best Available Rate', attributes: { currency: 'USD' } },
          { id: ids.hb, code: 'HB', name: 'Half Board', attributes: { currency: 'USD' } },
        ];
      case 'chargeCode':
        return [
          { id: ids.rm, code: 'RM', name: 'Room' },
          { id: ids.fnb, code: 'FNB', name: 'Food and Beverage' },
          { id: ids.spa, code: 'SPA', name: 'Spa' },
        ];
      default:
        return [];
    }
  },
};

export interface Org {
  ctx: RequestContext;
  tenantId: string;
  propertyId: string;
  propertyIds: string[];
}

/** An organization with one or more properties (first property code LGN matches the simulator). */
export async function setupOrg(
  h: Harness,
  opts: {
    environment?: TenantEnvironment;
    properties?: Array<{ code: string; name: string; currency?: string }>;
  } = {},
): Promise<Org> {
  // Default: a sandbox organization (simulators are never available in live ones — F8).
  const ctx = testContext({ environment: opts.environment ?? 'sandbox' });
  await withTenantTx(h.t.db, ctx, (tx) =>
    platform.provisionOrganization(tx, {
      name: 'Lagoon Collection',
      slug: `lagoon-${ctx.tenantId.slice(-12)}`,
      environment: opts.environment ?? 'sandbox',
      planCode: 'enterprise',
    }),
  );
  const le = await withTenantTx(h.t.db, ctx, (tx) =>
    platform.createLegalEntity(tx, {
      name: 'Lagoon Resorts',
      legalName: 'Lagoon Resorts Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    }),
  );
  const specs = opts.properties ?? [{ code: 'LGN', name: 'Lagoon Island Resort' }];
  const ids: string[] = [];
  for (const s of specs) {
    const p = await withTenantTx(h.t.db, ctx, (tx) =>
      platform.createProperty(tx, {
        code: s.code,
        name: s.name,
        profile: 'resort',
        legalEntityId: le.id,
        countryCode: 'MV',
        timezone: 'Indian/Maldives',
        baseCurrency: s.currency ?? 'USD',
        businessDate: '2026-11-07',
      }),
    );
    ids.push(p.id);
  }
  return { ctx, tenantId: ctx.tenantId, propertyId: ids[0] as string, propertyIds: ids };
}

export function userCtx(
  org: Org,
  grants: Array<{ permission: string; propertyIds: string[] | 'all' }>,
): RequestContext {
  return {
    ...testContext({ tenantId: org.tenantId, environment: org.ctx.environment, grants }),
    actor: { kind: 'user', userId: newId(), displayName: 'Staff' },
  };
}

export const tx = <T>(h: Harness, ctx: RequestContext, fn: (tx: TxContext) => Promise<T>) =>
  withTenantTx(h.t.db, ctx, fn);

export const FULL_SCOPE = {
  workflows: [
    {
      workflow: 'reservations',
      operations: ['read', 'receive', 'update'] as Array<'read' | 'receive' | 'update' | 'create'>,
    },
    {
      workflow: 'roomStatus',
      operations: ['read', 'receive', 'update'] as Array<'read' | 'receive' | 'update' | 'create'>,
    },
    {
      workflow: 'charges',
      operations: ['read', 'receive', 'create'] as Array<'read' | 'receive' | 'update' | 'create'>,
    },
  ],
  authority: [
    { domain: 'reservations' as const, writeMode: 'forward' as const },
    { domain: 'roomStatus' as const, writeMode: 'forward' as const },
    { domain: 'charges' as const, writeMode: 'forward' as const },
  ],
};

export const READ_SCOPE = {
  workflows: [
    { workflow: 'reservations', operations: ['read', 'receive'] as Array<'read' | 'receive'> },
    { workflow: 'roomStatus', operations: ['read', 'receive'] as Array<'read' | 'receive'> },
  ],
  authority: [
    { domain: 'reservations' as const, writeMode: 'read_only' as const },
    { domain: 'roomStatus' as const, writeMode: 'read_only' as const },
  ],
};

/**
 * Drive a pms.simulator connection through the whole journey with a fully privileged context (reviewing every
 * mapping that needs it). Used by tests that start from an active connection.
 */
export async function activeSimulatorConnection(
  h: Harness,
  org: Org,
  opts: {
    scope?: typeof FULL_SCOPE | typeof READ_SCOPE;
    keyExpiresAt?: Date | null;
    readOnlyKey?: boolean;
    name?: string;
  } = {},
) {
  const { account, apiKey } = await h.hub.createAccount(org.tenantId, {
    seedAt: h.clock.now(),
    keyExpiresAt: opts.keyExpiresAt ?? null,
    readOnlyKey: opts.readOnlyKey ?? false,
  });
  const ctx = org.ctx;
  let conn = await tx(h, ctx, (t) =>
    integration.createConnection(t, h.deps, {
      connectorKey: 'pms.simulator',
      name: opts.name ?? 'Lagoon PMS',
      propertyIds: [org.propertyId],
    }),
  );
  conn = (
    await tx(h, ctx, (t) =>
      integration.reviewCompatibility(t, h.deps, conn.id, conn.version, opts.scope ?? FULL_SCOPE),
    )
  ).connection;
  conn = await integration.authorize(h.t.db, h.deps, ctx, conn.id, conn.version, {
    credentials: { accountId: account.accountId, apiKey },
    label: 'Simulator key',
  });
  const set = await integration.suggestConnectionMappings(h.t.db, h.deps, ctx, conn.id, conn.version);
  const ids = catalogIds(org.propertyId);
  for (const m of set.items) {
    if (m.status.mapping === 'confirmed' && !m.requiresReview) continue;
    const target = m.kind === 'unitType' && m.externalId === 'DV' ? ids.dbv : (m.internalId ?? undefined);
    await tx(h, ctx, (t) =>
      integration.reviewMapping(
        t,
        h.deps,
        m.id,
        m.version,
        target ? { decision: 'override', internalId: target } : { decision: 'ignore' },
      ),
    );
  }
  conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
  conn = await tx(h, ctx, (t) => integration.resolveIssues(t, h.deps, conn.id, conn.version));
  const run = await integration.runValidation(h.t.db, h.deps, ctx, conn.id, conn.version);
  if (run.status !== 'passed') throw new Error(`validation failed: ${JSON.stringify(run.checks)}`);
  conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
  const preview = await integration.previewActivation(h.t.db, h.deps, ctx, conn.id, conn.version);
  conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
  conn = await tx(h, ctx, (t) =>
    integration.activate(t, h.deps, conn.id, conn.version, {
      previewId: preview.id,
      previewHash: preview.hash,
    }),
  );
  return { conn, account, apiKey, preview };
}
