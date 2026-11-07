/**
 * Typed endpoints for the modules on main (platform, identity). Request and response shapes come from the
 * modules' contracts.ts — the same Zod schemas the API validates with.
 */
import { createUserRequest, loginRequest, loginResponse, me, userSummary } from '@portico/identity/contracts';
import {
  legalEntity,
  legalEntityInput,
  organization,
  property,
  propertyUpdate,
} from '@portico/platform/contracts';
import { z } from 'zod';
import type { ApiClient } from './client';

export type LoginRequest = z.input<typeof loginRequest>;
export type LoginResponse = z.infer<typeof loginResponse>;
export type Me = z.infer<typeof me>;
export type Organization = z.infer<typeof organization>;
export type Property = z.infer<typeof property>;
export type PropertyUpdate = z.infer<typeof propertyUpdate>;
export type LegalEntity = z.infer<typeof legalEntity>;
export type LegalEntityInput = z.infer<typeof legalEntityInput>;
export type UserSummary = z.infer<typeof userSummary>;
export type CreateUserRequest = z.input<typeof createUserRequest>;

/** GET /v1/roles is not yet described by a contract on main; this schema mirrors identity.listRoles. */
export const roleSummary = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(z.string()),
  is_system: z.boolean(),
});
export type RoleSummary = z.infer<typeof roleSummary>;

const items = <T extends z.ZodType>(s: T) => z.object({ items: z.array(s) });

/**
 * Cross-module experience endpoints on main (apps/api/src/records-routes.ts). The API declares these schemas
 * inline (no module contracts.ts yet), so they are mirrored here exactly.
 */
export const searchHit = z.object({
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
export type SearchHit = z.infer<typeof searchHit>;
export const recordSummary = searchHit.omit({ score: true });
export type RecordSummaryDto = z.infer<typeof recordSummary>;
export const recordHistory = z.object({
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
});
export type RecordHistoryDto = z.infer<typeof recordHistory>;

export function endpoints(api: ApiClient) {
  return {
    login: (body: LoginRequest) =>
      api.request({ method: 'POST', path: '/auth/login', body: loginRequest.parse(body), schema: loginResponse, expectUnauthenticated: true }),
    logout: () => api.request({ method: 'POST', path: '/auth/logout', schema: null }),
    me: () => api.request({ path: '/me', schema: me }),
    organization: () => api.request({ path: '/organization', schema: organization }),
    properties: () => api.request({ path: '/properties', schema: items(property) }),
    property: (id: string) => api.request({ path: `/properties/${encodeURIComponent(id)}`, schema: property }),
    updateProperty: (id: string, patch: PropertyUpdate, version: number) =>
      api.request({
        method: 'PATCH',
        path: `/properties/${encodeURIComponent(id)}`,
        body: propertyUpdate.parse(patch),
        ifMatch: version,
        schema: property,
      }),
    legalEntities: () => api.request({ path: '/legal-entities', schema: items(legalEntity) }),
    createLegalEntity: (body: LegalEntityInput, idempotencyKey: string) =>
      api.request({
        method: 'POST',
        path: '/legal-entities',
        body: legalEntityInput.parse(body),
        idempotencyKey,
        schema: legalEntity,
      }),
    users: () => api.request({ path: '/users', schema: items(userSummary) }),
    createUser: (body: CreateUserRequest, idempotencyKey: string) =>
      api.request({
        method: 'POST',
        path: '/users',
        body: createUserRequest.parse(body),
        idempotencyKey,
        schema: z.object({ userId: z.uuid() }),
      }),
    roles: () => api.request({ path: '/roles', schema: items(roleSummary) }),
    search: (q: string, opts: { types?: string[]; limit?: number; signal?: AbortSignal } = {}) =>
      api.request({
        path: `/search?${new URLSearchParams({ q, ...(opts.types ? { types: opts.types.join(',') } : {}), limit: String(opts.limit ?? 10) })}`,
        schema: z.object({ query: z.string(), items: z.array(searchHit) }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      }),
    recordSummary: (type: string, id: string) =>
      api.request({ path: `/records/${encodeURIComponent(type)}/${encodeURIComponent(id)}/summary`, schema: recordSummary }),
    recordHistory: (type: string, id: string) =>
      api.request({ path: `/records/${encodeURIComponent(type)}/${encodeURIComponent(id)}/history`, schema: recordHistory }),
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
