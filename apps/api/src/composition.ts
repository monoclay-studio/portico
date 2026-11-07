/**
 * Composition root — the ONLY place where modules are wired together (ports → providers).
 * Each module contributes: a manifest (migrations + permissions), an HTTP module, event subscriptions and
 * port bindings. Keep one block per module to make parallel work merge cleanly.
 */
import {
  CORE_JOBS,
  type PorticoDatabase,
  type ScheduledJob,
  type SearchProvider,
  type TxEventSubscription,
} from '@portico/db';
import {
  createGuestsDemoSeed,
  createGuestsService,
  type GuestsService,
  guestsHttp,
  guestsJobs,
  guestsManifest,
  guestsSearchProvider,
} from '@portico/guests';
import type { Authenticator, HttpModule } from '@portico/http';
import { type IdentityPorts, identityAuthenticator, identityHttp, identityManifest } from '@portico/identity';
import {
  createConnectorRegistry,
  type IntegrationDeps,
  integrationHttp,
  integrationJobs,
  integrationManifest,
  integrationSearch,
  integrationSubscriptions,
  localSecretStore,
  noAuthorityTransitions,
  PmsSimulatorHub,
  safeWebhookTransport,
  systemResolver,
  unavailableActivationScope,
  unavailableCatalog,
} from '@portico/integration';
import {
  createInventoryDemoSeed,
  createInventoryJobs,
  createInventoryService,
  type InventoryService,
  inventoryHttp,
  inventoryManifest,
  inventorySearch,
} from '@portico/inventory';
import { fieldCryptoFromEnv, type ModuleManifest, systemAuthorizer } from '@portico/kernel';
import {
  createOperationsDemoSeed,
  createOperationsService,
  type OperationsPorts,
  type OperationsService,
  operationsHttp,
  operationsJobs,
  operationsManifest,
  operationsSearch,
  operationsSubscriptions,
} from '@portico/operations';
import { platform, platformHttp, platformManifest, platformSearch } from '@portico/platform';
import {
  createRatesDemoSeed,
  type RatesPorts,
  type RatesService,
  ratesHttp,
  ratesManifest,
  ratesSearch,
  ratesService,
  termsSealKeyFromEnv,
} from '@portico/rates';
import { recordsHttp } from './records-routes';
import type { DemoSeedStep } from './seed/demo';

export const MANIFESTS: readonly ModuleManifest[] = [
  platformManifest,
  identityManifest,
  inventoryManifest,
  guestsManifest,
  operationsManifest,
  ratesManifest,
  integrationManifest,
  // wave-1 modules register here
];

// ── inventory ── bound once; inventory's only port is platform (exists on main), so nothing is stubbed.
// Other modules (reservations, operations, groups, distribution, day-close) bind their inventory ports to this.
export const inventoryService: InventoryService = createInventoryService({
  platform: {
    getBusinessDate: platform.getBusinessDate,
    getDataAuthority: platform.getDataAuthority,
    assertWritable: platform.assertWritable,
    getLimit: platform.getLimit,
    resolvePolicy: platform.resolvePolicy,
  },
});
/** DemoSeedStep `run` for inventory (registered in `Composition.demoSeedSteps`). */
export const inventoryDemoSeed = createInventoryDemoSeed(inventoryService, {
  businessDate: platform.getBusinessDate,
});

export interface Composition {
  authenticator: Authenticator;
  httpModules: HttpModule[];
  subscriptions: TxEventSubscription[];
  searchProviders: SearchProvider[];
  /** Periodic background jobs run by apps/worker (each module contributes its own). */
  jobs: ScheduledJob[];
  /** Provider services other modules' ports bind to (domain map). */
  services: {
    guests: GuestsService;
    inventory: InventoryService;
    operations: OperationsService;
    rates: RatesService;
  };
  /** Demo data contributed by each module, run in order inside each demo organization (apps/api/src/seed). */
  demoSeedSteps: DemoSeedStep[];
}

