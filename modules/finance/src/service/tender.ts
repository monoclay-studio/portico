import type { TxContext } from '@portico/db';
import { BusinessRuleError, convert, type LocalDate, type Money, money, newId } from '@portico/kernel';
import { clearingKeyForMethod } from '../domain/chart';
import type { SubLedgerType } from '../domain/ledger';
import type { PaymentMethodKind } from '../domain/types';
import { actorKey, type Deps, db, functionalCurrencyOf, type LineSpec, rateBetween } from './support';

export interface Side {
  accountKey: string;
  subLedger?: { type: SubLedgerType; id: string } | null;
  postingIndex?: number;
}

/**
 * Lines moving value from a debit side in currency X to a credit side in currency F. Same currency: two lines.
 * Different currencies: an explicit conversion through the currency-position account, so every currency and the
 * functional currency balance on their own (FIN-R41). Returns the credited amount in F and the rate used.
 */
export async function bridgeLines(
  tx: TxContext,
  deps: Deps,
  legalEntityId: string,
  businessDate: LocalDate,
  debit: Side & { amount: Money },
  credit: Side & { currency: string },
): Promise<{ lines: LineSpec[]; creditAmount: Money; fxRateId: string | null }> {
  const a = debit.amount;
  if (a.currency === credit.currency) {
    return {
      lines: [
        {
          accountKey: debit.accountKey,
          amountMinor: a.amountMinor,
          currency: a.currency,
          subLedger: debit.subLedger ?? null,
          ...(debit.postingIndex !== undefined ? { postingIndex: debit.postingIndex } : {}),
        },
        {
          accountKey: credit.accountKey,
          amountMinor: -a.amountMinor,
          currency: a.currency,
          subLedger: credit.subLedger ?? null,
          ...(credit.postingIndex !== undefined ? { postingIndex: credit.postingIndex } : {}),
        },
      ],
      creditAmount: a,
      fxRateId: null,
    };
  }
  const functional = await functionalCurrencyOf(tx, deps, legalEntityId);
  const cross = await rateBetween(tx, legalEntityId, a.currency, credit.currency, businessDate);
  const f = convert(a, credit.currency, cross.rate);
  const toFunctional = async (m: Money): Promise<number> => {
    if (m.currency === functional) return m.amountMinor;
    const r = await rateBetween(tx, legalEntityId, m.currency, functional, businessDate);
    return convert(m, functional, r.rate).amountMinor;
  };
  const f1 = await toFunctional(a);
  const f2 = await toFunctional(f);
  return {
    lines: [
      {
        accountKey: debit.accountKey,
        amountMinor: a.amountMinor,
        currency: a.currency,
        functionalAmountMinor: f1,
        fxRateId: cross.rateId,
        subLedger: debit.subLedger ?? null,
        ...(debit.postingIndex !== undefined ? { postingIndex: debit.postingIndex } : {}),
      },
      {
        accountKey: 'fx_position',
        amountMinor: -a.amountMinor,
        currency: a.currency,
        functionalAmountMinor: -f1,
        fxRateId: cross.rateId,
        memo: `conversion ${a.currency}→${credit.currency}`,
      },
      {
        accountKey: 'fx_position',
        amountMinor: f.amountMinor,
        currency: f.currency,
        functionalAmountMinor: f2,
        fxRateId: cross.rateId,
        memo: `conversion ${a.currency}→${credit.currency}`,
      },
      {
        accountKey: credit.accountKey,
        amountMinor: -f.amountMinor,
        currency: f.currency,
        functionalAmountMinor: -f2,
        fxRateId: cross.rateId,
        subLedger: credit.subLedger ?? null,
        ...(credit.postingIndex !== undefined ? { postingIndex: credit.postingIndex } : {}),
      },
    ],
    creditAmount: money(f.amountMinor, f.currency),
    fxRateId: cross.rateId,
  };
}

/** Encodes method + provider for storage ('card:stripe'). */
export function encodeMethod(method: PaymentMethodKind, provider?: string | null): string {
  return provider ? `${method}:${provider}` : method;
}

export function decodeMethod(s: string | null): { method: PaymentMethodKind; provider: string | null } {
  const [m, p] = (s ?? 'other').split(':');
  return { method: (m ?? 'other') as PaymentMethodKind, provider: p ?? null };
}

export function clearingSide(
  method: PaymentMethodKind,
  provider: string | null,
  sessionId: string | null,
): Side {
  const accountKey = clearingKeyForMethod(method, provider);
  return accountKey === 'cash' && sessionId
    ? { accountKey, subLedger: { type: 'cashier_session', id: sessionId } }
    : { accountKey };
}

/** The actor's open cashier session at a property (required for cash, attached for other methods). */
export async function openSessionFor(
  tx: TxContext,
  propertyId: string,
  method: PaymentMethodKind,
  explicitSessionId?: string,
  opts: { cashRequiresSession?: boolean } = {},
): Promise<string | null> {
  if (explicitSessionId) {
    const s = await db(tx)
      .selectFrom('finance.cashier_sessions')
      .select(['id', 'status', 'property_id'])
      .where('id', '=', explicitSessionId)
      .executeTakeFirst();
    if (s?.status !== 'open' || s.property_id !== propertyId) {
      throw new BusinessRuleError(
        'cashier_session_not_open',
        'The cashier session is not open at this property. Open a cashier session before handling cash.',
      );
    }
    return s.id;
  }
  const s = await db(tx)
    .selectFrom('finance.cashier_sessions')
    .select('id')
    .where('property_id', '=', propertyId)
    .where('user_key', '=', actorKey(tx))
    .where('status', '=', 'open')
    .executeTakeFirst();
  if (!s && method === 'cash' && opts.cashRequiresSession !== false) {
    throw new BusinessRuleError(
      'cashier_session_required',
      'Cash can only be taken or paid out in an open cashier session. Open your cashier session (with your opening float) and try again.',
    );
  }
  return s?.id ?? null;
}

export async function recordCashMovement(
  tx: TxContext,
  input: {
    sessionId: string;
    kind: 'payment' | 'refund' | 'paid_out' | 'variance';
    amount: Money;
    entryId: string;
    postingId?: string | null;
    reference?: string | null;
  },
): Promise<void> {
  await db(tx)
    .insertInto('finance.cash_movements')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      session_id: input.sessionId,
      kind: input.kind,
      amount_minor: input.amount.amountMinor,
      currency: input.amount.currency,
      entry_id: input.entryId,
      posting_id: input.postingId ?? null,
      reference: input.reference ?? null,
    })
    .execute();
}
