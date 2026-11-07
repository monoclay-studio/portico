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
  createFinance,
  type FinancePorts,
  financeDemoSeed,
  financeHttp,
  financeManifest,
  financeSearch,
  financeSubscriptions,
  unavailableFinancePorts,
} from '@portico/finance';
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
import {
  fetchOidcHttp,
  fieldEncryptedSecretStore,
  IDENTITY_JOBS,
  type IdentityPorts,
  identityAuthenticator,
  identityHttp,
  identityManifest,
  operatorDirectoryFromConfig,
  outboxNotifier,
  ssoDomainRecheckJob,
  systemTxtResolver,
  unknownGeo,
} from '@portico/identity';
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
import {
  assertExternalEffectAllowed,
  BusinessRuleError,
  DomainError,
  fieldCryptoFromEnv,
  type ModuleManifest,
  ModuleUnavailableError,
  NotFoundError,
  randomToken,
  systemAuthorizer,
} from '@portico/kernel';
import {
  createMigrationDemoSeed,
  createRehearsalBridge,
  type MigrationDeps,
  migrationHttp,
  migrationJobs,
  migrationManifest,
  migrationPersonalData,
  migrationSearch,
  migrationSubscriptions,
  ProviderUnavailableError,
} from '@portico/migration';
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
import {
  type PlatformPorts,
  platform,
  platformHttp,
  platformManifest,
  platformSearch,
} from '@portico/platform';
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
import {
  type AccessPort,
  environmentAccessAdapter,
  type FinancePort,
  type GuestsPort,
  inventoryPortFrom,
  type OperationsPort,
  type PaymentsPort,
  type PlatformPort,
  type RatesPort,
  reservationsHttp,
  reservationsJobs,
  reservationsManifest,
  reservationsService,
} from '@portico/reservations';
import { createTrialForOrganization, provisioningHttp } from './provisioning';
import { recordsHttp } from './records-routes';
import type { DemoSeedStep } from './seed/demo';

export const MANIFESTS: readonly ModuleManifest[] = [
  platformManifest,
  identityManifest,
  inventoryManifest,
  guestsManifest,
  financeManifest,
  reservationsManifest,
  operationsManifest,
  ratesManifest,
  integrationManifest,
  // wave-1 modules register here
  paymentsManifest,
  // wave-2 modules
  migrationManifest,
];

/**
 * Stub for a port whose provider is another wave-1 module not merged yet. Every call fails with a clear,
 * retryable error (except the operations given in `available`).
 */
function unavailablePort<T extends object>(module: string, available: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined; // not a thenable
      if (prop in available) return available[prop as keyof T];
      return () => {
        throw new ModuleUnavailableError(module, String(prop));
      };
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
      'module_not_available',
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
  identityPorts: IdentityPorts;
  platformPorts: PlatformPorts;
}

export interface CompositionOptions {
  /** Configuration source (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Test/integration overrides for identity ports (e.g. a fake identity provider, a GeoIP fake). */
  identity?: Partial<IdentityPorts>;
  platform?: Partial<PlatformPorts>;
}

