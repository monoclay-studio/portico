/**
 * Global search for migrations and their exceptions (universal record contract). Permission- and property-scope
 * aware: only jobs at properties where the user holds migration.job.read.
 */
import { normalizeQuery, type SearchProvider, type TxContext, typed } from '@portico/db';
import type { RecordSummary, SearchHit } from '@portico/kernel';
import { P } from './manifest';
import type { MigrationDB } from './tables';

const db = (tx: TxContext) => typed<MigrationDB>(tx.db);
const readable = (tx: TxContext, propertyId: string) => tx.authz.can(P.read, { propertyId });

export const migrationSearch: SearchProvider = {
  types: ['migration_job', 'migration_exception'],
  async search(tx, query, { limit }): Promise<SearchHit[]> {
    const q = normalizeQuery(query);
    if (q.length < 2) return [];
    const scope = tx.authz.propertyScope(P.read);
    if (scope !== 'all' && scope.length === 0) return [];
    const jobs = await db(tx)
      .selectFrom('migration.jobs')
      .select(['id', 'source_system', 'state', 'property_id', 'purpose'])
      .where('source_system', 'ilike', `%${q}%`)
      .limit(limit)
      .execute();
    // Source ids stay searchable from day one (DD11 §7.4): a confirmation number finds its exception.
    const exceptions = await db(tx)
      .selectFrom('migration.exceptions')
      .select(['id', 'source_key', 'problem', 'status', 'severity', 'property_id', 'data_class'])
      .where((eb) => eb.or([eb('source_key', '=', q), eb('problem', 'ilike', `%${q}%`)]))
      .where('status', 'in', ['open', 'in_progress'])
      .limit(limit)
      .execute();
    const hits: SearchHit[] = [];
    for (const j of jobs)
      if (readable(tx, j.property_id))
        hits.push({
          type: 'migration_job',
          id: j.id,
          title: `Migration from ${j.source_system}`,
          subtitle: j.purpose === 'production' ? 'Production migration' : 'Rehearsal',
          status: { migration: j.state },
          propertyId: j.property_id,
          score: 0.8,
          matched: 'source system',
        });
    for (const e of exceptions)
      if (readable(tx, e.property_id))
        hits.push({
          type: 'migration_exception',
          id: e.id,
          title: e.source_key ? `${e.data_class} ${e.source_key}` : e.data_class,
          subtitle: e.problem.slice(0, 120),
          status: { exception: e.status, severity: e.severity },
          propertyId: e.property_id,
          score: e.source_key === q ? 1 : 0.5,
          matched: e.source_key === q ? 'source id' : 'problem',
        });
    return hits.slice(0, limit);
  },
  async summarize(tx, type, id): Promise<RecordSummary | null> {
    if (type === 'migration_job') {
      const j = await db(tx)
        .selectFrom('migration.jobs')
        .select(['id', 'source_system', 'state', 'property_id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!j || !readable(tx, j.property_id)) return null;
      return {
        type,
        id,
        title: `Migration from ${j.source_system}`,
        status: { migration: j.state },
        propertyId: j.property_id,
      };
    }
    if (type === 'migration_exception') {
      const e = await db(tx)
        .selectFrom('migration.exceptions')
        .select(['id', 'source_key', 'problem', 'status', 'property_id', 'data_class'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!e || !readable(tx, e.property_id)) return null;
      return {
        type,
        id,
        title: e.source_key ? `${e.data_class} ${e.source_key}` : e.data_class,
        subtitle: e.problem.slice(0, 120),
        status: { exception: e.status },
        propertyId: e.property_id,
      };
    }
    return null;
  },
};
