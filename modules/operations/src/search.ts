import { normalizeQuery, type SearchProvider, sql, type TxContext, typed } from '@portico/db';
import type { RecordSummary, SearchHit } from '@portico/kernel';
import type { OperationsDB } from './tables';

const db = (tx: TxContext) => typed<OperationsDB>(tx.db);

/** Union of property scopes over several permissions ('all' wins). */
function scopeOf(tx: TxContext, permissions: readonly string[]): string[] | 'all' {
  const ids = new Set<string>();
  for (const p of permissions) {
    const s = tx.authz.propertyScope(p);
    if (s === 'all') return 'all';
    for (const id of s) ids.add(id);
  }
  return [...ids];
}

const TASK_READ = ['operations.task.read', 'operations.task.update', 'operations.task.manage'];
const MX_READ = [
  'operations.maintenance.read',
  'operations.maintenance.manage',
  'operations.maintenance.report',
];
const LF_READ = ['operations.lostFound.manage'];

function scoreFor(code: string | null, q: string, title: string): { score: number; matched: string } {
  if (code && code.toLowerCase() === q.toLowerCase()) return { score: 1, matched: 'number' };
  if (code?.toLowerCase().startsWith(q.toLowerCase())) return { score: 0.9, matched: 'number' };
  return { score: title.toLowerCase().startsWith(q.toLowerCase()) ? 0.7 : 0.5, matched: 'title' };
}

/**
 * Global search + hover previews for operations records: tasks, service requests (SR-…), work orders (WO-…),
 * lost & found items (LF-…) and assets. Every query is limited to the properties where the actor may read the
 * record type (and RLS limits it to the organization).
 */
