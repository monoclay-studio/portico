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
import { type ModuleManifest, systemAuthorizer } from '@portico/kernel';
import { platform, platformHttp, platformManifest, platformSearch } from '@portico/platform';
import { type RatesPorts, ratesHttp, ratesManifest, ratesSearch, ratesService } from '@portico/rates';
import { recordsHttp } from './records-routes';

export const MANIFESTS: readonly ModuleManifest[] = [
  platformManifest,
  identityManifest,
  ratesManifest,
  // wave-1 modules register here
];

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

  // ── rates ──
  const ratesPorts: RatesPorts = {
    // Property facts for pricing/taxes. Read with the system authorizer: rates checks its own permissions
    // (a channel or desk agent quoting holds rates.quote.read, not platform.property.read).
    async getProperty(tx, propertyId) {
      const p = await platform.getProperty({ ...tx, authz: systemAuthorizer }, propertyId);
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
    // listUnitTypes: bind to inventory's unit-type listing when inventory merges (optional port; until then
    // unit type ids are not validated on price writes and the rates demo seed cannot run).
  };
  const rates = ratesService(ratesPorts);
  const ratesModule = ratesHttp({ database, rates });

  // ── cross-module experience: global search, summaries, record history ──
  const searchProviders: SearchProvider[] = [platformSearch, ratesSearch];
  const recordsModule = recordsHttp({ database, manifests: MANIFESTS, searchProviders });

  return {
    authenticator: identityAuthenticator(database, identityPorts),
    httpModules: [platformModule, identityModule, ratesModule, recordsModule],
    subscriptions: [],
    searchProviders,
    jobs: [...CORE_JOBS],
  };
}

/** Every permission key registered by any module (for role editors and validation). */
export function permissionCatalog() {
  return MANIFESTS.flatMap((m) => m.permissions);
}