export function compose(database: PorticoDatabase): Composition {
  // ── platform ──
  const platformModule = platformHttp({ database });

  // ── identity ──
  const identityPorts: IdentityPorts = { propertyIdsInScope: platform.propertyIdsInScope };
  const identityModule = identityHttp({ database });

  // ── guests ── (other wave-1 providers — referenceCounters, personalDataContributors, communications — are
  // bound by the orchestrator when reservations / finance / comms merge; until then the ports are empty.)
  const asSystem = <T extends { authz: unknown }>(tx: T): T => ({ ...tx, authz: systemAuthorizer });
  const guestsService = createGuestsService({
    platform: {
      assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
      hasEntitlement: (tx, feature) => platform.hasEntitlement(tx, feature),
      resolvePolicy: (tx, propertyId, key, def) => platform.resolvePolicy(tx, propertyId, key, def),
      listPropertyIds: async (tx) => (await platform.listProperties(asSystem(tx))).map((p) => p.id),
      getPropertyCountry: async (tx, id) => (await platform.getProperty(asSystem(tx), id)).countryCode,
      getPropertyLegalEntityId: async (tx, id) =>
        (await platform.getProperty(asSystem(tx), id)).legalEntityId,
      legalEntityExists: (tx, id) =>
        platform.getLegalEntity(tx, id).then(
          () => true,
          () => false,
        ),
      getBusinessDate: (tx, id) => platform.getBusinessDate(tx, id),
    },
    // Field encryption + blind index from the shared kernel helper (KMS in production; refuses dev keys there).
    crypto: fieldCryptoFromEnv(),
  });
  const guestsModule = guestsHttp({ database, service: guestsService });

  // ── inventory ──
  const inventoryModule = inventoryHttp({ database, inventory: inventoryService });

  // ── operations (housekeeping, tasks, maintenance, lost & found, offline sync) ──
  const operationsPorts: OperationsPorts = {
    platform: {
      // Reference reads (timezone, business date, departments) for internal computation use system scope;
      // operations enforces its own permissions on every command.
      async getProperty(tx, propertyId) {
        const p = await platform.getProperty({ ...tx, authz: systemAuthorizer }, propertyId);
        return {
          id: p.id,
          timezone: p.timezone,
          businessDate: p.businessDate,
          checkInTime: p.checkInTime,
          profile: p.profile,
        };
      },
      assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
      async getDataAuthority(tx, propertyId, domain) {
        const a = await platform.getDataAuthority(tx, propertyId, domain);
        return {
          authority: a.authority,
          connectionId: a.connectionId,
          systemName: a.systemName,
          writeMode: a.writeMode,
        };
      },
      resolvePolicy: async (tx, propertyId, key) =>
        (await platform.resolvePolicy(tx, propertyId, key, {})).value,
      listDepartments: async (tx, propertyId) =>
        (await platform.listDepartments({ ...tx, authz: systemAuthorizer }, propertyId)).map((d) => ({
          id: d.id,
          kind: d.kind,
        })),
    },
    // ADR-0015: operations authorizes the user's intent (operations.maintenance.setInventoryImpact at the
    // property); inventory enforces integrity and its data authority. Refusals are kept on the work order.
    // Until inventory drops its own permission re-check on port calls (pending-fixes: ADR-0015), the adapter calls
    // it with system scope AFTER operations authorized the intent; inventory still enforces integrity and the
    // availability/maintenance authority of the property.
    inventory: {
      blockUnit: (tx, input) => inventoryService.blockUnit(asSystem(tx), input),
      releaseBlock: (tx, input) => inventoryService.releaseBlock(asSystem(tx), input),
      listUnits: (tx, propertyId, filter) => inventoryService.listUnits(asSystem(tx), propertyId, filter),
    },
  };
  const operationsService = createOperationsService(operationsPorts);
  const operationsModule = operationsHttp({ database, service: operationsService });

  // ── rates ── (pricing contract provider: quote, agreed terms, priceChange, penalties, computeTaxes)
  const ratesPorts: RatesPorts = {
    // Property facts and unit types are read as the system: rates checks its own permissions (a channel or desk
    // agent quoting holds rates.quote.read, not platform.property.read or inventory read).
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
    resolvePolicy: (tx, propertyId, key, defaultValue) =>
      platform.resolvePolicy(tx, propertyId, key, defaultValue),
    getBusinessDate: (tx, propertyId) => platform.getBusinessDate(tx, propertyId),
    listUnitTypes: async (tx, propertyId) =>
      (await inventoryService.listUnitTypes(asSystem(tx), propertyId)).map((u) => ({
        id: u.id,
        code: u.code,
        name: u.name,
      })),
    // Negotiated-rate eligibility: the company must exist in this organization and not be inactive.
    companyExists: (tx, companyId) =>
      guestsService.getCompany(asSystem(tx), companyId).then(
        (c) => c.status.company !== 'inactive',
        () => false,
      ),
    // channelForApiClient (distribution) and affectedAgreements (reservations/finance) are bound when those
    // modules merge; until then API clients sell as `api_client:<id>` and the tax activation report says so.
  };
  // Agreed terms are sealed with a server key (PORTICO_TERMS_SEAL_KEY; required in production).
  const rates = ratesService(ratesPorts, { termsSealKey: termsSealKeyFromEnv().key });
  const ratesModule = ratesHttp({ database, rates });

  // ── integration ──
  // Ports: platform, inventory (unit types, units) and rates (rate plans) are real. Tax-rule / finance / outlet
  // catalogs, platform activation scope (G-04) and authority transitions (G-02) are bound to stubs until those
  // providers merge (modules/integration/README.md).
  const notYetBound = unavailableCatalog({
    taxRule: 'rates (tax rules)',
    chargeCode: 'finance',
    ledgerAccount: 'finance',
    outlet: 'platform (outlets)',
  });
  const pmsSimulators = new PmsSimulatorHub(database);
  const fieldCrypto = fieldCryptoFromEnv();
  const integrationDeps: IntegrationDeps = {
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
      // Unit types and units come from inventory (on main). Integration already authorized the user's intent and
      // property scope (ADR-0015), so the read goes through a system context scoped to that property.
      catalog: {
        async listCandidates(tx, input) {
          if (input.kind === 'unitType') {
            const types = await inventoryService.listUnitTypes(asSystem(tx), input.propertyId);
            return types.map((t) => ({
              id: t.id,
              code: t.code,
              name: t.name,
              attributes: { maxOccupancy: t.maxOccupancy },
            }));
          }
          if (input.kind === 'unit') {
            const units = await inventoryService.listUnits(asSystem(tx), input.propertyId);
            return units.map((u) => ({
              id: u.id,
              code: u.number,
              name: u.name ?? u.number,
              attributes: { unitTypeId: u.unitTypeId },
            }));
          }
          if (input.kind === 'ratePlan') {
            const plans = await rates.listRatePlans(asSystem(tx), { propertyId: input.propertyId });
            return plans.map((r) => ({
              id: r.id,
              code: r.code,
              name: r.name,
              attributes: { currency: r.currency, mealPlan: r.mealPlan },
            }));
          }
          return notYetBound.listCandidates(tx, input);
        },
      },
      // Owning modules register inbound handlers here (operations → roomStatus, reservations → reservations) when
      // they merge; until then received records are stored as `accepted` and applied in order once bound.
      inbound: {},
      activationScope: unavailableActivationScope,
      // When platform authority transitions are on main (identity-plus), bind: activeTransition ← openTransitionFor
      // (status → state); plan ← planAuthorityTransition(tx, propertyId, { changes, reason, freezeMinutes }); and
      // platform's transitionGuard ← createIntegrationProvider(integrationDeps).pendingOperations.
      transitions: noAuthorityTransitions,
    },
    connectors: createConnectorRegistry({ pmsSimulator: pmsSimulators }),
    secrets: localSecretStore(fieldCrypto.cipher, fieldCrypto.keySource),
    transport: safeWebhookTransport({ resolver: systemResolver, allowedPorts: [443] }),
    net: { resolver: systemResolver, allowedPorts: [443] },
    simulators: { pms: pmsSimulators },
  };
  const integrationModule = integrationHttp({ database, integration: integrationDeps });

  // ── cross-module experience: global search, summaries, record history ──
  const searchProviders: SearchProvider[] = [
    platformSearch,
    inventorySearch,
    guestsSearchProvider(guestsService),
    operationsSearch,
    ratesSearch,
    integrationSearch,
  ];
  const recordsModule = recordsHttp({ database, manifests: MANIFESTS, searchProviders });

  return {
    authenticator: identityAuthenticator(database, identityPorts),
    httpModules: [
      platformModule,
      identityModule,
      inventoryModule,
      guestsModule,
      operationsModule,
      ratesModule,
      integrationModule,
      recordsModule,
    ],
    subscriptions: [
      ...operationsSubscriptions(operationsPorts),
      ...integrationSubscriptions(integrationDeps),
    ],
    searchProviders,
    jobs: [
      ...CORE_JOBS,
      ...createInventoryJobs(inventoryService),
      ...guestsJobs(guestsService),
      ...operationsJobs(operationsPorts, {
        onError: (job, propertyId, err) =>
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'job failed for property',
              job,
              propertyId,
              err: err instanceof Error ? err.name : 'unknown',
            }),
          ),
      }),
      ...integrationJobs(integrationDeps),
    ],
    services: { guests: guestsService, inventory: inventoryService, operations: operationsService, rates },
    demoSeedSteps: [
      { name: 'inventory', run: inventoryDemoSeed },
      createGuestsDemoSeed(guestsService),
      createOperationsDemoSeed(operationsService),
      // After inventory: prices the demo properties' unit types by profile (resort vs guesthouse).
      { name: 'rates', run: createRatesDemoSeed(rates, ratesPorts) },
    ],
  };
}

/** Every permission key registered by any module (for role editors and validation). */
export function permissionCatalog() {
  return MANIFESTS.flatMap((m) => m.permissions);
}
