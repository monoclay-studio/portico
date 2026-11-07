import type { PorticoDatabase, TxContext } from '@portico/db';
import type { RequestContext } from '@portico/kernel';
import type { ChecklistItem } from './domain/activation';
import type { BundleItem, PlannedItem } from './domain/configuration';

/**
 * Ports through which other modules plug into platform capabilities. Platform depends on no module; the
 * composition root passes the providers in. Every port is optional and defaults to "platform only".
 */

/**
 * A module's contribution to configuration bundles (adoption brief §11 templates and bulk setup; trial
 * carry-forward). Items are keyed by portable business keys (codes, names) — never database ids.
 */
export interface ConfigurationSectionProvider {
  /** `<module>.<section>`, e.g. `platform.outlets`, later `rates.ratePlans`, `finance.chargeCodes`. */
  key: string;
  title: string;
  schemaVersion: number;
  /** May this section move from a trial to production (evaluation-and-trial.md §9)? */
  carryForward: boolean;
  exportItems(tx: TxContext, propertyId: string): Promise<BundleItem[]>;
  currentItems(tx: TxContext, propertyId: string): Promise<Map<string, Record<string, unknown>>>;
  /** Conflicts by item key (e.g. a referenced legal entity does not exist here). */
  validateItems?(
    tx: TxContext,
    propertyId: string,
    items: readonly BundleItem[],
  ): Promise<Map<string, string>>;
  /** Apply planned `create` and `update` items (never deletes). */
  applyItems(tx: TxContext, propertyId: string, items: readonly PlannedItem[]): Promise<void>;
}

/** A module that holds operational data in a trial organization (reset and export, adoption brief §3). */
export interface TrialDataParticipant {
  module: string;
  /** Delete operational data (bookings, guests, folios, tasks …), keep configuration. */
  resetOperationalData(tx: TxContext): Promise<{ removed: number }>;
  exportOperationalData?(tx: TxContext): Promise<Record<string, unknown>>;
}

/** Module readiness checks shown on the activation checklist (PLT-R14), e.g. tax pack verified. */
export interface ActivationCheckProvider {
  module: string;
  check(tx: TxContext, propertyId: string, toStatus: 'pilot' | 'active'): Promise<ChecklistItem[]>;
}

/**
 * Integration's view of in-flight work during an authority transition: a transition cannot become effective
 * while forwarded operations are still pending (source-of-truth-matrix ST-08).
 */
export interface AuthorityTransitionGuard {
  pendingOperations(
    tx: TxContext,
    propertyId: string,
    domains: readonly string[],
  ): Promise<Array<{ ref: string; description: string }>>;
}

/** Creates a trial organization (needs identity too, so it is implemented in the composition root). */
export interface TrialProvisioner {
  createTrial(
    database: PorticoDatabase,
    ctx: RequestContext,
    input: { name: string },
  ): Promise<{ organizationId: string; name: string }>;
}

export interface PlatformPorts {
  configurationSections?: readonly ConfigurationSectionProvider[];
  trialParticipants?: readonly TrialDataParticipant[];
  activationChecks?: readonly ActivationCheckProvider[];
  transitionGuard?: AuthorityTransitionGuard;
  trialProvisioner?: TrialProvisioner;
}
