import { ForbiddenError } from './errors';

/** Who is performing an action. Every audit record and event carries one. */
export type Actor =
  | { kind: 'user'; userId: string; displayName?: string; sessionId?: string; impersonatedBy?: string }
  | { kind: 'api_client'; clientId: string; displayName?: string }
  | { kind: 'system'; process: string }
  | { kind: 'guest'; guestProfileId?: string; bookingId?: string };

/**
 * Environment of the organization (tenant). Non-live environments must never cause real-world effects
 * (card charges, guest messages, channel publication, government submissions, paid AI).
 */
export type TenantEnvironment = 'live' | 'trial' | 'sandbox' | 'training' | 'demo';

/**
 * Where a piece of displayed information comes from. Shown to users so they never mistake simulated, copied
 * or stale information for live facts.
 */
/** CLAUDE.md rule 16. `sandbox` = produced against a provider's test environment (rule 12: simulated *or* sandbox). */
export type Provenance = 'live' | 'simulated' | 'sandbox' | 'copied' | 'delayed' | 'incomplete' | 'external';

/** Resolved permissions of the current actor. Implemented by the identity module (and test fakes). */
export interface Authorizer {
  /** True if the actor holds `permission`, for `propertyId` when the permission is property-scoped. */
  can(permission: string, scope?: { propertyId?: string | null }): boolean;
  /** Property ids where the actor holds `permission`, or 'all' (organization-wide grant). */
  propertyScope(permission: string): readonly string[] | 'all';
}

/** Request-scoped context: identity + tenant + tracing. Created by the HTTP/worker layer. */
export interface RequestContext {
  readonly tenantId: string;
  readonly environment: TenantEnvironment;
  readonly actor: Actor;
  readonly authz: Authorizer;
  readonly correlationId: string;
  /** IP / user agent for audit. Never used for authorization. */
  readonly origin?: { ip?: string; userAgent?: string };
}

/** Throws ForbiddenError unless the actor holds the permission (for the property, if given). */
export function requirePermission(
  ctx: Pick<RequestContext, 'authz'>,
  permission: string,
  scope?: { propertyId?: string | null },
): void {
  if (!ctx.authz.can(permission, scope)) {
    throw new ForbiddenError(permission, scope?.propertyId ? { propertyId: scope.propertyId } : undefined);
  }
}

/** Grants everything. Only for trusted system processes (Day Close scheduler, outbox consumers). */
export const systemAuthorizer: Authorizer = {
  can: () => true,
  propertyScope: () => 'all',
};

/** Simple authorizer from a static grant list — used by API clients, tests and the identity module. */
export function staticAuthorizer(
  grants: ReadonlyArray<{ permission: string; propertyIds: readonly string[] | 'all' }>,
): Authorizer {
  const index = new Map<string, Set<string> | 'all'>();
  for (const g of grants) {
    const existing = index.get(g.permission);
    if (existing === 'all' || g.propertyIds === 'all') {
      index.set(g.permission, 'all');
      continue;
    }
    const set = existing ?? new Set<string>();
    for (const p of g.propertyIds) set.add(p);
    index.set(g.permission, set);
  }
  // Union of every matching grant: the exact key plus each wildcard level ('module.*', '*'). A narrower exact
  // grant must never shadow a broader wildcard grant (identity-plus review P2-10).
  const lookup = (permission: string): Set<string> | 'all' | undefined => {
    const parts = permission.split('.');
    const keys = [permission];
    for (let i = parts.length - 1; i >= 0; i--) keys.push(i === 0 ? '*' : `${parts.slice(0, i).join('.')}.*`);
    let union: Set<string> | undefined;
    for (const key of keys) {
      const g = index.get(key);
      if (!g) continue;
      if (g === 'all') return 'all';
      union = union ? new Set([...union, ...g]) : new Set(g);
    }
    return union;
  };
  return {
    can(permission, scope) {
      const grant = lookup(permission);
      if (!grant) return false;
      if (grant === 'all') return true;
      if (!scope?.propertyId) return grant.size > 0;
      return grant.has(scope.propertyId);
    },
    propertyScope(permission) {
      const grant = lookup(permission);
      if (!grant) return [];
      return grant === 'all' ? 'all' : [...grant];
    },
  };
}

export function actorLabel(actor: Actor): string {
  switch (actor.kind) {
    case 'user':
      return actor.displayName ?? `user:${actor.userId}`;
    case 'api_client':
      return actor.displayName ?? `api:${actor.clientId}`;
    case 'system':
      return `system:${actor.process}`;
    case 'guest':
      return 'guest';
  }
}

export function actorId(actor: Actor): string {
  switch (actor.kind) {
    case 'user':
      return actor.userId;
    case 'api_client':
      return actor.clientId;
    case 'system':
      return actor.process;
    case 'guest':
      return actor.guestProfileId ?? actor.bookingId ?? 'anonymous';
  }
}

/** Context for trusted background processes acting within one tenant. */
export function systemContext(
  tenantId: string,
  process: string,
  environment: TenantEnvironment,
  correlationId: string,
): RequestContext {
  return {
    tenantId,
    environment,
    actor: { kind: 'system', process },
    authz: systemAuthorizer,
    correlationId,
  };
}
