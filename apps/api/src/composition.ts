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
  systemTxtResolver,
  unknownGeo,
} from '@portico/identity';
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
  type PlatformPorts,
  platform,
  platformHttp,
  platformManifest,
  platformSearch,
} from '@portico/platform';
import { createTrialForOrganization, provisioningHttp } from './provisioning';
import { recordsHttp } from './records-routes';
import type { DemoSeedStep } from './seed/demo';

export const MANIFESTS: readonly ModuleManifest[] = [
  platformManifest,
  identityManifest,
  inventoryManifest,
  guestsManifest,
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
  services: { guests: GuestsService; inventory: InventoryService };
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
  });
  const guestsModule = guestsHttp({ database, service: guestsService });

  // ── inventory ──
  const inventoryModule = inventoryHttp({ database, inventory: inventoryService });

  // ── cross-module experience: global search, summaries, record history ──
  const searchProviders: SearchProvider[] = [
    platformSearch,
    inventorySearch,
    guestsSearchProvider(guestsService),
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
      recordsModule,
    ],
    subscriptions: [],
    searchProviders,
    jobs: [
      ...CORE_JOBS,
      ...IDENTITY_JOBS,
      ...createInventoryJobs(inventoryService),
      ...guestsJobs(guestsService),
    ],
    services: { guests: guestsService, inventory: inventoryService },
    demoSeedSteps: [{ name: 'inventory', run: inventoryDemoSeed }, createGuestsDemoSeed(guestsService)],
    identityPorts,
    platformPorts,
  };
}

/** Every permission key registered by any module (for role editors and validation). */
export function permissionCatalog() {
  return MANIFESTS.flatMap((m) => m.permissions);
}
