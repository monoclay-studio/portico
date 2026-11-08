/**
 * Cardholder consent (ADR-0015 Amendments 2, 3 and 4; re-reviews #3 R3-P1-2, #4 R4-P1-1/2, #5 R5-P1-1/2).
 *
 * Staff permission decides WHO may initiate; the cardholder's consent decides WHAT may be taken. Every use of a stored
 * card the hotel initiates — a charge, a hold, a hold increase, a capture — must lie inside the recorded agreement, and
 * every input to that decision is a cardholder fact or a server fact, never a client label (Amendment 4 rule 1):
 *  - terms version and acceptance recorded (`mit_agreement`), WITH its scope — or the card was entered by its
 *    cardholder FOR a booking (consent for that booking's guarantee, deposit, balance and no-show fee);
 *  - an amount limit when staff recorded the agreement (rule 3); the cardholder alone may choose no limit;
 *  - the hotel company (legal entity) and properties it names;
 *  - the purpose DERIVED from the facts (`purpose.ts`: booking → deposit, folio → balance, a recorded penalty →
 *    no_show; `guarantee` for holds and their captures);
 *  - the bookings (and folios) it NAMES, with the stays each booking had when the cardholder consented (Amendment 3):
 *    a stay is covered only if it is listed; a booking-level reference (the booking, or a folio it owns) only while
 *    EVERY current stay of the booking is listed; nothing staff can write — booker, occupants, payer, company, an added
 *    stay, a profile merge — extends it;
 *  - where the money lands (rule 2): a folio is covered only if every owner of the debt on it — charges transferred or
 *    routed onto it from other stays or bookings, followed to the original posting — is covered too. The same check
 *    runs again under the collection lock (`assertDestinationCovered`), and finance asks it before it moves card money
 *    or debt between folios (`cardMoneyMayMeet`);
 *  - its amount: `maxAmount` is the most the hotel may have taken or held on the card under the agreement at any time
 *    (charges and captures in flight or done, every open hold, every hold increase in flight, this use), read under a
 *    lock on the card row (R4-P1-2).
 * Anything beyond it needs NEW consent from the cardholder. A guest acting for themselves may use only a card saved
 * for them (judged on `cardholder_ref`, which a merge never rewrites) and entered by them (R4-P3-6, R5-P3-2).
 *
 * Lock order (domain map): authorization row → card row → collection lock → deposit account / folio → payment request.
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, formatMoney, money } from '@portico/kernel';
import type { CollectionPurpose } from '../contracts';
import type { PropertyInfo } from '../ports';
import { db, type MethodRow, type PaymentsDeps, type ReferenceContext, referenceContext } from './shared';

export interface ConsentUse {
  /** `hold`: a new authorization, or an increase (pass `authorizationId` and the hold's NEW total); `charge`; `capture`. */
  kind: 'hold' | 'charge' | 'capture';
  /** Where money lands (charge, capture): the purpose DERIVED from the destination's facts; holds: `guarantee`. */
  purpose: CollectionPurpose | 'guarantee';
  /** Omitted: the amount is not known yet (assessing a card before a hold). */
  amount?: { amountMinor: number; currency: string };
  ref: { type: string; id: string };
  /** The hold being increased or captured: its own open amount is not counted twice. */
  authorizationId?: string;
}

interface StoredScope {
  legalEntityId?: string;
  propertyIds?: string[];
  purposes?: string[];
  maxAmount?: { amountMinor: number; currency: string };
  noLimitChosenByCardholder?: true;
  bookingIds?: string[];
  /** Folios named directly (no booking): exactly these. */
  folioIds?: string[];
  /**
   * Server-built, per named booking: when (server clock) and through which channel (server: who recorded it) the
   * cardholder consented to it, the channel the client declared, and the stays the booking had then.
   */
  bookingEvidence?: Record<
    string,
    { at: string; channel: string; declaredChannel?: string; stayIds?: string[] }
  >;
}

