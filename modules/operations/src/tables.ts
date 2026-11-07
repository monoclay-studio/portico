import type { Generated } from '@portico/db';

export interface SectionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  name: string;
  kind: 'island_zone' | 'jetty' | 'building' | 'wing' | 'floor' | 'section';
  parent_id: string | null;
  sort_order: Generated<number>;
  created_at: Generated<Date>;
  version: Generated<number>;
}

export interface UnitStatusTable {
  id: string;
  tenant_id: string;
  property_id: string;
  unit_number: string;
  unit_type_id: string | null;
  unit_type_code: string | null;
  section_id: string | null;
  floor: string | null;
  location_path: string | null;
  features: Generated<string[]>;
  active: Generated<boolean>;
  condition: string;
  condition_changed_at: Date;
  condition_changed_by: string;
  occupancy: Generated<string>;
  occupancy_stay_id: string | null;
  observed_occupancy: string | null;
  observed_at: Date | null;
  observed_by: string | null;
  discrepancy: Generated<string>;
  dnd: Generated<boolean>;
  dnd_since: Date | null;
  turndown: Generated<string>;
  ready_at: Date | null;
  expected_ready_at: Date | null;
  readiness: Generated<unknown>;
  last_cleaned_at: Date | null;
  last_cleaned_by: string | null;
  last_inspected_at: Date | null;
  last_inspection_id: string | null;
  last_inspection_result: string | null;
  block_kind: string | null;
  block_id: string | null;
  block_from: string | null;
  block_to: string | null;
  block_reason: string | null;
  block_work_order_id: string | null;
  pending_forward_id: string | null;
  pending_change: unknown;
  provenance: Generated<string>;
  external_synced_at: Date | null;
  feed_xid: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface UnitStatusLogTable {
  id: string;
  tenant_id: string;
  property_id: string;
  unit_id: string;
  field: string;
  from_value: string | null;
  to_value: string | null;
  reason: string | null;
  source: string;
  version_after: number;
  actor: unknown;
  actor_key: string;
  occurred_at: Date;
  client_occurred_at: Date | null;
  metadata: unknown;
}

export interface StayProjectionTable {
  id: string;
  tenant_id: string;
  property_id: string;
  booking_id: string | null;
  unit_id: string | null;
  arrival: string;
  departure: string;
  status: string;
  guest_profile_id: string | null;
  guest_label: string | null;
  vip: Generated<boolean>;
  early_check_in: Generated<boolean>;
  eta: Date | null;
  source: Generated<string>;
  updated_at: Generated<Date>;
}

export interface AttendantsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  user_id: string;
  display_name: string;
  home_section_ids: Generated<string[]>;
  daily_credit_capacity: number;
  active: Generated<boolean>;
  created_at: Generated<Date>;
  version: Generated<number>;
}

export interface TasksTable {
  id: string;
  tenant_id: string;
  property_id: string;
  department_kind: string;
  department_id: string | null;
  kind: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  priority_score: Generated<number>;
  priority_reasons: Generated<string[]>;
  unit_id: string | null;
  stay_id: string | null;
  guest_profile_id: string | null;
  parent_task_id: string | null;
  refs: Generated<unknown>;
  assignee_user_id: string | null;
  assignee_name: string | null;
  service_date: string | null;
  due_at: Date | null;
  credits: Generated<number>;
  blocked_reason: string | null;
  cancelled_reason: string | null;
  started_at: Date | null;
  done_at: Date | null;
  done_by: string | null;
  verified_at: Date | null;
  verified_by: string | null;
  cancelled_at: Date | null;
  escalation_path: Generated<unknown>;
  escalation_level: Generated<number>;
  next_escalation_at: Date | null;
  last_escalated_at: Date | null;
  source: string;
  dedupe_key: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  feed_xid: Generated<string>;
  version: Generated<number>;
}

export interface TaskActivityTable {
  id: string;
  tenant_id: string;
  property_id: string;
  task_id: string;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  comment: string | null;
  attachments: unknown;
  task_version: number;
  source: string;
  actor: unknown;
  actor_key: string;
  occurred_at: Date;
  client_occurred_at: Date | null;
}

export interface ServiceRequestsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  number: string;
  task_id: string;
  stay_id: string | null;
  guest_profile_id: string | null;
  unit_id: string | null;
  channel: string;
  category: string;
  description: string;
  status: string;
  requested_at: Date;
  fulfilled_at: Date | null;
  created_at: Date;
  version: Generated<number>;
}

export interface ChecklistTemplatesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  name: string;
  purpose: string;
  items: unknown;
  active: Generated<boolean>;
  created_at: Generated<Date>;
  version: Generated<number>;
}

