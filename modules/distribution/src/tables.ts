/** Kysely typings for the `distribution` schema only. */
import type { ColumnType, Generated } from '@portico/db';

type Ts = ColumnType<Date, Date | string, Date | string>;
type TsN = ColumnType<Date | null, Date | string | null, Date | string | null>;
type DateCol = ColumnType<string, string, string>;
type Json<T = unknown> = ColumnType<T, string, string>;

export interface ConnectionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  hub: 'channex';
  name: string;
  status: 'setup' | 'active' | 'paused' | 'disconnected';
  target: 'simulator' | 'staging' | 'production';
  external_property_id: string;
  credential_ref: string | null;
  credential_state: 'unverified' | 'valid' | 'invalid';
  webhook_endpoint_id: string;
  webhook_secret_hash: string;
  webhook_secret_ref: string;
  webhook_registered_at: TsN;
  webhook_verifier: 'header_secret' | 'hmac_sha256';
  channel_code: string;
  settings: Json;
  health: string;
  health_reason: string | null;
  health_changed_at: TsN;
  last_push_at: TsN;
  last_revision_at: TsN;
  inbound_gap_at: TsN;
  last_feed_pull_at: TsN;
  next_feed_pull_at: TsN;
  last_full_sync_at: TsN;
  next_full_sync_at: TsN;
  activated_at: TsN;
  created_by: string;
  created_at: Ts;
  updated_at: Ts;
  version: Generated<number>;
}

export interface RoomMappingsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  unit_type_id: string;
  channel_room_type_id: string;
  status: 'active' | 'retired';
  created_by: string;
  created_at: Ts;
  retired_at: TsN;
  version: Generated<number>;
}

export interface RateMappingsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  unit_type_id: string;
  rate_plan_id: string;
  channel_rate_plan_id: string;
  status: 'active' | 'retired';
  created_by: string;
  created_at: Ts;
  retired_at: TsN;
  version: Generated<number>;
}

export interface AriDirtyTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  kind: 'availability' | 'restrictions';
  unit_type_id: string;
  rate_plan_id: string | null;
  ranges: Json;
  merged_deltas: number;
  first_dirty_at: Ts;
  updated_at: Ts;
}

export interface AriMessagesTable {
  id: string;
  seq: Generated<number>;
  tenant_id: string;
  connection_id: string;
  property_id: string;
  kind: 'availability' | 'restrictions';
  trigger: 'delta' | 'resync' | 'protection';
  status:
    | 'queued'
    | 'sending'
    | 'accepted'
    | 'partially_accepted'
    | 'rejected'
    | 'failed_transient'
    | 'superseded'
    | 'pending_verification';
  cells: Json;
  payload: Json;
  cell_count: number;
  value_count: number;
  coalesced_deltas: number;
  oldest_change_at: Ts;
  attempts: number;
  lease_token: string | null;
  lease_until: TsN;
  next_attempt_at: TsN;
  first_failed_at: TsN;
  sent_at: TsN;
  accepted_at: TsN;
  last_error_class: string | null;
  last_error: string | null;
  rejected_cells: Json | null;
  provenance: 'live' | 'sandbox' | 'simulated';
  created_at: Ts;
  updated_at: Ts;
  version: Generated<number>;
}

export interface AriBudgetTable {
  tenant_id: string;
  connection_id: string;
  kind: 'availability' | 'restrictions';
  sends: ColumnType<Date[], Date[] | string, Date[] | string>;
  paused_until: TsN;
}

export interface ChannelStateTable {
  tenant_id: string;
  connection_id: string;
  kind: 'availability' | 'restrictions';
  unit_type_id: string;
  rate_plan_id: string | null;
  stay_date: DateCol;
  last_acked: Json;
  acked_message_id: string;
  acked_message_seq: number;
  acked_at: Ts;
}

export interface ResyncRunsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  trigger: 'connect' | 'nightly' | 'on_demand' | 'resume' | 'authority';
  range_from: DateCol;
  range_to: DateCol;
  products_marked: number;
  requested_by: string;
  created_at: Ts;
}

export interface StopSellsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  property_id: string;
  source: 'manual' | 'protection';
  unit_type_id: string | null;
  range_from: DateCol;
  range_to: DateCol;
  threshold: number | null;
  reason: string;
  status: 'active' | 'released';
  created_by: string;
  created_at: Ts;
  released_by: string | null;
  released_at: TsN;
  release_reason: string | null;
  version: Generated<number>;
}

