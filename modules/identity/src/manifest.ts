import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

export const identityManifest: ModuleManifest = {
  name: 'identity',
  schema: 'identity',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  migrateAfter: ['platform'],
  permissions: [
    { key: 'identity.user.read', description: 'View staff members and their roles', scope: 'organization' },
    {
      key: 'identity.user.manage',
      description: 'Add, suspend and remove staff members',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'identity.role.assign',
      description: 'Grant and revoke roles',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'identity.role.manage',
      description: 'Create and edit custom roles',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'identity.apiClient.manage',
      description: 'Create and revoke API credentials for integrations',
      scope: 'organization',
      sensitive: true,
    },
  ],
};
