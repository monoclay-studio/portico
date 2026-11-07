import { type PorticoDatabase, runIdempotent, type TxContext, withTenantTx } from '@portico/db';
import { type HttpModule, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as c from './contracts';
import type { OperationsService } from './service';

const T = {
  hk: ['Operations · Housekeeping'],
  tasks: ['Operations · Tasks'],
  mx: ['Operations · Maintenance'],
  lf: ['Operations · Lost & found'],
  sync: ['Operations · Offline sync'],
  ext: ['Operations · Connected mode'],
};

const items = <S extends z.ZodType>(s: S) => z.object({ items: z.array(s) });
const dateQuery = z.object({ date: z.iso.date().optional() });

/**
 * HTTP surface of the operations module (mounted under /v1). Handlers are thin: validate (Zod), run the service
 * in one tenant transaction, set ETag. Creates need Idempotency-Key; updates of versioned records need If-Match.
 */
export function operationsHttp(deps: { database: PorticoDatabase; service: OperationsService }): HttpModule {
  const { database, service: ops } = deps;
  const tx = <R>(req: FastifyRequest, fn: (tx: TxContext) => Promise<R>) =>
    withTenantTx(database, req.ctx, fn);
  async function create<R>(
    req: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    fn: (tx: TxContext) => Promise<R>,
    status = 201,
  ) {
    const key = requireIdempotencyKey(req);
    const res = await runIdempotent(
      database,
      req.ctx,
      { scope, key, request: { params: req.params, body: req.body } },
      async (t) => ({ status, body: await fn(t) }),
    );
    const v = (res.body as { version?: unknown } | null)?.version;
    if (typeof v === 'number') setVersion(reply, v);
    return reply.status(res.status).send(res.body);
  }
  const versioned = <R extends { version: number }>(reply: FastifyReply, r: R) => {
    setVersion(reply, r.version);
    return r;
  };

  return {
    name: 'operations',
    routes(app) {
      // ───────────── Units, board and readiness ─────────────
      app.get(
        '/operations/properties/:propertyId/board',
        {
          schema: {
            tags: T.hk,
            params: c.propertyParams,
            querystring: c.boardQuery,
            response: { 200: c.board },
          },
        },
        (req) => tx(req, (t) => ops.board(t, req.params.propertyId, req.query)),
      );
      app.get(
        '/operations/properties/:propertyId/arrival-readiness',
        {
          schema: {
            tags: T.hk,
            params: c.propertyParams,
            querystring: dateQuery,
            response: { 200: c.arrivalReadiness },
          },
        },
        (req) => tx(req, (t) => ops.arrivalReadiness(t, req.params.propertyId, req.query.date)),
      );
      app.post(
        '/operations/properties/:propertyId/units',
        {
          schema: {
            tags: T.hk,
            params: c.propertyParams,
            body: c.unitUpsertInput,
            response: { 200: z.object({ created: z.number(), updated: z.number() }) },
          },
        },
        (req, reply) =>
          create(
            req,
            reply,
            'POST /operations/units',
            (t) => ops.upsertUnits(t, req.params.propertyId, req.body),
            200,
          ),
      );
      app.post(
        '/operations/properties/:propertyId/units/sync-from-inventory',
        {
          schema: {
            tags: T.hk,
            params: c.propertyParams,
            response: { 200: z.object({ created: z.number(), updated: z.number() }) },
          },
        },
        (req, reply) =>
          create(
            req,
            reply,
            'POST /operations/units/sync',
            (t) => ops.syncUnitsFromInventory(t, req.params.propertyId),
            200,
          ),
      );
      app.get(
        '/operations/units/:id',
        { schema: { tags: T.hk, params: c.idParams, response: { 200: c.unitStatus } } },
        async (req, reply) => versioned(reply, await tx(req, (t) => ops.getUnit(t, req.params.id))),
      );
      app.get(
        '/operations/units/:id/readiness',
        { schema: { tags: T.hk, params: c.idParams, response: { 200: c.unitStatus } } },
        async (req, reply) => versioned(reply, await tx(req, (t) => ops.getUnitReadiness(t, req.params.id))),
      );
      const unitChange = <B extends z.ZodType>(
        path: string,
        body: B,
        run: (
          t: TxContext,
          id: string,
          body: z.infer<B>,
          expectedVersion: number,
        ) => Promise<c.UnitChangeResult>,
      ) =>
        app.post(
          `/operations/units/:id/${path}`,
          { schema: { tags: T.hk, params: c.idParams, body, response: { 200: c.unitChangeResult } } },
          async (req, reply) => {
            const expected = requireIfMatch(req);
            const r = await tx(req, (t) => run(t, req.params.id, req.body as z.infer<B>, expected));
            setVersion(reply, r.unit.version);
            return r;
          },
        );
      unitChange('condition', c.conditionChangeInput, (t, id, b, v) =>
        ops.setCondition(t, id, b, { expectedVersion: v }),
      );
      unitChange('dnd', c.dndInput, (t, id, b, v) => ops.setDnd(t, id, b, { expectedVersion: v }));
      unitChange('occupancy-report', c.occupancyReportInput, (t, id, b, v) =>
        ops.reportOccupancy(t, id, b, { expectedVersion: v }),
      );
      unitChange('turndown', c.turndownInput, (t, id, b, v) =>
        ops.setTurndown(t, id, b, { expectedVersion: v }),
      );

      // ───────────── Inspections & checklists ─────────────
      app.post(
        '/operations/units/:id/inspections',
        {
          schema: {
            tags: T.hk,
            params: c.idParams,
            body: c.inspectionInput,
            response: { 201: c.inspectionResult },
          },
        },
        (req, reply) => {
          const ifMatch = req.headers['if-match'] ? requireIfMatch(req) : undefined;
          return create(req, reply, 'POST /operations/inspections', (t) =>
            ops.recordInspection(t, req.params.id, req.body, {
              ...(ifMatch !== undefined ? { expectedUnitVersion: ifMatch } : {}),
              ...(req.body.clientInspectedAt
                ? { clientInspectedAt: new Date(req.body.clientInspectedAt) }
                : {}),
            }),
          );
        },
      );
      app.get(
        '/operations/properties/:propertyId/checklists',
        { schema: { tags: T.hk, params: c.propertyParams, response: { 200: items(c.checklistTemplate) } } },
        async (req) => ({
          items: await tx(req, (t) => ops.listChecklistTemplates(t, req.params.propertyId)),
        }),
      );
      app.post(
        '/operations/properties/:propertyId/checklists',
        {
          schema: {
            tags: T.hk,
            params: c.propertyParams,
            body: c.checklistTemplateInput,
            response: { 201: c.checklistTemplate },
          },
        },
        (req, reply) =>
          create(req, reply, 'POST /operations/checklists', (t) =>
            ops.createChecklistTemplate(t, req.params.propertyId, req.body),
          ),
      );

      // ───────────── Sections, roster, planning, assignments ─────────────
      app.get(
        '/operations/properties/:propertyId/sections',
        { schema: { tags: T.hk, params: c.propertyParams, response: { 200: items(c.section) } } },
        async (req) => ({ items: await tx(req, (t) => ops.listSections(t, req.params.propertyId)) }),
      );
      app.post(
        '/operations/properties/:propertyId/sections',
        {
          schema: {
            tags: T.hk,
            params: c.propertyParams,
            body: c.sectionInput,
            response: { 201: c.section },
          },
        },
        (req, reply) =>
          create(req, reply, 'POST /operations/sections', (t) =>
            ops.createSection(t, req.params.propertyId, req.body),
          ),
      );
      app.get(
        '/operations/properties/:propertyId/attendants',
        { schema: { tags: T.hk, params: c.propertyParams, response: { 200: items(c.attendant) } } },
        async (req) => ({ items: await tx(req, (t) => ops.listAttendants(t, req.params.propertyId)) }),
      );
      app.post(
        '/operations/properties/:propertyId/attendants',
        {
          schema: {
            tags: T.hk,
            params: c.propertyParams,
            body: c.attendantInput,
            response: { 201: c.attendant },
          },
        },
        (req, reply) =>
          create(req, reply, 'POST /operations/attendants', (t) =>
            ops.upsertAttendant(t, req.params.propertyId, req.body),
          ),
      );
      app.post(
        '/operations/properties/:propertyId/housekeeping/plan',
        {
          schema: {
            tags: T.hk,
            params: c.propertyParams,
            body: c.dayPlanInput,
            response: { 201: c.dayPlanResult },
          },
        },
        (req, reply) =>
          create(req, reply, 'POST /operations/housekeeping/plan', (t) =>
            ops.generateDayPlan(t, req.params.propertyId, req.body),
          ),
      );
      app.get(
        '/operations/properties/:propertyId/housekeeping/assignment-suggestions',
        {
          schema: {
            tags: T.hk,
            params: c.propertyParams,
            querystring: c.assignmentSuggestionQuery,
            response: { 200: c.assignmentSuggestions },
          },
        },
        (req) => tx(req, (t) => ops.suggestAssignments(t, req.params.propertyId, req.query)),
      );
      app.post(
        '/operations/properties/:propertyId/housekeeping/assignments',
        {
          schema: {
            tags: T.hk,
            params: c.propertyParams,
            body: c.applyAssignmentsInput,
            response: { 200: c.applyAssignmentsResult },
          },
        },
        (req, reply) =>
          create(
            req,
            reply,
            'POST /operations/housekeeping/assignments',
            (t) => ops.applyAssignments(t, req.params.propertyId, req.body),
            200,
          ),
      );

      // ───────────── Tasks ─────────────
      app.get(
        '/operations/tasks',
        { schema: { tags: T.tasks, querystring: c.taskListQuery, response: { 200: items(c.task) } } },
        async (req) => ({ items: await tx(req, (t) => ops.listTasks(t, req.query)) }),
      );
      app.post(
        '/operations/tasks',
        { schema: { tags: T.tasks, body: c.taskCreateInput, response: { 201: c.task } } },
        (req, reply) =>
          create(req, reply, 'POST /operations/tasks', (t) => ops.createGenericTask(t, req.body)),
      );
      app.get(
        '/operations/tasks/:id',
        { schema: { tags: T.tasks, params: c.idParams, response: { 200: c.taskDetail } } },
        async (req, reply) => versioned(reply, await tx(req, (t) => ops.getTask(t, req.params.id))),
      );
      app.post(
        '/operations/tasks/:id/transitions',
        {
          schema: {
            tags: T.tasks,
            params: c.idParams,
            body: c.taskTransitionInput,
            response: { 200: c.task },
          },
        },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          return versioned(
            reply,
            await tx(req, (t) =>
              ops.transitionTask(t, req.params.id, req.body, { expectedVersion: expected }),
            ),
          );
        },
      );
      app.post(
        '/operations/tasks/:id/assignment',
        { schema: { tags: T.tasks, params: c.idParams, body: c.taskAssignInput, response: { 200: c.task } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          return versioned(
            reply,
            await tx(req, (t) => ops.assignTask(t, req.params.id, req.body, { expectedVersion: expected })),
          );
        },
      );
      app.post(
        '/operations/tasks/:id/comments',
        {
          schema: { tags: T.tasks, params: c.idParams, body: c.taskCommentInput, response: { 201: c.task } },
        },
        (req, reply) =>
          create(req, reply, 'POST /operations/tasks/comments', (t) =>
            ops.commentTask(t, req.params.id, req.body),
          ),
      );
      app.post(
        '/operations/properties/:propertyId/escalations/run',
        { schema: { tags: T.tasks, params: c.propertyParams, response: { 200: c.escalationRunResult } } },
        (req) => tx(req, (t) => ops.runEscalations(t, req.params.propertyId)),
      );

      app.post(
        '/operations/stays/:id/guest-waiting',
        {
          schema: {
            tags: T.hk,
            params: c.idParams,
            body: z.object({ waiting: z.boolean() }),
            response: {
              200: z.object({
                stayId: z.uuid(),
                unitId: z.uuid().nullable(),
                waitingSince: z.string().nullable(),
              }),
            },
          },
        },
        (req) => tx(req, (t) => ops.setGuestWaiting(t, { stayId: req.params.id, waiting: req.body.waiting })),
      );
      app.get(
        '/operations/my-work',
        { schema: { tags: T.tasks, querystring: c.myWorkQuery, response: { 200: items(c.workItem) } } },
        async (req) => ({ items: await tx(req, (t) => ops.listMyWork(t, req.query)) }),
      );

      // ───────────── Service requests ─────────────
      app.get(
        '/operations/service-requests',
        {
          schema: {
            tags: T.tasks,
            querystring: z.object({
              propertyId: z.uuid(),
              status: z.string().max(20).optional(),
              stayId: z.uuid().optional(),
            }),
            response: { 200: items(c.serviceRequest) },
          },
        },
        async (req) => ({ items: await tx(req, (t) => ops.listServiceRequests(t, req.query)) }),
      );
      app.post(
        '/operations/service-requests',
        { schema: { tags: T.tasks, body: c.serviceRequestInput, response: { 201: c.serviceRequest } } },
        (req, reply) =>
          create(req, reply, 'POST /operations/service-requests', (t) =>
            ops.createServiceRequest(t, req.body),
          ),
      );
      app.get(
        '/operations/service-requests/:id',
        { schema: { tags: T.tasks, params: c.idParams, response: { 200: c.serviceRequest } } },
        async (req, reply) => versioned(reply, await tx(req, (t) => ops.getServiceRequest(t, req.params.id))),
      );

      // ───────────── Maintenance ─────────────
      app.get(
        '/operations/properties/:propertyId/assets',
        {
          schema: {
            tags: T.mx,
            params: c.propertyParams,
            querystring: z.object({
              category: z.string().max(60).optional(),
              kind: z.string().max(20).optional(),
            }),
            response: { 200: items(c.asset) },
          },
        },
        async (req) => ({ items: await tx(req, (t) => ops.listAssets(t, req.params.propertyId, req.query)) }),
      );
      app.post(
        '/operations/properties/:propertyId/assets',
        { schema: { tags: T.mx, params: c.propertyParams, body: c.assetInput, response: { 201: c.asset } } },
        (req, reply) =>
          create(req, reply, 'POST /operations/assets', (t) =>
            ops.createAsset(t, req.params.propertyId, req.body),
          ),
      );
      app.get(
        '/operations/assets/:id',
        { schema: { tags: T.mx, params: c.idParams, response: { 200: c.asset } } },
        async (req, reply) => versioned(reply, await tx(req, (t) => ops.getAsset(t, req.params.id))),
      );
      app.patch(
        '/operations/assets/:id',
        { schema: { tags: T.mx, params: c.idParams, body: c.assetUpdateInput, response: { 200: c.asset } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          return versioned(
            reply,
            await tx(req, (t) => ops.updateAsset(t, req.params.id, expected, req.body)),
          );
        },
      );
      app.get(
        '/operations/assets/:id/history',
        { schema: { tags: T.mx, params: c.idParams, response: { 200: c.assetHistory } } },
        (req) => tx(req, (t) => ops.assetHistory(t, req.params.id)),
      );
      app.get(
        '/operations/work-orders',
        { schema: { tags: T.mx, querystring: c.workOrderListQuery, response: { 200: items(c.workOrder) } } },
        async (req) => ({ items: await tx(req, (t) => ops.listWorkOrders(t, req.query)) }),
      );
      app.post(
        '/operations/work-orders',
        { schema: { tags: T.mx, body: c.workOrderInput, response: { 201: c.workOrder } } },
        (req, reply) =>
          create(req, reply, 'POST /operations/work-orders', (t) => ops.createWorkOrder(t, req.body)),
      );
      app.get(
        '/operations/work-orders/:id',
        { schema: { tags: T.mx, params: c.idParams, response: { 200: c.workOrder } } },
        async (req, reply) => versioned(reply, await tx(req, (t) => ops.getWorkOrder(t, req.params.id))),
      );
      const woAction = <B extends z.ZodType>(
        path: string,
        body: B,
        run: (t: TxContext, id: string, expected: number, body: z.infer<B>) => Promise<c.WorkOrderView>,
      ) =>
        app.post(
          `/operations/work-orders/:id/${path}`,
          { schema: { tags: T.mx, params: c.idParams, body, response: { 200: c.workOrder } } },
          async (req, reply) => {
            const expected = requireIfMatch(req);
            return versioned(
              reply,
              await tx(req, (t) => run(t, req.params.id, expected, req.body as z.infer<B>)),
            );
          },
        );
      woAction('block', c.blockRequestInput, (t, id, v, b) =>
        ops.requestUnitBlock(t, id, b, { expectedVersion: v }),
      );
      woAction('parts', c.workOrderPartsInput, (t, id, v, b) => ops.addWorkOrderParts(t, id, v, b.parts));
      woAction('photos', c.workOrderPhotosInput, (t, id, v, b) => ops.addWorkOrderPhotos(t, id, v, b.photos));
      woAction('complete', c.workOrderCompleteInput, (t, id, v, b) => ops.completeWorkOrder(t, id, v, b));
      woAction('return-to-service', z.object({}).optional(), (t, id, v) => ops.returnToService(t, id, v));
      app.get(
        '/operations/properties/:propertyId/resolution-items',
        {
          schema: {
            tags: T.mx,
            params: c.propertyParams,
            querystring: z.object({ status: z.enum(['open', 'resolved', 'dismissed']).optional() }),
            response: { 200: items(c.resolutionItem) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) => ops.listResolutionItems(t, req.params.propertyId, req.query.status)),
        }),
      );
      app.get(
        '/operations/resolution-items/:id',
        { schema: { tags: T.mx, params: c.idParams, response: { 200: c.resolutionItem } } },
        async (req, reply) => versioned(reply, await tx(req, (t) => ops.getResolutionItem(t, req.params.id))),
      );
      app.get(
        '/operations/preventive-schedules/:id',
        { schema: { tags: T.mx, params: c.idParams, response: { 200: c.preventiveSchedule } } },
        async (req, reply) =>
          versioned(reply, await tx(req, (t) => ops.getPreventiveSchedule(t, req.params.id))),
      );
      app.post(
        '/operations/resolution-items/:id/resolve',
        {
          schema: {
            tags: T.mx,
            params: c.idParams,
            body: c.resolveItemInput,
            response: { 200: c.resolutionItem },
          },
        },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          return versioned(
            reply,
            await tx(req, (t) => ops.resolveResolutionItem(t, req.params.id, expected, req.body)),
          );
        },
      );
      app.get(
        '/operations/properties/:propertyId/preventive-schedules',
        { schema: { tags: T.mx, params: c.propertyParams, response: { 200: items(c.preventiveSchedule) } } },
        async (req) => ({
          items: await tx(req, (t) => ops.listPreventiveSchedules(t, req.params.propertyId)),
        }),
      );
      app.post(
        '/operations/properties/:propertyId/preventive-schedules',
        {
          schema: {
            tags: T.mx,
            params: c.propertyParams,
            body: c.preventiveScheduleInput,
            response: { 201: c.preventiveSchedule },
          },
        },
        (req, reply) =>
          create(req, reply, 'POST /operations/preventive-schedules', (t) =>
            ops.createPreventiveSchedule(t, req.params.propertyId, req.body),
          ),
      );
      app.post(
        '/operations/properties/:propertyId/preventive-schedules/run',
        {
          schema: {
            tags: T.mx,
            params: c.propertyParams,
            body: c.preventiveRunInput,
            response: { 200: c.preventiveRunResult },
          },
        },
        (req, reply) =>
          create(
            req,
            reply,
            'POST /operations/preventive-schedules/run',
            (t) => ops.runPreventiveSchedules(t, req.params.propertyId, req.body.asOf),
            200,
          ),
      );

      // ───────────── Lost & found ─────────────
      app.get(
        '/operations/lost-found',
        {
          schema: {
            tags: T.lf,
            querystring: z.object({
              propertyId: z.uuid(),
              status: z.enum(['stored', 'matched', 'released', 'disposed']).optional(),
              stayId: z.uuid().optional(),
            }),
            response: { 200: items(c.lostFoundItem) },
          },
        },
        async (req) => ({ items: await tx(req, (t) => ops.listLostFound(t, req.query)) }),
      );
      app.post(
        '/operations/lost-found',
        { schema: { tags: T.lf, body: c.lostFoundInput, response: { 201: c.lostFoundItem } } },
        (req, reply) =>
          create(req, reply, 'POST /operations/lost-found', (t) => ops.recordLostFound(t, req.body)),
      );
      app.get(
        '/operations/lost-found/:id',
        { schema: { tags: T.lf, params: c.idParams, response: { 200: c.lostFoundItem } } },
        async (req, reply) => versioned(reply, await tx(req, (t) => ops.getLostFound(t, req.params.id))),
      );
      const lfAction = <B extends z.ZodType>(
        path: string,
        body: B,
        run: (t: TxContext, id: string, expected: number, body: z.infer<B>) => Promise<c.LostFoundView>,
      ) =>
        app.post(
          `/operations/lost-found/:id/${path}`,
          { schema: { tags: T.lf, params: c.idParams, body, response: { 200: c.lostFoundItem } } },
          async (req, reply) => {
            const expected = requireIfMatch(req);
            return versioned(
              reply,
              await tx(req, (t) => run(t, req.params.id, expected, req.body as z.infer<B>)),
            );
          },
        );
      lfAction('match', c.lostFoundMatchInput, (t, id, v, b) => ops.matchLostFound(t, id, v, b));
      lfAction('release', c.lostFoundReleaseInput, (t, id, v, b) => ops.releaseLostFound(t, id, v, b));
      lfAction('dispose', c.lostFoundDisposeInput, (t, id, v, b) => ops.disposeLostFound(t, id, v, b));

      // ───────────── Offline sync (staff app) ─────────────
      app.post(
        '/operations/sync/mutations',
        { schema: { tags: T.sync, body: c.syncBatchInput, response: { 200: c.syncBatchResult } } },
        // Each mutation carries its own client mutation id (dedupe), so no Idempotency-Key is needed here.
        (req) => ops.applySyncBatch(database, req.ctx, req.body),
      );
      app.get(
        '/operations/sync/changes',
        { schema: { tags: T.sync, querystring: c.changesQuery, response: { 200: c.changes } } },
        (req) => tx(req, (t) => ops.pullChanges(t, req.query)),
      );

      app.get(
        '/operations/properties/:propertyId/sync-conflicts',
        {
          schema: {
            tags: T.sync,
            params: c.propertyParams,
            querystring: z.object({ since: z.iso.datetime({ offset: true }).optional() }),
            response: { 200: items(c.syncConflict) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) =>
            ops.listSyncConflicts(
              t,
              req.params.propertyId,
              req.query.since ? { since: new Date(req.query.since) } : {},
            ),
          ),
        }),
      );

      // ───────────── Connected mode (external system of record) ─────────────
      app.get(
        '/operations/properties/:propertyId/forwards',
        {
          schema: {
            tags: T.ext,
            params: c.propertyParams,
            querystring: z.object({
              status: z.enum(['pending', 'acknowledged', 'rejected', 'superseded']).optional(),
            }),
            response: { 200: items(c.statusForward) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) => ops.listForwards(t, req.params.propertyId, req.query.status)),
        }),
      );
      app.post(
        '/operations/forwards/:id/acknowledge',
        {
          schema: {
            tags: T.ext,
            params: c.idParams,
            body: c.forwardAckInput,
            response: { 200: c.statusForward },
          },
        },
        (req) => tx(req, (t) => ops.acknowledgeForward(t, req.params.id, req.body)),
      );
      app.post(
        '/operations/units/:id/external-status',
        {
          schema: {
            tags: T.ext,
            params: c.idParams,
            body: c.externalRoomStatusInput,
            response: { 200: c.unitStatus },
          },
        },
        async (req, reply) =>
          versioned(
            reply,
            await tx(req, (t) =>
              ops.applyExternalRoomStatus(t, req.params.id, {
                ...req.body,
                observedAt: new Date(req.body.observedAt),
              }),
            ),
          ),
      );
    },
  };
}