export interface InboundRevisionsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  property_id: string;
  channel_booking_id: string;
  revision_id: string;
  hub_sequence: number | null;
  hub_micros: number | null;
  lifecycle_rank: number;
  arrival_seq: Generated<number>;
  channel_status: 'new' | 'modified' | 'cancelled';
  payload: Json;
  payload_hash: string;
  received_via: 'webhook' | 'feed' | 'recovery';
  received_at: Ts;
}

export type RevisionState = 'received' | 'applied' | 'duplicate' | 'stale' | 'parked' | 'rejected' | 'failed';
export type AckState = 'not_due' | 'pending' | 'sending' | 'acked' | 'failed';

export interface RevisionProcessingTable {
  revision_row_id: string;
  tenant_id: string;
  connection_id: string;
  property_id: string;
  channel_booking_id: string;
  arrival_seq: number;
  apply_seq: number | null;
  state: RevisionState;
  park_reason: 'orphan' | 'unmapped' | null;
  outcome: string | null;
  booking_id: string | null;
  note: string | null;
  attempts: number;
  next_attempt_at: TsN;
  first_failed_at: TsN;
  last_error: string | null;
  parked_since: TsN;
  escalated_at: TsN;
  hold_ids: Json<string[]>;
  ack_state: AckState;
  ack_attempts: number;
  ack_next_at: TsN;
  ack_first_failed_at: TsN;
  ack_lease_token: string | null;
  ack_lease_until: TsN;
  acked_at: TsN;
  processed_at: TsN;
  resolved_by: string | null;
  updated_at: Ts;
  version: Generated<number>;
}

export interface WebhookRejectionsTable {
  connection_id: string;
  tenant_id: string;
  rejected_total: number;
  first_rejected_at: Ts;
  last_rejected_at: Ts;
}

export interface InboundDeliveriesTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  revision_row_id: string | null;
  via: 'webhook' | 'feed' | 'recovery';
  outcome:
    | 'stored'
    | 'duplicate'
    | 'conflict'
    | 'notification'
    | 'unauthenticated'
    | 'property_mismatch'
    | 'unparseable';
  detail: Json | null;
  received_at: Ts;
}

export interface ExchangeLogTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  direction: 'outbound' | 'inbound';
  operation: string;
  ref: string | null;
  http_status: number | null;
  outcome: string;
  duration_ms: number | null;
  detail: Json | null;
  provenance: 'live' | 'sandbox' | 'simulated';
  occurred_at: Ts;
}

export interface ExceptionsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  property_id: string;
  code: string;
  dedupe_key: string;
  severity: 'urgent' | 'routine';
  problem: string;
  business_impact: string;
  responsible_party: 'hotel' | 'monoclay' | 'vendor';
  next_step: string;
  refs: Json;
  status: 'open' | 'resolved';
  occurrences: number;
  first_seen_at: Ts;
  last_seen_at: Ts;
  resolved_at: TsN;
  resolved_by: string | null;
  resolution: string | null;
  version: Generated<number>;
}

export interface DiscrepanciesTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  property_id: string;
  kind: 'availability' | 'rate' | 'reservation' | 'mapping' | 'field_loss' | 'price';
  dedupe_key: string;
  summary: string;
  refs: Json;
  detail: Json;
  status: 'open' | 'investigating' | 'resolved' | 'accepted';
  owner_user_id: string | null;
  detected_at: Ts;
  resolved_at: TsN;
  resolved_by: string | null;
  resolution: string | null;
  version: Generated<number>;
}

export interface SimHubsTable {
  id: string;
  tenant_id: string;
  state: Json;
  updated_at: Ts;
}

export interface TenantScheduleTable {
  tenant_id: string;
  next_due_at: Ts;
  lease_until: TsN;
}

export interface DistributionDB {
  'distribution.connections': ConnectionsTable;
  'distribution.room_mappings': RoomMappingsTable;
  'distribution.rate_mappings': RateMappingsTable;
  'distribution.ari_dirty': AriDirtyTable;
  'distribution.ari_messages': AriMessagesTable;
  'distribution.ari_budget': AriBudgetTable;
  'distribution.channel_state': ChannelStateTable;
  'distribution.resync_runs': ResyncRunsTable;
  'distribution.stop_sells': StopSellsTable;
  'distribution.inbound_revisions': InboundRevisionsTable;
  'distribution.revision_processing': RevisionProcessingTable;
  'distribution.inbound_deliveries': InboundDeliveriesTable;
  'distribution.webhook_rejections': WebhookRejectionsTable;
  'distribution.exchange_log': ExchangeLogTable;
  'distribution.exceptions': ExceptionsTable;
  'distribution.discrepancies': DiscrepanciesTable;
  'distribution.sim_hubs': SimHubsTable;
  'distribution.tenant_schedule': TenantScheduleTable;
}
