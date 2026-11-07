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
  createInventoryDemoSeed,
  createInventoryJobs,
  createInventoryService,
  type InventoryService,
  inventoryHttp,
  inventoryManifest,
  inventorySearch,
} from '@portico/inventory';
import {
  DomainError,
  fieldCryptoFromEnv,
  type ModuleManifest,
  randomToken,
  systemAuthorizer,
} from '@portico/kernel';
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
import {
  createPaymentsModule,
  envProviderSecrets,
  type LedgerPort,
  type PlatformPort as PaymentsPlatformPort,
  type PaymentsService,
  paymentsManifest,
  paymentsSearch,
  seedPaymentsDemo,
} from '@portico/payments';
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
  // wave-1 modules register here
  paymentsManifest,
];

/**
 * Stub for a port whose provider is another wave-1 module not merged yet. Every call fails with a clear,
 * retryable error (except the operations given in `available`).
 */
function unavailablePort<T extends object>(module: string, available: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_t, prop) =>
      prop in available
        ? available[prop as keyof T]
        : () => {
            throw new DomainError(
              'module_unavailable',
              `The ${module} module is not connected yet (${String(prop)}). The action was recorded where possible; it will be completed once ${module} is available.`,
              { status: 503, retryable: true, details: { module, operation: String(prop) } },
            );
          },
  });
}

/**
 * Finance is not merged yet. Payments may not collect against a folio it cannot place (P0-1: the folio might belong
 * to another property or company), so folio collections are refused with a clear reason; a booking deposit is
 * accepted (finance binds the booking to the property when it posts the deposit, and refuses a mismatch) and shows
 * "not yet on the bill" until finance is connected. Every posting fails retryably and is retried by reconciliation.
 */
const ledgerUntilFinanceMerges = unavailablePort<LedgerPort>('finance', {
  async describeTarget(_tx, ref) {
    if (ref.type === 'booking') return null;
    throw new DomainError(
      'module_unavailable',
      'Finance is not connected yet, so Portico cannot confirm which property this folio belongs to and will not collect against it. Take the payment as a booking deposit, or record it once finance is connected.',
      { status: 503, retryable: true, details: { module: 'finance', operation: 'describeTarget' } },
    );
  },
});

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
    payments: PaymentsService;
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

  // ── payments ── (finance LedgerPort: bind `financeLedgerForPayments(finance)` when finance merges)
  const paymentsPlatform: PaymentsPlatformPort = {
    // Payments has already checked its own permission; it needs the merchant (legal entity) and time zone.
    async getProperty(tx, propertyId) {
      const p = await platform.getProperty(asSystem(tx), propertyId);
      return { id: p.id, legalEntityId: p.legalEntityId, timezone: p.timezone, baseCurrency: p.baseCurrency };
    },
    async getLegalEntity(tx, id) {
      const le = await platform.getLegalEntity(tx, id);
      return { id: le.id, countryCode: le.countryCode, baseCurrency: le.baseCurrency };
    },
    assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
    async resolvePolicy(tx, propertyId, key, defaultValue) {
      return { value: (await platform.resolvePolicy(tx, propertyId, key, defaultValue)).value };
    },
  };
  const payments = createPaymentsModule({
    database,
    ledger: ledgerUntilFinanceMerges,
    platform: paymentsPlatform,
    secrets: envProviderSecrets(process.env),
    simulatorSigningSecret: process.env.PAYMENTS_SIMULATOR_SIGNING_SECRET ?? randomToken(),
  });

  // ── cross-module experience: global search, summaries, record history ──
  const searchProviders: SearchProvider[] = [
    platformSearch,
    inventorySearch,
    guestsSearchProvider(guestsService),
    operationsSearch,
    ratesSearch,
    paymentsSearch,
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
      payments.http,
      recordsModule,
    ],
    subscriptions: [...operationsSubscriptions(operationsPorts), ...payments.subscriptions],
    searchProviders,
    jobs: [
      ...CORE_JOBS,
      ...createInventoryJobs(inventoryService),
      ...guestsJobs(guestsService),
      ...payments.jobs,
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
    ],
    services: {
      guests: guestsService,
      inventory: inventoryService,
      operations: operationsService,
      rates,
      payments: payments.service,
    },
    demoSeedSteps: [
      { name: 'inventory', run: inventoryDemoSeed },
      createGuestsDemoSeed(guestsService),
      createOperationsDemoSeed(operationsService),
      // After inventory: prices the demo properties' unit types by profile (resort vs guesthouse).
      { name: 'rates', run: createRatesDemoSeed(rates, ratesPorts) },
      { name: 'payments', run: seedPaymentsDemo },
    ],
  };
}

/** Every permission key registered by any module (for role editors and validation). */
export function permissionCatalog() {
  return MANIFESTS.flatMap((m) => m.permissions);
}
