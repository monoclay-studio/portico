import { type PorticoDatabase, runIdempotent, type TxContext, withTenantTx } from '@portico/db';
import { type HttpModule, idParams, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  booking,
  bookingListQuery,
  bookingPatch,
  bookingSummary,
  changePreview,
  changeRequest,
  checkInInputs,
  checkOutInputs,
  commitRequest,
  frontDeskQuery,
  frontDeskRow,
  handover,
  handoverItem,
  handoverItemInput,
  ingestRequest,
  ingestResult,
  issue,
  newBookingInput,
  publishHandoverInput,
  quoteOffer,
  quoteRequest,
  relocationCase,
  skipStepInput,
  stay,
  stayPatch,
  workflowRun,
} from './contracts';
import type { StepKey, WorkflowKind } from './domain/workflow';
import { isForwarded, type ReservationsService } from './service';

const forwardedBody = z.object({
  forwarded: z.literal(true),
  message: z.string(),
  forwardedChange: z.object({
    id: z.uuid(),
    kind: z.string(),
    status: z.string(),
    systemName: z.string().nullable(),
    bookingId: z.uuid().nullable(),
    stayId: z.uuid().nullable(),
    createdAt: z.string(),
  }),
});
const keyEffect = z.object({
  stayId: z.uuid(),
  action: z.enum(['move', 'extend', 'cancel']),
  result: z.object({ status: z.string(), keyRefs: z.array(z.string()), message: z.string().optional() }),
});
const commitResponse = z.union([
  z.object({
    kind: z.string(),
    previewToken: z.uuid(),
    bookingId: z.uuid(),
    booking,
    keys: z.array(keyEffect),
  }),
  forwardedBody,
]);
const stayParams = z.object({ id: z.uuid() });
const stepParams = z.object({
  id: z.uuid(),
  step: z.enum(['registration', 'unit', 'guarantee', 'deposits', 'access', 'confirm', 'charges', 'settle']),
});
const propertyQuery = z.object({ propertyId: z.uuid() });

function reply202OrBody<T extends object>(reply: FastifyReply, body: T, status = 200): FastifyReply {
  if (isForwarded(body)) return reply.status(202).send(body);
  if ('version' in body && typeof body.version === 'number') setVersion(reply, body.version);
  return reply.status(status).send(body);
}