export function compose(database: PorticoDatabase, options: CompositionOptions = {}): Composition {
  const env = options.env ?? process.env;

  // ── platform ──
  const platformPorts: PlatformPorts = {
    // Other modules append their configuration sections, trial participants and activation checks here.
    configurationSections: platform.platformConfigurationSections(),
    trialParticipants: [],
    activationChecks: [],
    trialProvisioner: { createTrial: createTrialForOrganization },
    ...options.platform,
  };
  const platformModule = platformHttp({ database, ports: platformPorts });

  // ── identity ──
  // Field encryption (TOTP secrets, PKCE verifiers, SSO client secrets) from the single kernel key source.
  const { cipher } = fieldCryptoFromEnv(env);
  const appBaseUrl = env.PORTICO_APP_BASE_URL ?? 'http://localhost:5173';
  const production = env.NODE_ENV === 'production';
  const identityPorts: IdentityPorts = {
    propertyIdsInScope: platform.propertyIdsInScope,
    permissionCatalog,
    cipher,
    secrets: fieldEncryptedSecretStore(cipher),
    notifier: outboxNotifier(cipher),
    // SSRF-safe (public https only, pinned DNS, no redirects); a local http IdP only outside production (P2-2).
    oidcHttp: fetchOidcHttp({ allowLocalDevelopment: !production }),
    dnsTxt: systemTxtResolver,
    geo: unknownGeo,
    operators: operatorDirectoryFromConfig(env.PORTICO_OPERATORS),
    hasEntitlement: (tx, feature) => platform.hasEntitlement(tx, feature),
    organizationName: async (tx) => (await platform.getOrganization(tx)).name,
    assertPropertyExists: async (tx, propertyId) => {
      await platform.getPropertyFacts(tx, propertyId);
    },
    config: {
      appBaseUrl,
      ssoRedirectUri: env.PORTICO_SSO_REDIRECT_URI ?? `${appBaseUrl}/auth/sso/callback`,
      totpIssuer: 'Portico',
      allowLocalIdentityProvider: !production,
      // P2-17: static operator tokens (no expiry, no MFA) are refused in production until IAM Identity Center.
      operatorConsoleEnabled: !production,
    },
    ...options.identity,
  };
  const identityModule = identityHttp({ database, ports: identityPorts });

  // ── provisioning (operator console: trials for prospects) ──
  const provisioningModule = provisioningHttp({ database, ports: identityPorts });

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
    // A guest's data export includes what a migration still holds about them (source rows before the purge).
    personalDataContributors: [migrationPersonalData],
  });
  const guestsModule = guestsHttp({ database, service: guestsService });

  // ── inventory ──
  const inventoryModule = inventoryHttp({ database, inventory: inventoryService });

  // ── finance ──
  // Tax engine (rates) and payments are wave-1 modules built in parallel: bound to explicit "not connected"
  // stubs until they merge (tax computation fails loudly; collection requests report 'unavailable').
  const financePorts: FinancePorts = {
    platform: {
      // Routing metadata only (legal entity, currency): not gated by platform.property.read.
      getProperty: (tx, id) => platform.getProperty({ ...tx, authz: systemAuthorizer }, id),
      getBusinessDate: platform.getBusinessDate,
      getLegalEntity: platform.getLegalEntity,
      assertWritable: platform.assertWritable,
    },
    ...unavailableFinancePorts(),
    // Payer names for folios and tax invoices: guest profiles by id (companies/agencies when that module exists).
    payers: {
      async describePayer(tx, input) {
        if (input.type !== 'guest') return null;
        try {
          const p = await guestsService.getProfile(asSystem(tx), input.id, { propertyId: input.propertyId });
          return { name: p.displayName };
        } catch (err) {
          if (err instanceof NotFoundError) return null;
          throw err;
        }
      },
    },
  };
  const finance = createFinance(financePorts);
  const financeModule = financeHttp({ database, finance });

  // ── reservations ──
  // Platform is real. inventory, rates, guests, finance, payments, operations are wave-1 modules built in
  // parallel: bound to stubs that answer 503 `module_not_available` until the orchestrator binds the providers.
  // access (door locks / keys) is a later module: the environment-safe fallback adapter answers `simulated` in
  // non-live environments and `unavailable` (manual fallback at the desk) in live.
  const reservationsPlatform: PlatformPort = {
    async getProperty(tx, propertyId) {
      // Property facts for computation (time zone, currency) — not a user-facing read.
      const p = await platform.getProperty({ ...tx, authz: systemAuthorizer }, propertyId);
      return {
        id: p.id,
        name: p.name,
        timezone: p.timezone,
        baseCurrency: p.baseCurrency,
        legalEntityId: p.legalEntityId,
        businessDate: p.businessDate,
        checkInTime: p.checkInTime,
        checkOutTime: p.checkOutTime,
      };
    },
    getBusinessDate: (tx, propertyId) => platform.getBusinessDate(tx, propertyId),
    assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
    getDataAuthority: (tx, propertyId, domain) => platform.getDataAuthority(tx, propertyId, domain),
    resolvePolicy: (tx, propertyId, key, def) => platform.resolvePolicy(tx, propertyId, key, def),
  };
  const reservations = reservationsService({
    platform: reservationsPlatform,
    // R-13: the real inventory module through reservations' structural adapter (unit number → name, exclusions →
    // reasons/conflicting refs, sold[] for the who-sold-it explanation). Drift in inventory's contract fails tsc here.
    // ADR-0015: reservations authorizes the user's intent on every command; inventory is called with system scope
    // (like operations' binding) and still enforces integrity and the availability authority.
    inventory: inventoryPortFrom(inventoryService, { scope: asSystem }),
    rates: unavailablePort<RatesPort>('rates'),
    guests: unavailablePort<GuestsPort>('guests'),
    finance: unavailablePort<FinancePort>('finance'),
    payments: unavailablePort<PaymentsPort>('payments'),
    operations: unavailablePort<OperationsPort>('operations'),
    access: environmentAccessAdapter() satisfies AccessPort,
  });
  const reservationsModule = reservationsHttp({ database, service: reservations });
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

  // ── migration ("Move to Portico", D13) ──
  // Platform, inventory, guests, rates, finance (opening deposits) and the integration PMS simulator are real
  // (ADR-0015: migration authorizes the user's intent at the property; providers run with system scope and still
  // enforce integrity and data authority). The requested contracts that are not on main yet answer 503
  // `migration_provider_unavailable` and the pipeline waits honestly: reservations' migration import (MIG-CR-1),
  // finance's in-house and receivables opening balances (MIG-CR-3/4), payments' card re-collection (MIG-CR-5).
  const migrationUnavailable = (provider: string, operation: string, request: string) => async () => {
    throw new ProviderUnavailableError(provider, operation, request);
  };
  const asMigrationProcess = <T extends { actor: unknown; authz: unknown }>(tx: T): T => ({
    ...tx,
    actor: { kind: 'system', process: 'migration' },
    authz: systemAuthorizer,
  });
  const transitionView = (t: Awaited<ReturnType<typeof platform.planAuthorityTransition>>) => ({
    id: t.id,
    status: t.status,
    approvalRequired: t.approvalRequired,
    approvedBy: t.approvedBy,
    plannedBy: t.plannedBy,
  });
  const migrationDeps: MigrationDeps = {
    ports: {
      platform: {
        async getProperty(tx, id) {
          const p = await platform.getProperty(asSystem(tx), id);
          return {
            id: p.id,
            name: p.name,
            timezone: p.timezone,
            baseCurrency: p.baseCurrency,
            businessDate: p.businessDate,
            status: p.status,
          };
        },
        getDataAuthority: (tx, propertyId, domain) => platform.getDataAuthority(tx, propertyId, domain),
        // Restricting (Portico read-only until the cutover): recorded as the migration process; moving back to
        // Portico always needs the authority transition approved by a second person (CR-10).
        async declareExternalAuthority(tx, i) {
          await platform.setDataAuthority(asMigrationProcess(tx), {
            propertyId: i.propertyId,
            domain: i.domain,
            authority: 'external',
            connectionId: i.connectionId,
            systemName: i.systemName,
            writeMode: 'read_only',
            reason: i.reason,
          });
        },
        planTransition: async (tx, i) =>
          transitionView(
            await platform.planAuthorityTransition(asSystem(tx), i.propertyId, {
              changes: i.changes,
              reason: i.reason,
              rollbackCriteria: i.rollbackCriteria,
              freezeMinutes: i.freezeMinutes,
              ...(i.plannedStartAt ? { plannedStartAt: i.plannedStartAt } : {}),
            }),
          ),
        async getTransition(tx, propertyId, id) {
          const t = (await platform.listAuthorityTransitions(asSystem(tx), propertyId)).find(
            (x) => x.id === id,
          );
          return t ? transitionView(t) : null;
        },
        approveTransition: async (tx, id, note) =>
          transitionView(await platform.approveAuthorityTransition(asSystem(tx), id, note)),
        freezeTransition: async (tx, id) =>
          transitionView(await platform.freezeAuthorityTransition(asSystem(tx), id)),
        completeTransition: async (tx, id) =>
          transitionView(await platform.completeAuthorityTransition(asSystem(tx), platformPorts, id)),
        async cancelTransition(tx, id, reason) {
          await platform.cancelAuthorityTransition(asSystem(tx), id, reason);
        },
        assertWorkflowInScope: (tx, propertyId, workflow) =>
          platform.assertWorkflowInScope(tx, propertyId, workflow),
        async trialSourceOrganization(tx) {
          const info = await platform.getEnvironmentInfo(asSystem(tx));
          return info.trial
            ? { organizationId: info.trial.sourceOrganizationId, status: info.trial.status }
            : null;
        },
        recordTrialImport: (tx, i) => platform.recordTrialImport(asSystem(tx), i),
      },
      inventory: {
        listUnitTypes: async (tx, propertyId) =>
          (await inventoryService.listUnitTypes(asSystem(tx), propertyId)).map((u) => ({
            id: u.id,
            code: u.code,
            name: u.name,
          })),
        async createUnitType(tx, propertyId, i) {
          const u = await inventoryService.createUnitType(asSystem(tx), propertyId, {
            code: i.code,
            name: i.name,
            kind: 'room',
            baseOccupancy: i.baseOccupancy,
            maxAdults: i.maxOccupancy,
            maxChildren: Math.max(0, i.maxOccupancy - 1),
            maxOccupancy: i.maxOccupancy,
          });
          return { id: u.id };
        },
        listUnits: async (tx, propertyId) =>
          (await inventoryService.listUnits(asSystem(tx), propertyId)).map((u) => ({
            id: u.id,
            number: u.number,
            unitTypeId: u.unitTypeId,
          })),
        async createUnit(tx, propertyId, i) {
          const u = await inventoryService.createUnit(asSystem(tx), propertyId, {
            unitTypeId: i.unitTypeId,
            number: i.number,
            ...(i.name ? { name: i.name } : {}),
            ...(i.inInventoryFrom ? { inInventoryFrom: i.inInventoryFrom } : {}),
          });
          return { id: u.id };
        },
        sold: async (tx, i) =>
          (
            await inventoryService.getAvailability(asSystem(tx), {
              propertyId: i.propertyId,
              range: { from: i.from, to: i.to },
            })
          ).map((c) => ({ unitTypeId: c.unitTypeId, date: c.date, sold: c.sold })),
      },
      rates: {
        listRatePlans: async (tx, propertyId) =>
          (await rates.listRatePlans(asSystem(tx), { propertyId })).map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
          })),
      },
      guests: {
        async importProfile(tx, i) {
          const contactPoints = [
            ...(i.email ? [{ kind: 'email' as const, value: i.email, source: 'migration' }] : []),
            ...(i.phone ? [{ kind: 'phone' as const, value: i.phone, source: 'migration' }] : []),
          ];
          const r = await guestsService.resolveProfile(
            asSystem(tx),
            {
              propertyId: i.propertyId,
              familyName: i.familyName,
              ...(i.givenName ? { givenName: i.givenName } : {}),
              ...(i.nationality ? { nationality: i.nationality } : {}),
              ...(i.dateOfBirth ? { dateOfBirth: i.dateOfBirth } : {}),
              ...(contactPoints.length ? { contactPoints } : {}),
              source: { kind: 'migration', ref: `${i.sourceSystem}:${i.sourceKey}`.slice(0, 200) },
            },
            { matchStrategy: 'suggest' },
          );
          return {
            profileId: r.profileId,
            created: r.created,
            possibleDuplicates: r.suggestions.map((s) => ({
              profileId: s.profileId,
              score: s.score,
              band: s.band,
              reasons: s.reasons.map((x) => x.code),
            })),
          };
        },
        existing: async (tx, i) => [
          ...(await guestsService.visibleProfileIds(asSystem(tx), i.profileIds, {
            propertyId: i.propertyId,
          })),
        ],
      },
      reservations: {
        importBooking: migrationUnavailable('Reservations', 'import migrated bookings', 'MIG-CR-1'),
        listImported: migrationUnavailable('Reservations', 'list migrated bookings', 'MIG-CR-1'),
      },
      finance: {
        async importOpeningDeposits(tx, i) {
          const r = await finance.importOpeningDeposits(asSystem(tx), { ...i, idempotencyKey: i.importRef });
          return {
            status: r.status,
            importedCount: r.importedCount,
            importedTotalMinor: r.importedTotalMinor,
            differenceMinor: r.differenceMinor,
            rejected: r.rejected,
          };
        },
        async depositBalances(tx, i) {
          const out: Array<{ bookingId: string; amountMinor: number; currency: string }> = [];
          for (const id of i.bookingIds) {
            const d = await finance.getDeposits(asSystem(tx), id);
            if (d)
              out.push({ bookingId: id, amountMinor: d.balance.amountMinor, currency: d.balance.currency });
          }
          return out;
        },
        async taxAccountKeys(tx, propertyId) {
          const p = await platform.getProperty(asSystem(tx), propertyId);
          return (await finance.listAccounts(asSystem(tx), p.legalEntityId))
            .map((a) => a.systemKey ?? '')
            .filter((k) => k.startsWith('tax:') && k !== 'tax:unmapped')
            .map((k) => k.slice(4));
        },
        importOpeningFolioBalances: migrationUnavailable(
          'Finance',
          'import in-house folio balances',
          'MIG-CR-3',
        ),
        folioOpeningBalances: migrationUnavailable('Finance', 'read in-house opening balances', 'MIG-CR-3'),
        importOpeningReceivables: migrationUnavailable(
          'Finance',
          'import receivables open items',
          'MIG-CR-4',
        ),
        receivableOpenItems: migrationUnavailable('Finance', 'read receivables opening items', 'MIG-CR-4'),
      },
      cards: { request: migrationUnavailable('Payments', 'send card re-collection requests', 'MIG-CR-5') },
      simulator: {
        async snapshot(tx, accountId) {
          if (tx.environment === 'live')
            throw new BusinessRuleError(
              'simulator_not_in_live',
              'The simulator is never read in a live organization.',
            );
          assertExternalEffectAllowed(tx, 'integration.read');
          const st = await pmsSimulators.run(tx.tenantId, accountId, (a) => a.toState(), {
            write: false,
            tx,
          });
          return { accountId, property: st.property, reservations: st.reservations };
        },
      },
      rehearsal: createRehearsalBridge(database, () => migrationDeps),
    },
  };
  const migrationModule = migrationHttp({ database, migration: migrationDeps });

  // ── cross-module experience: global search, summaries, record history ──
  const searchProviders: SearchProvider[] = [
    platformSearch,
    inventorySearch,
    guestsSearchProvider(guestsService),
    financeSearch,
    reservations.search(),
    operationsSearch,
    ratesSearch,
    integrationSearch,
    paymentsSearch,
    migrationSearch,
  ];
  const recordsModule = recordsHttp({ database, manifests: MANIFESTS, searchProviders });

  return {
    authenticator: identityAuthenticator(database, identityPorts),
    httpModules: [
      platformModule,
      identityModule,
      provisioningModule,
      inventoryModule,
      guestsModule,
      financeModule,
      reservationsModule,
      operationsModule,
      ratesModule,
      integrationModule,
      payments.http,
      migrationModule,
      recordsModule,
    ],
    subscriptions: [
      ...financeSubscriptions(finance, financePorts),
      ...reservations.subscriptions(),
      ...operationsSubscriptions(operationsPorts),
      ...integrationSubscriptions(integrationDeps),
      ...payments.subscriptions,
      ...migrationSubscriptions(),
    ],
    searchProviders,
    jobs: [
      ...CORE_JOBS,
      ...IDENTITY_JOBS,
      ssoDomainRecheckJob(systemTxtResolver),
      ...createInventoryJobs(inventoryService),
      ...guestsJobs(guestsService),
      ...reservationsJobs(reservations),
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
      ...integrationJobs(integrationDeps),
      ...migrationJobs(),
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
      { name: 'finance', run: (tx, org) => financeDemoSeed(tx, org) },
      // After inventory and finance: stages the fictional "Coral Nest" spreadsheet pack in the demo guesthouse.
      createMigrationDemoSeed(() => migrationDeps),
    ],
    identityPorts,
    platformPorts,
  };
}

/** Every permission key registered by any module (for role editors and validation). */
export function permissionCatalog() {
  return MANIFESTS.flatMap((m) => m.permissions);
}
