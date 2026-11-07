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
}
