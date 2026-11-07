/**
 * Cardholder consent (ADR-0015 Amendments 2 and 3; re-reviews #3 R3-P1-2 and #4 R4-P1-1, R4-P1-2, R4-P3-1, R4-P3-6).
 *
 * Staff permission decides WHO may initiate; the cardholder's consent decides WHAT may be taken. Every use of a stored
 * card the hotel initiates — a charge, a hold, a hold increase, a capture — must lie inside the recorded agreement:
 *  - terms version and acceptance recorded (`mit_agreement`), WITH its scope (an agreement without a recorded scope is
 *    not stretched to "anything": it needs new consent) — or the card was entered by its cardholder FOR a booking,
 *    which is consent for that booking's guarantee, deposit, balance and no-show charge;
 *  - the hotel company (legal entity) and properties it names;
 *  - the purpose (`guarantee` for holds and their captures; `deposit`, `balance`, `incidentals`, `no_show` for charges;
 *    a `custom` charge is never covered);
 *  - the bookings (and folios) it NAMES, as recorded with evidence when the cardholder consented (Amendment 3). Nothing
 *    staff can write — booker, occupants, payer, company, an added stay, a profile merge — extends it. A booking's
 *    consent covers the stays it had then (the evidence lists them); a stay added later is not covered. A future-stays /
 *    payer-account scope does not exist (Q160);
 *  - its amount: `maxAmount` is the most the hotel may have taken or held on the card under the agreement at any time:
 *    every merchant-initiated charge and capture so far, plus every hold still open, plus this use. The running total
 *    is read under a lock on the card row (R4-P1-2), so parallel uses cannot each see the old total.
 * Anything beyond it needs NEW consent from the cardholder (a payment link, the terminal, hosted entry, or the guest's
 * own self-service); no staff permission stands in for it. A guest acting for themselves may use only a card they
 * entered themselves (R4-P3-6).
 *
 * Lock order (domain map): authorization row → card row → collection lock → folio → payment request.
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, formatMoney, money } from '@portico/kernel';
import type { PropertyInfo } from '../ports';
import { db, type MethodRow, type PaymentsDeps, referenceContext } from './shared';

export type ConsentPurpose = 'guarantee' | 'deposit' | 'balance' | 'incidentals' | 'no_show' | 'custom';

export interface ConsentUse {
  /** `hold`: a new authorization, or an increase (pass `authorizationId` and the hold's NEW total); `charge`; `capture`. */
  kind: 'hold' | 'charge' | 'capture';
  purpose: ConsentPurpose;
  /** Omitted: the amount is not known yet (assessing a card before a hold). */
  amount?: { amountMinor: number; currency: string };
  ref: { type: string; id: string };
  /** The hold being increased or captured: its own open amount is not counted twice. */
  authorizationId?: string;
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
    /** Folios named directly (no booking): exactly these. */
    folioIds?: string[];
    /**
     * Server-built, per named booking: when and through which channel the cardholder consented to it, and the stays
     * the booking had then — the consent covers those stays only.
     */
    bookingEvidence?: Record<string, { at: string; channel: string; stayIds?: string[] }>;
  };
  /** A card its cardholder entered for a booking (hosted entry): the booking's stays at that moment (server-built). */
  supplied?: { bookingId: string; at: string; stayIds?: string[] };
}

const NEW_CONSENT =
  'This needs new consent from the cardholder: send a payment link, take the card on the terminal, or let the guest confirm the card for this booking.';

export interface ConsentProblem {
  code: string;
  message: string;
}

/**
 * Why this use is outside the cardholder's consent, or null when it is inside. For a hotel-initiated use it first LOCKS
 * the card row and re-reads it (status and agreement as they are now), so the running total, a revocation and a
 * concurrent use are serialized (R4-P1-2, AP-56).
 */
