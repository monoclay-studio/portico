/**
 * What the integration module needs from other modules (ADR-0003). Bound in apps/api/src/composition.ts; tests
 * bind fakes. Integration never reads another module's tables.
 */
import type { TxContext } from '@portico/db';
import { DomainError, type ExternalEffect } from '@portico/kernel';
import type { DataDomain, MappingKind } from './contracts';
import type { InternalCandidate } from './domain/mapping-suggest';
import { MAPPING_KIND_LABELS } from './domain/vocabulary';

export interface PropertyInfo {
  id: string;
  name: string;
  code: string;
  timezone: string;
  baseCurrency: string;
  countryCode: string;
}

export interface DataAuthorityView {
  domain: DataDomain;
  authority: 'portico' | 'external';
  connectionId: string | null;
  systemName: string | null;
  writeMode: 'exclusive' | 'forward' | 'read_only';
}

/** Provided by platform (exists on main): property facts and data authority (ADR-0014). */
export interface PlatformPort {
  getProperty(tx: TxContext, propertyId: string): Promise<PropertyInfo>;
  getDataAuthority(tx: TxContext, propertyId: string, domain: DataDomain): Promise<DataAuthorityView>;
  setDataAuthority(
    tx: TxContext,
    input: {
      propertyId: string;
      domain: DataDomain;
      authority: 'portico' | 'external';
      connectionId?: string;
      systemName?: string;
      writeMode: 'exclusive' | 'forward' | 'read_only';
      reason: string;
    },
  ): Promise<DataAuthorityView>;
}

/**
 * Portico records an external code can be mapped to: unit types and units (inventory), rate plans and tax rules
 * (rates), charge codes and ledger accounts (finance), outlets (platform). Property and status candidates are
 * resolved inside integration (platform port / glossary vocabularies).
 */
export interface InternalCatalogPort {
  listCandidates(
    tx: TxContext,
    input: { kind: Exclude<MappingKind, 'property' | 'status'>; propertyId: string },
  ): Promise<InternalCandidate[]>;
}

/**
 * Pilot / production activation scope (gap G-04; platform agent is adding `assertEffectInScope`). Called for
 * every external effect of a `live` organization before it happens; throws when the property's approved scope does
 * not include the effect for this workflow. Not called in demo / training / sandbox / trial (the environment policy
 * already routes or blocks those).
 */
export interface ActivationScopePort {
  assertEffectInScope(
    tx: TxContext,
    input: { propertyId: string; effect: ExternalEffect; workflow: string; connectionId: string },
  ): Promise<void>;
}

/**
 * Authority transitions (gap G-02; platform agent is adding planned → frozen → effective). While a domain is
 * frozen, inbound changes are held (not applied) and activation / replacement for that domain is refused.
 */
export interface AuthorityTransitionPort {
  activeTransition(
    tx: TxContext,
    input: { propertyId: string; domain: DataDomain },
  ): Promise<{ id: string; state: 'planned' | 'frozen' } | null>;
}

/** A translated external record handed to the module that owns its meaning (F6, spec proposal 1). */
export interface InboundRecordForHandler {
  connectionId: string;
  /** Stable id of the stored message (use it to deduplicate). */
  messageId: string;
  propertyId: string;
  workflow: string;
  dataDomain: DataDomain | null;
  externalId: string;
  revision: string;
  /** Monotonic order of revisions for this external record (newer is greater). */
  revisionOrder: number;
  occurredAt: string;
  provenance: 'live' | 'sandbox' | 'simulated' | 'file';
  /** External codes translated through confirmed mappings: field → { externalCode, internalId }. */
  mapped: Record<string, { externalCode: string; internalId: string }>;
  /** The record's values as received (may contain guest data: keep only what the owning module needs). */
  values: Record<string, unknown>;
}

export type InboundHandlerResult =
  | { outcome: 'applied'; ref?: { type: string; id: string } }
  | {
      outcome: 'rejected';
      reason: string;
      responsibleParty: 'hotel' | 'monoclay' | 'vendor';
      nextStep: string;
    }
  | { outcome: 'held'; reason: string };

/**
 * Registered by the module that owns a workflow's data (e.g. operations for `roomStatus`, reservations for
 * `reservations`). Called inside integration's transaction, in a savepoint: "applied" means applied.
 */
export interface InboundHandler {
  applyInbound(tx: TxContext, record: InboundRecordForHandler): Promise<InboundHandlerResult>;
}

export interface IntegrationPorts {
  platform: PlatformPort;
  catalog: InternalCatalogPort;
  /** Inbound handlers per workflow. Unbound workflows store records as `accepted` until a handler is bound. */
  inbound: Partial<Record<string, InboundHandler>>;
  activationScope: ActivationScopePort;
  transitions: AuthorityTransitionPort;
}

/** A provider module is not wired in this deployment yet (wave-1 modules bound at merge). */
export class ModuleUnavailableError extends DomainError {
  constructor(module: string, capability: string) {
    super(
      'module_unavailable',
      `Portico's ${module} module is not connected in this deployment, so ${capability} is not available yet. The rest of the setup can continue; this step can be repeated once it is connected.`,
      { status: 503, details: { module, capability }, retryable: true },
    );
  }
}

/** Port stub for a provider module that is not bound yet; every call throws a clear error. */
export function unavailableCatalog(
  modules: Partial<Record<Exclude<MappingKind, 'property' | 'status'>, string>>,
): InternalCatalogPort {
  return {
    async listCandidates(_tx, input) {
      throw new ModuleUnavailableError(
        modules[input.kind] ?? 'provider',
        `the list of Portico ${MAPPING_KIND_LABELS[input.kind]} records`,
      );
    },
  };
}

/**
 * Stub until platform's activation scope is bound: refuses every LIVE external effect (conservative — a live
 * organization cannot reach a hotel's systems until pilot scope enforcement exists).
 */
export const unavailableActivationScope: ActivationScopePort = {
  async assertEffectInScope() {
    throw new ModuleUnavailableError('platform (activation scope)', 'live exchange with external systems');
  },
};

/** Platform on main has no authority transitions yet, so none can be in progress. Rebind at merge. */
export const noAuthorityTransitions: AuthorityTransitionPort = {
  async activeTransition() {
    return null;
  },
};
