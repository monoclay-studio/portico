import { normalizeQuery, type SearchProvider, sql, type TxContext } from '@portico/db';
import type { RecordSummary, SearchHit } from '@portico/kernel';
import { INVENTORY_PERMISSIONS } from './manifest';
import { idb } from './service/context';

const READ = [
  INVENTORY_PERMISSIONS.unitRead,
  INVENTORY_PERMISSIONS.availabilityRead,
  INVENTORY_PERMISSIONS.assignmentManage,
];

/** Property ids the actor may read inventory records for ('all' or a list; empty = none). */
function readableProperties(tx: TxContext): string[] | 'all' {
  const scopes = READ.map((p) => tx.authz.propertyScope(p));
  if (scopes.some((s) => s === 'all')) return 'all';
  return [...new Set(scopes.flatMap((s) => (s === 'all' ? [] : [...s])))];
}

const canRead = (tx: TxContext, propertyId: string) => READ.some((p) => tx.authz.can(p, { propertyId }));

/**
 * Global search + hover previews for units ("214", "Jetty B"), unit types ("Water Villa", "WV-POOL"), unit
 * blocks and inventory conflicts. Permission- and property-scope-aware.
 */
export const inventorySearch: SearchProvider = {
  types: ['unit', 'unitType', 'unitBlock', 'inventoryConflict'],
  async search(tx, query, { limit }): Promise<SearchHit[]> {
    const q = normalizeQuery(query);
    if (q.length < 1) return [];
    const scope = readableProperties(tx);
    if (scope !== 'all' && scope.length === 0) return [];
    let units = idb(tx)
      .selectFrom('inventory.units as u')
      .innerJoin('inventory.unit_types as t', 't.id', 'u.unit_type_id')
      .select([
        'u.id',
        'u.number',
        'u.name',
        'u.zone',
        'u.building',
        'u.status',
        'u.property_id',
        't.name as type_name',
        sql<number>`greatest(similarity(u.number, ${q}), similarity(coalesce(u.name, ''), ${q}),
                             case when u.number ilike ${`${q}%`} then 1 else 0 end)`.as('score'),
      ])
      .where((eb) =>
        eb.or([
          eb('u.number', 'ilike', `${q}%`),
          eb('u.name', 'ilike', `%${q}%`),
          eb('u.zone', 'ilike', `%${q}%`),
          sql<boolean>`similarity(u.number, ${q}) > 0.4`,
        ]),
      )
      .orderBy('score', 'desc')
      .orderBy('u.number')
      .limit(limit);
    if (scope !== 'all') units = units.where('u.property_id', 'in', scope);
    let types = idb(tx)
      .selectFrom('inventory.unit_types')
      .select([
        'id',
        'code',
        'name',
        'status',
        'property_id',
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
    if (scope !== 'all') types = types.where('property_id', 'in', scope);
    const [u, t] = await Promise.all([units.execute(), types.execute()]);
    const hits: SearchHit[] = [
      ...u.map((r) => ({
        type: 'unit',
        id: r.id,
        title: `${r.type_name} ${r.number}`,
        subtitle: [r.name, r.building, r.zone].filter(Boolean).join(' · ') || r.type_name,
        status: { lifecycle: r.status },
        propertyId: r.property_id,
        score: Math.min(1, Math.max(0.3, Number(r.score))),
        matched: r.number.toLowerCase().startsWith(q.toLowerCase()) ? 'number' : r.name ? 'name' : 'location',
      })),
      ...t.map((r) => ({
        type: 'unitType',
        id: r.id,
        title: r.name,
        subtitle: `Unit type ${r.code}`,
        status: { lifecycle: r.status },
        propertyId: r.property_id,
        score: Math.min(1, Math.max(0.3, Number(r.score))),
        matched: r.code.toLowerCase().startsWith(q.toLowerCase()) ? 'code' : 'name',
      })),
    ];
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  },
  async summarize(tx, type, id): Promise<RecordSummary | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    if (type === 'unit') {
      const r = await idb(tx)
        .selectFrom('inventory.units as u')
        .innerJoin('inventory.unit_types as t', 't.id', 'u.unit_type_id')
        .select(['u.id', 'u.number', 'u.name', 'u.zone', 'u.status', 'u.property_id', 't.name as type_name'])
        .where('u.id', '=', id)
        .executeTakeFirst();
      if (!r || !canRead(tx, r.property_id)) return null;
      return {
        type,
        id: r.id,
        title: `${r.type_name} ${r.number}`,
        subtitle: [r.name, r.zone].filter(Boolean).join(' · ') || r.type_name,
        status: { lifecycle: r.status },
        propertyId: r.property_id,
      };
    }
    if (type === 'unitType') {
      const r = await idb(tx)
        .selectFrom('inventory.unit_types')
        .select(['id', 'code', 'name', 'status', 'property_id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r || !canRead(tx, r.property_id)) return null;
      return {
        type,
        id: r.id,
        title: r.name,
        subtitle: `Unit type ${r.code}`,
        status: { lifecycle: r.status },
        propertyId: r.property_id,
      };
    }
    if (type === 'unitBlock') {
      const { rows } = await sql<{
        id: string;
        kind: string;
        reason: string;
        status: string;
        property_id: string;
        number: string;
        to: string;
      }>`
        select b.id, b.kind, b.reason, b.status, b.property_id, u.number, upper(b.nights)::text as to
        from inventory.unit_blocks b join inventory.units u on u.id = b.unit_id where b.id = ${id}`.execute(
        tx.db,
      );
      const r = rows[0];
      if (!r || !canRead(tx, r.property_id)) return null;
      return {
        type,
        id: r.id,
        title: `Unit ${r.number} ${r.kind.replace(/_/g, ' ')}`,
        subtitle: `${r.reason} · until ${r.to}`,
        status: { block: r.status },
        propertyId: r.property_id,
      };
    }
    if (type === 'inventoryConflict') {
      const r = await idb(tx)
        .selectFrom('inventory.conflicts as c')
        .innerJoin('inventory.unit_types as t', 't.id', 'c.unit_type_id')
        .select(['c.id', 'c.night', 'c.shortfall', 'c.status', 'c.property_id', 't.name as type_name'])
        .where('c.id', '=', id)
        .executeTakeFirst();
      if (!r || !tx.authz.can(INVENTORY_PERMISSIONS.availabilityRead, { propertyId: r.property_id }))
        return null;
      return {
        type,
        id: r.id,
        title: `${r.type_name} oversold on ${r.night}`,
        subtitle: r.status === 'resolved' ? 'Resolved' : `Short by ${r.shortfall}`,
        status: { conflict: r.status },
        propertyId: r.property_id,
      };
    }
    return null;
  },
};
