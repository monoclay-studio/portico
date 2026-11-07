import { type PorticoDatabase, withTenantTx } from '@portico/db';
import type { HttpModule } from '@portico/http';
import { type IdentityPorts, identity, requireOperator } from '@portico/identity';
import {
  BusinessRuleError,
  newId,
  type RequestContext,
  systemAuthorizer,
  type TenantEnvironment,
} from '@portico/kernel';
import { platform } from '@portico/platform';
import { z } from 'zod';

export interface ProvisionInput {
  name: string;
  slug: string;
  environment: TenantEnvironment;
  planCode: string;
  /**
   * `password` is for demo seeding ONLY (ADR-0017 rule 12): accepted for a `demo` organization and a
   * `*.portico.invalid` address; refused everywhere else. Real administrators choose their own password from the
   * invitation email.
   */
  admin: { email: string; displayName: string; password?: string };
  liveTenantId?: string;
}

type InvitationPorts = Pick<IdentityPorts, 'notifier' | 'config' | 'organizationName'>;

export interface ProvisionResult {
  tenantId: string;
  adminUserId: string;
  /** `invited` until the administrator accepts the invitation sent to them (R2-P2-5: never silent). */
  adminStatus: 'active' | 'invited';
  delivery?: { mode: 'queued' | 'simulated' | 'sandbox' };
}

/**
 * Create an organization with system roles and its first administrator — one transaction.
 * Called by Monoclay operators (internal endpoint / CLI) and by demo seeding. ADR-0017 rules 12-13: the first
 * administrator is invited (new or existing person) and the invitation is sent to their own email — the operator
 * sees `adminStatus: 'invited'` until they accept. The notifier is required so the invitation can never be lost.
 */
