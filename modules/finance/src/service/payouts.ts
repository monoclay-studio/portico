import { sql, type TxContext } from '@portico/db';
import { BusinessRuleError, Decimal, type LocalDate, type Money, requirePermission, ValidationError } from '@portico/kernel';
import { clearingKeyForMethod } from '../domain/chart';
import type { LineDraft } from '../domain/ledger';
import { accountId, claimEntry, type Deps, db, findEntryByKey, functionalCurrencyOf, requestHash, writeEntryBody } from './support';

export interface RecordPayoutInput {
  legalEntityId: string;
  payoutRef: { type: string; id: string };
  gross: Money;
  fees: Money;
  net: Money;
  currency: string;
  idempotencyKey: string;
  /** Payment provider whose clearing account the payout settles (default: generic card clearing). */
  provider?: string;
  /** Business date of the payout's arrival; defaults to the UTC date of the transaction. */
  businessDate?: LocalDate;
  /** 'bank' when the funds arrived; 'in_transit' to hold them in payout clearing until bank reconciliation. */
  destination?: 'bank' | 'in_transit';
}

/**
 * Record a provider payout (provider contract): moves settled funds from card clearing to the bank, with the
 * provider's fees as an expense. A payout is never revenue — no revenue account is touched.
 */
export async function recordPayout(tx: TxContext, deps: Deps, input: RecordPayoutInput): Promise<{ entryId: string; replayed: boolean }> {
  requirePermission(tx, 'finance.ledger.manage');
  for (const m of [input.gross, input.fees, input.net]) {
    if (m.currency !== input.currency) throw new ValidationError('payout_currency_mismatch', 'Gross, fees and net must all be in the payout currency.');
    if (m.amountMinor < 0) throw new ValidationError('invalid_amount', 'Payout amounts cannot be negative.');
  }
  if (input.gross.amountMinor !== input.net.amountMinor + input.fees.amountMinor) {
    throw new ValidationError('payout_does_not_add_up', `Gross (${input.gross.amountMinor}) must equal net (${input.net.amountMinor}) plus fees (${input.fees.amountMinor}).`);
  }
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'payout', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) return { entryId: prior, replayed: true };
  await deps.ports.platform.getLegalEntity(tx, input.legalEntityId);
  const businessDate = input.businessDate ?? tx.now.toISOString().slice(0, 10);
  const claim = await claimEntry(tx, {
    legalEntityId: input.legalEntityId,
    propertyId: null,
    entryType: 'payout',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    source: input.payoutRef,
    description: `Payout ${input.payoutRef.id}${input.provider ? ` (${input.provider})` : ''}`,
  });
  if (!claim.claimed) return { entryId: claim.entryId, replayed: true };
  const lines: LineDraft[] = [
    { accountKey: input.destination === 'in_transit' ? 'payout_clearing' : 'bank', amountMinor: input.net.amountMinor, currency: input.currency, memo: `payout ${input.payoutRef.id}` },
    { accountKey: clearingKeyForMethod('card', input.provider ?? null), amountMinor: -input.gross.amountMinor, currency: input.currency, memo: `payout ${input.payoutRef.id}` },
  ];
  if (input.fees.amountMinor > 0) lines.push({ accountKey: 'payment_fees', amountMinor: input.fees.amountMinor, currency: input.currency, memo: 'provider fees' });
  await writeEntryBody(tx, deps, claim.entryId, { legalEntityId: input.legalEntityId, propertyId: null, businessDate, description: 'Payout' }, [], lines);
  await tx.audit({ action: 'finance.payout.record', target: { type: input.payoutRef.type, id: input.payoutRef.id }, after: rest });
  await tx.emit({
    type: 'finance.payout.recorded',
    aggregate: { type: 'journal_entry', id: claim.entryId },
    payload: { entryId: claim.entryId, payoutRef: input.payoutRef, gross: input.gross, fees: input.fees, net: input.net },
  });
  return { entryId: claim.entryId, replayed: false };
}

/**
 * Settle a foreign-currency balance (e.g. MVR cash or MVR card clearing) into the functional currency at the
 * amount actually received. The difference between the carried (booked) functional value and the settled value
 * is a realized FX gain or loss (FIN-R41).
 */
