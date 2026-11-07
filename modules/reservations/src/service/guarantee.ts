/**
 * Guarantee card checks (integration-step review P1-2). A card used to secure a stay must belong to the booking's
 * guest, booker or payer — never a stranger's saved card — and choosing another card or amount than the booking's
 * agreed guarantee is an explicit capability (`payments.payment.collect`, ADR-0015 §5), capped by policy.
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, type Money } from '@portico/kernel';
import { type Deps, db, policy } from './context';

export const PAYMENT_COLLECT = 'payments.payment.collect';

/** Profile, company, agency and booking ids a guarantee card of this booking may belong to. */
async function allowedOwners(tx: TxContext, bookingId: string): Promise<Set<string>> {
  const b = await db(tx)
    .selectFrom('reservations.bookings')
    .select(['id', 'booker_profile_id', 'company_id', 'agency_id', 'billing'])
    .where('id', '=', bookingId)
    .executeTakeFirstOrThrow();
  const occupants = await db(tx)
    .selectFrom('reservations.occupants as o')
    .innerJoin('reservations.stays as s', 's.id', 'o.stay_id')
    .select('o.profile_id')
    .where('s.booking_id', '=', bookingId)
    .where('o.profile_id', 'is not', null)
    .execute();
  const billing = (b.billing ?? null) as { accommodationPayer?: { type: string; id: string } } | null;
  const keys = new Set<string>([`booking:${b.id}`]);
  if (b.booker_profile_id) keys.add(`guest_profile:${b.booker_profile_id}`);
  for (const o of occupants) keys.add(`guest_profile:${o.profile_id}`);
  if (b.company_id) keys.add(`company:${b.company_id}`);
  if (b.agency_id) keys.add(`agency:${b.agency_id}`);
  const payer = billing?.accommodationPayer;
  if (payer) keys.add(`${payer.type === 'profile' ? 'guest_profile' : payer.type}:${payer.id}`);
  return keys;
}

/**
 * Refuses a card that does not belong to the booking's guest, booker or payer (or is unknown / of another property).
 * Returns the reason instead of throwing when `soft` (workflow steps report a failed step with the reason).
 */
export async function checkGuaranteeMethod(
  deps: Deps,
  tx: TxContext,
  input: { bookingId: string; propertyId: string; methodId: string },
): Promise<string | null> {
  const method = await deps.ports.payments.describeMethod(tx, input.methodId, {
    propertyId: input.propertyId,
  });
  if (!method) {
    return "This payment method is not a saved card of this property (unknown, removed, or of another property). Save the guest's card first.";
  }
  const owners = await allowedOwners(tx, input.bookingId);
  if (!owners.has(`${method.owner.type}:${method.owner.id}`)) {
    return 'This card belongs to someone who is not a guest, booker or payer of this booking, so it cannot secure it. Use a card of the guest (or of the paying company).';
  }
  return null;
}

export async function assertGuaranteeMethod(
  deps: Deps,
  tx: TxContext,
  input: { bookingId: string; propertyId: string; methodId: string },
): Promise<void> {
  const reason = await checkGuaranteeMethod(deps, tx, input);
  if (reason)
    throw new BusinessRuleError('guarantee_method_not_allowed', reason, { methodId: input.methodId });
}

/**
 * Highest amount the desk may hold at check-in: the stay's agreed gross × policy
 * `reservations.checkIn.guaranteeCapPercent` (default 150 % — room total plus incidentals).
 */
export async function guaranteeCap(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  agreedGross: Money,
): Promise<Money> {
  const percent = await policy<number>(deps, tx, propertyId, 'reservations.checkIn.guaranteeCapPercent', 150);
  return {
    amountMinor: Math.floor((agreedGross.amountMinor * Math.max(0, percent)) / 100),
    currency: agreedGross.currency,
  };
}
