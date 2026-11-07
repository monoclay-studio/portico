import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

export const ratesManifest: ModuleManifest = {
  name: 'rates',
  schema: 'rates',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  recordTypes: [
    {
      type: 'rate_plan',
      label: 'Rate plan',
      readPermission: 'rates.ratePlan.read',
      route: '/rates/plans/:id',
    },
    {
      type: 'rate_policy',
      label: 'Rate policy',
      readPermission: 'rates.ratePlan.read',
      route: '/rates/policies/:id',
    },
    {
      type: 'inclusion',
      label: 'Inclusion / allowance',
      readPermission: 'rates.ratePlan.read',
      route: '/rates/inclusions/:id',
    },
    {
      type: 'package',
      label: 'Package',
      readPermission: 'rates.ratePlan.read',
      route: '/rates/packages/:id',
    },
    {
      type: 'promotion',
      label: 'Promotion',
      readPermission: 'rates.ratePlan.read',
      route: '/rates/promotions/:id',
    },
    {
      type: 'tax_rule',
      label: 'Tax & fee rule',
      readPermission: 'rates.taxRule.read',
      route: '/settings/tax-rules/:id',
    },
    { type: 'tax_rule_version', label: 'Tax & fee rule version', readPermission: 'rates.taxRule.read' },
  ],
  permissions: [
    {
      key: 'rates.ratePlan.read',
      description: 'View rate plans, prices, restrictions and policies',
      scope: 'property',
    },
    {
      key: 'rates.ratePlan.manage',
      description: 'Create and edit rate plans and their status',
      scope: 'property',
    },
    { key: 'rates.price.manage', description: 'Change prices in the rate calendar', scope: 'property' },
    {
      key: 'rates.restriction.manage',
      description: 'Change restrictions (closed, CTA/CTD, length of stay…)',
      scope: 'property',
    },
    {
      key: 'rates.restriction.override',
      description: 'Quote and book through restriction violations with a reason (audited)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'rates.promotion.manage',
      description: 'Create and edit promotions and promo codes',
      scope: 'property',
    },
    {
      key: 'rates.package.manage',
      description: 'Create and edit packages, inclusions, allowances and meal plans',
      scope: 'property',
    },
    {
      key: 'rates.policy.manage',
      description: 'Create and edit cancellation, guarantee and deposit policies',
      scope: 'property',
    },
    {
      key: 'rates.taxRule.read',
      description: 'View tax and fee rules and their versions',
      scope: 'organization',
    },
    {
      key: 'rates.taxRule.manage',
      description: 'Create tax and fee rules and draft new versions',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'rates.taxRule.activate',
      description: 'Activate a tax or fee rule version after reviewing the change report',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'rates.quote.read',
      description: 'Price stays (quotes, change previews, tax previews)',
      scope: 'property',
    },
  ],
};
