/**
 * Global search + hover previews for payments records. Staff search by what they have in hand: the provider
 * reference, the terminal approval code or terminal id, a bank reference, or "last 4 + amount" from a receipt
 * ("4242 840.00"). Permission- and property-scope-aware. Never returns or matches tokens or card data.
 */
import { normalizeQuery, type SearchProvider, type TxContext, typed } from '@portico/db';
import { formatMoney, money as kernelMoney, type RecordSummary, type SearchHit } from '@portico/kernel';
import { presentAuthorization, presentPayment, presentRefund, presentRequest } from './domain/presentation';
import type { PaymentsDB } from './tables';

const db = (tx: TxContext) => typed<PaymentsDB>(tx.db);

function scope(tx: TxContext): readonly string[] | 'all' {
  const a = tx.authz.propertyScope('payments.payment.read');
  const b = tx.authz.propertyScope('payments.payment.collect');
  if (a === 'all' || b === 'all') return 'all';
  return [...new Set([...a, ...b])];
}

function money(amountMinor: number, currency: string): string {
  return formatMoney(kernelMoney(amountMinor, currency));
}

/** Candidate minor-unit values for a typed major amount (exponent 0, 2 or 3). */
function amountCandidates(text: string): number[] {
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(text);
  if (!m) return [];
  const whole = Number(m[1]);
  const frac = m[2] ?? '';
  const out = new Set<number>();
  for (const exp of [0, 2, 3]) {
    if (frac.length > exp) continue;
    out.add(whole * 10 ** exp + Number(frac.padEnd(exp, '0') || '0'));
  }
  return [...out];
}

type PaymentHitRow = {
  id: string;
  property_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  mode: string;
  method: string;
  card_brand: string | null;
  card_last4: string | null;
  external_reference: string | null;
  provider_ref: string | null;
};

function paymentSummary(r: PaymentHitRow): RecordSummary {
  const card = r.card_last4 ? ` · ${r.card_brand ?? 'card'} •••• ${r.card_last4}` : '';
  const pres = presentPayment(r.status as never, r.mode as never, r.method);
  return {
    type: 'payment',
    id: r.id,
    title: `Payment ${money(r.amount_minor, r.currency)}${card}`,
    subtitle: `${pres.label} · ${r.method.replace(/_/g, ' ')}${r.external_reference ? ` · ref ${r.external_reference}` : ''}`,
    status: { payment: r.status },
    propertyId: r.property_id,
  };
}

