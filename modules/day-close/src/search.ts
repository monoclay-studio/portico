import { normalizeQuery, type SearchProvider, type TxContext, typed } from '@portico/db';
import type { RecordSummary, SearchHit } from '@portico/kernel';
import { DAY_CLOSE_PERMISSIONS as P, DAY_CLOSE_RECORD_TYPES as T } from './manifest';
import type { DayCloseDB } from './tables';

const db = (tx: TxContext) => typed<DayCloseDB>(tx.db);
const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const WORDS = /\b(day ?close|night audit|end of day|eod)\b/i;

function scopeFilter(tx: TxContext, permission: string): string[] | 'all' {
  const s = tx.authz.propertyScope(permission);
  return s === 'all' ? 'all' : [...s];
}

/**
 * Global search and hover previews for Day Close runs ("2026-11-07", "day close") and day reports, limited to the
 * properties where the user may read them.
 */
export const dayCloseSearch: SearchProvider = {
  types: [T.run, T.report],
  async search(tx, query, opts): Promise<SearchHit[]> {
    const q = normalizeQuery(query);
    const date = DATE.exec(q)?.[1];
    if (!date && !WORDS.test(q)) return [];
    const scope = scopeFilter(tx, P.runRead);
    if (scope !== 'all' && scope.length === 0) return [];
    let rq = db(tx)
      .selectFrom('day_close.runs')
      .select(['id', 'property_id', 'business_date', 'status'])
      .orderBy('business_date', 'desc')
      .limit(Math.min(opts.limit, 20));
    if (date) rq = rq.where('business_date', '=', date);
    if (scope !== 'all') rq = rq.where('property_id', 'in', scope);
    const rows = await rq.execute();
    return rows.map((r) => ({
      type: T.run,
      id: r.id,
      title: `Day Close ${r.business_date}`,
      subtitle: r.status,
      status: { dayClose: r.status },
      propertyId: r.property_id,
      score: date ? 0.95 : 0.6,
      matched: date ? 'business date' : 'Day Close',
    }));
  },
  async summarize(tx, type, id): Promise<RecordSummary | null> {
    if (type === T.run) {
      const r = await db(tx)
        .selectFrom('day_close.runs')
        .select(['id', 'property_id', 'business_date', 'status', 'current_step'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r || !tx.authz.can(P.runRead, { propertyId: r.property_id })) return null;
      return {
        type,
        id,
        title: `Day Close ${r.business_date}`,
        subtitle: r.current_step ? `${r.status} · ${r.current_step}` : r.status,
        status: { dayClose: r.status },
        propertyId: r.property_id,
      };
    }
    if (type === T.report) {
      const [propertyId, date] = id.split(':');
      if (!propertyId || !date || !tx.authz.can(P.reportRead, { propertyId })) return null;
      const r = await db(tx)
        .selectFrom('day_close.day_reports')
        .select(['business_date'])
        .where('property_id', '=', propertyId)
        .where('business_date', '=', date)
        .executeTakeFirst();
      if (!r) return null;
      return { type, id, title: `Day report ${date}`, propertyId };
    }
    return null;
  },
};