export async function consentProblem(
  d: PaymentsDeps,
  tx: TxContext,
  methodIn: MethodRow,
  property: PropertyInfo,
  initiator: 'customer' | 'merchant',
  use: ConsentUse,
  opts: { lock?: boolean } = {},
): Promise<ConsentProblem | null> {
  const method =
    opts.lock === false
      ? methodIn
      : ((await db(tx)
          .selectFrom('payments.payment_methods')
          .selectAll()
          .where('id', '=', methodIn.id)
          .forUpdate()
          .executeTakeFirst()) ?? methodIn);
  if (method.status !== 'active') {
    return {
      code: 'payment_method_inactive',
      message: `This saved card is ${method.status}. Ask the guest for another card or send a payment link.`,
    };
  }
  const ownerKey = `${method.owner_type}:${method.owner_id}`;
  if (initiator === 'customer') {
    // R3-P3-1 / R4-P3-6: a guest acting for themselves pays only with a card THEY entered (hosted entry), for
    // themselves or their own booking — never a channel's virtual card or a card staff keyed in.
    const actor = tx.actor.kind === 'guest' ? tx.actor : null;
    const own =
      method.entry_channel === 'hosted_entry' &&
      ((actor?.guestProfileId && ownerKey === `guest_profile:${actor.guestProfileId}`) ||
        (actor?.bookingId && ownerKey === `booking:${actor.bookingId}`));
    return own
      ? null
      : { code: 'card_not_yours', message: 'This saved card is not one you entered. Use your own card.' };
  }
  const stored = (method.mandate ?? {}) as StoredMandate;
  // A card its cardholder entered FOR a booking (self-service / hosted entry) is consent for that booking: its
  // guarantee and its charges — at the moment the card was entered (Amendment 2: "the card supplied for this booking").
  const suppliedForBooking =
    method.owner_type === 'booking' && method.entry_channel === 'hosted_entry' && !method.mit_agreement;
  const suppliedAt = new Date(method.created_at).toISOString();
  const mandate: StoredMandate = suppliedForBooking
    ? {
        termsVersion: 'supplied-for-booking',
        acceptedAt: suppliedAt,
        scope: {
          legalEntityId: property.legalEntityId,
          purposes: ['guarantee', 'deposit', 'balance', 'no_show'],
          bookingIds: [method.owner_id],
          ...(stored.supplied?.bookingId === method.owner_id
            ? {
                bookingEvidence: {
                  [method.owner_id]: {
                    at: suppliedAt,
                    channel: 'hosted_entry',
                    ...(stored.supplied.stayIds ? { stayIds: stored.supplied.stayIds } : {}),
                  },
                },
              }
            : {}),
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
  // Amendment 3 / R4-P1-1: only the bookings the agreement NAMES, as consented — never the people staff link.
  const ctx = await referenceContext(d, tx, use.ref);
  const named = scope.bookingIds ?? [];
  const inNamedBooking = ctx.bookingId !== null && named.includes(ctx.bookingId);
  // A stay added to the booking after the cardholder's consent is not part of what they agreed to: the consent covers
  // the stays its evidence lists (the booking's stays when they consented). Evidence without that list (a directory
  // that cannot list a booking's stays) falls back to the stay's creation time: strictly before the consent.
  const stayCovered = (bookingId: string): boolean => {
    if (ctx.stayId === null) return true;
    const evidence = scope.bookingEvidence?.[bookingId];
    if (evidence?.stayIds) return evidence.stayIds.includes(ctx.stayId);
    const consentedAt = new Date(evidence?.at ?? (mandate.acceptedAt as string));
    return ctx.stayCreatedAt !== null && ctx.stayCreatedAt.getTime() < consentedAt.getTime();
  };
  const namedFolio = use.ref.type === 'folio' && (scope.folioIds ?? []).includes(use.ref.id);
  const covered = namedFolio || (inNamedBooking && stayCovered(ctx.bookingId as string));
  if (!covered) {
    return {
      code: 'mandate_reference_not_covered',
      message: `The cardholder’s agreement does not cover this ${use.ref.type}: it covers only the bookings the cardholder agreed to${inNamedBooking ? ', and this stay was added after that agreement' : ''}. ${NEW_CONSENT}`,
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
    const total = await runningTotal(tx, method.id, { ...use, amount: use.amount });
    if (total > max.amountMinor) {
      return {
        code: 'mandate_amount_exceeded',
        message: `The cardholder agreed to at most ${formatMoney(money(max.amountMinor, max.currency))} taken or held on this card; with what is already taken or held, this would make ${formatMoney(money(total, max.currency))}. ${NEW_CONSENT}`,
      };
    }
  }
  return null;
}

/**
 * R4-P1-2 / R4-P3-1: what the card's agreement would carry after this use — everything taken so far (merchant charges and
 * captures in flight or done), plus every hold still open (except the one being increased or captured) and every hold
 * increase still in flight, plus this use.
 * Called under the card row lock taken by `consentProblem`.
 */
async function runningTotal(
  tx: TxContext,
  methodId: string,
  use: ConsentUse & { amount: { amountMinor: number; currency: string } },
): Promise<number> {
  const taken = await db(tx)
    .selectFrom('payments.payments')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('amount_minor'), eb.val('0')).as('n'))
    .where('method_id', '=', methodId)
    .where('initiator', '=', 'merchant')
    .where('status', 'in', ['processing', 'pending_verification', 'succeeded'])
    .executeTakeFirstOrThrow();
  const holds = await db(tx)
    .selectFrom('payments.authorizations')
    .select(['id', 'amount_minor', 'captured_minor', 'capture_reserved_minor'])
    .where('method_id', '=', methodId)
    .where('initiator', '=', 'merchant')
    .where('status', 'in', ['processing', 'pending_verification', 'authorized', 'partially_captured'])
    .execute();
  const open = (h: { amount_minor: number; captured_minor: number; capture_reserved_minor: number }) =>
    Math.max(0, h.amount_minor - h.captured_minor - h.capture_reserved_minor);
  const others = holds.filter((h) => h.id !== use.authorizationId).reduce((n, h) => n + open(h), 0);
  const own = holds.find((h) => h.id === use.authorizationId);
  // A hold increase sent to the provider but not confirmed yet is not in the hold's amount: count it (except the
  // increase this use replaces — an increase passes the hold's new total as its amount).
  const increases = await db(tx)
    .selectFrom('payments.provider_operations as o')
    .innerJoin('payments.authorizations as a', 'a.id', 'o.authorization_id')
    .select(['o.authorization_id', 'o.amount_minor'])
    .where('a.method_id', '=', methodId)
    .where('a.initiator', '=', 'merchant')
    .where('o.kind', '=', 'increment')
    .where('o.status', 'in', ['pending', 'sent', 'pending_verification'])
    .execute();
  const pendingIncreases = increases
    .filter((o) => !(use.kind === 'hold' && o.authorization_id === use.authorizationId))
    .reduce((n, o) => n + o.amount_minor, 0);
  // A capture moves money from its hold to "taken": the hold's whole open amount is counted once.
  const thisUse = use.kind === 'capture' && own ? open(own) : use.amount.amountMinor;
  return Number(taken.n) + others + pendingIncreases + thisUse;
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