export const paymentsSearch: SearchProvider = {
  types: ['payment', 'authorization', 'refund', 'payment_request'],
  async search(tx, query, { limit }): Promise<SearchHit[]> {
    const q = normalizeQuery(query);
    if (q.length < 3) return [];
    const s = scope(tx);
    if (s !== 'all' && s.length === 0) return [];
    const hits: SearchHit[] = [];

    // "4242 840.00" or "4242" → card last 4 (+ amount).
    const last4Amount = /^(\d{4})(?:\s+(\d{1,9}(?:\.\d{1,3})?))?$/.exec(q);
    let pq = db(tx)
      .selectFrom('payments.payments')
      .select([
        'id',
        'property_id',
        'amount_minor',
        'currency',
        'status',
        'mode',
        'method',
        'card_brand',
        'card_last4',
        'external_reference',
        'provider_ref',
      ])
      .orderBy('created_at', 'desc')
      .limit(limit);
    if (s !== 'all') pq = pq.where('property_id', 'in', s as string[]);
    let matched: string;
    if (last4Amount) {
      const amounts = last4Amount[2] ? amountCandidates(last4Amount[2]) : [];
      pq = pq.where('card_last4', '=', last4Amount[1] as string);
      if (amounts.length) pq = pq.where('amount_minor', 'in', amounts);
      matched = amounts.length ? 'card last 4 + amount' : 'card last 4';
    } else {
      pq = pq.where((eb) =>
        eb.or([
          eb('provider_ref', '=', q),
          eb('external_reference', 'ilike', `${q}%`),
          eb('terminal_id', '=', q),
        ]),
      );
      matched = 'reference';
    }
    for (const r of await pq.execute()) {
      hits.push({ ...paymentSummary(r), score: last4Amount?.[2] ? 0.95 : 0.8, matched });
    }
    if (last4Amount) return hits.slice(0, limit);

    let aq = db(tx)
      .selectFrom('payments.authorizations')
      .select(['id', 'property_id', 'amount_minor', 'currency', 'status', 'mode', 'external_reference'])
      .where((eb) => eb.or([eb('provider_ref', '=', q), eb('external_reference', 'ilike', `${q}%`)]))
      .limit(limit);
    if (s !== 'all') aq = aq.where('property_id', 'in', s as string[]);
    for (const a of await aq.execute()) {
      hits.push({
        type: 'authorization',
        id: a.id,
        title: `Hold ${money(a.amount_minor, a.currency)}`,
        subtitle: presentAuthorization(a.status, a.mode).label,
        status: { authorization: a.status },
        propertyId: a.property_id,
        score: 0.8,
        matched: 'reference',
      });
    }
    let rq = db(tx)
      .selectFrom('payments.refunds')
      .select(['id', 'property_id', 'amount_minor', 'currency', 'status', 'mode'])
      .where((eb) => eb.or([eb('provider_ref', '=', q), eb('external_reference', 'ilike', `${q}%`)]))
      .limit(limit);
    if (s !== 'all') rq = rq.where('property_id', 'in', s as string[]);
    for (const r of await rq.execute()) {
      hits.push({
        type: 'refund',
        id: r.id,
        title: `Refund ${money(r.amount_minor, r.currency)}`,
        subtitle: presentRefund(r.status, r.mode).label,
        status: { refund: r.status },
        propertyId: r.property_id,
        score: 0.8,
        matched: 'reference',
      });
    }
    let lq = db(tx)
      .selectFrom('payments.payment_requests')
      .select(['id', 'property_id', 'amount_minor', 'currency', 'status', 'paid_minor', 'purpose'])
      .where('provider_link_ref', '=', q)
      .limit(limit);
    if (s !== 'all') lq = lq.where('property_id', 'in', s as string[]);
    for (const r of await lq.execute()) {
      hits.push({
        type: 'payment_request',
        id: r.id,
        title: `Payment request ${money(r.amount_minor, r.currency)} (${r.purpose})`,
        subtitle: presentRequest(r.status, r.paid_minor).label,
        status: { paymentRequest: r.status },
        propertyId: r.property_id,
        score: 0.8,
        matched: 'link reference',
      });
    }
    return hits.slice(0, limit);
  },

  async summarize(tx, type, id): Promise<RecordSummary | null> {
    const s = scope(tx);
    const visible = (propertyId: string) => s === 'all' || s.includes(propertyId);
    if (type === 'payment') {
      const r = await db(tx)
        .selectFrom('payments.payments')
        .select([
          'id',
          'property_id',
          'amount_minor',
          'currency',
          'status',
          'mode',
          'method',
          'card_brand',
          'card_last4',
          'external_reference',
          'provider_ref',
        ])
        .where('id', '=', id)
        .executeTakeFirst();
      return r && visible(r.property_id) ? paymentSummary(r) : null;
    }
    if (type === 'authorization') {
      const a = await db(tx)
        .selectFrom('payments.authorizations')
        .select(['id', 'property_id', 'amount_minor', 'currency', 'status', 'mode'])
        .where('id', '=', id)
        .executeTakeFirst();
      return a && visible(a.property_id)
        ? {
            type,
            id,
            title: `Hold ${money(a.amount_minor, a.currency)}`,
            subtitle: presentAuthorization(a.status, a.mode).label,
            status: { authorization: a.status },
            propertyId: a.property_id,
          }
        : null;
    }
    if (type === 'refund') {
      const r = await db(tx)
        .selectFrom('payments.refunds')
        .select(['id', 'property_id', 'amount_minor', 'currency', 'status', 'mode'])
        .where('id', '=', id)
        .executeTakeFirst();
      return r && visible(r.property_id)
        ? {
            type,
            id,
            title: `Refund ${money(r.amount_minor, r.currency)}`,
            subtitle: presentRefund(r.status, r.mode).label,
            status: { refund: r.status },
            propertyId: r.property_id,
          }
        : null;
    }
    if (type === 'payment_request') {
      const r = await db(tx)
        .selectFrom('payments.payment_requests')
        .select(['id', 'property_id', 'amount_minor', 'currency', 'status', 'paid_minor', 'purpose'])
        .where('id', '=', id)
        .executeTakeFirst();
      return r && visible(r.property_id)
        ? {
            type,
            id,
            title: `Payment request ${money(r.amount_minor, r.currency)} (${r.purpose})`,
            subtitle: presentRequest(r.status, r.paid_minor).label,
            status: { paymentRequest: r.status },
            propertyId: r.property_id,
          }
        : null;
    }
    return null;
  },
};
