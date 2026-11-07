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
  createGuestsService,
  type GuestsCryptoPort,
  type GuestsService,
  guestsHttp,
  guestsJobs,
  guestsManifest,
  guestsSearchProvider,
  localGuestsCrypto,
} from '@portico/guests';
import type { Authenticator, HttpModule } from '@portico/http';
import { type IdentityPorts, identityAuthenticator, identityHttp, identityManifest } from '@portico/identity';
import { type ModuleManifest, systemAuthorizer } from '@portico/kernel';
import { platform, platformHttp, platformManifest, platformSearch } from '@portico/platform';
import { recordsHttp } from './records-routes';

export const MANIFESTS: readonly ModuleManifest[] = [
  platformManifest,
  identityManifest,
  guestsManifest,
  // wave-1 modules register here
];

export interface Composition {
  authenticator: Authenticator;
  httpModules: HttpModule[];
  subscriptions: TxEventSubscription[];
  searchProviders: SearchProvider[];
  /** Periodic background jobs run by apps/worker (each module contributes its own). */
  jobs: ScheduledJob[];
  /** Provider services other modules' ports bind to (domain map). */
  services: { guests: GuestsService };
}

/**
 * Guests field crypto. Development/test: kernel localFieldCipher with a key from PORTICO_FIELD_ENCRYPTION_KEY
 * (or a clearly dev-only derived key). Production must bind KMS envelope encryption + a separate blind-index key
 * (modules/guests/README.md → ports); starting without a configured key in production is refused.
 */
function guestsCrypto(): GuestsCryptoPort {
  const key = process.env.PORTICO_FIELD_ENCRYPTION_KEY;
  if (!key && process.env.NODE_ENV === 'production') {
    throw new Error(
      'PORTICO_FIELD_ENCRYPTION_KEY (or the KMS FieldCipher binding) is required in production.',
    );
  }
  return key
    ? localGuestsCrypto(key, 'env')
    : localGuestsCrypto(Buffer.from('portico-development-only-field-key').toString('base64'), 'dev');
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
    },
    crypto: guestsCrypto(),
  });
  const guestsModule = guestsHttp({ database, service: guestsService });

  // ── cross-module experience: global search, summaries, record history ──
  const searchProviders: SearchProvider[] = [platformSearch, guestsSearchProvider(guestsService)];
  const recordsModule = recordsHttp({ database, manifests: MANIFESTS, searchProviders });

  return {
    authenticator: identityAuthenticator(database, identityPorts),
    httpModules: [platformModule, identityModule, guestsModule, recordsModule],
    subscriptions: [],
    searchProviders,
    jobs: [...CORE_JOBS, ...guestsJobs(guestsService)],
    services: { guests: guestsService },
  };
}

/** Every permission key registered by any module (for role editors and validation). */
export function permissionCatalog() {
  return MANIFESTS.flatMap((m) => m.permissions);
}