export const operationsSearch: SearchProvider = {
  types: ['task', 'service_request', 'work_order', 'lost_found_item', 'asset'],
  async search(tx, query, { limit }): Promise<SearchHit[]> {
    const q = normalizeQuery(query);
    if (q.length < 2) return [];
    const like = `%${q}%`;
    const prefix = `${q}%`;
    const hits: SearchHit[] = [];
    // Property scope as a SQL predicate (RLS already limits rows to the organization).
    const inScope = (scope: string[] | 'all', col: string) =>
      scope === 'all' ? sql<boolean>`true` : sql<boolean>`${sql.ref(col)} = any(${scope}::uuid[])`;

    const taskScope = scopeOf(tx, TASK_READ);
    if (taskScope === 'all' || taskScope.length) {
      const rows = await db(tx)
        .selectFrom('operations.tasks')
        .select(['id', 'title', 'kind', 'status', 'priority', 'property_id'])
        .where('kind', 'not in', ['service_request', 'work_order'])
        .where('title', 'ilike', like)
        .where(inScope(taskScope, 'property_id'))
        .orderBy(sql`case when status in ('open','in_progress','blocked') then 0 else 1 end`)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute();
      for (const r of rows)
        hits.push({
          type: 'task',
          id: r.id,
          title: r.title,
          subtitle: `Task · ${r.kind.replace(/_/g, ' ')}`,
          status: { task: r.status, priority: r.priority },
          propertyId: r.property_id,
          ...scoreFor(null, q, r.title),
        });
      const srs = await db(tx)
        .selectFrom('operations.service_requests')
        .select(['id', 'number', 'category', 'description', 'status', 'property_id'])
        .where((eb) =>
          eb.or([
            eb('number', 'ilike', prefix),
            eb('description', 'ilike', like),
            eb('category', 'ilike', like),
          ]),
        )
        .where(inScope(taskScope, 'property_id'))
        .orderBy('requested_at', 'desc')
        .limit(limit)
        .execute();
      for (const r of srs)
        hits.push({
          type: 'service_request',
          id: r.id,
          title: `${r.number} · ${r.category}`,
          subtitle: r.description.slice(0, 80),
          status: { serviceRequest: r.status },
          propertyId: r.property_id,
          ...scoreFor(r.number, q, r.description),
        });
    }
    const mxScope = scopeOf(tx, MX_READ);
    if (mxScope === 'all' || mxScope.length) {
      const wos = await db(tx)
        .selectFrom('operations.work_orders as w')
        .innerJoin('operations.tasks as t', 't.id', 'w.task_id')
        .select(['w.id', 'w.number', 't.title', 't.status', 'w.urgency', 'w.property_id', 'w.completed_at'])
        .where((eb) =>
          eb.or([
            eb('w.number', 'ilike', prefix),
            eb('t.title', 'ilike', like),
            eb('w.fault_category', 'ilike', like),
          ]),
        )
        .where(inScope(mxScope, 'w.property_id'))
        .orderBy('w.created_at', 'desc')
        .limit(limit)
        .execute();
      for (const r of wos)
        hits.push({
          type: 'work_order',
          id: r.id,
          title: `${r.number} · ${r.title}`,
          subtitle: `Work order · ${r.urgency}`,
          status: { workOrder: r.completed_at ? 'completed' : r.status },
          propertyId: r.property_id,
          ...scoreFor(r.number, q, r.title),
        });
      const assets = await db(tx)
        .selectFrom('operations.assets')
        .select(['id', 'code', 'name', 'category', 'status', 'property_id'])
        .where((eb) => eb.or([eb('code', 'ilike', prefix), eb('name', 'ilike', like)]))
        .where(inScope(mxScope, 'property_id'))
        .orderBy('code')
        .limit(limit)
        .execute();
      for (const r of assets)
        hits.push({
          type: 'asset',
          id: r.id,
          title: `${r.name}`,
          subtitle: `Asset ${r.code} · ${r.category}`,
          status: { asset: r.status },
          propertyId: r.property_id,
          ...scoreFor(r.code, q, r.name),
        });
    }
    const lfScope = scopeOf(tx, LF_READ);
    if (lfScope === 'all' || lfScope.length) {
      const items = await db(tx)
        .selectFrom('operations.lost_found_items')
        .select(['id', 'number', 'description', 'status', 'property_id'])
        .where((eb) => eb.or([eb('number', 'ilike', prefix), eb('description', 'ilike', like)]))
        .where(inScope(lfScope, 'property_id'))
        .orderBy('found_at', 'desc')
        .limit(limit)
        .execute();
      for (const r of items)
        hits.push({
          type: 'lost_found_item',
          id: r.id,
          title: `${r.number} · ${r.description.slice(0, 60)}`,
          subtitle: 'Lost & found',
          status: { lostFound: r.status },
          propertyId: r.property_id,
          ...scoreFor(r.number, q, r.description),
        });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  async summarize(tx, type, id): Promise<RecordSummary | null> {
    const allowed = (perms: string[], propertyId: string) =>
      perms.some((p) => tx.authz.can(p, { propertyId }));
    switch (type) {
      case 'task': {
        const r = await db(tx)
          .selectFrom('operations.tasks')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!r || !allowed(TASK_READ, r.property_id)) return null;
        return {
          type,
          id,
          title: r.title,
          subtitle: `${r.assignee_name ?? r.department_kind.replace(/_/g, ' ')}${r.due_at ? ` · due ${new Date(r.due_at).toISOString()}` : ''}`,
          status: { task: r.status, priority: r.priority },
          propertyId: r.property_id,
        };
      }
      case 'service_request': {
        const r = await db(tx)
          .selectFrom('operations.service_requests')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!r || !allowed(TASK_READ, r.property_id)) return null;
        return {
          type,
          id,
          title: `${r.number} · ${r.category}`,
          subtitle: r.description.slice(0, 80),
          status: { serviceRequest: r.status },
          propertyId: r.property_id,
        };
      }
      case 'work_order': {
        const r = await db(tx)
          .selectFrom('operations.work_orders as w')
          .innerJoin('operations.tasks as t', 't.id', 'w.task_id')
          .select([
            'w.number',
            't.title',
            't.status',
            'w.block_status',
            'w.property_id',
            'w.completed_at',
            'w.urgency',
          ])
          .where('w.id', '=', id)
          .executeTakeFirst();
        if (!r || !allowed(MX_READ, r.property_id)) return null;
        return {
          type,
          id,
          title: `${r.number} · ${r.title}`,
          subtitle: `Urgency ${r.urgency}`,
          status: { workOrder: r.completed_at ? 'completed' : r.status, maintenanceBlock: r.block_status },
          propertyId: r.property_id,
        };
      }
      case 'lost_found_item': {
        const r = await db(tx)
          .selectFrom('operations.lost_found_items')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!r || !allowed(LF_READ, r.property_id)) return null;
        return {
          type,
          id,
          title: `${r.number} · ${r.description.slice(0, 60)}`,
          subtitle: `Stored at ${r.storage_location}`,
          status: { lostFound: r.status },
          propertyId: r.property_id,
        };
      }
      case 'asset': {
        const r = await db(tx)
          .selectFrom('operations.assets')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!r || !allowed(MX_READ, r.property_id)) return null;
        return {
          type,
          id,
          title: r.name,
          subtitle: `Asset ${r.code} · ${r.category}`,
          status: { asset: r.status },
          propertyId: r.property_id,
        };
      }
      default:
        return null;
    }
  },
};
