import { queryOptions } from '@tanstack/react-query';
import { api } from './index';

/** Who the cached data belongs to. Every query key starts with the organization AND the staff member. */
export interface Scope {
  userId: string;
  organization: { id: string };
}

/**
 * Query keys are scoped by organization and user, so a different person signing in on the same tab can never
 * see the previous person's cached data (shared desk computers). The cache is also cleared on every session change.
 */
export function scopeKey(s: Scope, ...rest: readonly unknown[]): unknown[] {
  return ['org', s.organization.id, 'user', s.userId, ...rest];
}

export const queries = {
  me: (s: Scope) => queryOptions({ queryKey: scopeKey(s, 'me'), queryFn: async () => (await api.me()).data }),
  organization: (s: Scope) =>
    queryOptions({ queryKey: scopeKey(s, 'organization'), queryFn: async () => (await api.organization()).data }),
  properties: (s: Scope) =>
    queryOptions({ queryKey: scopeKey(s, 'properties'), queryFn: async () => (await api.properties()).data.items }),
  property: (s: Scope, id: string) =>
    queryOptions({
      queryKey: scopeKey(s, 'property', id),
      // Keep the version from the ETag next to the data: it is sent back as If-Match.
      queryFn: async () => {
        const r = await api.property(id);
        return { property: r.data, version: r.version ?? r.data.version };
      },
    }),
  legalEntities: (s: Scope) =>
    queryOptions({
      queryKey: scopeKey(s, 'legal-entities'),
      queryFn: async () => (await api.legalEntities()).data.items,
    }),
  users: (s: Scope) =>
    queryOptions({ queryKey: scopeKey(s, 'users'), queryFn: async () => (await api.users()).data.items }),
  roles: (s: Scope) =>
    queryOptions({ queryKey: scopeKey(s, 'roles'), queryFn: async () => (await api.roles()).data.items }),
};
