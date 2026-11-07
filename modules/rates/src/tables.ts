import type { Generated } from '@portico/db';

export interface PoliciesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  kind: 'cancellation' | 'guarantee' | 'deposit';
  code: string;
  name: string;
  structure: unknown;
  status: Generated<'active' | 'retired'>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PolicyVersionsTable {
  id: string;
  tenant_id: string;
  policy_id: string;
  version: number;
  name: string;
  structure: unknown;
  changed_at: Date;
  changed_by: string;
}

export interface InclusionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  name: string;
  kind: 'component' | 'allowance';
  charge_code: string;
  tax_category: string;
  pricing: unknown;
  basis: 'per_unit' | 'per_person' | 'per_adult' | 'per_child' | 'per_stay';
  rhythm: unknown;
  price_mode: 'included' | 'added';
  fulfilment_outlets: string[];
  allowance: unknown | null;
  status: Generated<'active' | 'retired'>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PackagesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  name: string;
  description: string | null;
  meal_plan_code: string | null;
  inclusion_ids: string[];
  status: Generated<'active' | 'retired'>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RatePlansTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  name: string;
  description: string | null;
  currency: string;
  parent_id: string | null;
  derivation: unknown | null;
  inherit: unknown;
  meal_plan: string;
  package_ids: string[];
  cancellation_policy_id: string | null;
  guarantee_policy_id: string | null;
  deposit_policy_id: string | null;
  eligibility: unknown;
  commission: unknown | null;
  tax_inclusion: unknown;
  room_charge_code: string;
  market_segment: string | null;
  status: Generated<'draft' | 'active' | 'paused' | 'retired'>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ChangeSetsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  kind: 'prices' | 'restrictions';
  rate_plan_id: string | null;
  actor: unknown;
  actor_key: string;
  reason: string | null;
  summary: unknown;
  created_at: Date;
}

export interface PricesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  rate_plan_id: string;
  unit_type_id: string;
  stay_date: string;
  currency: string;
  base_occupancy: number;
  base_amount_minor: number;
  single_amount_minor: number | null;
  extra_adult_minor: number | null;
  child_amounts_minor: unknown;
  occupancy_amounts_minor: unknown;
  version: Generated<number>;
  change_set_id: string;
  updated_at: Date;
}

export interface PriceHistoryTable {
  id: string;
  tenant_id: string;
  property_id: string;
  change_set_id: string;
  rate_plan_id: string;
  unit_type_id: string;
  stay_date: string;
  before: unknown | null;
  after: unknown;
  changed_at: Date;
  changed_by: string;
}

export interface RestrictionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  rate_plan_id: string | null;
  unit_type_id: string | null;
  stay_date: string;
  closed: boolean | null;
  closed_to_arrival: boolean | null;
  closed_to_departure: boolean | null;
  min_los: number | null;
  min_los_through: number | null;
  max_los: number | null;
  min_advance_days: number | null;
  max_advance_days: number | null;
  sales_limit: number | null;
  version: Generated<number>;
  change_set_id: string;
  updated_at: Date;
}

export interface RestrictionHistoryTable {
  id: string;
  tenant_id: string;
  property_id: string;
  change_set_id: string;
  rate_plan_id: string | null;
  unit_type_id: string | null;
  stay_date: string;
  before: unknown | null;
  after: unknown;
  changed_at: Date;
  changed_by: string;
}

export interface PromotionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  name: string;
  discount: unknown;
  conditions: unknown;
  combinability: 'exclusive' | 'stackable';
  stackable_with: string[];
  sequence: number;
  status: Generated<'active' | 'paused' | 'retired'>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TaxRulesTable {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  jurisdiction: string;
  category: 'tax' | 'fee';
  property_ids: string[] | null;
  tax_point_policy: 'service_date' | 'booking_date' | 'invoice_date' | 'time_of_supply';
  ledger_mapping_key: string;
  sequence: number;
  status: Generated<'active' | 'retired'>;
  template: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TaxRuleVersionsTable {
  id: string;
  tenant_id: string;
  tax_rule_id: string;
  version_no: number;
  status: 'draft' | 'active' | 'withdrawn';
  effective_from: string | null;
  effective_to: string | null;
  definition: unknown;
  verification: unknown;
  sources: unknown;
  notes: string | null;
  created_at: Date;
  created_by: string;
  activated_at: Date | null;
  activated_by: string | null;
  activation_report: unknown | null;
}

export interface PlanSalesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  rate_plan_id: string;
  stay_date: string;
  ref_type: string;
  ref_id: string;
  quantity: number;
  created_at: Date;
  released_at: Date | null;
}

export interface RatesDB {
  'rates.policies': PoliciesTable;
  'rates.policy_versions': PolicyVersionsTable;
  'rates.inclusions': InclusionsTable;
  'rates.packages': PackagesTable;
  'rates.rate_plans': RatePlansTable;
  'rates.change_sets': ChangeSetsTable;
  'rates.prices': PricesTable;
  'rates.price_history': PriceHistoryTable;
  'rates.restrictions': RestrictionsTable;
  'rates.restriction_history': RestrictionHistoryTable;
  'rates.promotions': PromotionsTable;
  'rates.tax_rules': TaxRulesTable;
  'rates.tax_rule_versions': TaxRuleVersionsTable;
  'rates.plan_sales': PlanSalesTable;
}
