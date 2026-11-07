import {
  type Actor,
  type Authorizer,
  type RequestContext,
  type TenantEnvironment,
  UnauthenticatedError,
} from '@portico/kernel';
import type { FastifyRequest } from 'fastify';

export interface AuthResult {
  tenantId: string;
  environment: TenantEnvironment;
  actor: Actor;
  authz: Authorizer;
}

/** Resolves the caller from a request (session token, API client credentials, test token…). */
export interface Authenticator {
  authenticate(req: FastifyRequest): Promise<AuthResult | null>;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated request context. Throws 401 when the route is public and nobody is signed in. */
    readonly ctx: RequestContext;
    auth: AuthResult | null;
  }
  interface FastifyContextConfig {
    /** Route does not require authentication (health, login, public booking engine). */
    public?: boolean;
  }
}

export function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export function contextFrom(req: FastifyRequest): RequestContext {
  if (!req.auth) throw new UnauthenticatedError();
  const userAgent = req.headers['user-agent'];
  return {
    tenantId: req.auth.tenantId,
    environment: req.auth.environment,
    actor: req.auth.actor,
    authz: req.auth.authz,
    correlationId: String(req.id),
    origin: { ip: req.ip, ...(userAgent ? { userAgent } : {}) },
  };
}
