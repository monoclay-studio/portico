import type { Generated } from '@portico/db';

type Json = unknown;
type Ts = Date;

export interface ConnectionsTable {
  id: string;
  tenant_id: string;
  connector_key: string;
  name: string;
  property_ids: string[];
  state: string;
  resume_state: string | null;
  scope: Json;
  compatibility: Json | null;
  health_status: Generated<string>;
  health_reason: string | null;
  health_changed_at: Ts | null;
  interrupted_since: Ts | null;
  interruption_reason: string | null;
  last_reconnected_at: Ts | null;
  activated_at: Ts | null;
  activated_by: string | null;
  activated_preview_id: string | null;
  replaces_connection_id: string | null;
  replaced_by_connection_id: string | null;
  owner_user_id: string | null;
  last_error: Json | null;
  next_sync_at: Ts | null;
  created_at: Generated<Ts>;
  created_by: string;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface ConnectionStepsTable {
  seq: Generated<number>;
  id: string;
  tenant_id: string;
  connection_id: string;
  step: number;
  action: string;
  outcome: 'completed' | 'failed' | 'reopened' | 'lifecycle';
  state_from: string;
  state_to: string;
  detail: Json;
  actor: Json;
  actor_key: string;
  occurred_at: Ts;
}

export interface SecretsTable {
  id: string;
  tenant_id: string;
  purpose: string;
  ciphertext: string;
  key_id: string;
  created_at: Generated<Ts>;
}

export interface CredentialsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  secret_ref: string | null;
  store_kind: string;
  label: string;
  status: 'active' | 'superseded' | 'revoked';
  expires_at: Ts | null;
  verified_at: Ts | null;
  account_label: string | null;
  scopes_granted: string[] | null;
  read_only_at_vendor: boolean | null;
  rotated_from: string | null;
  created_at: Ts;
  created_by: string;
  superseded_at: Ts | null;
  version: Generated<number>;
}

export interface MappingsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  kind: string;
  external_id: string;
  external_label: string;
  external_attrs: Json;
  property_id: string | null;
  internal_id: string | null;
  internal_label: string | null;
  suggested_internal_id: string | null;
  status: 'suggested' | 'confirmed' | 'unmapped' | 'ignored';
  confidence: string | number | null;
  reasons: Json;
  alternatives: Json;
  financially_significant: boolean;
  requires_review: boolean;
  review_reason: string | null;
  reviewed: boolean;
  reviewed_by: string | null;
  reviewed_at: Ts | null;
  auto_confirmed: boolean;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface MappingVersionsTable {
  id: string;
  tenant_id: string;
  mapping_id: string;
  connection_id: string;
  version: number;
  internal_id: string | null;
  status: string;
  reviewed: boolean;
  confidence: string | number | null;
  change: string;
  reason: string | null;
  actor_key: string;
  changed_at: Ts;
}

export interface ValidationRunsTable {
  seq: Generated<number>;
  id: string;
  tenant_id: string;
  connection_id: string;
  status: 'passed' | 'failed';
  checks: Json;
  mapping_fingerprint: string;
  provenance: string;
  started_at: Ts;
  finished_at: Ts;
  actor_key: string;
}

export interface PreviewsTable {
  seq: Generated<number>;
  id: string;
  tenant_id: string;
  connection_id: string;
  kind: string;
  content: Json;
  content_hash: string;
  mapping_fingerprint: string | null;
  created_at: Ts;
  actor_key: string;
}

export interface WorkflowStateTable {
  tenant_id: string;
  connection_id: string;
  workflow: string;
  last_success_at: Ts | null;
  last_attempt_at: Ts | null;
  last_failure_at: Ts | null;
  last_failure_kind: string | null;
  last_failure_reason: string | null;
  consecutive_failures: Generated<number>;
  last_latency_ms: number | null;
  last_message_latency_s: number | null;
  last_applied_at: Ts | null;
  incomplete_since: Ts | null;
  incomplete_reason: string | null;
  cursor: string | null;
  version: Generated<number>;
}

export interface FilesTable {
  seq: Generated<number>;
  id: string;
  tenant_id: string;
  connection_id: string;
  direction: 'import' | 'export';
  workflow: string;
  name: string;
  content_type: string;
  sha256: string;
  size_bytes: number;
  content: string;
  created_at: Ts;
  actor_key: string;
}

export interface SyncRunsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  workflow: string | null;
  trigger: 'periodic' | 'manual' | 'file' | 'reconciliation';
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  counts: Json;
  file_id: string | null;
  provenance: string;
  error: Json | null;
  started_at: Ts;
  finished_at: Ts | null;
  actor_key: string;
  version: Generated<number>;
}

export interface ExchangeLogTable {
  seq: Generated<number>;
  id: string;
  tenant_id: string;
  connection_id: string;
  property_id: string | null;
  workflow: string;
  direction: 'inbound' | 'outbound';
  operation: string | null;
  external_ref: string | null;
  idempotency_key: string | null;
  outcome: string;
  latency_ms: number | null;
  error_class: string | null;
  summary: string;
  detail: Json | null;
  provenance: string;
  sync_run_id: string | null;
  occurred_at: Ts;
}

