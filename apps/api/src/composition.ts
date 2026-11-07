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
  DomainError,
  fieldCryptoFromEnv,
  type ModuleManifest,
  randomToken,
  systemAuthorizer,
} from '@portico/kernel';
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
import { recordsHttp } from './records-routes';
import type { DemoSeedStep } from './seed/demo';

export const MANIFESTS: readonly ModuleManifest[] = [
  platformManifest,
  identityManifest,
  guestsManifest,
  // wave-1 modules register here
  paymentsManifest,
];

/**
 * Stub for a port whose provider is another wave-1 module not merged yet. Every call fails with a clear,
 * retryable error; payments then records the money truthfully and flags "not yet on the bill" (ledger pending).
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

export interface Composition {
  authenticator: Authenticator;
  httpModules: HttpModule[];
  subscriptions: TxEventSubscription[];
  searchProviders: SearchProvider[];
  /** Periodic background jobs run by apps/worker (each module contributes its own). */
  jobs: ScheduledJob[];
  /** Provider services other modules' ports bind to (domain map). */
  services: { guests: GuestsService; payments: PaymentsService };
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
    guestsSearchProvider(guestsService),
    paymentsSearch,
  ];
  const recordsModule = recordsHttp({ database, manifests: MANIFESTS, searchProviders });

  return {
    authenticator: identityAuthenticator(database, identityPorts),
    httpModules: [platformModule, identityModule, guestsModule, payments.http, recordsModule],
    subscriptions: [...payments.subscriptions],
    searchProviders,
    jobs: [...CORE_JOBS, ...guestsJobs(guestsService), ...payments.jobs],
    services: { guests: guestsService, payments: payments.service },
    demoSeedSteps: [createGuestsDemoSeed(guestsService), { name: 'payments', run: seedPaymentsDemo }],
  };
}

/** Every permission key registered by any module (for role editors and validation). */
export function permissionCatalog() {
  return MANIFESTS.flatMap((m) => m.permissions);
}
