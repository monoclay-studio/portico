/**
 * HTTP surface (mounted under /v1/migration). Creates, uploads, sign-offs and authorizations require
 * Idempotency-Key; changes to versioned records require If-Match; reads return ETag; errors are problem+json that
 * explain the problem and the recovery. `run`, `cutover/start` and `sweep` are resumable multi-step commands: a
 * repeat resumes where the previous one stopped and can never duplicate a record (the import ledger), and a second
 * concurrent call is refused while the first runs (lease).
 */
import { type PorticoDatabase, runIdempotent, type TxContext, withTenantTx } from '@portico/db';
import { type HttpModule, idParams, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type RequestContext,
  requirePermission,
} from '@portico/kernel';
import { z } from 'zod';
import {
  assignExceptionInput,
  authorizeInput,
  cardRecollectionView,
  checklistInput,
  createJobInput,
  exceptionsQuery,
  exceptionView,
  jobView,
  journalEntryView,
  journalTickInput,
  ledgerEntryView,
  linkRehearsalInput,
  listJobsQuery,
  planCutoverInput,
  reportView,
  resolveExceptionInput,
  reviewMappingInput,
  rollbackInput,
  runResult,
  sourceAdapterView,
  startCutoverInput,
  uploadInput,
  uploadResult,
} from './contracts';
import { P } from './manifest';
import { assignChecklistOwner, completeChecklistItem } from './service/checklist';
import { db, loadJob, loadJobFor, type MigrationDeps } from './service/context';
import {
  approveCutover,
  approveRollback,
  authorizeProduction,
  cancelJob,
  planCutover,
  requestCardRecollections,
  requestRollback,
  sweep,
  tickJournal,
} from './service/cutover';
import { assignException, getException, listExceptions, resolveException } from './service/exceptions';
import { uploadFiles } from './service/extract';
import { jobView as buildJobView, createJob, linkRehearsal, listJobs } from './service/jobs';
import { runPipeline } from './service/pipeline';
import { reviewMapping } from './service/plan';
import { ledgerNamespace } from './service/state';
import { SOURCE_ADAPTERS } from './sources/adapters';
import { TEMPLATE_GUIDE, templateFiles, templateWorkbook } from './sources/templates';

const tags = ['Migration'];

/** Deny by default: catalogue and templates are for people who may read migrations somewhere. */
function requireAnyRead(ctx: RequestContext): void {
  const scope = ctx.authz.propertyScope(P.read);
  if (scope !== 'all' && scope.length === 0) throw new ForbiddenError(P.read);
}
const UPLOAD_LIMIT = 32 * 1024 * 1024;
const items = <T extends z.ZodType>(t: T) => z.object({ items: z.array(t) });

