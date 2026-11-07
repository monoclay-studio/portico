import {
  type Actor,
  newId,
  type RequestContext,
  staticAuthorizer,
  systemAuthorizer,
  type TenantEnvironment,
} from '@portico/kernel';

export interface TestContextOptions {
  tenantId?: string;
  environment?: TenantEnvironment;
  actor?: Actor;
  /** Permission grants. Omit for an all-powerful context (setup); pass [] for no permissions. */
  grants?: Array<{ permission: string; propertyIds: string[] | 'all' }>;
}

/** Build a RequestContext for tests. */
export function testContext(opts: TestContextOptions = {}): RequestContext {
  return {
    tenantId: opts.tenantId ?? newId(),
    environment: opts.environment ?? 'live',
    actor: opts.actor ?? { kind: 'user', userId: newId(), displayName: 'Test User' },
    authz: opts.grants ? staticAuthorizer(opts.grants) : systemAuthorizer,
    correlationId: newId(),
  };
}
