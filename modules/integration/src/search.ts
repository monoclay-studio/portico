/**
 * Global search and hover previews for connections and integration exceptions (universal record contract).
 * Permission- and property-scope-aware: a record is returned only when the user may read its connection.
 */
import { normalizeQuery, type SearchProvider, sql, type TxContext, typed } from '@portico/db';
import type { RecordSummary, SearchHit } from '@portico/kernel';
import { P } from './manifest';
import type { IntegrationDB } from './tables';

const db = (tx: TxContext) => typed<IntegrationDB>(tx.db);

function readable(tx: TxContext, propertyIds: string[]): boolean {
  if (propertyIds.length === 0) return tx.authz.propertyScope(P.connectionRead) === 'all';
  return propertyIds.some((p) => tx.authz.can(P.connectionRead, { propertyId: p }));
}

export const integrationSearch: SearchProvider = {
  types: ['integration_connection', 'integration_exception'],
  async search(tx, query, { limit }): Promise<SearchHit[]> {
    const q = normalizeQuery(query);
    if (q.length < 2) return [];
    const scope = tx.authz.propertyScope(P.connectionRead);
    if (scope !== 'all' && scope.length === 0) return [];
    const connections = await db(tx)
      .selectFrom('integration.connections')
      .select([
        'id',
        'name',
        'connector_key',
        'state',
        'health_status',
        'property_ids',
        sql<number>`similarity(name, ${q})`.as('score'),
      ])
      .where((eb) =>
        eb.or([
          eb('name', 'ilike', `%${q}%`),
          eb('connector_key', 'ilike', `%${q}%`),
          sql<boolean>`similarity(name, ${q}) > 0.3`,
        ]),
      )
      .orderBy('score', 'desc')
      .limit(limit)
      .execute();
    const exceptions = await db(tx)
      .selectFrom('integration.exceptions as e')
      .innerJoin('integration.connections as c', 'c.id', 'e.connection_id')
      .select([
        'e.id',
        'e.problem',
        'e.severity',
        'e.status',
        'e.property_id',
        'c.name',
        'c.property_ids',
        sql<number>`similarity(e.problem, ${q})`.as('score'),
      ])
      .where('e.status', 'in', ['open', 'acknowledged'])
      .where((eb) =>
        eb.or([eb('e.problem', 'ilike', `%${q}%`), sql<boolean>`similarity(e.problem, ${q}) > 0.2`]),
      )
      .orderBy('score', 'desc')
      .limit(limit)
      .execute();
    const hits: SearchHit[] = [];
    for (const c of connections) {
      if (!readable(tx, c.property_ids)) continue;
      hits.push({
        type: 'integration_connection',
        id: c.id,
        title: c.name,
        subtitle: `Connection · ${c.connector_key}`,
        status: { setup: c.state, health: c.health_status },
        propertyId: c.property_ids.length === 1 ? (c.property_ids[0] ?? null) : null,
        score: Math.min(1, Math.max(0.3, Number(c.score))),
        matched: 'name',
      });
    }
    for (const e of exceptions) {
      if (!readable(tx, e.property_ids)) continue;
      hits.push({
        type: 'integration_exception',
        id: e.id,
        title: e.problem,
        subtitle: `Integration exception · ${e.name}`,
        status: { exception: e.status, severity: e.severity },
        propertyId: e.property_id,
        score: Math.min(1, Math.max(0.2, Number(e.score))),
        matched: 'problem',
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  },
  async summarize(tx, type, id): Promise<RecordSummary | null> {
    if (type === 'integration_connection') {
      const c = await db(tx)
        .selectFrom('integration.connections')
        .select(['id', 'name', 'connector_key', 'state', 'health_status', 'property_ids'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!c || !readable(tx, c.property_ids)) return null;
      return {
        type,
        id,
        title: c.name,
        subtitle: `Connection · ${c.connector_key}`,
        status: { setup: c.state, health: c.health_status },
        propertyId: c.property_ids.length === 1 ? (c.property_ids[0] ?? null) : null,
      };
    }
    if (type === 'integration_exception') {
      const e = await db(tx)
        .selectFrom('integration.exceptions as e')
        .innerJoin('integration.connections as c', 'c.id', 'e.connection_id')
        .select(['e.id', 'e.problem', 'e.severity', 'e.status', 'e.property_id', 'c.name', 'c.property_ids'])
        .where('e.id', '=', id)
        .executeTakeFirst();
      if (!e || !readable(tx, e.property_ids)) return null;
      return {
        type,
        id,
        title: e.problem,
        subtitle: `Integration exception · ${e.name}`,
        status: { exception: e.status, severity: e.severity },
        propertyId: e.property_id,
      };
    }
    return null;
  },
};
