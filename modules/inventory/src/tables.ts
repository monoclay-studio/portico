import type { Generated } from '@portico/db';

/** Kysely typings for the `inventory` schema only. `daterange` columns are read via SQL (lower/upper). */
export interface FeaturesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  name: string;
  category: Generated<'view' | 'location' | 'layout' | 'amenity' | 'accessibility' | 'general'>;
  description: string | null;
  status: Generated<'active' | 'archived'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface UnitTypesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  name: string;
  kind: 'room' | 'villa' | 'suite' | 'apartment' | 'bed' | 'tent' | 'pitch' | 'other';
  noun: string;
  description: string | null;
  base_occupancy: number;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  bedding: string | null;
  size_sqm: number | null;
  rank: Generated<number>;
  sort_order: Generated<number>;
  sellable: Generated<boolean>;
  is_composite: Generated<boolean>;
  features: Generated<string[]>;
  status: Generated<'active' | 'archived'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface UnitsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  unit_type_id: string;
  number: string;
  name: string | null;
  building: string | null;
  floor: string | null;
  zone: string | null;
  features: Generated<string[]>;
  max_occupancy_override: number | null;
  sort_order: Generated<number>;
  status: Generated<'active' | 'inactive' | 'retired'>;
  in_inventory_from: string;
  in_inventory_to: string | null;
  is_composite: Generated<boolean>;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface CompositeComponentsTable {
  tenant_id: string;
  composite_unit_id: string;
  composite_unit_type_id: string;
  component_unit_id: string;
  component_unit_type_id: string;
}

export interface LedgerTable {
  tenant_id: string;
  property_id: string;
  unit_type_id: string;
  night: string;
  capacity: number;
  out_of_order: Generated<number>;
  sold: Generated<number>;
  held: Generated<number>;
  overbooking_allowance: Generated<number>;
  version: Generated<number>;
  updated_at: Generated<Date>;
}

export interface ConsumptionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  ref_type: string;
  ref_id: string;
  unit_type_id: string;
  night: string;
  quantity: number;
  kind: 'stay' | 'house_use' | 'block_allocation' | 'composite_component' | 'import';
  parent_unit_type_id: string | null;
  hold_id: string | null;
  overbooking_allowance_id: string | null;
  created_at: Date;
}

export interface OverbookingAllowancesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  unit_type_id: string;
  night: string;
  quantity: number;
  kind: 'standing' | 'ad_hoc';
  reason: string;
  authorized_by: string;
  entered_by: string;
  ref_type: string | null;
  ref_id: string | null;
  expires_at: Date | null;
  status: Generated<'active' | 'revoked' | 'expired' | 'superseded'>;
  created_at: Date;
  closed_at: Date | null;
}

export interface ConflictsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  unit_type_id: string;
  night: string;
  shortfall: number;
  max_shortfall: number;
  causes: unknown;
  status: Generated<'open' | 'resolving' | 'resolved'>;
  owner_user_id: string | null;
  resolution:
    | 'relocated'
    | 'upgraded'
    | 'moved_dates'
    | 'cancelled'
    | 'allowance_authorized'
    | 'capacity_restored'
    | 'other'
    | null;
  detected_at: Date;
  resolved_at: Date | null;
  previous_conflict_id: string | null;
  version: Generated<number>;
}

export interface InventoryDB {
  'inventory.features': FeaturesTable;
  'inventory.unit_types': UnitTypesTable;
  'inventory.units': UnitsTable;
  'inventory.composite_components': CompositeComponentsTable;
  'inventory.ledger': LedgerTable;
  'inventory.consumptions': ConsumptionsTable;
  'inventory.overbooking_allowances': OverbookingAllowancesTable;
  'inventory.conflicts': ConflictsTable;
}
