/**
 * Guarantee cards (integration-step reviews P1-2 and R2-P1-1; ADR-0015 Amendment 1).
 *
 * Choosing which stored card secures or pays for a booking is a payments decision. A card counts as the booking's
 * AGREED guarantee only if payments confirms that its cardholder supplied it for THIS booking (hosted entry,
 * self-service, the booking's own channel virtual card) or that a recorded mandate of the cardholder names this
 * booking. Staff linking a person to a booking — as booker, occupant, payer, company or agency — never makes that
 * person's saved card usable. Any other card is an explicit capability: the acting user needs
 * `payments.payment.collect` at the property, checked every time the card is recorded AND every time it is held (a
 * card a colleague with payment rights attached is not "agreed" for someone without them).
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, type Money } from '@portico/kernel';
import { actorKey, type Deps, db, policy } from './context';

export const PAYMENT_COLLECT = 'payments.payment.collect';

/** Why a card may secure this booking. `designated`: chosen by someone holding `payments.payment.collect`. */
export type GuaranteeBasis = 'cardholder_supplied' | 'channel_card' | 'mandate' | 'designated';

export type GuaranteeCheck = { basis: GuaranteeBasis; reason?: undefined } | { basis: null; reason: string };

/** The guarantee as stored on the booking (server fields never come from the client). */
export interface StoredGuarantee {
  kind: string;
  paymentMethodId?: string;
  note?: string;
  basis?: GuaranteeBasis;
  recordedBy?: string;
}

export async function checkGuaranteeCard(
  deps: Deps,
  tx: TxContext,
  input: { bookingId: string; propertyId: string; methodId: string; amount?: Money },
): Promise<GuaranteeCheck> {
  const a = await deps.ports.payments.assessGuaranteeCard(tx, {
    propertyId: input.propertyId,
    methodId: input.methodId,
    bookingId: input.bookingId,
    ...(input.amount ? { amount: input.amount } : {}),
  });
  if (!a.usable) return { basis: null, reason: a.reason };
  if (a.basis) return { basis: a.basis };
  if (!tx.authz.can(PAYMENT_COLLECT, { propertyId: input.propertyId }))
    return { basis: null, reason: a.reason };
  // A user with payment rights chooses the card — still only one of the booking's own people (review P1-2, invariant
  // (e) "owned by the payer"): never a stranger's saved card, whoever chooses it.
  const owners = await bookingPeople(tx, input.bookingId);
  if (!a.owner || !owners.has(`${a.owner.type}:${a.owner.id}`)) {
    return {
      basis: null,
      reason:
        'This card belongs to someone who is not a guest, booker or payer of this booking, so it cannot secure it. Use a card of the guest (or of the paying company), or send the guest a card link for this booking.',
    };
  }
  return { basis: 'designated' };
}

/** Profile, company, agency and booking ids of the people a payment user may choose a guarantee card from. */
async function bookingPeople(tx: TxContext, bookingId: string): Promise<Set<string>> {
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
 * Validates a guarantee card being recorded on a booking (create, patch, channel modify) and returns the guarantee to
 * store, with its basis and who recorded it. Throws `guarantee_method_not_allowed` with the reason and the recovery.
 */
export async function guaranteeToStore(
  deps: Deps,
  tx: TxContext,
  input: {
    bookingId: string;
    propertyId: string;
    guarantee: { kind: string; paymentMethodId?: string | undefined; note?: string | undefined };
  },
): Promise<StoredGuarantee> {
  const g = input.guarantee;
  const base: StoredGuarantee = {
    kind: g.kind,
    ...(g.paymentMethodId ? { paymentMethodId: g.paymentMethodId } : {}),
    ...(g.note ? { note: g.note } : {}),
  };
  if (!g.paymentMethodId) return base;
  const check = await checkGuaranteeCard(deps, tx, {
    bookingId: input.bookingId,
    propertyId: input.propertyId,
    methodId: g.paymentMethodId,
  });
  if (!check.basis) {
    throw new BusinessRuleError('guarantee_method_not_allowed', check.reason, {
      methodId: g.paymentMethodId,
    });
  }
  return { ...base, basis: check.basis, recordedBy: actorKey(tx) };
}

/**
 * Highest amount the desk may hold at check-in: the stay's agreed gross × policy
 * `reservations.checkIn.guaranteeCapPercent` (default 150 % — room total plus incidentals). Review R2-P3-1: the cap
 * fails CLOSED — a policy value that is not a finite number above 0 and at most 1000 is ignored and the default
 * applies (never "no cap", never "cap 0").
 */
export const GUARANTEE_CAP_DEFAULT_PERCENT = 150;
export async function guaranteeCap(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  agreedGross: Money,
): Promise<Money> {
  const raw = await policy<unknown>(
    deps,
    tx,
    propertyId,
    'reservations.checkIn.guaranteeCapPercent',
    GUARANTEE_CAP_DEFAULT_PERCENT,
  );
  const percent =
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 1000
      ? raw
      : GUARANTEE_CAP_DEFAULT_PERCENT;
  return {
    amountMinor: Math.floor((agreedGross.amountMinor * percent) / 100),
    currency: agreedGross.currency,
  };
}
