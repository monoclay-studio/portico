/**
 * Composition root — the ONLY place where modules are wired together (ports → providers).
 * Each module contributes: a manifest (migrations + permissions), an HTTP module, event subscriptions and
 * port bindings. Keep one block per module to make parallel work merge cleanly.
 */
import type { PorticoDatabase, SearchProvider, TxEventSubscription } from '@portico/db';
import {
  createFinance,
  type FinancePorts,
  financeHttp,
  financeManifest,
  financeSearch,
  financeSubscriptions,
  unavailableFinancePorts,
} from '@portico/finance';
import type { Authenticator, HttpModule } from '@portico/http';
import { type IdentityPorts, identityAuthenticator, identityHttp, identityManifest } from '@portico/identity';
import { type ModuleManifest, systemAuthorizer } from '@portico/kernel';
import { platform, platformHttp, platformManifest, platformSearch } from '@portico/platform';
import { recordsHttp } from './records-routes';

export const MANIFESTS: readonly ModuleManifest[] = [
  platformManifest,
  identityManifest,
  financeManifest,
  // wave-1 modules register here
];

export interface Composition {
  authenticator: Authenticator;
  httpModules: HttpModule[];
  subscriptions: TxEventSubscription[];
  searchProviders: SearchProvider[];
}

export function compose(database: PorticoDatabase): Composition {
  // ── platform ──
  const platformModule = platformHttp({ database });

  // ── identity ──
  const identityPorts: IdentityPorts = { propertyIdsInScope: platform.propertyIdsInScope };
  const identityModule = identityHttp({ database });

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
  };
  const finance = createFinance(financePorts);
  const financeModule = financeHttp({ database, finance });

  // ── cross-module experience: global search, summaries, record history ──
  const searchProviders: SearchProvider[] = [platformSearch, financeSearch];
  const recordsModule = recordsHttp({ database, manifests: MANIFESTS, searchProviders });

  return {
    authenticator: identityAuthenticator(database, identityPorts),
    httpModules: [platformModule, identityModule, financeModule, recordsModule],
    subscriptions: [...financeSubscriptions(finance, financePorts)],
    searchProviders,
  };
}

/** Every permission key registered by any module (for role editors and validation). */
export function permissionCatalog() {
  return MANIFESTS.flatMap((m) => m.permissions);
}
