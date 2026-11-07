/**
 * Cardholder consent (ADR-0015 Amendment 2; re-review #3 R3-P1-2, R3-P2-4, R3-P3-1).
 *
 * Staff permission decides WHO may initiate; the cardholder's consent decides WHAT may be taken. Every use of a stored
 * card the hotel initiates — a charge, a hold, a hold increase, a capture — must lie inside the recorded agreement:
 *  - terms version and acceptance recorded (`mit_agreement`), WITH its scope (an agreement without a recorded scope is
 *    not stretched to "anything": it needs new consent) — or the card was entered by its cardholder FOR a booking,
 *    which is consent for that booking's guarantee, deposit, balance and no-show charge only;
 *  - the hotel company (legal entity) and properties it names;
 *  - the purpose (`guarantee` for holds and their captures; `deposit`, `balance`, `incidentals` for charges; a
 *    `custom` charge is never covered);
 *  - the bookings it covers: a card saved FOR a booking covers that booking (its stays and folios); an agreement naming
 *    bookings covers those; a standing agreement covers only the cardholder's OWN bookings and folios (booker,
 *    occupant, company, agency, payer) — which is also invariant (e) "a card is used for its owner's charges";
 *  - its amount: `maxAmount` is the most the hotel may take on the card in total under the agreement (every
 *    merchant-initiated charge and capture so far, plus this one) and the most it may hold at once — so five charges
 *    of 100 cannot pass a 100 limit.
 * Anything beyond it needs NEW consent from the cardholder (a payment link, or the terminal with the guest); no staff
 * permission stands in for it. A guest acting for themselves (customer-initiated) may use only their own card.
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, formatMoney, money } from '@portico/kernel';
import type { PropertyInfo } from '../ports';
import { db, type MethodRow, type PaymentsDeps, referenceContext } from './shared';

export type ConsentPurpose = 'guarantee' | 'deposit' | 'balance' | 'incidentals' | 'no_show' | 'custom';

export interface ConsentUse {
  /** `hold`: an authorization (or its increase: pass the new total); `charge`/`capture`: money collected. */
  kind: 'hold' | 'charge' | 'capture';
  purpose: ConsentPurpose;
  /** Omitted: the amount is not known yet (assessing a card before a hold). */
  amount?: { amountMinor: number; currency: string };
  ref: { type: string; id: string };
}

interface StoredMandate {
  termsVersion?: string;
  acceptedAt?: string;
  scope?: {
    legalEntityId?: string;
    propertyIds?: string[];
    purposes?: string[];
    maxAmount?: { amountMinor: number; currency: string };
    bookingIds?: string[];
  };
}

const NEW_CONSENT =
  'This needs new consent from the cardholder: send a payment link, or take the card on the terminal with the guest.';

export interface ConsentProblem {
  code: string;
  message: string;
}

