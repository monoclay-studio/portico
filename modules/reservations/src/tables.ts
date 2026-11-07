import type { Generated } from '@portico/db';

export interface BookingsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  status: string;
  booker_kind: string;
  booker_profile_id: string | null;
  booker_name: string | null;
  company_id: string | null;
  agency_id: string | null;
  source: string;
  channel_connection_id: string | null;
  channel_external_id: string | null;
  external_refs: unknown;
  market_segment: string;
  commission: unknown;
  guarantee: unknown;
  deposit_requirement: unknown;
  billing: unknown;
  option_date: string | null;
  hold_expires_at: Date | null;
  owner_id: string | null;
  notes: string | null;
  special_requests: unknown;
  tags: string[];
  currency: string;
  cancellation: unknown;
  created_by: string;
  created_by_name: string;
  created_at: Date;
  updated_at: Date;
  version: Generated<number>;
}

export interface BookingVersionsTable {
  tenant_id: string;
  booking_id: string;
  version: number;
  state: unknown;
  action: string;
  actor_key: string;
  actor_name: string;
  changed_at: Date;
}

export interface StaysTable {
  id: string;
  tenant_id: string;
  property_id: string;
  booking_id: string;
  position: number;
  status: string;
  commercial_type: string;
  commercial_reason: string | null;
  arrival: string;
  departure: string;
  block_id: string | null;
  hold_id: string | null;
  eta: string | null;
  etd: string | null;
  arrival_details: unknown;
  requests: unknown;
  notes: string | null;
  waitlist: unknown;
  early_check_in: unknown;
  late_check_out: unknown;
  no_show: unknown;
  checked_in_at: Date | null;
  checked_out_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: Generated<number>;
}

export interface StaySegmentsTable {
  id: string;
  tenant_id: string;
  stay_id: string;
  nights: string;
  unit_type_id: string;
  rate_plan_id: string;
  adults: number;
  children_ages: number[];
  terms_snapshot_id: string;
  unit_id: string | null;
}

export interface OccupantsTable {
  id: string;
  tenant_id: string;
  stay_id: string;
  position: number;
  profile_id: string | null;
  name: string | null;
  kind: string;
  age_at_arrival: number | null;
  is_primary: boolean;
}

export interface TermsSnapshotsTable {
  id: string;
  tenant_id: string;
  stay_id: string;
  document: unknown;
  hash: string;
  price_source: string;
  accepted_via: string;
  accepted_at: Date;
  accepted_by: string;
  supersedes_id: string | null;
  change_preview: string | null;
}

export interface RoomMovesTable {
  id: string;
  tenant_id: string;
  stay_id: string;
  from_unit_id: string | null;
  to_unit_id: string | null;
  from_date: string;
  reason: string;
  chargeable: boolean;
  moved_at: Date;
  moved_by: string;
}

export interface ChangePreviewsTable {
  token: string;
  tenant_id: string;
  property_id: string;
  booking_id: string | null;
  booking_version: number | null;
  kind: string;
  request: unknown;
  result: unknown;
  fingerprint: string;
  status: Generated<string>;
  created_by: string;
  created_at: Date;
  expires_at: Date;
  committed_at: Date | null;
  parent_token: string | null;
}

export interface WorkflowRunsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  stay_id: string;
  kind: string;
  status: string;
  steps: unknown;
  started_by: string;
  started_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  version: Generated<number>;
}

export interface ChannelRevisionsTable {
  id: string;
  tenant_id: string;
  connection_id: string;
  external_id: string;
  revision: number;
  payload_hash: string;
  payload: unknown;
  outcome: string;
  applied: boolean;
  booking_id: string | null;
  diff: unknown;
  field_losses: unknown;
  note: string | null;
  received_at: Date;
}

export interface IssuesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  kind: string;
  severity: string;
  booking_id: string | null;
  stay_id: string | null;
  dedupe_key: string;
  message: string;
  owner_id: string | null;
  status: Generated<string>;
  details: unknown;
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution: string | null;
  version: Generated<number>;
}

export interface RelocationCasesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  stay_id: string;
  booking_id: string;
  cause: string;
  cause_ref: unknown;
  nights: string;
  options: unknown;
  status: Generated<string>;
  selected: unknown;
  owner_id: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  version: Generated<number>;
}

export interface HandoverItemsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  department: string;
  kind: string;
  title: string;
  detail: string | null;
  ref: unknown;
  owner_id: string;
  owner_name: string | null;
  due_at: Date | null;
  status: Generated<string>;
  created_by: string;
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution: string | null;
  version: Generated<number>;
}

export interface HandoversTable {
  id: string;
  tenant_id: string;
  property_id: string;
  department: string;
  shift_label: string;
  status: string;
  notes: string | null;
  items: unknown;
  published_by: string;
  published_by_name: string;
  published_at: Date;
  acknowledged_by: string | null;
  acknowledged_by_name: string | null;
  acknowledged_at: Date | null;
  version: Generated<number>;
}

export interface ForwardedChangesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  booking_id: string | null;
  stay_id: string | null;
  kind: string;
  connection_id: string | null;
  system_name: string | null;
  payload: unknown;
  status: Generated<string>;
  external_ref: string | null;
  detail: string | null;
  created_by: string;
  created_at: Date;
  resolved_at: Date | null;
  version: Generated<number>;
}

export interface ReservationsDB {
  'reservations.bookings': BookingsTable;
  'reservations.booking_versions': BookingVersionsTable;
  'reservations.stays': StaysTable;
  'reservations.stay_segments': StaySegmentsTable;
  'reservations.occupants': OccupantsTable;
  'reservations.terms_snapshots': TermsSnapshotsTable;
  'reservations.room_moves': RoomMovesTable;
  'reservations.change_previews': ChangePreviewsTable;
  'reservations.workflow_runs': WorkflowRunsTable;
  'reservations.channel_revisions': ChannelRevisionsTable;
  'reservations.issues': IssuesTable;
  'reservations.relocation_cases': RelocationCasesTable;
  'reservations.handover_items': HandoverItemsTable;
  'reservations.handovers': HandoversTable;
  'reservations.forwarded_changes': ForwardedChangesTable;
}
