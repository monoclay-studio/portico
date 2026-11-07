import { type PorticoDatabase, runIdempotent, withTenantTx } from '@portico/db';
import { type HttpModule, idParams, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import { z } from 'zod';
import {
  assignableQuery,
  assignment,
  assignmentsQuery,
  availabilityExplanation,
  availabilityGrid,
  availabilityQuery,
  blocksQuery,
  compositeUnitInput,
  conflictQuery,
  conflictUpdate,
  explanationQuery,
  feature,
  featureInput,
  featureUpdate,
  inventoryConflict,
  inventoryConflictRecord,
  listQuery,
  overbookingAllowance,
  overbookingAllowanceInput,
  overbookingAllowanceResult,
  propertyParams,
  releaseBlockInput,
  unit,
  unitBlock,
  unitBlockInput,
  unitBlockPreview,
  unitBlockRecord,
  unitCandidate,
  unitChangePreview,
  unitChangePreviewInput,
  unitInput,
  unitRecord,
  unitsQuery,
  unitType,
  unitTypeInput,
  unitTypeRecord,
  unitTypeUpdate,
  unitUpdate,
} from './contracts';
import type { InventoryService } from './service';

const tags = ['Inventory'];
const csv = (v: string | undefined) =>
  v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
const ref = (q: { refType?: string | undefined; refId?: string | undefined }) =>
  q.refType && q.refId ? { type: q.refType, id: q.refId } : undefined;

/**
 * HTTP surface: configuration (features, unit types, units, composite units), availability grid and
 * explanations, assignable units and assignments (read), unit blocks with preview, authorized overbooking and the
 * inventory-conflict queue. Consumption, holds and assignment writes are provider calls made inside other
 * modules' commands (reservations, groups, distribution) and are not exposed here.
 */
export function inventoryHttp(deps: { database: PorticoDatabase; inventory: InventoryService }): HttpModule {
  const { database, inventory } = deps;
  return {
    name: 'inventory',
    routes(app) {
      // ── features catalog ──
      app.get(
        '/properties/:propertyId/unit-features',
        {
          schema: {
            tags,
            params: propertyParams,
            querystring: listQuery,
            response: { 200: z.object({ items: z.array(feature) }) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) =>
            inventory.listFeatures(tx, req.params.propertyId, {
              includeArchived: req.query.includeArchived === 'true',
            }),
          ),
        }),
      );
      app.post(
        '/properties/:propertyId/unit-features',
        { schema: { tags, params: propertyParams, body: featureInput, response: { 201: feature } } },
        async (req, reply) => {
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: 'POST /unit-features',
              key: requireIdempotencyKey(req),
              request: { params: req.params, body: req.body },
            },
            async (tx) => ({
              status: 201,
              body: await inventory.createFeature(tx, req.params.propertyId, req.body),
            }),
          );
          setVersion(reply, res.body.version);
          return reply.status(201).send(res.body);
        },
      );
      app.patch(
        '/unit-features/:id',
        { schema: { tags, params: idParams, body: featureUpdate, response: { 200: feature } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const f = await withTenantTx(database, req.ctx, (tx) =>
            inventory.updateFeature(tx, req.params.id, expected, req.body),
          );
          setVersion(reply, f.version);
          return f;
        },
      );

      // ── unit types ──
      app.get(
        '/properties/:propertyId/unit-types',
        {
          schema: {
            tags,
            params: propertyParams,
            querystring: listQuery,
            response: { 200: z.object({ items: z.array(unitType) }) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) =>
            inventory.listUnitTypes(tx, req.params.propertyId, {
              includeArchived: req.query.includeArchived === 'true',
            }),
          ),
        }),
      );
      app.post(
        '/properties/:propertyId/unit-types',
        { schema: { tags, params: propertyParams, body: unitTypeInput, response: { 201: unitTypeRecord } } },
        async (req, reply) => {
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: 'POST /unit-types',
              key: requireIdempotencyKey(req),
              request: { params: req.params, body: req.body },
            },
            async (tx) => {
              const created = await inventory.createUnitType(tx, req.params.propertyId, req.body);
              return { status: 201, body: await inventory.getUnitTypeRecord(tx, created.id) };
            },
          );
          setVersion(reply, res.body.version);
          return reply.status(201).send(res.body);
        },
      );
      app.get(
        '/unit-types/:id',
        { schema: { tags, params: idParams, response: { 200: unitTypeRecord } } },
        async (req, reply) => {
          const r = await withTenantTx(database, req.ctx, (tx) =>
            inventory.getUnitTypeRecord(tx, req.params.id),
          );
          setVersion(reply, r.version);
          return r;
        },
      );
      app.patch(
        '/unit-types/:id',
        { schema: { tags, params: idParams, body: unitTypeUpdate, response: { 200: unitTypeRecord } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const r = await withTenantTx(database, req.ctx, async (tx) => {
            await inventory.updateUnitType(tx, req.params.id, expected, req.body);
            return inventory.getUnitTypeRecord(tx, req.params.id);
          });
          setVersion(reply, r.version);
          return r;
        },
      );

      // ── units ──
      app.get(
        '/properties/:propertyId/units',
        {
          schema: {
            tags,
            params: propertyParams,
            querystring: unitsQuery,
            response: { 200: z.object({ items: z.array(unit) }) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) =>
            inventory.listUnits(tx, req.params.propertyId, {
              ...(req.query.unitTypeId ? { unitTypeId: req.query.unitTypeId } : {}),
              status: req.query.status,
            }),
          ),
        }),
      );
      app.post(
        '/properties/:propertyId/units',
        { schema: { tags, params: propertyParams, body: unitInput, response: { 201: unitRecord } } },
        async (req, reply) => {
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: 'POST /units',
              key: requireIdempotencyKey(req),
              request: { params: req.params, body: req.body },
            },
            async (tx) => {
              const created = await inventory.createUnit(tx, req.params.propertyId, req.body);
              return { status: 201, body: await inventory.getUnitRecord(tx, created.id) };
            },
          );
          setVersion(reply, res.body.version);
          return reply.status(201).send(res.body);
        },
      );
      app.post(
        '/properties/:propertyId/composite-units',
        { schema: { tags, params: propertyParams, body: compositeUnitInput, response: { 201: unitRecord } } },
        async (req, reply) => {
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: 'POST /composite-units',
              key: requireIdempotencyKey(req),
              request: { params: req.params, body: req.body },
            },
            async (tx) => {
              const created = await inventory.createCompositeUnit(tx, req.params.propertyId, req.body);
              return { status: 201, body: await inventory.getUnitRecord(tx, created.id) };
            },
          );
          setVersion(reply, res.body.version);
          return reply.status(201).send(res.body);
        },
      );
      app.get(
        '/units/:id',
        { schema: { tags, params: idParams, response: { 200: unitRecord } } },
        async (req, reply) => {
          const r = await withTenantTx(database, req.ctx, (tx) => inventory.getUnitRecord(tx, req.params.id));
          setVersion(reply, r.version);
          return r;
        },
      );
      app.patch(
        '/units/:id',
        { schema: { tags, params: idParams, body: unitUpdate, response: { 200: unitRecord } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const r = await withTenantTx(database, req.ctx, async (tx) => {
            await inventory.updateUnit(tx, req.params.id, expected, req.body);
            return inventory.getUnitRecord(tx, req.params.id);
          });
          setVersion(reply, r.version);
          return r;
        },
      );

      app.post(
        '/units/:id/preview-change',
        {
          schema: {
            tags,
            params: idParams,
            body: unitChangePreviewInput,
            response: { 200: unitChangePreview },
          },
        },
        async (req) =>
          withTenantTx(database, req.ctx, (tx) =>
            inventory.previewUnitChange(tx, req.params.id, {
              ...(req.body.status !== undefined ? { status: req.body.status } : {}),
              ...(req.body.inInventoryTo !== undefined ? { inInventoryTo: req.body.inInventoryTo } : {}),
            }),
          ),
      );

      // ── availability ──
      app.get(
        '/properties/:propertyId/availability',
        {
          schema: {
            tags,
            params: propertyParams,
            querystring: availabilityQuery,
            response: { 200: availabilityGrid },
          },
        },
        async (req) => {
          const unitTypeIds = csv(req.query.unitTypeIds);
          return withTenantTx(database, req.ctx, (tx) =>
            inventory.getAvailabilityGrid(tx, {
              propertyId: req.params.propertyId,
              range: { from: req.query.from, to: req.query.to },
              ...(unitTypeIds ? { unitTypeIds } : {}),
            }),
          );
        },
      );
      app.get(
        '/properties/:propertyId/availability/explanation',
        {
          schema: {
            tags,
            params: propertyParams,
            querystring: explanationQuery,
            response: { 200: availabilityExplanation },
          },
        },
        async (req) =>
          withTenantTx(database, req.ctx, (tx) =>
            inventory.explainAvailability(tx, {
              propertyId: req.params.propertyId,
              unitTypeId: req.query.unitTypeId,
              date: req.query.date,
            }),
          ),
      );

      // ── assignments (read) ──
      app.get(
        '/properties/:propertyId/assignable-units',
        {
          schema: {
            tags,
            params: propertyParams,
            querystring: assignableQuery,
            response: { 200: z.object({ items: z.array(unitCandidate) }) },
          },
        },
        async (req) => {
          const features = csv(req.query.features);
          const forRef = ref(req.query);
          return {
            items: await withTenantTx(database, req.ctx, (tx) =>
              inventory.findAssignableUnits(tx, {
                propertyId: req.params.propertyId,
                unitTypeId: req.query.unitTypeId,
                nights: { from: req.query.from, to: req.query.to },
                ...(features ? { features } : {}),
                ...(forRef ? { ref: forRef } : {}),
              }),
            ),
          };
        },
      );
      app.get(
        '/properties/:propertyId/assignments',
        {
          schema: {
            tags,
            params: propertyParams,
            querystring: assignmentsQuery,
            response: { 200: z.object({ items: z.array(assignment) }) },
          },
        },
        async (req) => {
          const forRef = ref(req.query);
          return {
            items: await withTenantTx(database, req.ctx, (tx) =>
              inventory.listAssignments(tx, {
                propertyId: req.params.propertyId,
                range: { from: req.query.from, to: req.query.to },
                ...(req.query.unitId ? { unitId: req.query.unitId } : {}),
                ...(forRef ? { ref: forRef } : {}),
              }),
            ),
          };
        },
      );

      // ── unit blocks ──
      app.get(
        '/properties/:propertyId/unit-blocks',
        {
          schema: {
            tags,
            params: propertyParams,
            querystring: blocksQuery,
            response: { 200: z.object({ items: z.array(unitBlock) }) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) =>
            inventory.listBlocks(tx, {
              propertyId: req.params.propertyId,
              range: { from: req.query.from, to: req.query.to },
              ...(req.query.unitId ? { unitId: req.query.unitId } : {}),
              status: req.query.status,
            }),
          ),
        }),
      );
      app.post(
        '/properties/:propertyId/unit-blocks/preview',
        {
          schema: { tags, params: propertyParams, body: unitBlockInput, response: { 200: unitBlockPreview } },
        },
        async (req) =>
          withTenantTx(database, req.ctx, (tx) =>
            inventory.previewBlock(tx, { ...req.body, propertyId: req.params.propertyId }),
          ),
      );
      app.post(
        '/properties/:propertyId/unit-blocks',
        {
          schema: {
            tags,
            params: propertyParams,
            body: unitBlockInput,
            response: {
              201: z.object({
                block: unitBlockRecord,
                affectedAssignments: unitBlockPreview.shape.affectedAssignments,
                conflictsCreated: z.array(z.uuid()),
              }),
            },
          },
        },
        async (req, reply) => {
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: 'POST /unit-blocks',
              key: requireIdempotencyKey(req),
              request: { params: req.params, body: req.body },
            },
            async (tx) => {
              const r = await inventory.blockUnit(tx, { ...req.body, propertyId: req.params.propertyId });
              return {
                status: 201,
                body: {
                  block: await inventory.getBlockRecord(tx, r.blockId),
                  affectedAssignments: r.affectedAssignments,
                  conflictsCreated: r.conflictsCreated,
                },
              };
            },
          );
          setVersion(reply, res.body.block.version);
          return reply.status(201).send(res.body);
        },
      );
      app.get(
        '/unit-blocks/:id',
        { schema: { tags, params: idParams, response: { 200: unitBlockRecord } } },
        async (req, reply) => {
          const r = await withTenantTx(database, req.ctx, (tx) =>
            inventory.getBlockRecord(tx, req.params.id),
          );
          setVersion(reply, r.version);
          return r;
        },
      );
      app.post(
        '/unit-blocks/:id/release',
        { schema: { tags, params: idParams, body: releaseBlockInput, response: { 200: unitBlockRecord } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: 'POST /unit-blocks/release',
              key: requireIdempotencyKey(req),
              request: { params: req.params, body: req.body },
            },
            async (tx) => {
              await inventory.releaseBlock(tx, {
                blockId: req.params.id,
                expectedVersion: expected,
                ...(req.body.reason ? { reason: req.body.reason } : {}),
              });
              return { status: 200, body: await inventory.getBlockRecord(tx, req.params.id) };
            },
          );
          setVersion(reply, res.body.version);
          return res.body;
        },
      );

      // ── authorized overbooking ──
      app.get(
        '/properties/:propertyId/overbooking-allowances',
        {
          schema: {
            tags,
            params: propertyParams,
            querystring: z.object({ from: z.iso.date(), to: z.iso.date(), unitTypeId: z.uuid().optional() }),
            response: { 200: z.object({ items: z.array(overbookingAllowance) }) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) =>
            inventory.listOverbookingAllowances(tx, {
              propertyId: req.params.propertyId,
              range: { from: req.query.from, to: req.query.to },
              ...(req.query.unitTypeId ? { unitTypeId: req.query.unitTypeId } : {}),
            }),
          ),
        }),
      );
      app.post(
        '/properties/:propertyId/overbooking-allowances',
        {
          schema: {
            tags,
            params: propertyParams,
            body: overbookingAllowanceInput,
            response: { 201: overbookingAllowanceResult },
          },
        },
        async (req, reply) => {
          const res = await runIdempotent(
            database,
            req.ctx,
            {
              scope: 'POST /overbooking-allowances',
              key: requireIdempotencyKey(req),
              request: { params: req.params, body: req.body },
            },
            async (tx) => ({
              status: 201,
              body: await inventory.setOverbookingAllowance(tx, req.params.propertyId, req.body),
            }),
          );
          return reply.status(201).send(res.body);
        },
      );

      // ── inventory conflicts ──
      app.get(
        '/properties/:propertyId/inventory-conflicts',
        {
          schema: {
            tags,
            params: propertyParams,
            querystring: conflictQuery,
            response: { 200: z.object({ items: z.array(inventoryConflict) }) },
          },
        },
        async (req) => ({
          items: await withTenantTx(database, req.ctx, (tx) =>
            inventory.listConflicts(tx, {
              propertyId: req.params.propertyId,
              status: req.query.status,
              ...(req.query.from && req.query.to
                ? { range: { from: req.query.from, to: req.query.to } }
                : {}),
            }),
          ),
        }),
      );
      app.get(
        '/inventory-conflicts/:id',
        { schema: { tags, params: idParams, response: { 200: inventoryConflictRecord } } },
        async (req, reply) => {
          const r = await withTenantTx(database, req.ctx, (tx) =>
            inventory.getConflictRecord(tx, req.params.id),
          );
          setVersion(reply, r.version);
          return r;
        },
      );
      app.patch(
        '/inventory-conflicts/:id',
        {
          schema: {
            tags,
            params: idParams,
            body: conflictUpdate,
            response: { 200: inventoryConflictRecord },
          },
        },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          const r = await withTenantTx(database, req.ctx, async (tx) => {
            await inventory.updateConflict(tx, req.params.id, expected, req.body);
            return inventory.getConflictRecord(tx, req.params.id);
          });
          setVersion(reply, r.version);
          return r;
        },
      );
    },
  };
}
