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
    {
      key: 'identity.security.manage',
      description:
        'Change the organization security policy (MFA step-up window, support access, break-glass users)',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'identity.securityLog.read',
      description: 'View security alerts, emergency access and the security log',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'identity.sso.manage',
      description: 'Configure single sign-on, group-to-role mappings and SSO enforcement',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'identity.scim.provision',
      description: 'Provision staff accounts and groups through SCIM (identity provider integrations)',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'identity.supportAccess.read',
      description: 'View Monoclay support sessions and their access log',
      scope: 'organization',
    },
    {
      key: 'identity.supportAccess.approve',
      description: 'Approve, decline or revoke Monoclay support sessions',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'identity.elevation.review',
      description: 'Record the post-incident review of emergency (break-glass) access',
      scope: 'organization',
      sensitive: true,
    },
  ],
};
