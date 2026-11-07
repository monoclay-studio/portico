/**
 * Connector SDK. Every connector — simulated PMS, CSV files, partner webhooks, and later channel hubs, POS,
 * accounting, door locks — is a ConnectorDefinition registered in code. Capabilities are declared per WORKFLOW,
 * never per vendor (domain map § integration): what Portico can read, create, update or receive, how it syncs
 * (realtime / periodic / manual / file) and how well it is supported, with limitations in plain English.
 *
 * A listing communicates demonstrated capability only. It never implies vendor certification: the
 * implementation level (CLAUDE.md §7, R1–R9) and the external approval status are separate fields.
 */
import type { z } from 'zod';
import type {
  CapabilityStatus,
  ConnectorCategory,
  ConnectorSummary,
  DataDomain,
  EffectClass,
  MappingKind,
  ReadinessLevel,
  ResponsibleParty,
  SyncMode,
  WorkflowOperation,
} from '../contracts';
import type { AttributeValue } from '../domain/mapping-suggest';
import type { SendFailureKind } from '../domain/outbound-policy';
import type { StatusDomain } from '../domain/vocabulary';

/** Workflow capability, exactly as in docs/architecture/domain-map.md § integration. */
export interface WorkflowCapability {
  workflow: string;
  operations: Array<'read' | 'create' | 'update' | 'receive'>;
  sync: 'realtime' | 'periodic' | 'manual' | 'file';
  status: 'supported' | 'limited' | 'unsupported' | 'unverified';
  limitations: string[];
}

/** A payload field that carries an external code and must be translated through a mapping. */
export interface MappedField {
  field: string;
  kind: MappingKind;
  statusDomain?: StatusDomain;
  /** When false, an unmapped value does not hold the message (e.g. an optional rate plan). */
  required: boolean;
}

export interface WorkflowDefinition extends WorkflowCapability {
  label: string;
  description: string;
  dataDomain: DataDomain | null;
  /** What happens when the vendor cannot provide the information or refuses the action. */
  whenUnavailable: string;
  /** Received information older than this is labeled delayed. */
  freshnessTargetSeconds: number | null;
  /** Periodic workflows: how often Portico asks. */
  expectedIntervalSeconds: number | null;
  /** True when the vendor's revisions are consecutive integers (gaps then reveal missed updates). */
  sequentialRevisions: boolean;
  mappedFields: MappedField[];
  /** Effect class per outbound operation name (create, update, cancel, post…). Default: standard. */
  effects: Partial<Record<string, EffectClass>>;
  /** Payload field holding the money amount check (currency must match the property's currency). */
  currencyField?: string;
}

export interface CredentialFieldDescriptor {
  name: string;
  label: string;
  secret: boolean;
  description: string;
}

export interface ConnectorDefinition {
  key: string;
  name: string;
  category: ConnectorCategory;
  vendor: { name: string; note?: string };
  products: Array<{ name: string; versions: string[] }>;
  regions: string[];
  accessModel: 'public_api' | 'partner_program' | 'on_prem_interface' | 'file';
  localConnectorRequired: boolean;
  localConnectorNote: string | null;
  /** Zod schema validating the credential the hotel provides; null when the connector needs none (files). */
  credentialSchema: z.ZodType<Record<string, unknown>> | null;
  credentialFields: CredentialFieldDescriptor[];
  vendorSetupSteps: string[];
  prerequisites: string[];
  workflows: WorkflowDefinition[];
  governableDomains: Array<{ domain: DataDomain; writeModes: Array<'read_only' | 'forward'> }>;
  /** "Quote required" when the cost is not known — never a guess. */
  costNotes: string[];
  implementation: { level: ReadinessLevel; label: string; evidence: string[] };
  externalApproval: {
    status: 'not_required' | 'not_started' | 'applied' | 'approved' | 'unknown';
    note: string;
  };
  provenance: 'external' | 'simulated' | 'file';
  isSimulator: boolean;
  fileBased: boolean;
  setupPath: 'connection' | 'webhook_subscriptions' | 'not_available';
  /**
   * What acknowledging received records does at the vendor: nothing, a per-client cursor (safe in a trial), or
   * removal from a queue other consumers share (a write: never done from a trial).
   */
  ackSemantics: 'none' | 'per-client' | 'shared-queue';
  support: { vendor: string; escalation: string };
  vendorNotices: Array<{
    title: string;
    requiredAction: string;
    dueDate: string | null;
    responsibleParty: ResponsibleParty;
  }>;
}

// ───────────────────────────── Runtime adapter ─────────────────────────────

export interface AdapterContext {
  tenantId: string;
  connectionId: string;
  credential: Record<string, unknown> | null;
  /** Mode granted by assertExternalEffectAllowed for this call. */
  mode: 'live' | 'sandbox' | 'simulate';
  now: Date;
  /** Calls must finish before this instant (Portico stops waiting and treats the outcome as unknown). */
  deadline?: Date;
  /** File connectors: most recent uploaded files per workflow (samples during setup). */
  files?: ReadonlyArray<{ workflow: string; name: string; content: string }>;
}

export interface ExternalEntity {
  kind: MappingKind;
  externalId: string;
  /** Code shown to staff and compared with Portico codes (defaults to externalId). */
  code?: string;
  label: string;
  propertyExternalId: string | null;
  statusDomain?: StatusDomain;
  attributes: Record<string, AttributeValue>;
}

