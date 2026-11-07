import type { TxContext } from '@portico/db';
import { DomainError } from '@portico/kernel';
import { type BookingStatus, inventoryEffect, type StayStatus } from '../domain/status';
import type { Deps } from './context';
import { raiseIssue } from './issues';
import { loadBooking } from './repo';

/**
 * Rates' sales limits (RAT-R08, review R-15): every stay that consumes inventory also counts against the sales
 * limits of its rate plan and unit type, in the same transaction, so a limited offer cannot oversell. Called at the
 * end of every command that changes what a booking consumes. Idempotent: the stay's plan sales are released and
 * re-recorded from its current segments (rates re-activates the same rows), so moves, shortening, extensions,
 * cancellation and early departure all converge (no-show: see markNoShow). A departed stay keeps the nights it used.
 * Rates refuses with `sales_limit_reached` (BusinessRuleError) — the command then fails and nothing is written.
 * `onLimit: 'record_issue'` (channel ingestion: the channel already sold it) accepts the booking and raises an
 * urgent issue instead, like inventory's `record_conflict`.
 */
export async function syncPlanSales(
  deps: Deps,
  tx: TxContext,
  bookingId: string,
  opts: { onLimit?: 'reject' | 'record_issue' } = {},
): Promise<void> {
  const booking = await loadBooking(tx, bookingId);
  const consumes = inventoryEffect(booking.row.status as BookingStatus) === 'consume';
  for (const stay of booking.stays) {
    const ref = { type: 'stay', id: stay.row.id };
    const status = stay.row.status as StayStatus;
    // A no-show keeps whatever nights policy kept in inventory; markNoShow releases exactly the released nights.
    if (status === 'no_show') continue;
    await deps.ports.rates.releasePlanSale(tx, { ref });
    if (!consumes || !(status === 'expected' || status === 'in_house' || status === 'departed')) continue;
    for (const seg of stay.segments) {
      if (seg.from >= seg.to) continue;
      try {
        await deps.ports.rates.recordPlanSale(tx, {
          propertyId: booking.row.property_id,
          ratePlanId: seg.ratePlanId,
          unitTypeId: seg.unitTypeId,
          nights: { from: seg.from, to: seg.to },
          quantity: 1,
          ref,
        });
      } catch (err) {
        if (
          opts.onLimit !== 'record_issue' ||
          !(err instanceof DomainError && err.code === 'sales_limit_reached')
        )
          throw err;
        await raiseIssue(tx, {
          propertyId: booking.row.property_id,
          kind: 'sales_limit_exceeded',
          severity: 'urgent',
          bookingId: booking.row.id,
          stayId: stay.row.id,
          dedupeKey: `sales_limit:${stay.row.id}:${seg.from}:${seg.to}`,
          message: `Booking ${booking.row.code} arrived from a channel beyond the rate's sales limit (${err.message}) Check the channel's rate allocation.`,
        });
      }
    }
  }
}
