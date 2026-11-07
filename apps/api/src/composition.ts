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
import type { Authenticator, HttpModule } from '@portico/http';
import { type IdentityPorts, identityAuthenticator, identityHttp, identityManifest } from '@portico/identity';
import { DomainError, type ModuleManifest, randomToken, systemAuthorizer } from '@portico/kernel';
import {
  createPaymentsModule,
  envProviderSecrets,
  type LedgerPort,
  type PlatformPort as PaymentsPlatformPort,
  paymentsManifest,
  paymentsSearch,
} from '@portico/payments';
import { platform, platformHttp, platformManifest, platformSearch } from '@portico/platform';
import { recordsHttp } from './records-routes';

export const MANIFESTS: readonly ModuleManifest[] = [
  platformManifest,
  identityManifest,
  // wave-1 modules register here
  paymentsManifest,
];

/**
 * Stub for a port whose provider is another wave-1 module not merged yet. Every call fails with a clear,
 * retryable error; payments then records the money truthfully and flags "not yet on the bill" (ledger pending).
 */
function unavailablePort<T extends object>(module: string): T {
  return new Proxy({} as T, {
    get: (_t, prop) => () => {
      throw new DomainError(
        'module_unavailable',
        `The ${module} module is not connected yet (${String(prop)}). The action was recorded where possible; it will be completed once ${module} is available.`,
        { status: 503, retryable: true, details: { module, operation: String(prop) } },
      );
    },
  });
}

export interface Composition {
  authenticator: Authenticator;
  httpModules: HttpModule[];
  subscriptions: TxEventSubscription[];
  searchProviders: SearchProvider[];
  /** Periodic background jobs run by apps/worker (each module contributes its own). */
  jobs: ScheduledJob[];
}

export function compose(database: PorticoDatabase): Composition {
  // ── platform ──
  const platformModule = platformHttp({ database });

  // ── identity ──
  const identityPorts: IdentityPorts = { propertyIdsInScope: platform.propertyIdsInScope };
  const identityModule = identityHttp({ database });

  // ── payments ── (finance LedgerPort: bound by the orchestrator when finance merges)
  const paymentsPlatform: PaymentsPlatformPort = {
    // Payments has already checked its own permission; it needs the merchant (legal entity) and time zone.
    async getProperty(tx, propertyId) {
      const p = await platform.getProperty({ ...tx, authz: systemAuthorizer }, propertyId);
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
    ledger: unavailablePort<LedgerPort>('finance'),
    platform: paymentsPlatform,
    secrets: envProviderSecrets(process.env),
    simulatorSigningSecret: process.env.PAYMENTS_SIMULATOR_SIGNING_SECRET ?? randomToken(),
  });

  // ── cross-module experience: global search, summaries, record history ──
  const searchProviders: SearchProvider[] = [platformSearch, paymentsSearch];
  const recordsModule = recordsHttp({ database, manifests: MANIFESTS, searchProviders });

  return {
    authenticator: identityAuthenticator(database, identityPorts),
    httpModules: [platformModule, identityModule, payments.http, recordsModule],
    subscriptions: [...payments.subscriptions],
    searchProviders,
    jobs: [...CORE_JOBS, ...payments.jobs],
  };
}

/** Every permission key registered by any module (for role editors and validation). */
export function permissionCatalog() {
  return MANIFESTS.flatMap((m) => m.permissions);
}