interface StoredMandate {
  kind?: string;
  termsVersion?: string;
  acceptedAt?: string;
  /** Server fact: who recorded the agreement (`staff` or `cardholder`). Absent on rows saved before Amendment 4. */
  recordedBy?: 'staff' | 'cardholder';
  scope?: StoredScope;
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
 * The agreement a hotel-initiated use is judged against: the recorded mandate, or — for a card its cardholder entered
 * for a booking (hosted entry, no separate agreement) — consent for that booking as it was then. Null: no agreement.
 */
function effectiveMandate(
  method: MethodRow,
  legalEntityId: string,
): { mandate: StoredMandate; supplied: boolean } {
  const stored = (method.mandate ?? {}) as StoredMandate;
  const supplied =
    method.owner_type === 'booking' && method.entry_channel === 'hosted_entry' && !method.mit_agreement;
  if (!supplied) return { mandate: stored, supplied };
  const at = new Date(method.created_at).toISOString();
  return {
    supplied,
    mandate: {
      termsVersion: 'supplied-for-booking',
      acceptedAt: at,
      recordedBy: 'cardholder',
      scope: {
        legalEntityId,
        purposes: ['guarantee', 'deposit', 'balance', 'no_show'],
        bookingIds: [method.owner_id],
        ...(stored.supplied?.bookingId === method.owner_id
          ? {
              bookingEvidence: {
                [method.owner_id]: {
                  at,
                  channel: 'hosted_entry',
                  ...(stored.supplied.stayIds ? { stayIds: stored.supplied.stayIds } : {}),
                },
              },
            }
          : {}),
      },
    },
  };
}

type OwnerCoverage = 'covered' | 'not_named' | 'stay_added' | 'booking_changed';

/**
 * Amendment 3: does the agreement cover what this reference context is — a stay (listed in its booking's evidence), or
 * a booking-level reference (EVERY current stay of the booking listed)? No list → not covered (fails closed).
 */
function ownerCoverage(scope: StoredScope, ctx: ReferenceContext): OwnerCoverage {
  if (!ctx.bookingId || !(scope.bookingIds ?? []).includes(ctx.bookingId)) return 'not_named';
  const listed = scope.bookingEvidence?.[ctx.bookingId]?.stayIds;
  if (!listed) return 'booking_changed';
  if (ctx.stayId !== null) return listed.includes(ctx.stayId) ? 'covered' : 'stay_added';
  if (ctx.bookingStayIds === null) return 'booking_changed';
  return ctx.bookingStayIds.every((id) => listed.includes(id)) ? 'covered' : 'booking_changed';
}

function coverageMessage(what: string, why: Exclude<OwnerCoverage, 'covered'>): string {
  if (why === 'stay_added')
    return `The cardholder’s agreement does not cover this ${what}: it covers only the bookings the cardholder agreed to, and this stay was added after that agreement. ${NEW_CONSENT}`;
  if (why === 'booking_changed')
    return `The cardholder’s agreement does not cover this ${what}: the booking changed since the cardholder agreed (a stay was added), so ask them to confirm it again. ${NEW_CONSENT}`;
  return `The cardholder’s agreement does not cover this ${what}: it covers only the bookings the cardholder agreed to. ${NEW_CONSENT}`;
}

/**
 * Amendments 3 and 4 rule 2: the reference itself is covered (a named folio, or a covered stay / booking), and — for
 * a folio — so is every owner of the debt on it (charges transferred or routed onto it from elsewhere).
 */
async function coverageProblem(
  d: PaymentsDeps,
  tx: TxContext,
  scope: StoredScope,
  ref: { type: string; id: string },
): Promise<ConsentProblem | null> {
  const namedFolio = ref.type === 'folio' && (scope.folioIds ?? []).includes(ref.id);
  if (!namedFolio) {
    const why = ownerCoverage(scope, await referenceContext(d, tx, ref));
    if (why !== 'covered')
      return { code: 'mandate_reference_not_covered', message: coverageMessage(ref.type, why) };
  }
  if (ref.type === 'folio') {
    for (const origin of await d.ledger.debtOriginsOf(tx, ref.id)) {
      const why = ownerCoverage(scope, await referenceContext(d, tx, origin));
      if (why !== 'covered') {
        return {
          code: 'mandate_reference_not_covered',
          message: `This folio carries charges of another ${origin.type} (transferred or routed onto it) that the cardholder did not agree to pay. Move those charges back, or collect them from their own guest. ${NEW_CONSENT}`,
        };
      }
    }
  }
  return null;
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
  if (initiator === 'customer') {
    // R3-P3-1 / R4-P3-6 / R5-P3-2: a guest acting for themselves pays only with a card THEY entered (hosted entry),
    // saved for themselves or their own booking — judged on who it was saved for, never on an owner a merge rewrote.
    const actor = tx.actor.kind === 'guest' ? tx.actor : null;
    const own =
      method.entry_channel === 'hosted_entry' &&
      ((actor?.guestProfileId && method.cardholder_ref === `guest_profile:${actor.guestProfileId}`) ||
        (actor?.bookingId && method.cardholder_ref === `booking:${actor.bookingId}`));
    return own
      ? null
      : { code: 'card_not_yours', message: 'This saved card is not one you entered. Use your own card.' };
  }
  const { mandate, supplied } = effectiveMandate(method, property.legalEntityId);
  if (!supplied && (!method.mit_agreement || !mandate.termsVersion || !mandate.acceptedAt)) {
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
  // Amendment 4 rule 3: an agreement staff recorded carries an amount limit; only the cardholder may choose none. (A
  // card entered for a booking is bounded by the facts each purpose rests on: deposit due, folio balance, penalty.)
  if (
    !supplied &&
    !scope.maxAmount &&
    !(mandate.recordedBy === 'cardholder' && scope.noLimitChosenByCardholder)
  ) {
    return {
      code: 'mandate_limit_missing',
      message: `The cardholder’s agreement was recorded without an amount limit, so the hotel cannot charge or hold the card under it. Record the agreement again with the most the cardholder agreed to. ${NEW_CONSENT}`,
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
  // Amendment 5 rule 1: a hold is judged as a hold; money that lands (a charge, a capture) on the purpose it lands as.
  const purposeOk =
    use.kind === 'hold'
      ? purposes.includes('guarantee') || purposes.includes('incidentals')
      : purposes.includes(use.purpose);
  if (!purposeOk) {
    return {
      code: 'mandate_purpose_not_covered',
      message: `The cardholder agreed to ${purposes.join(', ') || 'no'} charges on this card, not to ${use.kind === 'hold' ? 'this hold' : `a ${use.purpose.replace('_', '-')} ${use.kind}`}. ${NEW_CONSENT}`,
    };
  }
  // Amendments 3 and 4: only the bookings and folios the agreement NAMES, as consented — and where the money lands.
  const coverage = await coverageProblem(d, tx, scope, use.ref);
  if (coverage) return coverage;
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
 * Amendment 4 rule 2, under the collection lock: the destination of a hotel-initiated card collection is (still)
 * covered — a transfer or routing of another stay's charges onto the folio that committed while this collection waited
 * for the lock is seen here.
 */
export async function assertDestinationCovered(
  d: PaymentsDeps,
  tx: TxContext,
  method: MethodRow,
  property: PropertyInfo,
  ref: { type: string; id: string },
): Promise<void> {
  const { mandate } = effectiveMandate(method, property.legalEntityId);
  const problem = mandate.scope
    ? await coverageProblem(d, tx, mandate.scope, ref)
    : { code: 'mandate_scope_missing', message: NEW_CONSENT };
  if (problem) throw new BusinessRuleError(problem.code, problem.message, { methodId: method.id, ref });
}

/**
 * Amendment 4 rule 2 (finance asks before it moves money or debt): may card money from these sources meet debt of these
 * owners on one folio? Sources: payments by id, the card-funded deposits of bookings, and every card payment taken on
 * folios. Only hotel-initiated card money is bound by an agreement (a guest's own payment, a link, cash are not).
 */
export async function cardMoneyMayMeet(
  d: PaymentsDeps,
  tx: TxContext,
  input: {
    sources: { paymentIds?: string[]; depositBookingIds?: string[]; folioIds?: string[] };
    owners: Array<{ type: string; id: string }>;
  },
): Promise<{ covered: true } | { covered: false; reason: string }> {
  const { paymentIds = [], depositBookingIds = [], folioIds = [] } = input.sources;
  if (input.owners.length === 0 || paymentIds.length + depositBookingIds.length + folioIds.length === 0)
    return { covered: true };
  const rows = await db(tx)
    .selectFrom('payments.payments as p')
    .innerJoin('payments.payment_methods as m', 'm.id', 'p.method_id')
    .selectAll('m')
    .select(['p.legal_entity_id as paymentLegalEntityId'])
    .where('p.initiator', '=', 'merchant')
    .where('p.status', 'in', ['processing', 'pending_verification', 'succeeded'])
    .where((eb) => eb('p.amount_minor', '>', eb.ref('p.refunded_minor')))
    .where((eb) =>
      eb.or([
        ...(paymentIds.length ? [eb('p.id', 'in', paymentIds)] : []),
        ...(depositBookingIds.length
          ? [eb.and([eb('p.ref_type', '=', 'booking'), eb('p.ref_id', 'in', depositBookingIds)])]
          : []),
        ...(folioIds.length
          ? [eb.and([eb('p.ref_type', '=', 'folio'), eb('p.ref_id', 'in', folioIds)])]
          : []),
      ]),
    )
    .execute();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const { paymentLegalEntityId, ...method } = row;
    const scope = effectiveMandate(method, paymentLegalEntityId).mandate.scope;
    for (const owner of input.owners) {
      const why = scope ? ownerCoverage(scope, await referenceContext(d, tx, owner)) : 'not_named';
      if (why !== 'covered') {
        return {
          covered: false,
          reason: `Money taken from a saved card (${method.brand ?? 'card'} ${method.last4 ? `•••• ${method.last4}` : ''}) under its cardholder’s agreement would pay for a ${owner.type} that agreement does not cover. Keep it with the stays the cardholder agreed to, ask the cardholder to confirm the card for this booking again, or refund it and collect from the right guest.`,
        };
      }
    }
  }
  return { covered: true };
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

/**
 * Re-review #6 R6-P3-1 / #7 R7-P1-1: finance asks this only when no penalty is owed on the booking's folios (a forfeit
 * with a penalty owed settles that penalty instead). Card-funded deposit money is then not kept as revenue. Null when
 * no card money is in the deposit.
 */
export async function cardDepositForfeitProblem(
  tx: TxContext,
  input: { bookingId: string; amountMinor: number },
): Promise<string | null> {
  const card = await db(tx)
    .selectFrom('payments.payments')
    .select((eb) =>
      eb.fn
        .coalesce(eb.fn.sum<string>(eb('amount_minor', '-', eb.ref('refunded_minor'))), eb.val('0'))
        .as('n'),
    )
    .where('ref_type', '=', 'booking')
    .where('ref_id', '=', input.bookingId)
    .where('initiator', '=', 'merchant')
    .where('method_id', 'is not', null)
    .where('status', 'in', ['processing', 'pending_verification', 'succeeded'])
    .executeTakeFirstOrThrow();
  if (Number(card.n) <= 0) return null;
  // Re-review #7 R7-P1-1: finance asks only when no penalty is owed on the ledger — then card money is not kept.
  return 'Part of this deposit was taken from a saved card under its cardholder’s agreement, and no no-show or cancellation penalty is owed on the booking’s folios. Refund it, or record the no-show or cancellation first (a forfeit then settles that penalty).';
}