export async function recordFxSettlement(
  tx: TxContext,
  deps: Deps,
  input: {
    legalEntityId: string;
    fromAccountKey: string;
    amount: Money;
    settled: Money;
    toAccountKey?: string;
    reference: string;
    businessDate?: LocalDate;
    idempotencyKey: string;
  },
): Promise<{ entryId: string; gainLossMinor: number; replayed: boolean }> {
  requirePermission(tx, 'finance.fx.manage');
  const { idempotencyKey, ...rest } = input;
  const hash = requestHash({ op: 'fx-settlement', ...rest });
  const prior = await findEntryByKey(tx, idempotencyKey, hash);
  if (prior) {
    const gl = await db(tx).selectFrom('finance.journal_lines as l').innerJoin('finance.accounts as a', 'a.id', 'l.account_id').select('l.functional_amount_minor').where('l.entry_id', '=', prior).where('a.system_key', '=', 'fx_gain_loss').executeTakeFirst();
    return { entryId: prior, gainLossMinor: Number(gl?.functional_amount_minor ?? 0), replayed: true };
  }
  const functional = await functionalCurrencyOf(tx, deps, input.legalEntityId);
  if (input.settled.currency !== functional) throw new ValidationError('settlement_currency', `Settled amounts are in the functional currency (${functional}).`);
  if (input.amount.currency === functional) throw new ValidationError('settlement_currency', 'Only foreign-currency balances need an FX settlement.');
  if (input.amount.amountMinor <= 0 || input.settled.amountMinor <= 0) throw new ValidationError('invalid_amount', 'Amounts must be positive.');
  const fromId = await accountId(tx, deps, input.legalEntityId, input.fromAccountKey);
  const bal = await db(tx)
    .selectFrom('finance.journal_lines')
    .select([sql<number>`coalesce(sum(amount_minor), 0)::bigint`.as('txn'), sql<number>`coalesce(sum(functional_amount_minor), 0)::bigint`.as('func')])
    .where('account_id', '=', fromId)
    .where('currency', '=', input.amount.currency)
    .executeTakeFirstOrThrow();
  const txn = Number(bal.txn);
  if (txn < input.amount.amountMinor) {
    throw new BusinessRuleError('insufficient_balance', `Only ${txn} ${input.amount.currency} (minor units) is held on this account.`);
  }
  const carried = new Decimal(Number(bal.func)).mul(input.amount.amountMinor).div(txn).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const gainLoss = input.settled.amountMinor - carried; // positive = gain
  const businessDate = input.businessDate ?? tx.now.toISOString().slice(0, 10);
  const claim = await claimEntry(tx, {
    legalEntityId: input.legalEntityId,
    propertyId: null,
    entryType: 'fx_settlement',
    businessDate,
    idempotencyKey,
    requestHash: hash,
    description: `FX settlement ${input.amount.currency}→${functional}: ${input.reference}`,
  });
  if (!claim.claimed) return { entryId: claim.entryId, gainLossMinor: gainLoss, replayed: true };
  const lines: LineDraft[] = [
    { accountKey: input.fromAccountKey, amountMinor: -input.amount.amountMinor, currency: input.amount.currency, functionalAmountMinor: -carried },
    { accountKey: 'fx_position', amountMinor: input.amount.amountMinor, currency: input.amount.currency, functionalAmountMinor: input.settled.amountMinor },
    { accountKey: 'fx_position', amountMinor: -input.settled.amountMinor, currency: functional, functionalAmountMinor: -input.settled.amountMinor },
    { accountKey: input.toAccountKey ?? 'bank', amountMinor: input.settled.amountMinor, currency: functional, functionalAmountMinor: input.settled.amountMinor },
  ];
  if (gainLoss !== 0) {
    // Functional-only line: no transaction-currency amount, realized difference in the functional currency.
    lines.push({ accountKey: 'fx_gain_loss', amountMinor: 0, currency: functional, functionalAmountMinor: -gainLoss, memo: gainLoss > 0 ? 'realized FX gain' : 'realized FX loss' });
  }
  await writeEntryBody(tx, deps, claim.entryId, { legalEntityId: input.legalEntityId, propertyId: null, businessDate, description: 'FX settlement' }, [], lines);
  await tx.audit({ action: 'finance.fx.settle', target: { type: 'journal_entry', id: claim.entryId }, after: { ...rest, carried, gainLoss } });
  return { entryId: claim.entryId, gainLossMinor: gainLoss, replayed: false };
}