export interface InboundMessagesTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  property_id: string | null;
  workflow: string;
  external_id: string;
  revision: string;
  revision_order: string | number;
  external_occurred_at: Ts;
  received_at: Ts;
  payload: Json;
  canonical: Json | null;
  status: 'applied' | 'accepted' | 'stale' | 'held_mapping' | 'held_validation' | 'rejected';
  hold_reason: string | null;
  gap_detected: boolean;
  delayed: boolean;
  duplicate_count: Generated<number>;
  sync_run_id: string | null;
  processed_at: Ts | null;
  redacted_at: Ts | null;
  version: Generated<number>;
}

export interface ExternalRecordsTable {
  tenant_id: string;
  connection_id: string;
  workflow: string;
  external_id: string;
  last_revision: string;
  last_revision_order: string | number;
  last_message_id: string;
  updated_at: Ts;
}

export interface OutboundCommandsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  property_id: string | null;
  workflow: string;
  operation: string;
  idempotency_key: string;
  business_key: string | null;
  effect_class: 'standard' | 'money' | 'inventory' | 'inventory_reopen';
  payload: Json;
  source_ref: Json | null;
  status:
    | 'queued'
    | 'sending'
    | 'acknowledged'
    | 'rejected'
    | 'pending_verification'
    | 'needs_revalidation'
    | 'cancelled'
    | 'superseded'
    | 'exported';
  attempts: Generated<number>;
  next_attempt_at: Ts;
  lease_until: Ts | null;
  verify_before_send: Generated<boolean>;
  hold_after_send: Generated<boolean>;
  last_error: Json | null;
  external_ref: string | null;
  revalidation_reason: string | null;
  revalidated_by: string | null;
  revalidated_at: Ts | null;
  enqueued_at: Ts;
  completed_at: Ts | null;
  version: Generated<number>;
}

export interface ExceptionsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  property_id: string | null;
  workflow: string | null;
  severity: 'urgent' | 'routine';
  code: string;
  dedupe_key: string;
  problem: string;
  business_impact: string;
  responsible_party: 'hotel' | 'monoclay' | 'vendor';
  next_step: string;
  related_refs: Json;
  technical_detail: Json | null;
  owner_user_id: string | null;
  owner_department_id: string | null;
  status: 'open' | 'acknowledged' | 'resolved' | 'ignored';
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: Ts | null;
  occurrences: Generated<number>;
  first_seen_at: Ts;
  last_seen_at: Ts;
  version: Generated<number>;
}

export interface VendorNoticesTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  title: string;
  required_action: string;
  responsible_party: 'hotel' | 'monoclay' | 'vendor';
  due_date: string | null;
  status: 'open' | 'done';
  created_at: Ts;
  actor_key: string;
  version: Generated<number>;
}

export interface WebhookSubscriptionsTable {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  event_types: string[];
  property_ids: string[];
  secret_ref: string;
  previous_secret_ref: string | null;
  previous_secret_expires_at: Ts | null;
  api_client_id: string | null;
  status: 'active' | 'disabled';
  disabled_reason: string | null;
  disabled_at: Ts | null;
  consecutive_failures: Generated<number>;
  last_success_at: Ts | null;
  created_at: Ts;
  created_by: string;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface WebhookDeliveriesTable {
  id: string;
  tenant_id: string;
  subscription_id: string;
  event_id: string;
  event_type: string;
  property_id: string | null;
  payload: Json;
  status: 'pending' | 'succeeded' | 'failed' | 'dead' | 'blocked' | 'simulated' | 'cancelled';
  attempts: Generated<number>;
  next_attempt_at: Ts;
  lease_until: Ts | null;
  last_attempt_at: Ts | null;
  last_response_status: number | null;
  last_error: string | null;
  replay_of: string | null;
  requested_by: string | null;
  created_at: Ts;
  completed_at: Ts | null;
  version: Generated<number>;
}

export interface WebhookAttemptsTable {
  id: string;
  tenant_id: string;
  delivery_id: string;
  attempt_no: number;
  attempted_at: Ts;
  outcome: 'succeeded' | 'failed' | 'blocked' | 'simulated';
  response_status: number | null;
  duration_ms: number | null;
  error: string | null;
}

export interface SimAccountsTable {
  tenant_id: string;
  account_id: string;
  state: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface TenantScheduleTable {
  tenant_id: string;
  next_due_at: Ts;
  lease_until: Ts | null;
}

export interface IntegrationDB {
  'integration.connections': ConnectionsTable;
  'integration.connection_steps': ConnectionStepsTable;
  'integration.secrets': SecretsTable;
  'integration.credentials': CredentialsTable;
  'integration.mappings': MappingsTable;
  'integration.mapping_versions': MappingVersionsTable;
  'integration.validation_runs': ValidationRunsTable;
  'integration.previews': PreviewsTable;
  'integration.workflow_state': WorkflowStateTable;
  'integration.files': FilesTable;
  'integration.sync_runs': SyncRunsTable;
  'integration.exchange_log': ExchangeLogTable;
  'integration.inbound_messages': InboundMessagesTable;
  'integration.external_records': ExternalRecordsTable;
  'integration.outbound_commands': OutboundCommandsTable;
  'integration.exceptions': ExceptionsTable;
  'integration.vendor_notices': VendorNoticesTable;
  'integration.webhook_subscriptions': WebhookSubscriptionsTable;
  'integration.webhook_deliveries': WebhookDeliveriesTable;
  'integration.webhook_attempts': WebhookAttemptsTable;
  'integration.tenant_schedule': TenantScheduleTable;
  'integration.sim_accounts': SimAccountsTable;
}
