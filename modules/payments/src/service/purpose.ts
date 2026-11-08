/**
 * Purposes are facts (ADR-0015 Amendment 4 rule 1; re-review #5 R5-P1-1).
 *
 * The purpose of money collected is derived by the server from the record that justifies it, never from the label a
 * client sends (labels are display text):
 *  - a booking reference collects a `deposit`, up to the deposit the booking's agreed payment schedule asks for;
 *  - a folio reference collects its `balance`, up to what the folio owes;
 *  - `no_show` only on the folio of a stay for which reservations recorded a no-show penalty (night audit,
 *    `reservations.stay.noShow`) or a cancellation penalty, up to what that penalty still owes.
 * Consent (which purposes the cardholder agreed to) and the collection-ownership guard (which link owns the money) read
 * the derived purpose. The amount limits are checked under the collection lock, so two collections against one fact
 * cannot each see it unpaid.
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, formatMoney, money } from '@portico/kernel';
import type { CollectionPurpose } from '../contracts';
import { db, type MethodRow, type PaymentsDeps, referenceContext } from './shared';

export interface PurposeFact {
  purpose: CollectionPurpose;
  /** The fact a `no_show` rests on (`penalty:<stayId>`); null for deposit and balance (the reference is the fact). */
  basis: string | null;
}

/** Statuses of money that counts as collected against a fact (in flight, done, or recorded). */
const COLLECTED = [
  'processing',
  'pending_verification',
  'succeeded',
  'awaiting_receipt',
  'recorded_unverified',
  'recorded_verified',
] as const;

/**
 * The purpose of a collection on `ref`, from the facts. The label decides only one thing: `no_show` asks for the
 * stay's recorded penalty, and is refused when reservations recorded none.
 */
export async function derivePurpose(
  d: PaymentsDeps,
  tx: TxContext,
  ref: { type: 'folio' | 'booking'; id: string },
  label?: string,
): Promise<PurposeFact> {
  if (label === 'no_show') {
    if (ref.type !== 'folio') {
      throw new BusinessRuleError(
        'no_show_not_recorded',
        'A no-show or cancellation fee is collected on the folio of the stay it was recorded for, not on the booking.',
      );
    }
    const ctx = await referenceContext(d, tx, ref);
    if (!ctx.stayId || ctx.penalties.length === 0) {
      throw new BusinessRuleError(
        'no_show_not_recorded',
        'No no-show or cancellation penalty is recorded for the stay of this folio. A no-show fee is collected only after the night audit records the no-show (or the stay is cancelled with a penalty), and only up to that penalty. Collect the bill as the folio balance, or send a payment link.',
      );
    }
    return { purpose: 'no_show', basis: `penalty:${ctx.stayId}` };
  }
  return ref.type === 'booking' ? { purpose: 'deposit', basis: null } : { purpose: 'balance', basis: null };
}

/**
 * What a folio still owes for a card to take now: its ledger balance, less deposits held for its booking (not yet
 * applied) and less money taken on it that the ledger has not posted yet (in flight, or confirmed and waiting to post).
 */
export async function folioOwedNow(
  d: PaymentsDeps,
  tx: TxContext,
  folioId: string,
  bookingId: string | null,
) {
  const owed = (await d.ledger.balanceOf(tx, { type: 'folio', id: folioId })) ?? 0;
  const held = bookingId ? await d.ledger.depositsHeldFor(tx, bookingId) : 0;
  const unposted = await db(tx)
    .selectFrom('payments.payments')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('amount_minor'), eb.val('0')).as('n'))
    .where('ref_type', '=', 'folio')
    .where('ref_id', '=', folioId)
    .where((eb) =>
      eb.or([
        eb('status', 'in', ['processing', 'pending_verification']),
        eb.and([eb('status', 'in', [...COLLECTED]), eb('ledger_status', '!=', 'posted')]),
      ]),
    )
    .executeTakeFirstOrThrow();
  return owed - held - Number(unposted.n);
}