export interface InspectionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  unit_id: string;
  task_id: string | null;
  checklist_code: string | null;
  checklist_version: number | null;
  items: unknown;
  result: string;
  failure_reasons: unknown;
  notes: string | null;
  inspector: unknown;
  inspector_key: string;
  inspected_at: Date;
  client_inspected_at: Date | null;
  cleaned_by_user_id: string | null;
  reclean_task_id: string | null;
  affected_stay_id: string | null;
  work_order_id: string | null;
  created_at: Date;
}

export interface AssetsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  kind: string;
  code: string;
  name: string;
  category: string;
  unit_id: string | null;
  parent_asset_id: string | null;
  section_id: string | null;
  location_path: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  installed_on: string | null;
  status: Generated<string>;
  created_at: Generated<Date>;
  version: Generated<number>;
}

export interface PreventiveSchedulesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  title: string;
  description: string | null;
  asset_id: string | null;
  asset_category: string | null;
  fault_category: string;
  urgency: string;
  interval_unit: string;
  interval_count: number;
  next_due_on: string;
  lead_days: Generated<number>;
  checklist_code: string | null;
  active: Generated<boolean>;
  last_run_at: Date | null;
  created_at: Generated<Date>;
  version: Generated<number>;
}

export interface WorkOrdersTable {
  id: string;
  tenant_id: string;
  property_id: string;
  number: string;
  task_id: string;
  asset_id: string | null;
  unit_id: string | null;
  location_text: string | null;
  fault_category: string;
  urgency: string;
  photos: Generated<unknown>;
  parts: Generated<unknown>;
  resolution_note: string | null;
  completed_at: Date | null;
  block_kind: string | null;
  block_from: string | null;
  block_to: string | null;
  block_reason: string | null;
  block_id: string | null;
  block_status: Generated<string>;
  return_to_service_status: Generated<string>;
  returned_to_service_at: Date | null;
  preventive_schedule_id: string | null;
  preventive_due_on: string | null;
  authority_state: Generated<string>;
  reported_by: string;
  reported_via: Generated<string>;
  created_at: Date;
  feed_xid: Generated<string>;
  version: Generated<number>;
}

export interface ResolutionItemsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  unit_id: string;
  block_id: string;
  work_order_id: string | null;
  ref_type: string;
  ref_id: string;
  nights_from: string;
  nights_to: string;
  status: Generated<string>;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
  version: Generated<number>;
}

export interface LostFoundItemsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  number: string;
  description: string;
  category: string;
  high_value: Generated<boolean>;
  found_at: Date;
  found_location: string;
  found_unit_id: string | null;
  finder: string;
  finder_user_id: string | null;
  storage_location: string;
  photos: Generated<unknown>;
  status: string;
  matched_guest_profile_id: string | null;
  matched_stay_id: string | null;
  matched_note: string | null;
  released_to: string | null;
  release_signature_ref: string | null;
  released_at: Date | null;
  disposal_method: string | null;
  disposal_signature_ref: string | null;
  disposal_reason: string | null;
  disposed_at: Date | null;
  retention_until: string;
  created_at: Date;
  version: Generated<number>;
}

export interface StatusForwardsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  domain: string;
  connection_id: string | null;
  target_type: string;
  target_id: string;
  change: unknown;
  status: Generated<string>;
  requested_by: string;
  requested_at: Date;
  resolved_at: Date | null;
  external_ref: string | null;
  rejection_reason: string | null;
  version: Generated<number>;
}

export interface SyncMutationsTable {
  tenant_id: string;
  client_mutation_id: string;
  device_id: string;
  actor_key: string;
  request_hash: string;
  property_id: string;
  entity_type: string;
  entity_id: string | null;
  op: string;
  outcome: string;
  base_version: number | null;
  result_version: number | null;
  result: unknown;
  client_occurred_at: Date;
  processed_at: Date;
}

export interface OperationsDB {
  'operations.sections': SectionsTable;
  'operations.unit_status': UnitStatusTable;
  'operations.unit_status_log': UnitStatusLogTable;
  'operations.stay_projection': StayProjectionTable;
  'operations.attendants': AttendantsTable;
  'operations.tasks': TasksTable;
  'operations.task_activity': TaskActivityTable;
  'operations.service_requests': ServiceRequestsTable;
  'operations.checklist_templates': ChecklistTemplatesTable;
  'operations.inspections': InspectionsTable;
  'operations.assets': AssetsTable;
  'operations.preventive_schedules': PreventiveSchedulesTable;
  'operations.work_orders': WorkOrdersTable;
  'operations.resolution_items': ResolutionItemsTable;
  'operations.lost_found_items': LostFoundItemsTable;
  'operations.status_forwards': StatusForwardsTable;
  'operations.sync_mutations': SyncMutationsTable;
}
