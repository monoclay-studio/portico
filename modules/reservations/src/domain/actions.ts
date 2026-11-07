import type { LocalDate, RecordAction } from '@portico/kernel';
import type { BookingStatus, StayStatus } from './status';

/**
 * Allowed actions computed server-side (universal record contract): the UI, API, integrations and the assistant
 * see the same truth, and every disabled action says WHY in plain language. Pure: permissions and facts are
 * passed in.
 */
export interface StayActionInput {
  stayStatus: StayStatus;
  bookingStatus: BookingStatus;
  arrival: LocalDate;
  departure: LocalDate;
  businessDate: LocalDate;
  unitAssigned: boolean;
  unitName: string | null;
  /** null when the unit condition is unknown/not applicable; false when it does not meet the required condition. */
  unitReady: boolean | null;
  unitCondition: string | null;
  checkInInProgress: boolean;
  checkOutInProgress: boolean;
  can: (permission: 'checkIn' | 'checkOut' | 'move' | 'update' | 'cancel' | 'noShow' | 'waitlist') => boolean;
}

const consuming = (b: BookingStatus) => b === 'tentative' || b === 'confirmed';
const NO_PERMISSION = 'You do not have permission for this at this property.';

function action(
  action: string,
  label: string,
  enabled: boolean,
  reason?: string,
  previewRequired?: boolean,
): RecordAction {
  return {
    action,
    label,
    enabled,
    ...(enabled || !reason ? {} : { reason }),
    ...(previewRequired ? { previewRequired } : {}),
  };
}

export function stayActions(i: StayActionInput): RecordAction[] {
  const out: RecordAction[] = [];
  const unit = i.unitName ?? 'The unit';
  const changeable =
    (i.stayStatus === 'expected' || i.stayStatus === 'in_house') &&
    ['quoted', 'tentative', 'confirmed'].includes(i.bookingStatus);
  const notChangeableReason =
    i.bookingStatus === 'held'
      ? 'The booking is on a temporary hold; confirm it first.'
      : `The stay is ${i.stayStatus.replace('_', ' ')}.`;

  // Check in
  if (i.stayStatus === 'expected' || i.stayStatus === 'waitlisted') {
    let reason: string | undefined;
    if (i.stayStatus === 'waitlisted')
      reason = 'The stay is on the waitlist; confirm it from the waitlist first.';
    else if (!consuming(i.bookingStatus))
      reason = `The booking is ${i.bookingStatus}; confirm it before check-in.`;
    else if (i.arrival > i.businessDate)
      reason = `The guest is due on ${i.arrival}; preview an earlier arrival to check in today.`;
    else if (!i.unitAssigned) reason = 'No unit is assigned yet.';
    else if (i.unitReady === false)
      reason = `${unit} is ${i.unitCondition?.replace('_', ' ') ?? 'not ready'} and has not passed inspection yet.`;
    else if (!i.can('checkIn')) reason = NO_PERMISSION;
    out.push(
      action('checkIn', i.checkInInProgress ? 'Resume check-in' : 'Check in', reason === undefined, reason),
    );
  }
  // Check out
  if (i.stayStatus === 'in_house') {
    const reason = i.can('checkOut') ? undefined : NO_PERMISSION;
    out.push(
      action(
        'checkOut',
        i.checkOutInProgress ? 'Resume check-out' : 'Check out',
        reason === undefined,
        reason,
      ),
    );
  }
  // Unit assignment and moves
  if (i.stayStatus === 'expected' || i.stayStatus === 'in_house') {
    const reason = !consuming(i.bookingStatus)
      ? 'Units are assigned once the booking is tentative or confirmed.'
      : !i.can('move')
        ? NO_PERMISSION
        : undefined;
    out.push(
      action(
        i.unitAssigned ? 'moveUnit' : 'assignUnit',
        i.unitAssigned ? 'Move to another unit' : 'Assign unit',
        reason === undefined,
        reason,
        i.unitAssigned,
      ),
    );
  }
  // Previewed stay changes
  const changeReason = !changeable ? notChangeableReason : !i.can('update') ? NO_PERMISSION : undefined;
  if (i.stayStatus === 'expected' || i.stayStatus === 'in_house' || i.stayStatus === 'waitlisted') {
    out.push(
      action(
        'changeDates',
        i.stayStatus === 'in_house' ? 'Extend or shorten' : 'Change dates',
        changeReason === undefined,
        changeReason,
        true,
      ),
    );
    out.push(action('changeUnitType', 'Change unit type', changeReason === undefined, changeReason, true));
    out.push(action('changeOccupancy', 'Change guests', changeReason === undefined, changeReason, true));
    out.push(action('changeRatePlan', 'Change rate plan', changeReason === undefined, changeReason, true));
  }
  if (i.stayStatus === 'expected') {
    out.push(action('earlyCheckIn', 'Early check-in', changeReason === undefined, changeReason, true));
  }
  if (i.stayStatus === 'expected' || i.stayStatus === 'in_house') {
    out.push(action('lateCheckOut', 'Late check-out', changeReason === undefined, changeReason, true));
  }
  // Cancel
  if (i.stayStatus === 'expected' || i.stayStatus === 'waitlisted' || i.stayStatus === 'in_house') {
    const reason =
      i.stayStatus === 'in_house'
        ? 'The guest is in house: shorten the stay or check out instead.'
        : !i.can('cancel')
          ? NO_PERMISSION
          : undefined;
    out.push(action('cancel', 'Cancel stay', reason === undefined, reason, true));
  }
  // No-show
  if (i.stayStatus === 'expected') {
    const reason =
      i.businessDate < i.arrival
        ? `The guest is due on ${i.arrival}; a no-show can be recorded from that business date.`
        : !consuming(i.bookingStatus)
          ? `The booking is ${i.bookingStatus}.`
          : !i.can('noShow')
            ? NO_PERMISSION
            : undefined;
    out.push(action('markNoShow', 'Mark no-show', reason === undefined, reason));
  }
  if (i.stayStatus === 'waitlisted') {
    const reason = i.can('waitlist') ? undefined : NO_PERMISSION;
    out.push(action('confirmFromWaitlist', 'Confirm from waitlist', reason === undefined, reason));
  }
  return out;
}

