/** Global search + hover previews for rates records (permission- and property-scope-aware). */
import { normalizeQuery, type SearchProvider, sql, type TxContext, typed } from '@portico/db';
import type { RecordSummary, SearchHit } from '@portico/kernel';
import type { RatesDB } from './tables';

const db = (tx: TxContext) => typed<RatesDB>(tx.db);

function score(q: string, code: string, name: string): { score: number; matched: string } {
  const lq = q.toLowerCase();
  if (code.toLowerCase() === lq) return { score: 1, matched: 'code' };
  if (code.toLowerCase().startsWith(lq)) return { score: 0.85, matched: 'code' };
  if (name.toLowerCase().startsWith(lq)) return { score: 0.7, matched: 'name' };
  return { score: 0.5, matched: name.toLowerCase().includes(lq) ? 'name' : 'code' };
}

type PropertyTable = 'rates.rate_plans' | 'rates.promotions' | 'rates.packages' | 'rates.policies';
const PROPERTY_TYPES: Record<string, { table: PropertyTable; label: string; statusFamily: string }> = {
  rate_plan: { table: 'rates.rate_plans', label: 'Rate plan', statusFamily: 'ratePlan' },
  promotion: { table: 'rates.promotions', label: 'Promotion', statusFamily: 'promotion' },
  package: { table: 'rates.packages', label: 'Package', statusFamily: 'package' },
  rate_policy: { table: 'rates.policies', label: 'Policy', statusFamily: 'policy' },
};

export const ratesSearch: SearchProvider = {
  types: ['rate_plan', 'promotion', 'package', 'rate_policy', 'tax_rule'],
  async search(tx, query, { limit }): Promise<SearchHit[]> {
    const q = normalizeQuery(query);
    if (q.length < 2) return [];
    const hits: SearchHit[] = [];
    const scope = tx.authz.propertyScope('rates.ratePlan.read');
    if (scope === 'all' || scope.length > 0) {
      for (const [type, def] of Object.entries(PROPERTY_TYPES)) {
        let rq = db(tx)
          .selectFrom(def.table)
          .select(['id', 'code', 'name', 'status', 'property_id'])
          .where((eb) => eb.or([eb('code', 'ilike', `${q}%`), eb('name', 'ilike', `%${q}%`)]))
          .limit(limit);
        if (scope !== 'all') rq = rq.where('property_id', 'in', scope as string[]);
        for (const r of await rq.execute()) {
          hits.push({
            type,
            id: r.id,
            title: r.name,
            subtitle: `${def.label} · ${r.code}`,
            status: { [def.statusFamily]: r.status },
            propertyId: r.property_id,
            ...score(q, r.code, r.name),
          });
        }
      }
      // Promo codes live inside promotion conditions.
      let pq = db(tx)
        .selectFrom('rates.promotions')
        .select(['id', 'code', 'name', 'status', 'property_id'])
        .where(sql<boolean>`upper(conditions->>'promoCode') = upper(${q})`)
        .limit(limit);
      if (scope !== 'all') pq = pq.where('property_id', 'in', scope as string[]);
      for (const r of await pq.execute()) {
        if (hits.some((h) => h.id === r.id)) continue;
        hits.push({ type: 'promotion', id: r.id, title: r.name, subtitle: `Promotion · promo code ${q.toUpperCase()}`, status: { promotion: r.status }, propertyId: r.property_id, score: 0.95, matched: 'promo code' });
      }
    }
    if (tx.authz.can('rates.taxRule.read')) {
      const rows = await db(tx)
        .selectFrom('rates.tax_rules')
        .select(['id', 'code', 'name', 'status', 'jurisdiction'])
        .where((eb) => eb.or([eb('code', 'ilike', `${q}%`), eb('name', 'ilike', `%${q}%`)]))
        .limit(limit)
        .execute();
      for (const r of rows)
        hits.push({ type: 'tax_rule', id: r.id, title: r.name, subtitle: `Tax & fee rule · ${r.code} · ${r.jurisdiction}`, status: { taxRule: r.status }, propertyId: null, ...score(q, r.code, r.name) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  },
  async summarize(tx, type, id): Promise<RecordSummary | null> {
    if (type === 'tax_rule') {
      if (!tx.authz.can('rates.taxRule.read')) return null;
      const r = await db(tx).selectFrom('rates.tax_rules').select(['id', 'code', 'name', 'status', 'jurisdiction']).where('id', '=', id).executeTakeFirst();
      return r ? { type, id: r.id, title: r.name, subtitle: `Tax & fee rule · ${r.code} · ${r.jurisdiction}`, status: { taxRule: r.status }, propertyId: null } : null;
    }
    const def = PROPERTY_TYPES[type];
    if (!def) return null;
    const r = await db(tx).selectFrom(def.table).select(['id', 'code', 'name', 'status', 'property_id']).where('id', '=', id).executeTakeFirst();
    if (!r || !tx.authz.can('rates.ratePlan.read', { propertyId: r.property_id })) return null;
    return { type, id: r.id, title: r.name, subtitle: `${def.label} · ${r.code}`, status: { [def.statusFamily]: r.status }, propertyId: r.property_id };
  },
};
