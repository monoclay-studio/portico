/**
 * Stay-night decisions and watched stays (review P1-1, P2-2).
 *
 * - `decideNight`: a night a person took out of Day Close (an override) is a decision, not a gap. The person decides
 *   "Day Close posts it" (then the next close posts it once, with the plan key — also after the guest left) or
 *   "it was charged another way" (Day Close never posts it). Append-only, audited, sensitive permission.
 * - `onStayEvent`: Day Close's own record of stays checked in after one of their nights may already have been passed
 *   by a close (a check-in during a run, or after the advance), with the departure reservations last announced, so the
 *   next close can still charge — or flag — the night after the guest has left (DCL-I04 until reservations offers
 *   stays-by-night including departed ones, CR-2).
 */
import type { TxContext } from '@portico/db';
import {
  addDays,
  BusinessRuleError,
  type DomainEvent,
  type LocalDate,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import { z } from 'zod';
import type { NightDecisionInput } from '../contracts';
import { DAY_CLOSE_PERMISSIONS as P } from '../manifest';
import { actorKey, type Deps, db } from './context';
import { closeIssue } from './repo';

export async function decideNight(
  _deps: Deps,
  tx: TxContext,
  propertyId: string,
  input: NightDecisionInput,
): Promise<{ stayId: string; night: LocalDate; decision: string }> {
  requirePermission(tx, P.exceptionOverride, { propertyId });
  const reason = input.reason.trim();
  if (reason.length < 3)
    throw new ValidationError('decision_reason_required', 'Give a reason for the decision.');
  const pending = await db(tx)
    .selectFrom('day_close.night_decisions')
    .select(['decision', 'property_id'])
    .where('stay_id', '=', input.stayId)
    .where('night', '=', input.night)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (pending?.property_id !== propertyId || pending.decision !== 'skip_pending') {
    throw new BusinessRuleError(
      'no_decision_pending',
      'Day Close is not waiting for a decision on this night (it was posted, or decided already). Refresh the list.',
    );
  }
  const posted = await db(tx)
    .selectFrom('day_close.night_postings')
    .select('night')
    .where('stay_id', '=', input.stayId)
    .where('night', '=', input.night)
    .executeTakeFirst();
  if (posted) throw new BusinessRuleError('night_already_posted', 'Day Close already posted this night.');
  await db(tx)
    .insertInto('day_close.night_decisions')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      property_id: propertyId,
      stay_id: input.stayId,
      night: input.night,
      decision: input.decision,
      run_id: null,
      reason,
      actor: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
  if (input.decision === 'post_by_day_close') {
    // Keep the stay in sight even if the guest has left: the next close posts the night (or flags it).
    await db(tx)
      .insertInto('day_close.watched_stays')
      .values({
        tenant_id: tx.tenantId,
        property_id: propertyId,
        stay_id: input.stayId,
        from_night: input.night,
        departure: addDays(input.night, 1),
        reason: 'decided_post_by_day_close',
        created_at: tx.now,
        updated_at: tx.now,
        resolved_at: null,
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'stay_id']).doUpdateSet((eb) => ({
          from_night: eb.fn('least', [eb.ref('day_close.watched_stays.from_night'), eb.val(input.night)]),
          departure: eb.fn('greatest', [
            eb.ref('day_close.watched_stays.departure'),
            eb.val(addDays(input.night, 1)),
          ]),
          resolved_at: null,
          updated_at: tx.now,
        })),
      )
      .execute();
  }
  await closeIssue(
    tx,
    `night_decision:${input.stayId}:${input.night}`,
    input.decision === 'post_by_day_close'
      ? 'Decided: Day Close posts the night at its next close'
      : 'Decided: charged another way; Day Close never posts it',
  );
  await tx.audit({
    action: 'dayClose.night.decided',
    target: { type: 'stay', id: input.stayId },
    propertyId,
    reason,
    after: { night: input.night, decision: input.decision },
  });
  return { stayId: input.stayId, night: input.night, decision: input.decision };
}

const stayEvent = z.looseObject({
  stayId: z.string(),
  businessDate: z.string().optional(),
  stays: z.array(
    z.looseObject({
      stayId: z.string(),
      propertyId: z.string(),
      arrival: z.string(),
      departure: z.string(),
    }),
  ),
});

/** Event consumer (inside the delivery's tenant transaction; idempotent — an upsert per stay). */
export async function onStayEvent(tx: TxContext, event: DomainEvent): Promise<void> {
  const parsed = stayEvent.safeParse(event.payload);
  if (!parsed.success) return;
  const info = parsed.data.stays.find((s) => s.stayId === parsed.data.stayId);
  if (!info) return;
  const existing = await db(tx)
    .selectFrom('day_close.watched_stays')
    .select(['stay_id'])
    .where('stay_id', '=', info.stayId)
    .executeTakeFirst();
  if (existing) {
    await db(tx)
      .updateTable('day_close.watched_stays')
      .set({ departure: info.departure, updated_at: tx.now })
      .where('stay_id', '=', info.stayId)
      .execute();
    return;
  }
  if (event.type !== 'reservations.stay.checkedIn') return;
  // Watch when a night of this stay may already have been passed by a close: the arrival is before the business date
  // the check-in happened on, or a Day Close for a date on/after the arrival has started.
  const late = parsed.data.businessDate !== undefined && info.arrival < parsed.data.businessDate;
  const run = await db(tx)
    .selectFrom('day_close.runs')
    .select('id')
    .where('property_id', '=', info.propertyId)
    .where('business_date', '>=', info.arrival)
    .where('status', '!=', 'cancelled')
    .executeTakeFirst();
  if (!late && !run) return;
  await db(tx)
    .insertInto('day_close.watched_stays')
    .values({
      tenant_id: tx.tenantId,
      property_id: info.propertyId,
      stay_id: info.stayId,
      from_night: info.arrival,
      departure: info.departure,
      reason: late ? 'checked_in_after_close' : 'checked_in_during_close',
      created_at: tx.now,
      updated_at: tx.now,
      resolved_at: null,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'stay_id']).doNothing())
    .execute();
}
