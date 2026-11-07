import type { Generated } from '@portico/db';

export interface TenantsTable {
  id: string;
  tenant_id: Generated<string>;
  name: string;
  slug: string;
  environment: 'live' | 'trial' | 'sandbox' | 'training' | 'demo';
  live_tenant_id: string | null;
  status: 'active' | 'suspended' | 'closed';
  plan_code: string;
  default_locale: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface LegalEntitiesTable {
  id: string;
  tenant_id: string;
  name: string;
  legal_name: string;
  registration_number: string | null;
  tax_id: string | null;
  country_code: string;
  base_currency: string;
  address: Generated<unknown>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface PropertiesTable {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  profile: PropertyProfile;
  legal_entity_id: string;
  brand_id: string | null;
  region_id: string | null;
  country_code: string;
  timezone: string;
  base_currency: string;
  classification: unknown;
  business_date: string;
  status: Generated<'setup' | 'pilot' | 'active' | 'inactive'>;
  check_in_time: string;
  check_out_time: string;
  address: Generated<unknown>;
  contact: Generated<unknown>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface BusinessDateLogTable {
  id: string;
  tenant_id: string;
  property_id: string;
  from_date: string;
  to_date: string;
  advanced_at: Date;
  advanced_by: string;
  day_close_run_id: string | null;
}

export interface SimpleScopeTable {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  created_at: Generated<Date>;
}

export interface RegionsTable extends SimpleScopeTable {
  parent_region_id: string | null;
}

export interface DepartmentsTable extends SimpleScopeTable {
  property_id: string;
  kind: string;
}

export interface PoliciesTable {
  id: string;
  tenant_id: string;
  key: string;
  scope_type: 'organization' | 'brand' | 'region' | 'property';
  scope_id: string;
  value: unknown;
  updated_at: Generated<Date>;
  updated_by: string;
  version: Generated<number>;
}

export interface EntitlementOverridesTable {
  tenant_id: string;
  feature: string;
  enabled: boolean | null;
  limit_value: number | null;
  reason: string;
  updated_at: Generated<Date>;
}

export interface DataAuthorityTable {
  id: string;
  tenant_id: string;
  property_id: string;
  domain: string;
  authority: 'portico' | 'external';
  connection_id: string | null;
  system_name: string | null;
  write_mode: 'exclusive' | 'forward' | 'read_only';
  effective_from: Date;
  updated_by: string;
  reason: string;
  version: Generated<number>;
}

export type PropertyProfile =
  | 'guesthouse'
  | 'boutique_hotel'
  | 'hotel'
  | 'resort'
  | 'serviced_apartments'
  | 'hostel';

export interface EntitlementGrantsTable {
  id: string;
  tenant_id: string;
  kind: 'add_on' | 'pack';
  key: string;
  property_id: string | null;
  reason: string;
  granted_by: string;
  granted_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

export interface OwnersTable {
  id: string;
  tenant_id: string;
  reference: string;
  kind: 'person' | 'company';
  display_name: string;
  legal_name: string | null;
  tax_id: string | null;
  country_code: string | null;
  email: string | null;
  phone: string | null;
  payout_account_ref: string | null;
  payout_hint: string | null;
  status: Generated<'active' | 'archived'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface UnitOwnershipTable {
  id: string;
  tenant_id: string;
  owner_id: string;
  property_id: string;
  unit_id: string;
  share_bps: number;
  effective_from: string;
  effective_to: string | null;
  created_at: Generated<Date>;
  created_by: string;
  ended_at: Date | null;
  ended_by: string | null;
  end_reason: string | null;
}

export type OutletKind =
  | 'restaurant'
  | 'bar'
  | 'cafe'
  | 'spa'
  | 'dive_center'
  | 'water_sports'
  | 'excursions'
  | 'boutique'
  | 'transfer_desk'
  | 'minibar'
  | 'in_room_dining'
  | 'laundry'
  | 'kids_club'
  | 'other';

export interface OutletsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  name: string;
  kind: OutletKind;
  legal_entity_id: string;
  default_charge_code_key: string | null;
  opening_hours: unknown;
  accepts_room_charge: boolean;
  status: Generated<'active' | 'archived'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface ConfigurationBundlesTable {
  id: string;
  tenant_id: string;
  name: string;
  version: number;
  description: string | null;
  source_kind: 'property' | 'trial' | 'upload';
  source_ref: string | null;
  source_property_id: string | null;
  content: unknown;
  checksum: string;
  created_by: string;
  created_at: Date;
}

export type RolloutStage = 'pilot' | 'wave1' | 'wave2' | 'wave3' | 'wave4' | 'final';

export interface RolloutGroupsTable {
  id: string;
  tenant_id: string;
  key: string;
  name: string;
  stage: RolloutStage;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface RolloutGroupMembersTable {
  tenant_id: string;
  group_id: string;
  property_id: string;
  added_at: Generated<Date>;
}

export interface ConfigurationChangesTable {
  id: string;
  tenant_id: string;
  bundle_id: string;
  rollout_group_id: string | null;
  target_property_ids: string[];
  sections: string[];
  mode: 'preserve_local' | 'overwrite';
  status: 'pending_approval' | 'approved' | 'applied' | 'rejected' | 'cancelled';
  approval_required: boolean;
  plan: unknown;
  plan_hash: string;
  summary: unknown;
  prepared_by: string;
  prepared_at: Date;
  approved_by: string | null;
  approved_at: Date | null;
  decision_note: string | null;
  applied_by: string | null;
  applied_at: Date | null;
  version: Generated<number>;
}

export interface EnvironmentLinksTable {
  id: string;
  tenant_id: string;
  linked_tenant_id: string;
  environment: 'trial' | 'training' | 'sandbox';
  name: string;
  created_by: string;
  created_at: Date;
  status: Generated<'active' | 'closed'>;
}

export interface TrialLifecycleTable {
  tenant_id: string;
  source_tenant_id: string | null;
  prospect_name: string | null;
  created_by: string;
  created_at: Date;
  status: Generated<'active' | 'closed'>;
  reset_count: Generated<number>;
  last_reset_at: Date | null;
  closed_at: Date | null;
  closed_by: string | null;
  close_reason: string | null;
  deletion_due_at: Date | null;
  legal_hold: Generated<boolean>;
  version: Generated<number>;
}

export interface TrialImportsTable {
  id: string;
  tenant_id: string;
  source_system: string;
  copied_at: Date;
  record_counts: unknown;
  recorded_by: string;
  recorded_at: Date;
}

export interface ActivationRequestsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  kind: 'status_change' | 'scope_change';
  from_status: string;
  to_status: 'setup' | 'pilot' | 'active' | 'inactive' | null;
  scope_stage: 'pilot' | 'production' | null;
  scope_content: unknown;
  reason: string;
  checklist: unknown;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_by: string;
  requested_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  version: Generated<number>;
}

export interface ActivationScopesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  stage: 'pilot' | 'production';
  version: number;
  content: unknown;
  request_id: string | null;
  approved_by: string;
  approved_at: Date;
}

export interface PropertyStatusHistoryTable {
  id: string;
  tenant_id: string;
  property_id: string;
  from_status: string;
  to_status: string;
  request_id: string | null;
  requested_by: string;
  approved_by: string | null;
  reason: string;
  changed_at: Date;
}

export interface DataAuthorityHistoryTable {
  id: string;
  tenant_id: string;
  property_id: string;
  domain: string;
  version: number;
  authority: 'portico' | 'external';
  connection_id: string | null;
  system_name: string | null;
  write_mode: 'exclusive' | 'forward' | 'read_only';
  effective_from: Date;
  effective_to: Date | null;
  changed_by: string;
  approved_by: string | null;
  reason: string;
  transition_id: string | null;
}

export interface DataAuthorityTransitionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  changes: unknown;
  status: 'planned' | 'frozen' | 'effective' | 'cancelled';
  reason: string;
  rollback_criteria: string | null;
  planned_start_at: Date | null;
  freeze_minutes: number;
  approval_required: boolean;
  planned_by: string;
  planned_at: Date;
  approved_by: string | null;
  approved_at: Date | null;
  frozen_at: Date | null;
  expected_end_at: Date | null;
  effective_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  version: Generated<number>;
}

export interface DataAuthorityTransitionDomainsTable {
  tenant_id: string;
  transition_id: string;
  property_id: string;
  domain: string;
  open: Generated<boolean>;
}

export interface PlatformDB {
  'platform.tenants': TenantsTable;
  'platform.legal_entities': LegalEntitiesTable;
  'platform.brands': SimpleScopeTable;
  'platform.regions': RegionsTable;
  'platform.properties': PropertiesTable;
  'platform.business_date_log': BusinessDateLogTable;
  'platform.departments': DepartmentsTable;
  'platform.policies': PoliciesTable;
  'platform.entitlement_overrides': EntitlementOverridesTable;
  'platform.data_authority': DataAuthorityTable;
  'platform.entitlement_grants': EntitlementGrantsTable;
  'platform.owners': OwnersTable;
  'platform.unit_ownership': UnitOwnershipTable;
  'platform.outlets': OutletsTable;
  'platform.configuration_bundles': ConfigurationBundlesTable;
  'platform.rollout_groups': RolloutGroupsTable;
  'platform.rollout_group_members': RolloutGroupMembersTable;
  'platform.configuration_changes': ConfigurationChangesTable;
  'platform.environment_links': EnvironmentLinksTable;
  'platform.trial_lifecycle': TrialLifecycleTable;
  'platform.trial_imports': TrialImportsTable;
  'platform.activation_requests': ActivationRequestsTable;
  'platform.activation_scopes': ActivationScopesTable;
  'platform.property_status_history': PropertyStatusHistoryTable;
  'platform.data_authority_history': DataAuthorityHistoryTable;
  'platform.data_authority_transitions': DataAuthorityTransitionsTable;
  'platform.data_authority_transition_domains': DataAuthorityTransitionDomainsTable;
}
