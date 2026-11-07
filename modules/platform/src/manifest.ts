import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

export const platformManifest: ModuleManifest = {
  name: 'platform',
  schema: 'platform',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  recordTypes: [
    {
      type: 'property',
      label: 'Property',
      readPermission: 'platform.property.read',
      route: '/settings/properties/:id',
    },
    {
      type: 'legal_entity',
      label: 'Legal entity',
      readPermission: 'platform.property.read',
      route: '/settings/legal-entities/:id',
    },
  ],
  permissions: [
    {
      key: 'platform.organization.manage',
      description: 'Manage organization settings, brands and regions',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'platform.legalEntity.manage',
      description: 'Create and edit legal entities',
      scope: 'organization',
      sensitive: true,
    },
    { key: 'platform.property.read', description: 'View property configuration', scope: 'property' },
    {
      key: 'platform.property.create',
      description: 'Create properties',
      scope: 'organization',
      sensitive: true,
    },
    { key: 'platform.property.update', description: 'Edit property configuration', scope: 'property' },
    { key: 'platform.department.manage', description: 'Manage departments', scope: 'property' },
    {
      key: 'platform.businessDate.advance',
      description: 'Advance the business date (Day Close)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'platform.policy.manage',
      description: 'Change central (organization/brand/region) policies',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'platform.policy.override',
      description: 'Set a local policy override for a property',
      scope: 'property',
    },
    {
      key: 'platform.dataAuthority.manage',
      description: 'Change which system is the system of record for a property (adoption path)',
      scope: 'property',
      sensitive: true,
    },
  ],
};