/**
 * Under the collection lock (a merchant-initiated card collection): the amount stays inside the fact its purpose rests
 * on. The channel's own virtual card is bounded by its registered amount instead (its agreement's `maxAmount`).
 */
export async function assertWithinFact(
  d: PaymentsDeps,
  tx: TxContext,
  method: MethodRow,
  fact: PurposeFact,
  ref: { type: 'folio' | 'booking'; id: string },
  amount: { amountMinor: number; currency: string },
): Promise<void> {
  if ((method.mandate as { kind?: string } | null)?.kind === 'ota_virtual_card') return;
  const ctx = await referenceContext(d, tx, ref);
  const fmt = (n: number) => formatMoney(money(Math.max(0, n), amount.currency));
  // Re-review #7 (ADR-0015 Amendment 6 rule 1): each obligation is ONE balance on the ledger, drawn down by every
  // method; the limit is what it still owes there, less money taken towards it that the ledger has not posted yet.
  if (fact.purpose === 'deposit') {
    const due = ctx.depositDue?.currency === amount.currency ? ctx.depositDue.amountMinor : 0;
    const received = await d.ledger.depositsReceivedFor(tx, ref.id);
    const inFlight = await unpostedOn(tx, ref);
    const collected = received + inFlight;
    if (amount.amountMinor > due - collected) {
      throw new BusinessRuleError(
        'deposit_not_due',
        `The agreed terms of this booking ask for a deposit of ${fmt(due)}; ${fmt(collected)} is already received by any method or in progress, so at most ${fmt(due - collected)} can be taken from the saved card as a deposit. Collect the rest against the folio when it is owed, or send a payment link.`,
        { dueMinor: due, collectedMinor: collected },
      );
    }
    return;
  }
  const owedNow = await folioOwedNow(d, tx, ref.id, ctx.bookingId);
  if (fact.purpose === 'balance') {
    if (amount.amountMinor > owedNow) {
      throw new BusinessRuleError(
        'balance_not_owed',
        `This folio owes ${fmt(owedNow)} now (after deposits held and payments in progress), so at most that can be taken from the saved card as its balance. A card on file pays what is owed; an advance payment needs a payment link.`,
        { owedMinor: owedNow },
      );
    }
    return;
  }
  // The penalty as it still owes on this folio's ledger: posted − credited ± moved, less every payment on the folio by
  // any method (card, cash, cheque, terminal, link, deposit applied or forfeited) — never the reservations record.
  const stillOwed = ctx.stayId ? await d.ledger.penaltyOwedOn(tx, ref.id, ctx.stayId) : 0;
  const inFlight = await unpostedOn(tx, ref);
  const left = Math.min(stillOwed - inFlight, owedNow);
  if (amount.amountMinor > left) {
    throw new BusinessRuleError(
      'no_show_penalty_exceeded',
      `The penalty for this stay still owes ${fmt(stillOwed)} on the folio (after credits and everything already paid towards it, by any method); ${fmt(inFlight)} more is in progress and the folio owes ${fmt(owedNow)} now, so at most ${fmt(left)} can be taken as the no-show or cancellation fee.`,
      { stillOwedMinor: stillOwed, inFlightMinor: inFlight, owedMinor: owedNow },
    );
  }
}

/** Money taken on this reference that the ledger has not posted yet (in flight, or confirmed and waiting to post). */
async function unpostedOn(tx: TxContext, ref: { type: 'folio' | 'booking'; id: string }): Promise<number> {
  const r = await db(tx)
    .selectFrom('payments.payments')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('amount_minor'), eb.val('0')).as('n'))
    .where('ref_type', '=', ref.type)
    .where('ref_id', '=', ref.id)
    .where((eb) =>
      eb.or([
        eb('status', 'in', ['processing', 'pending_verification']),
        eb.and([eb('status', 'in', [...COLLECTED]), eb('ledger_status', '!=', 'posted')]),
      ]),
    )
    .executeTakeFirstOrThrow();
  return Number(r.n);
}
