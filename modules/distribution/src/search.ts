/**
 * Global search and hover previews (universal record contract): channel connections (name, hub property id) and
 * booking revisions (channel booking id, OTA reservation code). Permission- and property-scope-aware; no guest data.
 */
import { normalizeQuery, type SearchProvider, sql, type TxContext, typed } from '@portico/db';
import type { RecordSummary, SearchHit } from '@portico/kernel';
import { P, RECORD } from './manifest';
import type { DistributionDB } from './tables';

const db = (tx: TxContext) => typed<DistributionDB>(tx.db);
const readable = (tx: TxContext, propertyId: string) => tx.authz.can(P.channelRead, { propertyId });
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const distributionSearch: SearchProvider = {
  types: [RECORD.connection, RECORD.revision],
  async search(tx, query, { limit }): Promise<SearchHit[]> {
    const q = normalizeQuery(query);
    if (q.length < 2) return [];
    const scope = tx.authz.propertyScope(P.channelRead);
    if (scope !== 'all' && scope.length === 0) return [];
    const like = `%${escapeLike(q)}%`;
    const conns = await db(tx)
      .selectFrom('distribution.connections')
      .select(['id', 'name', 'property_id', 'status', 'health', 'external_property_id'])
      .where((eb) => eb.or([eb('name', 'ilike', like), eb('external_property_id', 'ilike', like)]))
      .limit(limit)
      .execute();
    const revs = await db(tx)
      .selectFrom('distribution.revision_processing as p')
      .innerJoin('distribution.inbound_revisions as r', 'r.id', 'p.revision_row_id')
      .select([
        'p.revision_row_id as id',
        'p.property_id',
        'p.channel_booking_id',
        'p.state',
        'r.channel_status',
        sql<string | null>`r.payload->>'otaReservationCode'`.as('code'),
      ])
      .where((eb) =>
        eb.or([
          eb('p.channel_booking_id', 'ilike', like),
          eb(sql`r.payload->>'otaReservationCode'`, 'ilike', like),
        ]),
      )
      .orderBy('r.received_at', 'desc')
      .limit(limit)
      .execute();
    const hits: SearchHit[] = [];
    for (const c of conns) {
      if (!readable(tx, c.property_id)) continue;
      hits.push({
        type: RECORD.connection,
        id: c.id,
        title: c.name,
        subtitle: `Channel hub · ${c.external_property_id}`,
        status: { connection: c.status, health: c.health },
        propertyId: c.property_id,
        score: c.name.toLowerCase().includes(q.toLowerCase()) ? 0.9 : 0.6,
        matched: 'name',
      });
    }
    for (const r of revs) {
      if (!readable(tx, r.property_id)) continue;
      hits.push({
        type: RECORD.revision,
        id: r.id,
        title: `Channel booking ${r.code ?? r.channel_booking_id}`,
        subtitle: `Revision (${r.channel_status})`,
        status: { revision: r.state },
        propertyId: r.property_id,
        score: 0.7,
        matched: r.code?.toLowerCase().includes(q.toLowerCase())
          ? 'OTA reservation code'
          : 'channel booking id',
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  },
  async summarize(tx, type, id): Promise<RecordSummary | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    if (type === RECORD.connection) {
      const c = await db(tx)
        .selectFrom('distribution.connections')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!c || !readable(tx, c.property_id)) return null;
      return {
        type,
        id,
        title: c.name,
        subtitle: `Channel hub · ${c.target}`,
        status: { connection: c.status, health: c.health },
        propertyId: c.property_id,
      };
    }
    if (type === RECORD.revision) {
      const r = await db(tx)
        .selectFrom('distribution.revision_processing as p')
        .innerJoin('distribution.inbound_revisions as r', 'r.id', 'p.revision_row_id')
        .select(['p.property_id', 'p.channel_booking_id', 'p.state', 'p.ack_state', 'r.channel_status'])
        .where('p.revision_row_id', '=', id)
        .executeTakeFirst();
      if (!r || !readable(tx, r.property_id)) return null;
      return {
        type,
        id,
        title: `Channel booking ${r.channel_booking_id}`,
        subtitle: `Revision (${r.channel_status})`,
        status: { revision: r.state, ack: r.ack_state },
        propertyId: r.property_id,
      };
    }
    return null;
  },
};
