import { normalizeQuery, type SearchProvider, sql, type TxContext, typed } from '@portico/db';
import type { RecordSummary, SearchHit } from '@portico/kernel';
import type { FinanceDB } from './tables';

const db = (tx: TxContext) => typed<FinanceDB>(tx.db);

const scopeOf = (tx: TxContext, permission: string): readonly string[] | 'all' =>
  tx.authz.propertyScope(permission);

/**
 * Global search + hover previews for finance records: folios (by payer or label), fiscal documents (by number)
 * and receivables accounts (by company name). Permission- and property-scope-aware.
 */
export const financeSearch: SearchProvider = {
  types: ['folio', 'fiscal_document', 'receivables_account', 'cashier_session'],
  async search(tx, query, { limit }): Promise<SearchHit[]> {
    const q = normalizeQuery(query);
    if (q.length < 2) return [];
    const hits: SearchHit[] = [];
    const folioScope = scopeOf(tx, 'finance.folio.read');
    if (folioScope === 'all' || folioScope.length > 0) {
      let fq = db(tx)
        .selectFrom('finance.folios')
        .select([
          'id',
          'payer_name',
          'label',
          'status',
          'property_id',
          'owner_type',
          sql<number>`similarity(payer_name, ${q})`.as('score'),
        ])
        .where((eb) =>
          eb.or([
            eb('payer_name', 'ilike', `%${q}%`),
            eb('label', 'ilike', `%${q}%`),
            sql<boolean>`similarity(payer_name, ${q}) > 0.3`,
          ]),
        )
        .where('status', '<>', 'voided')
        .orderBy('score', 'desc')
        .limit(limit);
      if (folioScope !== 'all') fq = fq.where('property_id', 'in', folioScope as string[]);
      for (const r of await fq.execute()) {
        hits.push({
          type: 'folio',
          id: r.id,
          title: r.label ? `${r.payer_name} — ${r.label}` : r.payer_name,
          subtitle: `Folio · ${r.owner_type}`,
          status: { folio: r.status },
          propertyId: r.property_id,
          score: Math.min(1, Math.max(0.3, Number(r.score))),
          matched: 'payer',
        });
      }
      let dq = db(tx)
        .selectFrom('finance.fiscal_documents')
        .select(['id', 'document_number', 'kind', 'property_id', 'business_date', 'total_minor', 'currency'])
        .where('document_number', 'ilike', `%${q}%`)
        .orderBy('chain_position', 'desc')
        .limit(limit);
      if (folioScope !== 'all') dq = dq.where('property_id', 'in', folioScope as string[]);
      for (const r of await dq.execute()) {
        hits.push({
          type: 'fiscal_document',
          id: r.id,
          title: r.document_number,
          subtitle: `${r.kind === 'invoice' ? 'Invoice' : 'Credit note'} · ${r.business_date} · ${Number(r.total_minor)} ${r.currency}`,
          propertyId: r.property_id,
          score: r.document_number.toLowerCase() === q.toLowerCase() ? 1 : 0.8,
          matched: 'document number',
        });
      }
    }
    if (tx.authz.can('finance.receivables.read')) {
      const rows = await db(tx)
        .selectFrom('finance.receivables_accounts')
        .select(['id', 'name', 'kind', 'status', sql<number>`similarity(name, ${q})`.as('score')])
        .where((eb) => eb.or([eb('name', 'ilike', `%${q}%`), sql<boolean>`similarity(name, ${q}) > 0.3`]))
        .orderBy('score', 'desc')
        .limit(limit)
        .execute();
      for (const r of rows) {
        hits.push({
          type: 'receivables_account',
          id: r.id,
          title: r.name,
          subtitle: `Receivables account · ${r.kind}`,
          status: { account: r.status },
          propertyId: null,
          score: Math.min(1, Math.max(0.3, Number(r.score))),
          matched: 'name',
        });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  },
  async summarize(tx, type, id): Promise<RecordSummary | null> {
    if (type === 'folio') {
      const r = await db(tx).selectFrom('finance.folios').selectAll().where('id', '=', id).executeTakeFirst();
      if (!r || !tx.authz.can('finance.folio.read', { propertyId: r.property_id })) return null;
      const b = await db(tx)
        .selectFrom('finance.postings')
        .select(sql<number>`coalesce(sum(amount_minor),0)::bigint`.as('b'))
        .where('folio_id', '=', id)
        .executeTakeFirstOrThrow();
      return {
        type,
        id,
        title: r.label ? `${r.payer_name} — ${r.label}` : r.payer_name,
        subtitle: `Balance ${Number(b.b)} ${r.currency} (minor units)`,
        status: { folio: r.status },
        propertyId: r.property_id,
      };
    }
    if (type === 'fiscal_document') {
      const r = await db(tx)
        .selectFrom('finance.fiscal_documents')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r || !tx.authz.can('finance.folio.read', { propertyId: r.property_id })) return null;
      return {
        type,
        id,
        title: r.document_number,
        subtitle: `${r.kind === 'invoice' ? 'Invoice' : 'Credit note'} · ${r.business_date} · ${Number(r.total_minor)} ${r.currency}`,
        propertyId: r.property_id,
      };
    }
    if (type === 'receivables_account') {
      if (!tx.authz.can('finance.receivables.read')) return null;
      const r = await db(tx)
        .selectFrom('finance.receivables_accounts')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return r
        ? {
            type,
            id,
            title: r.name,
            subtitle: `Receivables account · ${r.kind} · ${r.currency}`,
            status: { account: r.status },
            propertyId: null,
          }
        : null;
    }
    if (type === 'cashier_session') {
      const r = await db(tx)
        .selectFrom('finance.cashier_sessions')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r || !tx.authz.can('finance.cashier.review', { propertyId: r.property_id })) return null;
      return {
        type,
        id,
        title: `Cashier session — ${r.cashier_name}`,
        subtitle: `Opened ${r.opened_business_date}`,
        status: { session: r.status },
        propertyId: r.property_id,
      };
    }
    return null;
  },
};