export function migrationHttp(deps: { database: PorticoDatabase; migration: MigrationDeps }): HttpModule {
  const { database } = deps;
  const m = deps.migration;
  const view = async (tx: TxContext, id: string) =>
    buildJobView(tx, await loadJobFor(tx, id, P.read), m.ports);
  return {
    name: 'migration',
    routes(app) {
      app.get(
        '/migration/sources',
        { schema: { tags, response: { 200: items(sourceAdapterView) } } },
        async (req) => {
          requireAnyRead(req.ctx);
          return {
            items: SOURCE_ADAPTERS.map((a) => ({
              key: a.key,
              label: a.label,
              vendor: a.vendor,
              kind: a.kind,
              verification: a.verification,
              verificationNote: a.verificationNote,
              provides: a.provides,
              assessment: { ...a.assessment },
            })),
          };
        },
      );
      app.get(
        '/migration/templates',
        {
          schema: {
            tags,
            response: {
              200: z.object({
                guide: z.array(z.string()),
                files: z.array(z.object({ name: z.string(), content: z.string() })),
                workbook: z.object({ name: z.string(), base64: z.string() }),
              }),
            },
          },
        },
        async (req) => {
          requireAnyRead(req.ctx);
          return {
            guide: TEMPLATE_GUIDE,
            files: templateFiles().map((f) => ({ name: f.name, content: f.content })),
            workbook: { name: 'portico-migration-templates.xlsx', base64: templateWorkbook() },
          };
        },
      );

      // ── jobs ──
      app.post(
        '/migration/jobs',
        { schema: { tags, body: createJobInput, response: { 201: jobView } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /migration/jobs', key, request: req.body },
            async (tx) => {
              const job = await createJob(tx, m, req.body);
              return { status: 201, body: await buildJobView(tx, job, m.ports) };
            },
          );
          setVersion(reply, res.body.version);
          return reply.status(201).send(res.body);
        },
      );
      app.get(
        '/migration/jobs',
        { schema: { tags, querystring: listJobsQuery, response: { 200: items(jobView) } } },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) => ({
            items: await Promise.all(
              (await listJobs(tx, req.query)).map((j) => buildJobView(tx, j, m.ports)),
            ),
          })),
      );
      app.get(
        '/migration/jobs/:id',
        { schema: { tags, params: idParams, response: { 200: jobView } } },
        async (req, reply) => {
          const v = await withTenantTx(database, req.ctx, (tx) => view(tx, req.params.id));
          setVersion(reply, v.version);
          return v;
        },
      );
      app.post(
        '/migration/jobs/:id/uploads/preview',
        {
          bodyLimit: UPLOAD_LIMIT,
          schema: { tags, params: idParams, body: uploadInput, response: { 200: uploadResult } },
        },
        async (req) => uploadFiles(database, m, req.ctx, req.params.id, { ...req.body, preview: true }),
      );
      app.post(
        '/migration/jobs/:id/uploads',
        {
          bodyLimit: UPLOAD_LIMIT,
          schema: { tags, params: idParams, body: uploadInput, response: { 200: uploadResult } },
        },
        async (req) => {
          requireIdempotencyKey(req);
          return uploadFiles(database, m, req.ctx, req.params.id, req.body);
        },
      );
      app.post(
        '/migration/jobs/:id/run',
        { schema: { tags, params: idParams, response: { 200: runResult } } },
        async (req) => {
          const run = await runPipeline(database, m, req.ctx, req.params.id);
          const job = await withTenantTx(database, req.ctx, (tx) => view(tx, req.params.id));
          return { job, executed: run.executed };
        },
      );
      app.patch(
        '/migration/jobs/:id/mapping',
        { schema: { tags, params: idParams, body: reviewMappingInput, response: { 200: jobView } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const v = await withTenantTx(database, req.ctx, async (tx) => {
            const job = await loadJob(tx, req.params.id, { lock: true });
            if (job.version !== expected)
              throw new ConflictError(
                'version_conflict',
                'The migration changed since you loaded it. Reload and review again.',
                {
                  currentVersion: job.version,
                },
              );
            const next = await reviewMapping(tx, m, req.params.id, req.body);
            return buildJobView(tx, next, m.ports);
          });
          setVersion(reply, v.version);
          return v;
        },
      );
      app.post(
        '/migration/jobs/:id/rehearsal-link',
        { schema: { tags, params: idParams, body: linkRehearsalInput, response: { 200: jobView } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const v = await withTenantTx(database, req.ctx, async (tx) => {
            const job = await loadJob(tx, req.params.id, { lock: true });
            if (job.version !== expected)
              throw new ConflictError('version_conflict', 'The migration changed since you loaded it.', {
                currentVersion: job.version,
              });
            return buildJobView(tx, await linkRehearsal(tx, req.params.id, req.body), m.ports);
          });
          setVersion(reply, v.version);
          return v;
        },
      );
      app.post(
        '/migration/jobs/:id/cancel',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({ reason: z.string().trim().min(3).max(1000) }),
            response: { 200: jobView },
          },
        },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) =>
            buildJobView(tx, await cancelJob(tx, m, req.params.id, req.body.reason), m.ports),
          ),
      );

      // ── exceptions and reports ──
      app.get(
        '/migration/jobs/:id/exceptions',
        {
          schema: {
            tags,
            params: idParams,
            querystring: exceptionsQuery,
            response: { 200: items(exceptionView) },
          },
        },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) => {
            await loadJobFor(tx, req.params.id, P.read);
            return { items: await listExceptions(tx, req.params.id, req.query) };
          }),
      );
      app.get(
        '/migration/exceptions/:id',
        { schema: { tags, params: idParams, response: { 200: exceptionView } } },
        async (req, reply) => {
          const e = await withTenantTx(database, req.ctx, (tx) => getException(tx, req.params.id));
          setVersion(reply, e.version);
          return e;
        },
      );
      app.post(
        '/migration/exceptions/:id/resolve',
        { schema: { tags, params: idParams, body: resolveExceptionInput, response: { 200: exceptionView } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const e = await withTenantTx(database, req.ctx, (tx) =>
            resolveException(tx, req.params.id, req.body, expected),
          );
          setVersion(reply, e.version);
          return e;
        },
      );
      app.post(
        '/migration/exceptions/:id/assign',
        { schema: { tags, params: idParams, body: assignExceptionInput, response: { 200: exceptionView } } },
        async (req) =>
          withTenantTx(database, req.ctx, (tx) => assignException(tx, req.params.id, req.body.ownerUserId)),
      );
      app.get(
        '/migration/jobs/:id/reports',
        {
          schema: {
            tags,
            params: idParams,
            response: { 200: items(reportView.omit({ result: true })) },
          },
        },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) => {
            const job = await loadJobFor(tx, req.params.id, P.read);
            const rows = await db(tx)
              .selectFrom('migration.reports')
              .select([
                'id',
                'job_id',
                'seq',
                'context',
                'extract_seq',
                'exact',
                'fingerprint',
                'generated_at',
              ])
              .where('job_id', '=', job.id)
              .orderBy('seq', 'desc')
              .execute();
            return {
              items: rows.map((r) => ({
                id: r.id,
                jobId: r.job_id,
                seq: r.seq,
                context: r.context,
                extractSeq: r.extract_seq,
                exact: r.exact,
                fingerprint: r.fingerprint,
                generatedAt: r.generated_at.toISOString(),
              })),
            };
          }),
      );
      app.get(
        '/migration/reports/:id',
        { schema: { tags, params: idParams, response: { 200: reportView } } },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) => {
            const r = await db(tx)
              .selectFrom('migration.reports')
              .selectAll()
              .where('id', '=', req.params.id)
              .executeTakeFirst();
            if (!r) throw new NotFoundError('migration_report', req.params.id);
            await loadJobFor(tx, r.job_id, P.read);
            return {
              id: r.id,
              jobId: r.job_id,
              seq: r.seq,
              context: r.context,
              extractSeq: r.extract_seq,
              exact: r.exact,
              fingerprint: r.fingerprint,
              result: r.result as Record<string, unknown>,
              generatedAt: r.generated_at.toISOString(),
            };
          }),
      );
      app.get(
        '/migration/jobs/:id/ledger',
        {
          schema: {
            tags,
            params: idParams,
            querystring: z.object({ dataClass: z.string().max(40).optional() }),
            response: { 200: items(ledgerEntryView) },
          },
        },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) => {
            const job = await loadJobFor(tx, req.params.id, P.read);
            let q = db(tx)
              .selectFrom('migration.import_ledger')
              .select(['data_class', 'source_key', 'state', 'target_type', 'target_id', 'reason'])
              .where('property_id', '=', job.propertyId)
              .where('source_system', '=', ledgerNamespace(job));
            if (req.query.dataClass) q = q.where('data_class', '=', req.query.dataClass);
            const rows = await q.orderBy('data_class').orderBy('source_key').limit(5000).execute();
            return {
              items: rows.map((r) => ({
                dataClass: r.data_class as never,
                sourceKey: r.source_key,
                state: r.state as never,
                targetType: r.target_type,
                targetId: r.target_id,
                reason: r.reason,
              })),
            };
          }),
      );

      // ── checklist, authorization, cutover ──
      app.post(
        '/migration/jobs/:id/checklist/:key',
        {
          schema: {
            tags,
            params: z.object({ id: z.uuid(), key: z.string().max(40) }),
            body: checklistInput,
            response: { 200: jobView },
          },
        },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: `POST /migration/jobs/:id/checklist/${req.params.key}`,
              key,
              request: { id: req.params.id, ...req.body },
            },
            async (tx) => {
              await completeChecklistItem(tx, req.params.id, req.params.key, req.body);
              return { status: 200, body: await view(tx, req.params.id) };
            },
          );
          return res.body;
        },
      );
      app.post(
        '/migration/jobs/:id/checklist/:key/owner',
        {
          schema: {
            tags,
            params: z.object({ id: z.uuid(), key: z.string().max(40) }),
            body: z.object({ ownerUserId: z.string().min(1).max(100) }),
            response: { 200: jobView },
          },
        },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) => {
            await assignChecklistOwner(tx, req.params.id, req.params.key, req.body.ownerUserId);
            return view(tx, req.params.id);
          }),
      );
      app.post(
        '/migration/jobs/:id/authorize',
        { schema: { tags, params: idParams, body: authorizeInput, response: { 200: jobView } } },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /migration/jobs/:id/authorize', key, request: { id: req.params.id, ...req.body } },
            async (tx) => {
              await authorizeProduction(tx, req.params.id, req.body);
              return { status: 200, body: await view(tx, req.params.id) };
            },
          );
          return res.body;
        },
      );
      app.post(
        '/migration/jobs/:id/cutover/plan',
        { schema: { tags, params: idParams, body: planCutoverInput, response: { 200: jobView } } },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: 'POST /migration/jobs/:id/cutover/plan',
              key,
              request: { id: req.params.id, ...req.body },
            },
            async (tx) => {
              await planCutover(tx, m, req.params.id, req.body);
              return { status: 200, body: await view(tx, req.params.id) };
            },
          );
          return res.body;
        },
      );
      app.post(
        '/migration/jobs/:id/cutover/approve',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({ note: z.string().max(1000).optional() }),
            response: { 200: jobView },
          },
        },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) => {
            await approveCutover(tx, m, req.params.id, req.body.note);
            return view(tx, req.params.id);
          }),
      );
      app.post(
        '/migration/jobs/:id/cutover/start',
        {
          bodyLimit: UPLOAD_LIMIT,
          schema: { tags, params: idParams, body: startCutoverInput, response: { 200: runResult } },
        },
        async (req) => {
          await withTenantTx(database, req.ctx, (tx) => loadJobFor(tx, req.params.id, P.cutoverExecute));
          if (req.body.files?.length)
            await uploadFiles(
              database,
              m,
              req.ctx,
              req.params.id,
              { files: req.body.files, confirmDetection: true },
              { kind: 'final' },
            );
          const run = await runPipeline(database, m, req.ctx, req.params.id, { start: 'freeze' });
          const job = await withTenantTx(database, req.ctx, (tx) => view(tx, req.params.id));
          return { job, executed: run.executed };
        },
      );
      app.post(
        '/migration/jobs/:id/sweep',
        {
          bodyLimit: UPLOAD_LIMIT,
          schema: {
            tags,
            params: idParams,
            body: z.object({ files: uploadInput.shape.files.optional() }),
            response: {
              200: z.object({
                imported: z.number().int(),
                exceptions: z.number().int(),
                reportSeq: z.number().int(),
                exact: z.boolean(),
              }),
            },
          },
        },
        async (req) => {
          if (req.body.files?.length)
            await uploadFiles(
              database,
              m,
              req.ctx,
              req.params.id,
              { files: req.body.files, confirmDetection: true },
              { kind: 'sweep' },
            );
          return sweep(database, m, req.ctx, req.params.id);
        },
      );
      app.post(
        '/migration/jobs/:id/rollback',
        {
          schema: {
            tags,
            params: idParams,
            body: rollbackInput,
            response: { 200: z.object({ transitionId: z.uuid(), worklist: z.number().int() }) },
          },
        },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /migration/jobs/:id/rollback', key, request: { id: req.params.id, ...req.body } },
            async (tx) => ({ status: 200, body: await requestRollback(tx, m, req.params.id, req.body) }),
          );
          return res.body;
        },
      );
      app.post(
        '/migration/jobs/:id/rollback/approve',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({ note: z.string().max(1000).optional() }),
            response: { 200: jobView },
          },
        },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) => {
            await approveRollback(tx, m, req.params.id, req.body.note);
            return view(tx, req.params.id);
          }),
      );
      app.get(
        '/migration/jobs/:id/journal',
        { schema: { tags, params: idParams, response: { 200: items(journalEntryView) } } },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) => {
            const job = await loadJobFor(tx, req.params.id, P.read);
            const rows = await db(tx)
              .selectFrom('migration.cutover_journal')
              .selectAll()
              .where('job_id', '=', job.id)
              .orderBy('occurred_at')
              .execute();
            return {
              items: rows.map((r) => ({
                id: r.id,
                eventType: r.event_type,
                occurredAt: r.occurred_at.toISOString(),
                recordType: r.record_type,
                recordId: r.record_id,
                summary: r.summary,
                worklistStatus: r.worklist_status,
              })),
            };
          }),
      );
      app.post(
        '/migration/jobs/:id/journal/:entryId',
        {
          schema: {
            tags,
            params: z.object({ id: z.uuid(), entryId: z.uuid() }),
            body: journalTickInput,
            response: { 204: z.null() },
          },
        },
        async (req, reply) => {
          await withTenantTx(database, req.ctx, (tx) =>
            tickJournal(tx, req.params.id, req.params.entryId, req.body.status),
          );
          return reply.status(204).send(null);
        },
      );
      app.get(
        '/migration/jobs/:id/cards',
        { schema: { tags, params: idParams, response: { 200: items(cardRecollectionView) } } },
        async (req) =>
          withTenantTx(database, req.ctx, async (tx) => {
            const job = await loadJobFor(tx, req.params.id, P.read);
            requirePermission(tx, P.read, { propertyId: job.propertyId });
            const rows = await db(tx)
              .selectFrom('migration.card_recollections')
              .selectAll()
              .where('job_id', '=', job.id)
              .orderBy('arrival')
              .execute();
            return {
              items: rows.map((r) => ({
                sourceKey: r.source_key,
                bookingId: r.booking_id,
                arrival: r.arrival,
                status: r.status,
                reference: r.reference,
                note: r.note,
              })),
            };
          }),
      );
      app.post(
        '/migration/jobs/:id/cards/request',
        {
          schema: {
            tags,
            params: idParams,
            response: { 200: z.object({ requested: z.number().int(), simulated: z.number().int() }) },
          },
        },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            { scope: 'POST /migration/jobs/:id/cards/request', key, request: { id: req.params.id } },
            async (tx) => ({ status: 200, body: await requestCardRecollections(tx, m, req.params.id) }),
          );
          return res.body;
        },
      );
    },
  };
}
