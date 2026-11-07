import { ConflictError, DomainError, type EntityRef, type LocalDate } from '@portico/kernel';

export interface ShortNightDetail {
  date: LocalDate;
  available: number;
}

/**
 * Not enough inventory for every requested night. Nothing was consumed (a consume either changes every night or
 * none). `shortNights` lists the nights that do not fit, with what is available on each.
 */
export class InventoryUnavailableError extends DomainError {
  readonly shortNights: ShortNightDetail[];
  readonly unitTypeId: string;

  constructor(input: {
    unitTypeId: string;
    unitTypeName: string;
    requested: number;
    shortNights: ShortNightDetail[];
    reason?: 'short' | 'no_single_unit' | 'composite_overbooking_not_permitted' | 'hold_not_convertible';
  }) {
    const reason = input.reason ?? 'short';
    const nights = input.shortNights.map((n) => `${n.date} (${Math.max(n.available, 0)} left)`).join(', ');
    const message =
      reason === 'no_single_unit'
        ? `No single ${input.unitTypeName} is free for every requested night, although some nights have availability. Combined units are sold together with a specific unit, so choose other dates, split the stay, or pick another unit type.`
        : reason === 'composite_overbooking_not_permitted'
          ? `${input.unitTypeName} cannot be overbooked: combined units are sold with a specific unit. Short on ${nights}. Choose other dates or another unit type.`
          : reason === 'hold_not_convertible'
            ? `The hold on ${input.unitTypeName} can no longer be converted: ${nights || 'no matching unit is free'}. Check availability and alternatives, then book again.`
            : `${input.unitTypeName} is not available for ${input.requested} unit${input.requested === 1 ? '' : 's'} on ${nights}. It was just sold or held — nothing was booked. Check availability for alternatives (other unit types or dates).`;
    super('inventory_unavailable', message, {
      status: 409,
      details: {
        unitTypeId: input.unitTypeId,
        requested: input.requested,
        shortNights: input.shortNights,
        reason,
      },
    });
    this.shortNights = input.shortNights;
    this.unitTypeId = input.unitTypeId;
  }
}

export interface AssignmentConflictDetail {
  ref: EntityRef;
  unitId: string;
  unitNumber: string;
  nights: { from: LocalDate; to: LocalDate };
}

/** The unit (or one of its components) is already assigned to someone else on some of the nights. */
export class UnitAssignmentConflictError extends ConflictError {
  readonly conflicts: EntityRef[];
  readonly conflictDetails: AssignmentConflictDetail[];

  constructor(unitNumber: string, details: AssignmentConflictDetail[]) {
    const desc = details
      .map(
        (d) =>
          `unit ${d.unitNumber} is assigned to ${d.ref.type} ${d.ref.id} for nights ${d.nights.from} to ${d.nights.to} (departure)`,
      )
      .join('; ');
    super(
      'unit_assignment_conflict',
      `Unit ${unitNumber} cannot be assigned: ${desc}. Choose another unit (see assignable units for these nights), or move the other stay first.`,
      { conflicts: details },
    );
    const seen = new Map<string, EntityRef>();
    for (const d of details) seen.set(`${d.ref.type}:${d.ref.id}`, d.ref);
    this.conflicts = [...seen.values()];
    this.conflictDetails = details;
  }
}
