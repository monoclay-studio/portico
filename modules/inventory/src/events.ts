import type { DateRange, EntityRef, LocalDate } from '@portico/kernel';

/** Event types emitted by inventory (`<module>.<aggregate>.<pastTenseVerb>`). */
export const INVENTORY_EVENTS = {
  /** Coalescible: consumers (distribution, waitlist) may merge events with the same `coalesceKey`. */
  availabilityChanged: 'inventory.availability.changed',
  unitBlocked: 'inventory.unit.blocked',
  unitUnblocked: 'inventory.unit.unblocked',
  assignmentChanged: 'inventory.assignment.changed',
  holdExpired: 'inventory.hold.expired',
  conflictDetected: 'inventory.conflict.detected',
  conflictResolved: 'inventory.conflict.resolved',
  overbookingAuthorized: 'inventory.overbooking.authorized',
  unitTypeChanged: 'inventory.unitType.changed',
  unitChanged: 'inventory.unit.changed',
  /** Urgent: the consistency check found sold/held that do not match consumption/holds (never auto-corrected). */
  ledgerInconsistent: 'inventory.ledger.inconsistent',
} as const;

/**
 * THE payload of `inventory.availability.changed`: one event per unit type per command, carrying the half-open
 * `range` that covers every changed night (not a list of cells). Consumers re-read availability for that range;
 * events with the same `coalesceKey` may be merged by widening the range.
 */
export interface AvailabilityChangedPayload extends Record<string, unknown> {
  propertyId: string;
  unitTypeId: string;
  /** Half-open range covering every changed night. */
  range: DateRange;
  /** Stable key: events with the same key may be coalesced (merge ranges, keep the latest). */
  coalesceKey: string;
  cause: string;
}

export interface UnitBlockedPayload extends Record<string, unknown> {
  blockId: string;
  propertyId: string;
  unitId: string;
  unitTypeId: string;
  kind: 'out_of_order' | 'out_of_service' | 'house_use';
  nights: DateRange;
  reason: string;
  sourceRef: EntityRef | null;
  affectedAssignments: Array<{ ref: EntityRef; nights: DateRange; unitId: string }>;
  conflictsCreated: string[];
}

export interface UnitUnblockedPayload extends Record<string, unknown> {
  blockId: string;
  propertyId: string;
  unitId: string;
  unitTypeId: string;
  kind: 'out_of_order' | 'out_of_service' | 'house_use';
  releasedNights: DateRange | null;
}

export interface AssignmentChangedPayload extends Record<string, unknown> {
  propertyId: string;
  ref: EntityRef;
  change: 'assigned' | 'moved' | 'unassigned';
  unitId: string | null;
  previousUnitIds: string[];
  nights: DateRange;
}

export interface HoldExpiredPayload extends Record<string, unknown> {
  holdId: string;
  propertyId: string;
  unitTypeId: string;
  ref: EntityRef;
  nights: DateRange;
}

export interface ConflictPayload extends Record<string, unknown> {
  conflictId: string;
  propertyId: string;
  unitTypeId: string;
  night: LocalDate;
  shortfall: number;
  resolution?: string;
}