export async function provisionOrganization(
  database: PorticoDatabase,
  input: ProvisionInput,
  operator = 'operator',
  ports: InvitationPorts = {},
): Promise<ProvisionResult> {
  if (!input.admin.password && !ports.notifier)
    throw new BusinessRuleError(
      'notifier_required',
      'Provisioning needs the staff notifier so the first administrator receives their invitation.',
    );
  const tenantId = newId();
  const ctx: RequestContext = {
    tenantId,
    environment: input.environment,
    actor: { kind: 'system', process: `provisioning:${operator}` },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
  return withTenantTx(database, ctx, async (tx) => {
    await platform.provisionOrganization(tx, {
      id: tenantId,
      name: input.name,
      slug: input.slug,
      environment: input.environment,
      planCode: input.planCode,
      ...(input.liveTenantId ? { liveTenantId: input.liveTenantId } : {}),
    });
    await identity.seedSystemRoles(tx);
    const roles = [{ roleKey: 'org_admin', scopeType: 'organization' as const }];
    if (input.admin.password) {
      // Demo seeding only; refused outside a demo organization or for a real address.
      const { userId } = await identity.seedDemoMember(tx, {
        email: input.admin.email,
        displayName: input.admin.displayName,
        password: input.admin.password,
        roles,
      });
      return { tenantId, adminUserId: userId, adminStatus: 'active' as const };
    }
    const created = await identity.createUser(
      tx,
      { email: input.admin.email, displayName: input.admin.displayName, roles },
      ports,
    );
    return {
      tenantId,
      adminUserId: created.userId,
      adminStatus: created.status,
      delivery: { mode: created.delivery.mode },
    };
  });
}

export interface TrialInput {
  name: string;
  /** The hotel's live organization, when it is already a customer. */
  liveTenantId?: string;
  /** Otherwise the prospect's name (trial before any contract). */
  prospectName?: string;
  planCode: string;
  /**
   * The trial administrator. `selfUserId`: the signed-in person who asked for the trial joins it directly (their
   * request is their consent). Otherwise an email: a new person is created; an existing person is INVITED and
   * accepts while signed in as themselves (ADR-0017 §2).
   */
  admin: { selfUserId: string; displayName: string } | { email: string; displayName: string };
}

/** A live organization may run at most this many open trials at once (P3-10; plans may set their own later). */
export const MAX_OPEN_TRIALS_PER_ORGANIZATION = 3;

/**
 * Create an isolated trial organization (adoption brief §3 stage 2): environment `trial` (effects simulated or
 * blocked by the kernel policy), trial lifecycle record, system roles and a trial administrator. The administrator
 * is the same person (same sign-in) but gets a separate trial-only membership — trial access never implies live
 * access and vice versa. When the hotel is already a customer, the live organization records the link.
 */
export async function provisionTrialOrganization(
  database: PorticoDatabase,
  input: TrialInput,
  operator = 'operator',
  ports: Pick<IdentityPorts, 'notifier' | 'config' | 'organizationName'> = {},
): Promise<{ tenantId: string; adminUserId: string; adminStatus: 'active' | 'invited' }> {
  if (!input.liveTenantId && !input.prospectName)
    throw new BusinessRuleError(
      'trial_owner_required',
      'A trial belongs to a live organization or a named prospect.',
    );
  const tenantId = newId();
  const ctx: RequestContext = {
    tenantId,
    environment: 'trial',
    actor: { kind: 'system', process: `provisioning:${operator}` },
    authz: systemAuthorizer,
    correlationId: newId(),
  };
  const created = await withTenantTx(database, ctx, async (tx) => {
    await platform.provisionOrganization(tx, {
      id: tenantId,
      name: input.name,
      slug: `trial-${tenantId.slice(-12)}`,
      environment: 'trial',
      planCode: input.planCode,
      ...(input.liveTenantId ? { liveTenantId: input.liveTenantId } : {}),
    });
    await platform.initTrialLifecycle(tx, {
      sourceTenantId: input.liveTenantId,
      prospectName: input.prospectName,
    });
    await identity.seedSystemRoles(tx);
    const admin = input.admin;
    if ('selfUserId' in admin) {
      await identity.addSelfToOrganization(tx, {
        userId: admin.selfUserId,
        displayName: admin.displayName,
        roleKey: 'org_admin',
      });
      return { tenantId, adminUserId: admin.selfUserId, adminStatus: 'active' as const };
    }
    const created = await identity.createUser(
      tx,
      {
        email: admin.email,
        displayName: admin.displayName,
        roles: [{ roleKey: 'org_admin', scopeType: 'organization' }],
      },
      ports,
    );
    return { tenantId, adminUserId: created.userId, adminStatus: created.status };
  });
  if (input.liveTenantId) {
    // Separate transaction (another tenant). Idempotent: re-running only re-links.
    const liveEnv = await withTenantTx(
      database,
      { ...ctx, tenantId: input.liveTenantId, environment: 'live' },
      async (tx) => {
        const org = await platform.getOrganization(tx);
        await platform.linkEnvironment(tx, {
          linkedTenantId: tenantId,
          environment: 'trial',
          name: input.name,
        });
        return org.environment;
      },
    );
    if (liveEnv !== 'live')
      throw new BusinessRuleError('not_live', 'Trials are linked to live organizations only.');
  }
  return created;
}

/**
 * Platform's TrialProvisioner: a live organization's administrator creates a trial for their own organization;
 * the requesting person becomes the trial administrator. Permission (`platform.trial.manage`) is checked by the
 * route before this runs.
 */
export async function createTrialForOrganization(
  database: PorticoDatabase,
  ctx: RequestContext,
  input: { name: string },
): Promise<{ organizationId: string; name: string }> {
  if (ctx.environment !== 'live')
    throw new BusinessRuleError(
      'not_live',
      'Create trials from your live organization, not from a trial or demo.',
    );
  if (ctx.actor.kind !== 'user' || ctx.actor.impersonatedBy)
    throw new BusinessRuleError('not_a_user', 'A trial is created by a signed-in staff member.');
  // R2-P3-1 / ADR-0017 §10: emergency access leaves no durable privilege — a trial (and its administrator) is one.
  if ((ctx.actor as typeof ctx.actor & { via?: string }).via === 'elevation')
    throw new BusinessRuleError(
      'not_during_emergency_access',
      'Creating a trial is not possible during emergency access. End emergency access and ask an administrator.',
    );
  const userId = ctx.actor.userId;
  const { me, org } = await withTenantTx(database, ctx, async (tx) => {
    const open = (await platform.listLinkedEnvironments(tx)).filter(
      (e) => e.environment === 'trial' && e.status !== 'closed',
    );
    if (open.length >= MAX_OPEN_TRIALS_PER_ORGANIZATION)
      throw new BusinessRuleError(
        'trial_limit_reached',
        `Your organization already has ${open.length} open trials (the limit is ${MAX_OPEN_TRIALS_PER_ORGANIZATION}). Delete a trial you no longer need, then try again.`,
        { limit: MAX_OPEN_TRIALS_PER_ORGANIZATION },
      );
    return { me: await identity.getMe(tx, userId), org: await platform.getOrganization(tx) };
  });
  const { tenantId } = await provisionTrialOrganization(
    database,
    {
      name: input.name,
      liveTenantId: ctx.tenantId,
      planCode: org.planCode,
      admin: { selfUserId: userId, displayName: me.displayName },
    },
    `user:${userId}`,
  );
  return { organizationId: tenantId, name: input.name };
}

/** Operator console endpoint: create a trial for a prospect (no live organization yet). */
export function provisioningHttp(deps: { database: PorticoDatabase; ports: IdentityPorts }): HttpModule {
  return {
    name: 'provisioning',
    routes(app) {
      app.post(
        '/operator/trials',
        {
          config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
          schema: {
            tags: ['Operator console'],
            body: z.object({
              name: z.string().min(1).max(200),
              prospectName: z.string().min(1).max(200),
              planCode: z
                .enum(['essentials', 'professional', 'resort', 'enterprise', 'connect'])
                .default('resort'),
              admin: z.object({ email: z.email(), displayName: z.string().min(1).max(200) }),
            }),
            response: {
              201: z.object({
                organizationId: z.uuid(),
                adminUserId: z.uuid(),
                /** `invited`: the person already uses Portico and accepts the trial from their own account. */
                adminStatus: z.enum(['active', 'invited']),
              }),
            },
          },
        },
        async (req, reply) => {
          const op = await requireOperator(deps.ports, req);
          const res = await provisionTrialOrganization(
            deps.database,
            {
              name: req.body.name,
              prospectName: req.body.prospectName,
              planCode: req.body.planCode,
              admin: req.body.admin,
            },
            `operator:${op.id}`,
            deps.ports,
          );
          return reply.status(201).send({
            organizationId: res.tenantId,
            adminUserId: res.adminUserId,
            adminStatus: res.adminStatus,
          });
        },
      );
    },
  };
}
