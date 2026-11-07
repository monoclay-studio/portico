/**
 * Operations vocabulary (glossary: Unit condition, Occupancy (physical), Task, Service request, Work order).
 * Pure constants and types — imported by domain logic, services and contracts alike.
 */

export const UNIT_CONDITIONS = ['dirty', 'cleaning', 'clean', 'inspected', 'failed_inspection'] as const;
export type UnitCondition = (typeof UNIT_CONDITIONS)[number];

/** Physical occupancy derived from in-house stays. */
export const OCCUPANCIES = ['vacant', 'occupied'] as const;
export type Occupancy = (typeof OCCUPANCIES)[number];

/** What housekeeping physically observed in the unit. */
export const OBSERVED_OCCUPANCIES = ['vacant', 'occupied', 'occupied_no_luggage'] as const;
export type ObservedOccupancy = (typeof OBSERVED_OCCUPANCIES)[number];

/**
 * Discrepancy between system occupancy and what housekeeping observed:
 *  - skip: system says occupied, unit found vacant (guest may have left without checking out)
 *  - sleep: system says vacant, unit found occupied (someone is using a unit that is not checked in)
 *  - occupied_no_luggage: system says occupied, unit used but no luggage (possible skip — verify with the guest)
 */
export const DISCREPANCIES = ['none', 'skip', 'sleep', 'occupied_no_luggage'] as const;
export type Discrepancy = (typeof DISCREPANCIES)[number];

export const TURNDOWN_STATUSES = ['not_required', 'pending', 'done', 'declined'] as const;
export type TurndownStatus = (typeof TURNDOWN_STATUSES)[number];

export const TASK_KINDS = [
  'departure_clean',
  'vacant_clean',
  'stayover',
  'turndown',
  'deep_clean',
  'inspection',
  'reclean',
  'service_request',
  'work_order',
  'guest_commitment',
  'general',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Task kinds that make a unit clean when done (housekeeping cleaning work). */
export const CLEANING_KINDS: readonly TaskKind[] = [
  'departure_clean',
  'vacant_clean',
  'reclean',
  'deep_clean',
];
/** Housekeeping kinds (shown on the housekeeping board / included in workload planning). */
export const HOUSEKEEPING_KINDS: readonly TaskKind[] = [
  'departure_clean',
  'vacant_clean',
  'stayover',
  'turndown',
  'deep_clean',
  'inspection',
  'reclean',
];

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'verified', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['open', 'in_progress', 'blocked'];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const DEPARTMENT_KINDS = [
  'housekeeping',
  'engineering',
  'front_office',
  'guest_services',
  'food_beverage',
  'security',
  'management',
] as const;
export type DepartmentKind = (typeof DEPARTMENT_KINDS)[number];

export const URGENCIES = ['low', 'normal', 'high', 'emergency'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const ESCALATION_TARGETS = [
  'supervisor',
  'department_head',
  'duty_manager',
  'general_manager',
] as const;
export type EscalationTarget = (typeof ESCALATION_TARGETS)[number];

export const BLOCK_KINDS = ['out_of_order', 'out_of_service'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const SERVICE_REQUEST_CHANNELS = [
  'desk',
  'phone',
  'guest_portal',
  'messaging',
  'in_person',
  'other',
] as const;
export type ServiceRequestChannel = (typeof SERVICE_REQUEST_CHANNELS)[number];

export const SERVICE_REQUEST_STATUSES = ['open', 'in_progress', 'fulfilled', 'cancelled'] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

export const LOST_FOUND_STATUSES = ['stored', 'matched', 'released', 'disposed'] as const;
export type LostFoundStatus = (typeof LOST_FOUND_STATUSES)[number];

export const DISPOSAL_METHODS = [
  'donated',
  'destroyed',
  'handed_to_authorities',
  'returned_to_finder',
] as const;
export type DisposalMethod = (typeof DISPOSAL_METHODS)[number];

export const SECTION_KINDS = ['island_zone', 'jetty', 'building', 'wing', 'floor', 'section'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const ASSET_KINDS = ['unit', 'public_area', 'equipment'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const INTERVAL_UNITS = ['day', 'week', 'month'] as const;
export type IntervalUnit = (typeof INTERVAL_UNITS)[number];

/** A reference to a record in any module (kernel convention). */
export interface EntityRef {
  type: string;
  id: string;
}
