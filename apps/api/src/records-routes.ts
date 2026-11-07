/**
 * Cross-module experience endpoints (docs/product/experience-architecture.md):
 *   GET /v1/search                         global, permission-aware search across every module
 *   GET /v1/records/:type/:id/summary      hover preview for any record type
 *   GET /v1/records/:type/:id/history      one timeline of what happened to a record, from the audit log
 */
import { normalizeQuery, type PorticoDatabase, type SearchProvider, typed, withTenantTx } from '@portico/db';
import type { HttpModule } from '@portico/http';
import {
  type ModuleManifest,
  NotFoundError,
  type RecordTypeDefinition,
  type SearchHit,
} from '@portico/kernel';
import { z } from 'zod';

interface AuditRow {
  'core.audit_log': {
    id: string;
    tenant_id: string;
    property_id: string | null;
    occurred_at: Date;
    actor: { kind: string; displayName?: string; process?: string };
    actor_key: string;
    action: string;
    target_type: string;
    target_id: string;
    reason: string | null;
    before: unknown;
    after: unknown;
    metadata: unknown;
    correlation_id: string;
  };
}

const searchHit = z.object({
  type: z.string(),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  status: z.record(z.string(), z.string()).optional(),
  propertyId: z.string().nullable(),
  score: z.number(),
  matched: z.string().optional(),
  label: z.string().optional(),
  route: z.string().optional(),
});

export function recordsHttp(deps: {
  database: PorticoDatabase;
  manifests: readonly ModuleManifest[];
  searchProviders: readonly SearchProvider[];
}): HttpModule {
  const recordTypes = new Map<string, RecordTypeDefinition>(
    deps.manifests.flatMap((m) => (m.recordTypes ?? []).map((r) => [r.type, r] as const)),
  );
  const decorate = (h: SearchHit) => {
    const def = recordTypes.get(h.type);
    return {
      ...h,
      ...(def ? { label: def.label, ...(def.route ? { route: def.route.replace(':id', h.id) } : {}) } : {}),
    };
  };
  return {
    name: 'records',
    routes(app) {
      app.get(
        '/search',
        {
          schema: {
            tags: ['Search'],
            querystring: z.object({
              q: z.string().min(1).max(200),
              types: z.string().optional(),
              limit: z.coerce.number().int().min(1).max(50).default(20),
            }),
            response: { 200: z.object({ query: z.string(), items: z.array(searchHit) }) },
          },
        },
        async (req) => {
          const q = normalizeQuery(req.query.q);
          const wanted = req.query.types ? new Set(req.query.types.split(',')) : null;
          const providers = deps.searchProviders.filter((p) => !wanted || p.types.some((t) => wanted.has(t)));
          const hits = await withTenantTx(deps.database, req.ctx, async (tx) => {
            const all: SearchHit[] = [];
            for (const p of providers) all.push(...(await p.search(tx, q, { limit: req.query.limit })));
            return all;
          });
          const items = hits
            .filter((h) => !wanted || wanted.has(h.type))
            .sort((a, b) => b.score - a.score)
            .slice(0, req.query.limit)
            .map(decorate);
          return { query: q, items };
        },
      );

      app.get(
        '/records/:type/:id/summary',
        {
          schema: {
            tags: ['Search'],
            params: z.object({ type: z.string().max(60), id: z.string().max(100) }),
            response: { 200: searchHit.omit({ score: true }) },
          },
        },
        async (req) => {
          const provider = deps.searchProviders.find((p) => p.types.includes(req.params.type) && p.summarize);
          const summary = provider?.summarize
            ? await withTenantTx(
                deps.database,
                req.ctx,
                (tx) => provider.summarize?.(tx, req.params.type, req.params.id) ?? Promise.resolve(null),
              )
            : null;
          if (!summary) throw new NotFoundError(req.params.type, req.params.id);
          return decorate({ ...summary, score: 1 });
        },
      );

      app.get(
        '/records/:type/:id/history',
        {
          schema: {
            tags: ['Search'],
            params: z.object({ type: z.string().max(60), id: z.string().max(100) }),
            response: {
              200: z.object({
                type: z.string(),
                id: z.string(),
                items: z.array(
                  z.object({
                    at: z.string(),
                    action: z.string(),
                    actor: z.object({ kind: z.string(), label: z.string() }),
                    reason: z.string().nullable(),
                    before: z.unknown(),
                    after: z.unknown(),
                  }),
                ),
              }),
            },
          },
        },
        async (req) => {
          const def = recordTypes.get(req.params.type);
          if (!def) throw new NotFoundError(req.params.type, req.params.id);
          const rows = await withTenantTx(deps.database, req.ctx, (tx) =>
            typed<AuditRow>(tx.db)
              .selectFrom('core.audit_log')
              .selectAll()
              .where('target_type', '=', req.params.type)
              .where('target_id', '=', req.params.id)
              .orderBy('occurred_at', 'asc')
              .limit(500)
              .execute(),
          );
          const propertyId = rows.find((r) => r.property_id)?.property_id ?? null;
          // Not found and not permitted look identical: existence is never revealed to people without access.
          if (
            rows.length === 0 ||
            !req.ctx.authz.can(def.readPermission, propertyId ? { propertyId } : undefined)
          ) {
            throw new NotFoundError(req.params.type, req.params.id);
          }
          return {
            type: def.type,
            id: req.params.id,
            items: rows.map((r) => ({
              at: new Date(r.occurred_at).toISOString(),
              action: r.action,
              actor: { kind: r.actor.kind, label: r.actor.displayName ?? r.actor.process ?? r.actor.kind },
              reason: r.reason,
              before: r.before,
              after: r.after,
            })),
          };
        },
      );
    },
  };
}