export interface BookingActionInput {
  status: BookingStatus;
  hasActiveStays: boolean;
  hasInHouseStays: boolean;
  can: (permission: 'create' | 'update' | 'cancel') => boolean;
}

export function bookingActions(i: BookingActionInput): RecordAction[] {
  const out: RecordAction[] = [];
  const s = i.status;
  const transition = (act: string, label: string, from: BookingStatus[], perm: 'create' | 'cancel') => {
    if (!from.includes(s)) return;
    const reason = i.can(perm) ? undefined : NO_PERMISSION;
    out.push(action(act, label, reason === undefined, reason));
  };
  transition('confirm', 'Confirm', ['quoted', 'held', 'tentative'], 'create');
  transition('hold', 'Hold inventory', ['quoted'], 'create');
  transition('markTentative', 'Make tentative', ['quoted', 'held'], 'create');
  transition('decline', 'Decline', ['inquiry', 'quoted'], 'cancel');
  if (['quoted', 'tentative', 'confirmed'].includes(s)) {
    const reason = i.can('update') ? undefined : NO_PERMISSION;
    out.push(action('addStay', 'Add a stay', reason === undefined, reason, true));
  }
  if (!['declined', 'expired', 'completed'].includes(s)) {
    const reason = !i.can('update') ? NO_PERMISSION : undefined;
    out.push(action('edit', 'Edit details', reason === undefined, reason));
  }
  if (['held', 'tentative', 'confirmed'].includes(s)) {
    const reason = i.hasInHouseStays
      ? 'A guest is in house; check out or shorten that stay instead of cancelling the booking.'
      : !i.hasActiveStays
        ? 'There are no active stays to cancel.'
        : !i.can('cancel')
          ? NO_PERMISSION
          : undefined;
    out.push(action('cancel', 'Cancel booking', reason === undefined, reason, true));
  }
  return out;
}
