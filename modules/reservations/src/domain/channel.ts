import type { CanonicalChannelBooking } from '../contracts';
import { diffValues, type FieldChange } from './diff';

/**
 * Channel modifications are FULL replacements (RES-R30): the module diffs against the last applied revision and
 * flags field losses (information the guest gave that silently disappeared) for human review.
 */
export interface FieldLoss {
  path: string;
  lost: unknown;
  kind: 'special_request' | 'occupant' | 'room' | 'note';
}

export function compareRevision(
  incoming: number,
  lastApplied: number | null,
): 'first' | 'newer' | 'same' | 'older' {
  if (lastApplied === null) return 'first';
  if (incoming > lastApplied) return 'newer';
  if (incoming === lastApplied) return 'same';
  return 'older';
}

const guestKey = (g: { firstName?: string | undefined; lastName: string }) =>
  `${(g.firstName ?? '').trim().toLowerCase()}|${g.lastName.trim().toLowerCase()}`;

export function detectFieldLosses(prev: CanonicalChannelBooking, next: CanonicalChannelBooking): FieldLoss[] {
  const losses: FieldLoss[] = [];
  const nextRequests = new Set(next.specialRequests);
  for (const r of prev.specialRequests)
    if (!nextRequests.has(r)) losses.push({ path: 'specialRequests', lost: r, kind: 'special_request' });
  if (prev.notes && !next.notes) losses.push({ path: 'notes', lost: prev.notes, kind: 'note' });
  const nextRooms = new Map(next.rooms.map((r) => [r.roomRef, r]));
  for (const room of prev.rooms) {
    const n = nextRooms.get(room.roomRef);
    if (!n) {
      losses.push({
        path: `rooms[${room.roomRef}]`,
        lost: { roomRef: room.roomRef, arrival: room.arrival },
        kind: 'room',
      });
      continue;
    }
    const reqs = new Set(n.specialRequests);
    for (const r of room.specialRequests)
      if (!reqs.has(r))
        losses.push({ path: `rooms[${room.roomRef}].specialRequests`, lost: r, kind: 'special_request' });
    const guests = new Set(n.guests.map(guestKey));
    for (const g of room.guests)
      if (!guests.has(guestKey(g)))
        losses.push({
          path: `rooms[${room.roomRef}].guests`,
          lost: { firstName: g.firstName ?? null, lastName: g.lastName },
          kind: 'occupant',
        });
  }
  return losses;
}

export function diffChannelBookings(
  prev: CanonicalChannelBooking,
  next: CanonicalChannelBooking,
): FieldChange[] {
  // Personal data is diffed by structure only: the stored diff is for staff review inside the tenant.
  return diffValues(prev, next);
}
