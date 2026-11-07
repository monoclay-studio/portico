import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

export const platformManifest: ModuleManifest = {
  name: 'platform',
  schema: 'platform',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
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
      description: 'Change which system is the system of record for a data domain at a property',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'platform.property.activate',
      description:
        'Approve pilot and production activation, approve activation scopes, stop pilots, deactivate',
      scope: 'property',
      sensitive: true,
    },
    { key: 'platform.outlet.manage', description: 'Create and edit outlets', scope: 'property' },
    {
      key: 'platform.owner.read',
      description: 'View owners and unit ownership shares',
      scope: 'organization',
    },
    {
      key: 'platform.owner.manage',
      description: 'Create owners and change unit ownership shares',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'platform.plan.read',
      description: "View the organization's plan, add-ons and limits",
      scope: 'organization',
    },
    {
      key: 'platform.configuration.export',
      description: "Export a property's configuration as a bundle",
      scope: 'property',
    },
    {
      key: 'platform.configuration.manage',
      description: 'Import configuration bundles and prepare and apply configuration changes',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'platform.configuration.approve',
      description: 'Approve portfolio configuration changes prepared by someone else',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'platform.rolloutGroup.manage',
      description: 'Manage staged rollout groups',
      scope: 'organization',
    },
    {
      key: 'platform.trial.manage',
      description: 'Create, reset, export and delete trial environments; carry trial configuration forward',
      scope: 'organization',
      sensitive: true,
    },
  ],
};