/** HTTP surface for reservations under /v1. Thin handlers: validation (Zod), transactions, ETag/If-Match/Idempotency. */
export function reservationsHttp(deps: {
  database: PorticoDatabase;
  service: ReservationsService;
}): HttpModule {
  const { database, service: svc } = deps;
  const tx = <T>(req: FastifyRequest, fn: (tx: TxContext) => Promise<T>) =>
    withTenantTx(database, req.ctx, fn);
  const idem = async <T>(
    req: FastifyRequest,
    scope: string,
    fn: (tx: TxContext) => Promise<T>,
    status = 200,
  ) => {
    const key = requireIdempotencyKey(req);
    return runIdempotent(
      database,
      req.ctx,
      { scope, key, request: { body: req.body, params: req.params } },
      async (t) => ({
        status,
        body: await fn(t),
      }),
    );
  };

  return {
    name: 'reservations',
    routes(app) {
      const tags = ['Reservations'];
      const deskTags = ['Front desk'];

      // ── quotes & bookings ──
      app.post(
        '/reservations/quotes',
        {
          schema: { tags, body: quoteRequest, response: { 200: z.object({ offers: z.array(quoteOffer) }) } },
        },
        async (req) => ({
          offers: await tx(req, (t) => svc.quote(t, req.body)),
        }),
      );

      app.post(
        '/bookings',
        { schema: { tags, body: newBookingInput, response: { 201: booking, 202: forwardedBody } } },
        async (req, reply) => {
          const res = await idem(req, 'POST /bookings', (t) => svc.createBooking(t, req.body), 201);
          return reply202OrBody(reply, res.body, 201);
        },
      );

      app.get(
        '/bookings',
        {
          schema: {
            tags,
            querystring: bookingListQuery,
            response: {
              200: z.object({ items: z.array(bookingSummary), nextCursor: z.string().nullable() }),
            },
          },
        },
        async (req) => tx(req, (t) => svc.listBookings(t, req.query)),
      );

      app.get(
        '/bookings/:id',
        { schema: { tags, params: idParams, response: { 200: booking } } },
        async (req, reply) => {
          const b = await tx(req, (t) => svc.getBooking(t, req.params.id));
          setVersion(reply, b.version);
          return b;
        },
      );

      app.patch(
        '/bookings/:id',
        {
          schema: {
            tags,
            params: idParams,
            body: bookingPatch,
            response: { 200: booking, 202: forwardedBody },
          },
        },
        async (req, reply) => {
          const expectedVersion = requireIfMatch(req);
          const b = await tx(req, (t) =>
            svc.patchBooking(t, { bookingId: req.params.id, expectedVersion, patch: req.body }),
          );
          return reply202OrBody(reply, b);
        },
      );

      app.post(
        '/bookings/:id/transitions',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({
              to: z.enum(['held', 'tentative', 'confirmed', 'declined']),
              optionDate: z.iso.date().optional(),
              reason: z.string().max(500).optional(),
            }),
            response: { 200: booking, 202: forwardedBody },
          },
        },
        async (req, reply) => {
          const expectedVersion = requireIfMatch(req);
          const res = await idem(req, `POST /bookings/${req.params.id}/transitions`, (t) =>
            svc.transitionBooking(t, { bookingId: req.params.id, expectedVersion, ...req.body }),
          );
          return reply202OrBody(reply, res.body);
        },
      );

      app.post(
        '/walk-ins',
        {
          schema: {
            tags: deskTags,
            body: newBookingInput
              .omit({ intent: true, source: true, stays: true })
              .extend({ stay: newBookingInput.shape.stays.element.partial({ arrival: true }) }),
            response: { 201: booking, 202: forwardedBody },
          },
        },
        async (req, reply) => {
          const res = await idem(req, 'POST /walk-ins', (t) => svc.createWalkIn(t, req.body), 201);
          return reply202OrBody(reply, res.body, 201);
        },
      );

      // ── change previews ──
      app.post(
        '/reservations/changes/preview',
        { schema: { tags, body: changeRequest, response: { 200: changePreview } } },
        async (req) => tx(req, (t) => svc.previewChange(t, req.body)),
      );

      app.post(
        '/reservations/changes/commit',
        { schema: { tags, body: commitRequest, response: { 200: commitResponse, 202: forwardedBody } } },
        async (req, reply) => {
          const key = requireIdempotencyKey(req);
          const res = await svc.commitChangeSafely(
            database,
            req.ctx,
            req.body,
            async (fn) =>
              (
                await runIdempotent(
                  database,
                  req.ctx,
                  { scope: 'POST /reservations/changes/commit', key, request: req.body },
                  async (t) => ({ status: 200, body: await fn(t) }),
                )
              ).body,
          );
          if (isForwarded(res)) return reply.status(202).send(res);
          setVersion(reply, res.booking.version);
          return res;
        },
      );

      // ── stays ──
      app.get(
        '/stays/:id',
        { schema: { tags, params: stayParams, response: { 200: stay } } },
        async (req, reply) => {
          const s = await tx(req, (t) => svc.getStay(t, req.params.id));
          const b = await tx(req, (t) => svc.getBookingByStay(t, req.params.id));
          setVersion(reply, b.version);
          return s;
        },
      );

      app.patch(
        '/stays/:id',
        { schema: { tags, params: stayParams, body: stayPatch, response: { 200: booking } } },
        async (req, reply) => {
          const expectedVersion = requireIfMatch(req);
          const b = await tx(req, (t) =>
            svc.patchStay(t, { stayId: req.params.id, expectedVersion, patch: req.body }),
          );
          setVersion(reply, b.version);
          return b;
        },
      );

      app.post(
        '/stays/:id/assignment',
        {
          schema: {
            tags: deskTags,
            params: stayParams,
            body: z.object({ unitId: z.uuid() }),
            response: { 200: booking },
          },
        },
        async (req, reply) => {
          const expectedVersion = requireIfMatch(req);
          const b = await tx(req, (t) =>
            svc.assignUnit(t, { stayId: req.params.id, unitId: req.body.unitId, expectedVersion }),
          );
          setVersion(reply, b.version);
          return b;
        },
      );

      app.post(
        '/stays/:id/no-show',
        {
          schema: {
            tags: deskTags,
            params: stayParams,
            response: { 200: z.record(z.string(), z.unknown()) },
          },
        },
        async (req) => {
          const key = requireIdempotencyKey(req);
          const res = await idem(req, `POST /stays/${req.params.id}/no-show`, (t) =>
            svc.markNoShow(t, { stayId: req.params.id, idempotencyKey: key }),
          );
          return res.body as unknown as Record<string, unknown>;
        },
      );

      app.post(
        '/stays/:id/waitlist/confirm',
        { schema: { tags, params: stayParams, response: { 200: booking } } },
        async (req, reply) => {
          const expectedVersion = requireIfMatch(req);
          const res = await idem(req, `POST /stays/${req.params.id}/waitlist/confirm`, (t) =>
            svc.confirmWaitlistedStay(t, { stayId: req.params.id, expectedVersion }),
          );
          setVersion(reply, res.body.version);
          return res.body;
        },
      );

      // ── check-in / check-out (resumable workflows) ──
      for (const kind of ['check_in', 'check_out'] as WorkflowKind[]) {
        const path = kind === 'check_in' ? 'check-in' : 'check-out';
        app.get(
          `/stays/:id/${path}`,
          { schema: { tags: deskTags, params: stayParams, response: { 200: workflowRun } } },
          async (req: FastifyRequest<{ Params: { id: string } }>) =>
            tx(req, (t) => svc.getWorkflow(t, { stayId: req.params.id, kind })),
        );
        app.post(
          `/stays/:id/${path}`,
          {
            schema: {
              tags: deskTags,
              params: stayParams,
              body: kind === 'check_in' ? checkInInputs.default({}) : checkOutInputs.default({}),
              response: {
                200: z.object({
                  run: workflowRun,
                  interrupted: z
                    .object({ step: z.string(), error: z.object({ code: z.string(), message: z.string() }) })
                    .nullable(),
                }),
              },
            },
          },
          async (req: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>) =>
            svc.performWorkflow(database, req.ctx, {
              stayId: req.params.id,
              kind,
              ...(kind === 'check_in' ? { checkIn: req.body } : { checkOut: req.body }),
            }),
        );
        app.post(
          `/stays/:id/${path}/steps/:step`,
          {
            schema: {
              tags: deskTags,
              params: stepParams,
              body: kind === 'check_in' ? checkInInputs.default({}) : checkOutInputs.default({}),
              response: { 200: workflowRun },
            },
          },
          async (
            req: FastifyRequest<{ Params: { id: string; step: StepKey }; Body: Record<string, unknown> }>,
          ) => {
            await tx(req, (t) => svc.startWorkflow(t, { stayId: req.params.id, kind }));
            return tx(req, (t) =>
              svc.runStep(t, {
                stayId: req.params.id,
                kind,
                step: req.params.step,
                ...(kind === 'check_in' ? { checkIn: req.body } : { checkOut: req.body }),
              }),
            );
          },
        );
        app.post(
          `/stays/:id/${path}/steps/:step/skip`,
          {
            schema: {
              tags: deskTags,
              params: stepParams,
              body: skipStepInput,
              response: { 200: workflowRun },
            },
          },
          async (req: FastifyRequest<{ Params: { id: string; step: StepKey }; Body: { reason: string } }>) =>
            tx(req, (t) =>
              svc.skipStep(t, {
                stayId: req.params.id,
                kind,
                step: req.params.step,
                reason: req.body.reason,
              }),
            ),
        );
      }

      // ── front desk ──
      const deskList = z.object({
        date: z.string(),
        businessDate: z.string(),
        items: z.array(frontDeskRow),
        counts: z.record(z.string(), z.number()),
      });
      app.get(
        '/front-desk/arrivals',
        { schema: { tags: deskTags, querystring: frontDeskQuery, response: { 200: deskList } } },
        async (req) => tx(req, (t) => svc.listArrivals(t, req.query)),
      );
      app.get(
        '/front-desk/departures',
        { schema: { tags: deskTags, querystring: frontDeskQuery, response: { 200: deskList } } },
        async (req) => tx(req, (t) => svc.listDepartures(t, req.query)),
      );
      app.get(
        '/front-desk/in-house',
        { schema: { tags: deskTags, querystring: frontDeskQuery, response: { 200: deskList } } },
        async (req) => tx(req, (t) => svc.listInHouse(t, req.query)),
      );

      // ── handover ──
      app.post(
        '/handover-items',
        { schema: { tags: deskTags, body: handoverItemInput, response: { 201: handoverItem } } },
        async (req, reply) => {
          const res = await idem(req, 'POST /handover-items', (t) => svc.addHandoverItem(t, req.body), 201);
          return reply.status(201).send(res.body);
        },
      );
      app.post(
        '/handover-items/:id/resolve',
        {
          schema: {
            tags: deskTags,
            params: idParams,
            body: z.object({ resolution: z.string().min(1).max(1000) }),
            response: { 200: handoverItem },
          },
        },
        async (req) =>
          tx(req, (t) =>
            svc.resolveHandoverItem(t, { itemId: req.params.id, resolution: req.body.resolution }),
          ),
      );
      app.post(
        '/handovers',
        { schema: { tags: deskTags, body: publishHandoverInput, response: { 201: handover } } },
        async (req, reply) => {
          const res = await idem(req, 'POST /handovers', (t) => svc.publishHandover(t, req.body), 201);
          setVersion(reply, res.body.version);
          return reply.status(201).send(res.body);
        },
      );
      app.get(
        '/handovers',
        {
          schema: {
            tags: deskTags,
            querystring: z.object({ propertyId: z.uuid(), department: z.string().optional() }),
            response: { 200: z.object({ items: z.array(handover) }) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) => svc.listHandovers(t, req.query)),
        }),
      );
      app.post(
        '/handovers/:id/acknowledge',
        { schema: { tags: deskTags, params: idParams, response: { 200: handover } } },
        async (req, reply) => {
          const expectedVersion = requireIfMatch(req);
          const h = await tx(req, (t) =>
            svc.acknowledgeHandover(t, { handoverId: req.params.id, expectedVersion }),
          );
          setVersion(reply, h.version);
          return h;
        },
      );

      // ── issues, relocation, data authority ──
      app.get(
        '/reservations/issues',
        {
          schema: {
            tags,
            querystring: propertyQuery.extend({ status: z.enum(['open', 'resolved']).optional() }),
            response: { 200: z.object({ items: z.array(issue) }) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) => svc.listIssues(t, req.query)),
        }),
      );
      app.post(
        '/reservations/issues/:id/resolve',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({ resolution: z.string().min(1).max(1000) }),
            response: { 204: z.null() },
          },
        },
        async (req, reply) => {
          await tx(req, (t) =>
            svc.resolveIssue(t, { issueId: req.params.id, resolution: req.body.resolution }),
          );
          return reply.status(204).send(null);
        },
      );
      app.get(
        '/relocation-cases',
        {
          schema: {
            tags,
            querystring: propertyQuery.extend({ status: z.string().optional() }),
            response: { 200: z.object({ items: z.array(relocationCase) }) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) => svc.listRelocationCases(t, req.query)),
        }),
      );
      app.post(
        '/relocation-cases/:id/resolve',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({
              outcome: z.enum(['completed', 'cancelled']),
              note: z.string().min(1).max(1000),
              selectedOption: z.number().int().min(0).optional(),
            }),
            response: { 204: z.null() },
          },
        },
        async (req, reply) => {
          await tx(req, (t) => svc.resolveRelocationCase(t, { caseId: req.params.id, ...req.body }));
          return reply.status(204).send(null);
        },
      );
      app.post(
        '/reservations/forwarded-changes/:id/acknowledge',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({
              outcome: z.enum(['acknowledged', 'rejected']),
              externalRef: z.string().max(200).optional(),
              detail: z.string().max(1000).optional(),
            }),
            response: { 200: forwardedBody.shape.forwardedChange },
          },
        },
        async (req) => tx(req, (t) => svc.acknowledgeForwardedChange(t, { id: req.params.id, ...req.body })),
      );

      // ── channel ingestion (integration clients / distribution) ──
      app.post(
        '/channel-bookings',
        { schema: { tags: ['Channels'], body: ingestRequest, response: { 200: ingestResult } } },
        async (req) => tx(req, (t) => svc.ingestChannelBooking(t, req.body)),
      );
    },
  };
}
