import { queryOptions } from '@tanstack/react-query';
import { api } from './index';

/** Query keys are scoped by organization so switching organization never shows another tenant's cache. */
export const queries = {
  me: (orgId: string) =>
    queryOptions({ queryKey: ['org', orgId, 'me'], queryFn: async () => (await api.me()).data }),
  organization: (orgId: string) =>
    queryOptions({
      queryKey: ['org', orgId, 'organization'],
      queryFn: async () => (await api.organization()).data,
    }),
  properties: (orgId: string) =>
    queryOptions({
      queryKey: ['org', orgId, 'properties'],
      queryFn: async () => (await api.properties()).data.items,
    }),
  property: (orgId: string, id: string) =>
    queryOptions({
      queryKey: ['org', orgId, 'property', id],
      // Keep the version from the ETag next to the data: it is sent back as If-Match.
      queryFn: async () => {
        const r = await api.property(id);
        return { property: r.data, version: r.version ?? r.data.version };
      },
    }),
  legalEntities: (orgId: string) =>
    queryOptions({
      queryKey: ['org', orgId, 'legal-entities'],
      queryFn: async () => (await api.legalEntities()).data.items,
    }),
  users: (orgId: string) =>
    queryOptions({ queryKey: ['org', orgId, 'users'], queryFn: async () => (await api.users()).data.items }),
  roles: (orgId: string) =>
    queryOptions({ queryKey: ['org', orgId, 'roles'], queryFn: async () => (await api.roles()).data.items }),
};
