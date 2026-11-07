import { normalizeQuery, type SearchProvider, sql, type TxContext } from '@portico/db';
import type { RecordSummary, SearchHit } from '@portico/kernel';
import { RESERVATIONS_PERMISSIONS as P } from './manifest';
import { type Deps, db, isModuleUnavailable } from './service/context';

/**
 * Global search + hover previews for bookings and stays (universal record contract). Matches: confirmation code
 * (prefix), channel booking id / voucher (external refs), booker and occupant names (trigram similarity), and unit
 * number (unit names from inventory → the stay currently or next assigned to it). Permission and property scope
 * are enforced here (reservations.booking.read).
 */
export function reservationsSearch(deps: Deps): SearchProvider {
  const scopeOf = (tx: TxContext) => tx.authz.propertyScope(P.bookingRead);

  async function bookingHits(
    tx: TxContext,
    q: string,
    limit: number,
    scope: readonly string[] | 'all',
  ): Promise<SearchHit[]> {
    const code = q.replace(/[\s-]/g, '').toUpperCase();
    let rq = db(tx)
      .selectFrom('reservations.bookings as b')
      .select([
        'b.id',
        'b.code',
        'b.status',
        'b.property_id',
        'b.booker_name',
        'b.channel_external_id',
        sql<number>`greatest(
          case when b.code = ${code} then 1.0 when b.code like ${`${code}%`} then 0.9 else 0 end,
          case when b.channel_external_id = ${q} then 0.95 else 0 end,
          case when b.external_refs::text ilike ${`%${q}%`} then 0.7 else 0 end,
          coalesce(similarity(b.booker_name, ${q}), 0)
        )`.as('score'),
      ])
      .where((eb) =>
        eb.or([
          eb('b.code', 'like', `${code}%`),
          eb('b.channel_external_id', '=', q),
          sql<boolean>`b.external_refs::text ilike ${`%${q}%`}`,
          eb('b.booker_name', 'ilike', `%${q}%`),
          sql<boolean>`similarity(b.booker_name, ${q}) > 0.3`,
        ]),
      )
      .orderBy('score', 'desc')
      .limit(limit);
    if (scope !== 'all') rq = rq.where('b.property_id', 'in', scope as string[]);
    const rows = await rq.execute();
    return rows.map((r) => ({
      type: 'booking',
      id: r.id,
      title: `${r.code}${r.booker_name ? ` · ${r.booker_name}` : ''}`,
      subtitle: r.channel_external_id ? `Channel booking ${r.channel_external_id}` : 'Booking',
      status: { booking: r.status },
      propertyId: r.property_id,
      score: Math.min(1, Math.max(0.3, Number(r.score))),
      matched: r.code.startsWith(code)
        ? 'confirmation code'
        : r.channel_external_id === q
          ? 'channel booking id'
          : 'guest name',
    }));
  }

  async function occupantHits(
    tx: TxContext,
    q: string,
    limit: number,
    scope: readonly string[] | 'all',
  ): Promise<SearchHit[]> {
    let rq = db(tx)
      .selectFrom('reservations.occupants as o')
      .innerJoin('reservations.stays as s', 's.id', 'o.stay_id')
      .innerJoin('reservations.bookings as b', 'b.id', 's.booking_id')
      .select([
        's.id',
        's.status',
        's.arrival',
        's.departure',
        's.property_id',
        'b.code',
        'o.name',
        sql<number>`coalesce(similarity(o.name, ${q}), 0)`.as('score'),
      ])
      .where((eb) => eb.or([eb('o.name', 'ilike', `%${q}%`), sql<boolean>`similarity(o.name, ${q}) > 0.3`]))
      .orderBy('score', 'desc')
      .limit(limit);
    if (scope !== 'all') rq = rq.where('s.property_id', 'in', scope as string[]);
    const rows = await rq.execute();
    return rows.map((r) => ({
      type: 'stay',
      id: r.id,
      title: `${r.name ?? 'Guest'} · ${r.code}`,
      subtitle: `${r.arrival} → ${r.departure}`,
      status: { stay: r.status },
      propertyId: r.property_id,
      score: Math.min(1, Math.max(0.3, Number(r.score))),
      matched: 'guest name',
    }));
  }

  async function unitHits(
    tx: TxContext,
    q: string,
    limit: number,
    scope: readonly string[] | 'all',
  ): Promise<SearchHit[]> {
    if (q.length > 12) return [];
    const properties =
      scope === 'all'
        ? (await db(tx).selectFrom('reservations.bookings').select('property_id').distinct().execute()).map(
            (r) => r.property_id,
          )
        : [...scope];
    const hits: SearchHit[] = [];
    for (const propertyId of properties.slice(0, 20)) {
      let units: Array<{ id: string; name: string }>;
      try {
        units = (await deps.ports.inventory.listUnits(tx, { propertyId })).filter(
          (u) => u.name.toLowerCase() === q.toLowerCase(),
        );
      } catch (err) {
        if (isModuleUnavailable(err)) return [];
        throw err;
      }
      if (units.length === 0) continue;
      const stays = await db(tx)
        .selectFrom('reservations.stay_segments as g')
        .innerJoin('reservations.stays as s', 's.id', 'g.stay_id')
        .innerJoin('reservations.bookings as b', 'b.id', 's.booking_id')
        .select([
          's.id',
          's.status',
          's.arrival',
          's.departure',
          's.property_id',
          'b.code',
          'b.booker_name',
          'g.unit_id',
        ])
        .where(
          'g.unit_id',
          'in',
          units.map((u) => u.id),
        )
        .where('s.status', 'in', ['expected', 'in_house'])
        .orderBy('s.arrival')
        .limit(limit)
        .execute();
      for (const s of stays) {
        const unit = units.find((u) => u.id === s.unit_id);
        hits.push({
          type: 'stay',
          id: s.id,
          title: `${unit?.name ?? 'Unit'} · ${s.booker_name ?? s.code}`,
          subtitle: `${s.status === 'in_house' ? 'In house' : 'Expected'} ${s.arrival} → ${s.departure}`,
          status: { stay: s.status },
          propertyId: s.property_id,
          score: s.status === 'in_house' ? 0.95 : 0.8,
          matched: 'unit number',
        });
      }
    }
    return hits;
  }

  return {
    types: ['booking', 'stay'],
    async search(tx, query, { limit }) {
      const q = normalizeQuery(query);
      if (q.length < 2) return [];
      const scope = scopeOf(tx);
      if (scope !== 'all' && scope.length === 0) return [];
      const all = [
        ...(await bookingHits(tx, q, limit, scope)),
        ...(await occupantHits(tx, q, limit, scope)),
        ...(await unitHits(tx, q, limit, scope)),
      ];
      const seen = new Set<string>();
      return all
        .sort((a, b) => b.score - a.score)
        .filter((h) => {
          const key = `${h.type}:${h.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, limit);
    },
    async summarize(tx, type, id): Promise<RecordSummary | null> {
      if (type === 'booking') {
        const b = await db(tx)
          .selectFrom('reservations.bookings')
          .select(['id', 'code', 'status', 'property_id', 'booker_name'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!b || !tx.authz.can(P.bookingRead, { propertyId: b.property_id })) return null;
        const range = await db(tx)
          .selectFrom('reservations.stays')
          .select([
            sql<string>`min(arrival)::text`.as('a'),
            sql<string>`max(departure)::text`.as('d'),
            sql<number>`count(*)::int`.as('n'),
          ])
          .where('booking_id', '=', id)
          .executeTakeFirstOrThrow();
        return {
          type,
          id,
          title: `${b.code}${b.booker_name ? ` · ${b.booker_name}` : ''}`,
          subtitle: `${range.a} → ${range.d} · ${range.n} stay${range.n === 1 ? '' : 's'}`,
          status: { booking: b.status },
          propertyId: b.property_id,
        };
      }
      if (type === 'stay') {
        const s = await db(tx)
          .selectFrom('reservations.stays as s')
          .innerJoin('reservations.bookings as b', 'b.id', 's.booking_id')
          .select([
            's.id',
            's.status',
            's.arrival',
            's.departure',
            's.property_id',
            'b.code',
            'b.status as booking_status',
            'b.booker_name',
          ])
          .where('s.id', '=', id)
          .executeTakeFirst();
        if (!s || !tx.authz.can(P.bookingRead, { propertyId: s.property_id })) return null;
        const primary = await db(tx)
          .selectFrom('reservations.occupants')
          .select('name')
          .where('stay_id', '=', id)
          .where('is_primary', '=', true)
          .executeTakeFirst();
        return {
          type,
          id,
          title: `${primary?.name ?? s.booker_name ?? 'Guest'} · ${s.code}`,
          subtitle: `${s.arrival} → ${s.departure}`,
          status: { stay: s.status, booking: s.booking_status },
          propertyId: s.property_id,
        };
      }
      return null;
    },
  };
}