/** Why this use is outside the cardholder's consent, or null when it is inside. */
export async function consentProblem(
  d: PaymentsDeps,
  tx: TxContext,
  method: MethodRow,
  property: PropertyInfo,
  initiator: 'customer' | 'merchant',
  use: ConsentUse,
): Promise<ConsentProblem | null> {
  const ownerKey = `${method.owner_type}:${method.owner_id}`;
  if (initiator === 'customer') {
    // R3-P3-1: a guest acting for themselves pays with THEIR card only.
    const actor = tx.actor.kind === 'guest' ? tx.actor : null;
    const own =
      (actor?.guestProfileId && ownerKey === `guest_profile:${actor.guestProfileId}`) ||
      (actor?.bookingId && ownerKey === `booking:${actor.bookingId}`);
    return own
      ? null
      : { code: 'card_not_yours', message: 'This saved card belongs to someone else. Use your own card.' };
  }
  const stored = (method.mandate ?? {}) as StoredMandate;
  // A card its cardholder entered FOR a booking (self-service / hosted entry) is consent for that booking: its
  // guarantee and the charges of that booking — nothing else (ADR-0015 Amendment 2: "the card supplied for this booking").
  const suppliedForBooking =
    method.owner_type === 'booking' && method.entry_channel === 'hosted_entry' && !method.mit_agreement;
  const mandate: StoredMandate = suppliedForBooking
    ? {
        termsVersion: 'supplied-for-booking',
        acceptedAt: new Date(method.created_at).toISOString(),
        scope: {
          legalEntityId: property.legalEntityId,
          purposes: ['guarantee', 'deposit', 'balance', 'no_show'],
          bookingIds: [method.owner_id],
        },
      }
    : stored;
  if (!suppliedForBooking && (!method.mit_agreement || !mandate.termsVersion || !mandate.acceptedAt)) {
    return {
      code: 'mit_not_agreed',
      message:
        'This saved card has no recorded agreement from the cardholder (terms and acceptance) to charges the hotel makes, so staff cannot charge or hold it. Send a payment link, take the card on the terminal with the guest, or save the card again with the cardholder’s recorded agreement.',
    };
  }
  const scope = mandate.scope;
  if (!scope) {
    return {
      code: 'mandate_scope_missing',
      message: `The cardholder’s agreement was recorded without its scope (which hotel, which purposes, which bookings, how much), so it is not stretched to cover this. ${NEW_CONSENT}`,
    };
  }
  if (
    scope.legalEntityId !== property.legalEntityId ||
    (scope.propertyIds !== undefined && !scope.propertyIds.includes(property.id))
  ) {
    return {
      code: 'mandate_out_of_scope',
      message:
        'The cardholder’s agreement to later charges covers another hotel or property, not this one. Send a payment link or ask the guest for a card here.',
    };
  }
  const purposes = scope.purposes ?? [];
  const purposeOk =
    use.kind === 'charge'
      ? use.purpose !== 'custom' && purposes.includes(use.purpose)
      : purposes.includes('guarantee') || purposes.includes('incidentals') || purposes.includes(use.purpose);
  if (!purposeOk) {
    return {
      code: 'mandate_purpose_not_covered',
      message: `The cardholder agreed to ${purposes.join(', ') || 'no'} charges on this card, not to ${use.kind === 'charge' ? `a ${use.purpose} charge` : 'this hold'}. ${NEW_CONSENT}`,
    };
  }
  const ctx = await referenceContext(d, tx, use.ref);
  const covered =
    method.owner_type === 'booking'
      ? ctx.bookingId === method.owner_id
      : scope.bookingIds
        ? ctx.bookingId !== null && scope.bookingIds.includes(ctx.bookingId)
        : ctx.people.has(ownerKey);
  if (!covered) {
    return {
      code: 'mandate_reference_not_covered',
      message: `The cardholder’s agreement does not cover this ${use.ref.type}: ${
        method.owner_type === 'booking' || scope.bookingIds
          ? 'it names other bookings'
          : 'the card is used only for the cardholder’s own bookings and bills'
      }. ${NEW_CONSENT}`,
    };
  }
  const max = scope.maxAmount;
  if (max && use.amount) {
    if (max.currency !== use.amount.currency) {
      return {
        code: 'mandate_amount_exceeded',
        message: `The cardholder’s agreement is in ${max.currency}. ${NEW_CONSENT}`,
      };
    }
    let total = use.amount.amountMinor;
    if (use.kind !== 'hold') {
      const taken = await db(tx)
        .selectFrom('payments.payments')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('amount_minor'), eb.val('0')).as('n'))
        .where('method_id', '=', method.id)
        .where('initiator', '=', 'merchant')
        .where('status', 'in', ['processing', 'pending_verification', 'succeeded'])
        .executeTakeFirstOrThrow();
      total += Number(taken.n);
    }
    if (total > max.amountMinor) {
      return {
        code: 'mandate_amount_exceeded',
        message: `The cardholder agreed to at most ${formatMoney(money(max.amountMinor, max.currency))} on this card${use.kind === 'hold' ? '' : ' in total'}; this would make ${formatMoney(money(total, max.currency))}. ${NEW_CONSENT}`,
      };
    }
  }
  return null;
}

export async function assertWithinConsent(
  d: PaymentsDeps,
  tx: TxContext,
  method: MethodRow,
  property: PropertyInfo,
  initiator: 'customer' | 'merchant',
  use: ConsentUse,
): Promise<void> {
  const problem = await consentProblem(d, tx, method, property, initiator, use);
  if (problem) {
    throw new BusinessRuleError(problem.code, problem.message, { methodId: method.id, ref: use.ref });
  }
}
