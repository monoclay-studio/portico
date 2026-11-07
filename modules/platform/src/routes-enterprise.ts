import { type PorticoDatabase, runIdempotent, type TxContext, withTenantTx } from '@portico/db';
import { idParams, type PorticoApp, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import { ExternalServiceError, requirePermission } from '@portico/kernel';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as svc from './api';
import {
  activationOverview,
  activationRequest,
  activationScopeContent,
  authorityHistoryEntry,
  authorityTransition,
  authorityTransitionInput,
  bundleExportInput,
  bundleImportInput,
  closeTrialInput,
  configurationBundle,
  configurationChange,
  configurationChangeInput,
  createTrialInput,
  dataAuthority,
  dataDomain,
  decisionInput,
  directStatusChangeInput,
  endShareInput,
  entitlementSummary,
  environmentInfo,
  linkedEnvironment,
  outlet,
  outletInput,
  outletUpdate,
  owner,
  ownerInput,
  ownershipShare,
  ownershipShareInput,
  ownerUpdate,
  pullTrialConfigurationInput,
  resetTrialInput,
  rolloutGroup,
  rolloutGroupInput,
  scopeChangeRequestInput,
  setDataAuthorityInput,
  statusChangeRequestInput,
  trialImportInput,
  unitOwnership,
} from './contracts';
import type { PlatformPorts } from './ports';

const propertyParams = z.object({ id: z.uuid() });
const reasonInput = z.object({ reason: z.string().min(3).max(1000) });

/** Run a command; with an Idempotency-Key header it is exactly-once (retries replay the stored response). */
async function command<T>(
  database: PorticoDatabase,
  req: FastifyRequest,
  scope: string,
  request: unknown,
  fn: (tx: TxContext) => Promise<T>,
  status = 200,
): Promise<T> {
  const key = req.headers['idempotency-key'];
  if (typeof key === 'string' && key.length > 0) {
    const res = await runIdempotent(database, req.ctx, { scope, key, request }, async (tx) => ({
      status,
      body: await fn(tx),
    }));
    return res.body;
  }
  return withTenantTx(database, req.ctx, fn);
}

/** Create: Idempotency-Key required. */
async function create<T>(
  database: PorticoDatabase,
  req: FastifyRequest,
  scope: string,
  request: unknown,
  fn: (tx: TxContext) => Promise<T>,
): Promise<T> {
  const key = requireIdempotencyKey(req);
  const res = await runIdempotent(database, req.ctx, { scope, key, request }, async (tx) => ({
    status: 201,
    body: await fn(tx),
  }));
  return res.body;
}

export function registerEnterpriseRoutes(
  app: PorticoApp,
  database: PorticoDatabase,
  ports: PlatformPorts,
): void {
  // ── Entitlements ──
  app.get(
    '/organization/entitlements',
    { schema: { tags: ['Organization'], response: { 200: entitlementSummary } } },
    (req) => withTenantTx(database, req.ctx, (tx) => svc.getEntitlementSummary(tx)),
  );

  // ── Data authority ──
  app.get(
    '/properties/:id/data-authority',
    {
      schema: {
        tags: ['Data authority'],
        params: propertyParams,
        response: { 200: z.object({ items: z.array(dataAuthority) }) },
      },
    },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) => svc.listDataAuthority(tx, req.params.id)),
    }),
  );
  app.post(
    '/properties/:id/data-authority',
    {
      schema: {
        tags: ['Data authority'],
        params: propertyParams,
        body: setDataAuthorityInput,
        response: { 200: dataAuthority },
      },
    },
    (req) =>
      command(database, req, `POST /properties/${req.params.id}/data-authority`, req.body, (tx) =>
        svc.setDataAuthority(tx, { propertyId: req.params.id, ...req.body }),
      ),
  );
  app.get(
    '/properties/:id/data-authority/history',
    {
      schema: {
        tags: ['Data authority'],
        params: propertyParams,
        querystring: z.object({ domain: dataDomain.optional() }),
        response: { 200: z.object({ items: z.array(authorityHistoryEntry) }) },
      },
    },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) =>
        svc.listDataAuthorityHistory(tx, req.params.id, req.query.domain),
      ),
    }),
  );
  app.get(
    '/properties/:id/authority-transitions',
    {
      schema: {
        tags: ['Data authority'],
        params: propertyParams,
        response: { 200: z.object({ items: z.array(authorityTransition) }) },
      },
    },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) => svc.listAuthorityTransitions(tx, req.params.id)),
    }),
  );
  app.post(
    '/properties/:id/authority-transitions',
    {
      schema: {
        tags: ['Data authority'],
        params: propertyParams,
        body: authorityTransitionInput,
        response: { 201: authorityTransition },
      },
    },
    async (req, reply) => {
      const t = await create(
        database,
        req,
        `POST /properties/${req.params.id}/authority-transitions`,
        req.body,
        (tx) =>
          svc.planAuthorityTransition(tx, req.params.id, {
            ...req.body,
            plannedStartAt: req.body.plannedStartAt ? new Date(req.body.plannedStartAt) : undefined,
          }),
      );
      return reply.status(201).send(t);
    },
  );
  const transitionStep = (
    step: 'approve' | 'freeze' | 'complete' | 'cancel',
    run: (
      tx: TxContext,
      id: string,
      body: { note?: string | undefined; reason?: string | undefined },
    ) => Promise<unknown>,
  ) =>
    app.post(
      `/authority-transitions/:id/${step}`,
      {
        schema: {
          tags: ['Data authority'],
          params: idParams,
          body: z
            .object({ note: z.string().max(2000).optional(), reason: z.string().max(1000).optional() })
            .default({}),
          response: { 200: authorityTransition },
        },
      },
      (req) =>
        command(database, req, `POST /authority-transitions/${req.params.id}/${step}`, req.body, (tx) =>
          run(tx, req.params.id, req.body),
        ) as Promise<z.infer<typeof authorityTransition>>,
    );
  transitionStep('approve', (tx, id, b) => svc.approveAuthorityTransition(tx, id, b.note));
  transitionStep('freeze', (tx, id) => svc.freezeAuthorityTransition(tx, id));
  transitionStep('complete', (tx, id) => svc.completeAuthorityTransition(tx, ports, id));
  transitionStep('cancel', (tx, id, b) =>
    svc.cancelAuthorityTransition(tx, id, b.reason ?? b.note ?? 'cancelled'),
  );

  // ── Owners and unit ownership ──
  app.get(
    '/owners',
    {
      schema: {
        tags: ['Owners'],
        querystring: z.object({ includeArchived: z.coerce.boolean().optional() }),
        response: { 200: z.object({ items: z.array(owner) }) },
      },
    },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) =>
        svc.listOwners(tx, { includeArchived: req.query.includeArchived ?? false }),
      ),
    }),
  );
  app.post(
    '/owners',
    { schema: { tags: ['Owners'], body: ownerInput, response: { 201: owner } } },
    async (req, reply) => {
      const o = await create(database, req, 'POST /owners', req.body, (tx) => svc.createOwner(tx, req.body));
      setVersion(reply, o.version);
      return reply.status(201).send(o);
    },
  );
  app.get(
    '/owners/:id',
    { schema: { tags: ['Owners'], params: idParams, response: { 200: owner } } },
    async (req, reply) => {
      const o = await withTenantTx(database, req.ctx, (tx) => svc.getOwner(tx, req.params.id));
      setVersion(reply, o.version);
      return o;
    },
  );
  app.patch(
    '/owners/:id',
    { schema: { tags: ['Owners'], params: idParams, body: ownerUpdate, response: { 200: owner } } },
    async (req, reply) => {
      const expected = requireIfMatch(req);
      const o = await withTenantTx(database, req.ctx, (tx) =>
        svc.updateOwner(tx, req.params.id, expected, req.body),
      );
      setVersion(reply, o.version);
      return o;
    },
  );
  app.post(
    '/owners/:id/archive',
    { schema: { tags: ['Owners'], params: idParams, body: reasonInput, response: { 200: owner } } },
    (req) =>
      command(database, req, `POST /owners/${req.params.id}/archive`, req.body, (tx) =>
        svc.archiveOwner(tx, req.params.id, req.body.reason),
      ),
  );
  app.get(
    '/ownership-shares',
    {
      schema: {
        tags: ['Owners'],
        querystring: z.object({
          propertyId: z.uuid().optional(),
          unitId: z.uuid().optional(),
          ownerId: z.uuid().optional(),
          onDate: z.iso.date().optional(),
        }),
        response: { 200: z.object({ items: z.array(ownershipShare) }) },
      },
    },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) => svc.listOwnershipShares(tx, req.query)),
    }),
  );
  app.post(
    '/ownership-shares',
    { schema: { tags: ['Owners'], body: ownershipShareInput, response: { 201: ownershipShare } } },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          await create(database, req, 'POST /ownership-shares', req.body, (tx) =>
            svc.addOwnershipShare(tx, req.body),
          ),
        ),
  );
  app.post(
    '/ownership-shares/:id/end',
    {
      schema: { tags: ['Owners'], params: idParams, body: endShareInput, response: { 200: ownershipShare } },
    },
    (req) =>
      command(database, req, `POST /ownership-shares/${req.params.id}/end`, req.body, (tx) =>
        svc.endOwnershipShare(tx, req.params.id, req.body),
      ),
  );
  app.get(
    '/units/:id/ownership',
    {
      schema: {
        tags: ['Owners'],
        params: idParams,
        querystring: z.object({ date: z.iso.date() }),
        response: { 200: unitOwnership },
      },
    },
    (req) =>
      withTenantTx(database, req.ctx, (tx) =>
        svc.getUnitOwnership(tx, { unitId: req.params.id, date: req.query.date }),
      ),
  );

  // ── Outlets ──
  app.get(
    '/properties/:id/outlets',
    {
      schema: {
        tags: ['Outlets'],
        params: propertyParams,
        querystring: z.object({ includeArchived: z.coerce.boolean().optional() }),
        response: { 200: z.object({ items: z.array(outlet) }) },
      },
    },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) =>
        svc.listOutlets(tx, req.params.id, { includeArchived: req.query.includeArchived ?? false }),
      ),
    }),
  );
  app.post(
    '/properties/:id/outlets',
    { schema: { tags: ['Outlets'], params: propertyParams, body: outletInput, response: { 201: outlet } } },
    async (req, reply) => {
      const o = await create(database, req, `POST /properties/${req.params.id}/outlets`, req.body, (tx) =>
        svc.createOutlet(tx, req.params.id, req.body),
      );
      setVersion(reply, o.version);
      return reply.status(201).send(o);
    },
  );
  app.get(
    '/outlets/:id',
    { schema: { tags: ['Outlets'], params: idParams, response: { 200: outlet } } },
    async (req, reply) => {
      const o = await withTenantTx(database, req.ctx, (tx) => svc.getOutlet(tx, req.params.id));
      setVersion(reply, o.version);
      return o;
    },
  );
  app.patch(
    '/outlets/:id',
    {
      schema: {
        tags: ['Outlets'],
        params: idParams,
        body: outletUpdate.extend({ status: z.enum(['active', 'archived']).optional() }),
        response: { 200: outlet },
      },
    },
    async (req, reply) => {
      const expected = requireIfMatch(req);
      const o = await withTenantTx(database, req.ctx, (tx) =>
        svc.updateOutlet(tx, req.params.id, expected, req.body),
      );
      setVersion(reply, o.version);
      return o;
    },
  );

  // ── Configuration bundles, rollout groups, changes ──
  app.post(
    '/properties/:id/configuration-bundles',
    {
      schema: {
        tags: ['Configuration'],
        params: propertyParams,
        body: bundleExportInput,
        response: { 201: configurationBundle },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          await create(
            database,
            req,
            `POST /properties/${req.params.id}/configuration-bundles`,
            req.body,
            (tx) => svc.exportConfigurationBundle(tx, ports, req.params.id, req.body),
          ),
        ),
  );
  app.post(
    '/configuration-bundles',
    { schema: { tags: ['Configuration'], body: bundleImportInput, response: { 201: configurationBundle } } },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          await create(database, req, 'POST /configuration-bundles', req.body, (tx) =>
            svc.importConfigurationBundle(tx, req.body),
          ),
        ),
  );
  app.get(
    '/configuration-bundles',
    {
      schema: {
        tags: ['Configuration'],
        response: { 200: z.object({ items: z.array(configurationBundle) }) },
      },
    },
    async (req) => ({
      items: await withTenantTx(database, req.ctx, (tx) => svc.listConfigurationBundles(tx)),
    }),
  );
  app.get(
    '/configuration-bundles/:id',
    { schema: { tags: ['Configuration'], params: idParams, response: { 200: configurationBundle } } },
    (req) => withTenantTx(database, req.ctx, (tx) => svc.getConfigurationBundle(tx, req.params.id)),
  );
  app.post(
    '/configuration-bundles/from-trial',
    {
      schema: {
        tags: ['Environments'],
        body: pullTrialConfigurationInput,
        response: { 201: configurationBundle },
      },
    },
    async (req, reply) => {
      // P2-7: the bundle is written inside the idempotent transaction, so a retry replays it instead of copying again.
      const b = await create(database, req, 'POST /configuration-bundles/from-trial', req.body, (tx) =>
        svc.pullTrialConfiguration(database, req.ctx, ports, req.body, tx),
      );
      return reply.status(201).send(b);
    },
  );
  app.get(
    '/rollout-groups',
    { schema: { tags: ['Configuration'], response: { 200: z.object({ items: z.array(rolloutGroup) }) } } },
    async (req) => ({ items: await withTenantTx(database, req.ctx, (tx) => svc.listRolloutGroups(tx)) }),
  );
  app.post(
    '/rollout-groups',
    { schema: { tags: ['Configuration'], body: rolloutGroupInput, response: { 201: rolloutGroup } } },
    async (req, reply) => {
      const g = await create(database, req, 'POST /rollout-groups', req.body, (tx) =>
        svc.createRolloutGroup(tx, req.body),
      );
      setVersion(reply, g.version);
      return reply.status(201).send(g);
    },
  );
  app.put(
    '/rollout-groups/:id/members',
    {
      schema: {
        tags: ['Configuration'],
        params: idParams,
        body: z.object({ propertyIds: z.array(z.uuid()).max(500) }),
        response: { 200: rolloutGroup },
      },
    },
    async (req, reply) => {
      const expected = requireIfMatch(req);
      const g = await withTenantTx(database, req.ctx, (tx) =>
        svc.setRolloutGroupMembers(tx, req.params.id, expected, req.body.propertyIds),
      );
      setVersion(reply, g.version);
      return g;
    },
  );
  app.post(
    '/configuration-changes',
    {
      schema: {
        tags: ['Configuration'],
        body: configurationChangeInput,
        response: { 201: configurationChange },
      },
    },
    async (req, reply) => {
      const c = await create(database, req, 'POST /configuration-changes', req.body, (tx) =>
        svc.prepareConfigurationChange(tx, ports, req.body),
      );
      setVersion(reply, c.version);
      return reply.status(201).send(c);
    },
  );
  app.get(
    '/configuration-changes/:id',
    { schema: { tags: ['Configuration'], params: idParams, response: { 200: configurationChange } } },
    async (req, reply) => {
      const c = await withTenantTx(database, req.ctx, (tx) => svc.getConfigurationChange(tx, req.params.id));
      setVersion(reply, c.version);
      return c;
    },
  );
  for (const step of ['approve', 'reject', 'cancel', 'apply'] as const) {
    app.post(
      `/configuration-changes/:id/${step}`,
      {
        schema: {
          tags: ['Configuration'],
          params: idParams,
          body: decisionInput.default({}),
          response: { 200: configurationChange },
        },
      },
      (req) =>
        command(database, req, `POST /configuration-changes/${req.params.id}/${step}`, req.body, (tx) =>
          step === 'approve'
            ? svc.approveConfigurationChange(tx, req.params.id, req.body.note)
            : step === 'reject'
              ? svc.rejectConfigurationChange(tx, req.params.id, req.body.note)
              : step === 'cancel'
                ? svc.cancelConfigurationChange(tx, req.params.id, req.body.note)
                : svc.applyConfigurationChange(tx, ports, req.params.id),
        ),
    );
  }

  // ── Environments and trials ──
  app.get('/environment', { schema: { tags: ['Environments'], response: { 200: environmentInfo } } }, (req) =>
    withTenantTx(database, req.ctx, (tx) => svc.getEnvironmentInfo(tx)),
  );
  app.get(
    '/environments',
    {
      schema: { tags: ['Environments'], response: { 200: z.object({ items: z.array(linkedEnvironment) }) } },
    },
    async (req) => ({ items: await withTenantTx(database, req.ctx, (tx) => svc.listLinkedEnvironments(tx)) }),
  );
  app.post(
    '/environments/trials',
    {
      schema: {
        tags: ['Environments'],
        body: createTrialInput,
        response: { 201: z.object({ organizationId: z.uuid(), name: z.string() }) },
      },
    },
    async (req, reply) => {
      const provisioner = ports.trialProvisioner;
      if (!provisioner)
        throw new ExternalServiceError('provisioning', 'Trial creation is not configured on this server.', {
          retryable: false,
        });
      // P2-7: the idempotency record is held (locked) while the trial organization is created in its own
      // transactions; a retry or a concurrent duplicate with the same key waits and replays the first result.
      const created = await create(database, req, 'POST /environments/trials', req.body, async (tx) => {
        requirePermission(tx, 'platform.trial.manage');
        return provisioner.createTrial(database, req.ctx, req.body);
      });
      return reply.status(201).send(created);
    },
  );
  app.post(
    '/environment/trial/imports',
    { schema: { tags: ['Environments'], body: trialImportInput, response: { 204: z.null() } } },
    async (req, reply) => {
      await command(database, req, 'POST /environment/trial/imports', req.body, (tx) =>
        svc.recordTrialImport(tx, { ...req.body, copiedAt: new Date(req.body.copiedAt) }),
      );
      return reply.status(204).send(null);
    },
  );
  app.post(
    '/environment/trial/reset',
    {
      schema: {
        tags: ['Environments'],
        body: resetTrialInput,
        response: {
          200: z.object({ removed: z.record(z.string(), z.number()), resetCount: z.number().int() }),
        },
      },
    },
    (req) =>
      command(database, req, 'POST /environment/trial/reset', req.body, (tx) =>
        svc.resetTrial(tx, ports, req.body),
      ),
  );
  app.get(
    '/environment/trial/export',
    { schema: { tags: ['Environments'], response: { 200: z.record(z.string(), z.unknown()) } } },
    async (req, reply) => {
      const data = await withTenantTx(database, req.ctx, (tx) => svc.exportTrial(tx, ports));
      reply.header('content-disposition', `attachment; filename="TRIAL-export-${data.organization.id}.json"`);
      return data;
    },
  );
  app.post(
    '/environment/trial/close',
    {
      schema: {
        tags: ['Environments'],
        body: closeTrialInput,
        response: { 200: z.object({ deletionDueAt: z.string() }) },
      },
    },
    (req) =>
      command(database, req, 'POST /environment/trial/close', req.body, (tx) => svc.closeTrial(tx, req.body)),
  );

  // ── Property activation ──
  app.get(
    '/properties/:id/activation',
    { schema: { tags: ['Activation'], params: propertyParams, response: { 200: activationOverview } } },
    (req) => withTenantTx(database, req.ctx, (tx) => svc.getActivationOverview(tx, req.params.id)),
  );
  app.get(
    '/properties/:id/activation-scope',
    {
      schema: {
        tags: ['Activation'],
        params: propertyParams,
        response: {
          200: z.object({
            propertyId: z.uuid(),
            status: z.string(),
            stage: z.enum(['pilot', 'production']).nullable(),
            scope: z
              .object({ version: z.number().int(), content: activationScopeContent, approvedBy: z.string() })
              .nullable(),
          }),
        },
      },
    },
    async (req) =>
      withTenantTx(database, req.ctx, async (tx) => {
        requirePermission(tx, 'platform.property.read', { propertyId: req.params.id });
        const s = await svc.getActivationScope(tx, req.params.id);
        return {
          ...s,
          scope: s.scope
            ? { version: s.scope.version, content: s.scope.content, approvedBy: s.scope.approvedBy }
            : null,
        };
      }),
  );
  app.post(
    '/properties/:id/activation-requests',
    {
      schema: {
        tags: ['Activation'],
        params: propertyParams,
        body: statusChangeRequestInput,
        response: { 201: activationRequest },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          await create(
            database,
            req,
            `POST /properties/${req.params.id}/activation-requests`,
            req.body,
            (tx) => svc.requestStatusChange(tx, ports, req.params.id, req.body),
          ),
        ),
  );
  app.post(
    '/properties/:id/activation-scope-requests',
    {
      schema: {
        tags: ['Activation'],
        params: propertyParams,
        body: scopeChangeRequestInput,
        response: { 201: activationRequest },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          await create(
            database,
            req,
            `POST /properties/${req.params.id}/activation-scope-requests`,
            req.body,
            (tx) => svc.requestScopeChange(tx, req.params.id, req.body),
          ),
        ),
  );
  for (const step of ['approve', 'reject', 'cancel'] as const) {
    app.post(
      `/activation-requests/:id/${step}`,
      {
        schema: {
          tags: ['Activation'],
          params: idParams,
          body: decisionInput.default({}),
          response: { 200: activationRequest },
        },
      },
      (req) =>
        command(database, req, `POST /activation-requests/${req.params.id}/${step}`, req.body, (tx) =>
          step === 'approve'
            ? svc.approveActivationRequest(tx, ports, req.params.id, req.body)
            : step === 'reject'
              ? svc.rejectActivationRequest(tx, req.params.id, req.body)
              : svc.cancelActivationRequest(tx, req.params.id, req.body),
        ),
    );
  }
  app.post(
    '/properties/:id/status',
    {
      schema: {
        tags: ['Activation'],
        params: propertyParams,
        body: directStatusChangeInput,
        response: { 200: activationOverview },
      },
    },
    (req) =>
      command(database, req, `POST /properties/${req.params.id}/status`, req.body, (tx) =>
        svc.changePropertyStatusDirect(tx, req.params.id, req.body),
      ),
  );
}