export interface InboundRecord {
  workflow: string;
  externalId: string;
  revision: string;
  revisionOrder: number;
  /** When the change happened in the external system (ISO timestamp with offset). */
  occurredAt: string;
  propertyExternalId: string | null;
  payload: Record<string, unknown>;
  /** One plain-English line for the exchange log ("Reservation R1001 modified"). */
  summary: string;
}

export interface OutboundRequest {
  workflow: string;
  operation: string;
  idempotencyKey: string;
  propertyExternalId: string | null;
  payload: Record<string, unknown>;
}

export interface CredentialCheck {
  accountLabel: string;
  expiresAt: string | null;
  scopes: string[] | null;
  readOnly: boolean | null;
}

export interface ConnectorAdapter {
  /**
   * Harmless call proving the credential works. Reports what the vendor granted: scopes and whether the
   * credential is read-only at the vendor (null when the vendor does not say) — gap G-03.
   */
  testCredentials(ctx: AdapterContext): Promise<CredentialCheck>;
  discover(ctx: AdapterContext): Promise<ExternalEntity[]>;
  pull?(
    ctx: AdapterContext,
    req: { workflow: string; cursor: string | null },
  ): Promise<{ records: InboundRecord[]; cursor: string | null }>;
  /** Confirm receipt AFTER Portico committed the records; unacknowledged records are delivered again. */
  acknowledge?(
    ctx: AdapterContext,
    req: { workflow: string; records: ReadonlyArray<{ externalId: string; revision: string }> },
  ): Promise<void>;
  /** Recent records without consuming them (validation and preview). */
  sample?(ctx: AdapterContext, req: { workflow: string; limit: number }): Promise<InboundRecord[]>;
  send?(ctx: AdapterContext, req: OutboundRequest): Promise<{ externalRef: string }>;
  /** Ask the vendor whether an action with this idempotency key was applied (verify before resend). */
  lookup?(ctx: AdapterContext, req: OutboundRequest): Promise<{ found: boolean; externalRef: string | null }>;
  parseFile?(workflow: string, content: string, fileName: string): InboundRecord[];
  renderFile?(
    workflow: string,
    commands: ReadonlyArray<{ idempotencyKey: string; operation: string; payload: Record<string, unknown> }>,
  ): { content: string; contentType: string; fileExtension: string };
}

/** Failures reported by adapters. `kind` drives retries, health and the responsible party. */
export class ConnectorError extends Error {
  constructor(
    readonly kind: SendFailureKind,
    message: string,
    readonly vendorDetail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export interface RegisteredConnector {
  definition: ConnectorDefinition;
  adapter: ConnectorAdapter | null;
}

export class ConnectorRegistry {
  private readonly byKey = new Map<string, RegisteredConnector>();

  register(definition: ConnectorDefinition, adapter: ConnectorAdapter | null = null): this {
    if (this.byKey.has(definition.key)) throw new Error(`Connector ${definition.key} is registered twice`);
    for (const w of definition.workflows) {
      if (w.status === 'supported' && w.limitations.length === 0 && definition.isSimulator) {
        throw new Error(`Simulator workflow ${definition.key}/${w.workflow} must state its limitations`);
      }
    }
    this.byKey.set(definition.key, { definition, adapter });
    return this;
  }

  get(key: string): RegisteredConnector | undefined {
    return this.byKey.get(key);
  }

  list(): RegisteredConnector[] {
    return [...this.byKey.values()].sort(
      (a, b) =>
        a.definition.category.localeCompare(b.definition.category) ||
        a.definition.name.localeCompare(b.definition.name),
    );
  }
}

export const CATALOGUE_DISCLAIMER =
  'This listing describes what Portico itself has built and tested, workflow by workflow. It does not mean the vendor has certified or endorsed Portico. Readiness and external approval are shown separately.';

export function toSummary(entry: RegisteredConnector): ConnectorSummary {
  const d = entry.definition;
  return {
    key: d.key,
    name: d.name,
    category: d.category,
    vendor: d.vendor,
    products: d.products,
    regions: d.regions,
    accessModel: d.accessModel,
    localConnectorRequired: d.localConnectorRequired,
    localConnectorNote: d.localConnectorNote,
    credentialFields: d.credentialFields,
    vendorSetupSteps: d.vendorSetupSteps,
    workflows: d.workflows.map((w) => ({
      workflow: w.workflow,
      label: w.label,
      description: w.description,
      operations: w.operations as WorkflowOperation[],
      sync: w.sync as SyncMode,
      status: w.status as CapabilityStatus,
      limitations: w.limitations,
      dataDomain: w.dataDomain,
      whenUnavailable: w.whenUnavailable,
      freshnessTargetSeconds: w.freshnessTargetSeconds,
    })),
    governableDomains: d.governableDomains,
    costNotes: d.costNotes,
    implementation: d.implementation,
    externalApproval: d.externalApproval,
    provenance: d.provenance,
    isSimulator: d.isSimulator,
    fileBased: d.fileBased,
    connectable: d.setupPath === 'connection' && entry.adapter !== null,
    setupPath: d.setupPath,
    support: d.support,
    vendorNotices: d.vendorNotices.map((n) => ({
      title: n.title,
      requiredAction: n.requiredAction,
      dueDate: n.dueDate,
    })),
    disclaimer: CATALOGUE_DISCLAIMER,
  };
}
