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
import { DomainError, fieldCryptoFromEnv, type ModuleManifest, systemAuthorizer } from '@portico/kernel';
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
import { recordsHttp } from './records-routes';
import type { DemoSeedStep } from './seed/demo';

export const MANIFESTS: readonly ModuleManifest[] = [
  platformManifest,
  identityManifest,
  guestsManifest,
  operationsManifest,
  // wave-1 modules register here
];

/** Port binding for a wave-1 provider that is not merged yet: fails loudly with an explanation. */
function unavailable(module: string): never {
  throw new DomainError(
    'module_unavailable',
    `The ${module} module is not available in this build yet, so this action cannot run. Nothing was changed.`,
    { status: 503, retryable: true, details: { module } },
  );
}

export interface Composition {
  authenticator: Authenticator;
  httpModules: HttpModule[];
  subscriptions: TxEventSubscription[];
  searchProviders: SearchProvider[];
  /** Periodic background jobs run by apps/worker (each module contributes its own). */
  jobs: ScheduledJob[];
  /** Provider services other modules' ports bind to (domain map). */
  services: { guests: GuestsService; operations: OperationsService };
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
    // TODO(orchestrator): bind to @portico/inventory (blockUnit, releaseBlock, listUnits) when it merges.
    inventory: {
      blockUnit: () => unavailable('inventory'),
      releaseBlock: () => unavailable('inventory'),
      listUnits: () => unavailable('inventory'),
    },
  };
  const operationsService = createOperationsService(operationsPorts);
  const operationsModule = operationsHttp({ database, service: operationsService });

  // ── cross-module experience: global search, summaries, record history ──
  const searchProviders: SearchProvider[] = [
    platformSearch,
    guestsSearchProvider(guestsService),
    operationsSearch,
  ];
  const recordsModule = recordsHttp({ database, manifests: MANIFESTS, searchProviders });

  return {
    authenticator: identityAuthenticator(database, identityPorts),
    httpModules: [platformModule, identityModule, guestsModule, operationsModule, recordsModule],
    subscriptions: [...operationsSubscriptions(operationsPorts)],
    searchProviders,
    jobs: [
      ...CORE_JOBS,
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
    ],
    services: { guests: guestsService, operations: operationsService },
    demoSeedSteps: [createGuestsDemoSeed(guestsService), createOperationsDemoSeed(operationsService)],
  };
}

/** Every permission key registered by any module (for role editors and validation). */
export function permissionCatalog() {
  return MANIFESTS.flatMap((m) => m.permissions);
}
