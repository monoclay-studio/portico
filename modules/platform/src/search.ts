import { normalizeQuery, type SearchProvider, sql, type TxContext, typed } from '@portico/db';
import type { RecordSummary, SearchHit } from '@portico/kernel';
import type { PlatformDB } from './tables';

const db = (tx: TxContext) => typed<PlatformDB>(tx.db);

/** Global search + hover previews for properties (reference implementation for other modules). */
export const platformSearch: SearchProvider = {
  types: ['property'],
  async search(tx, query, { limit }): Promise<SearchHit[]> {
    const q = normalizeQuery(query);
    if (q.length < 2) return [];
    const scope = tx.authz.propertyScope('platform.property.read');
    if (scope !== 'all' && scope.length === 0) return [];
    let rq = db(tx)
      .selectFrom('platform.properties')
      .select([
        'id',
        'code',
        'name',
        'profile',
        'status',
        sql<number>`greatest(similarity(name, ${q}), similarity(code, ${q}))`.as('score'),
      ])
      .where((eb) =>
        eb.or([
          eb('name', 'ilike', `%${q}%`),
          eb('code', 'ilike', `${q}%`),
          sql<boolean>`similarity(name, ${q}) > 0.3`,
        ]),
      )
      .orderBy('score', 'desc')
      .limit(limit);
    if (scope !== 'all') rq = rq.where('id', 'in', scope as string[]);
    const rows = await rq.execute();
    return rows.map((r) => ({
      type: 'property',
      id: r.id,
      title: r.name,
      subtitle: `${r.code} · ${r.profile.replace('_', ' ')}`,
      status: { property: r.status },
      propertyId: r.id,
      score: Math.min(1, Math.max(0.3, Number(r.score))),
      matched: r.code.toLowerCase().startsWith(q.toLowerCase()) ? 'code' : 'name',
    }));
  },
  async summarize(tx, type, id): Promise<RecordSummary | null> {
    if (type !== 'property' || !tx.authz.can('platform.property.read', { propertyId: id })) return null;
    const r = await db(tx)
      .selectFrom('platform.properties')
      .select(['id', 'code', 'name', 'profile', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r
      ? {
          type,
          id: r.id,
          title: r.name,
          subtitle: `${r.code} · ${r.profile.replace('_', ' ')}`,
          status: { property: r.status },
          propertyId: r.id,
        }
      : null;
  },
};
