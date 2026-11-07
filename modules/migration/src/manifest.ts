import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

/** Permission keys. Migration moves a hotel's whole business: most of them are sensitive. */
export const P = {
  read: 'migration.job.read',
  manage: 'migration.job.manage',
  mappingReview: 'migration.mapping.review',
  exceptionManage: 'migration.exception.manage',
  financeSignoff: 'migration.finance.signoff',
  checklistComplete: 'migration.checklist.complete',
  staffAccept: 'migration.staff.accept',
  cutoverExecute: 'migration.cutover.execute',
  productionAuthorize: 'migration.production.authorize',
} as const;

export const migrationManifest: ModuleManifest = {
  name: 'migration',
  schema: 'migration',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  // The scheduler's routing function reads platform.tenant_environment (reviewed SECURITY DEFINER lookup).
  migrateAfter: ['platform'],
  recordTypes: [
    { type: 'migration_job', label: 'Migration', readPermission: P.read, route: '/migration/jobs/:id' },
    {
      type: 'migration_exception',
      label: 'Migration exception',
      readPermission: P.read,
      route: '/migration/exceptions/:id',
    },
    { type: 'migration_report', label: 'Reconciliation report', readPermission: P.read },
  ],
  permissions: [
    {
      key: P.read,
      description:
        'View migrations: progress, mappings, exceptions, reconciliation reports and the checklist',
      scope: 'property',
    },
    {
      key: P.manage,
      description:
        'Start a migration ("Move to Portico"), upload source exports, run the pipeline and rehearsals',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.mappingReview,
      description: 'Review migration mappings (unit types, rate plans, statuses, date order)',
      scope: 'property',
    },
    {
      key: P.exceptionManage,
      description: 'Assign and resolve non-financial migration exceptions',
      scope: 'property',
    },
    {
      key: P.financeSignoff,
      description:
        'Decide financial migration items: tax mappings, financial exceptions, card transfer and opening-balance sign-off',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.checklistComplete,
      description: 'Complete migration checklist steps (data authorization, channel switch)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.staffAccept,
      description: 'Record staff acceptance of key workflows on the rehearsed data',
      scope: 'property',
    },
    {
      key: P.cutoverExecute,
      description: 'Plan and run the cutover (freeze, switch of system of record) and request a rollback',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.productionAuthorize,
      description:
        'Authorize a production migration (second person; required before a live cutover) and approve a rollback',
      scope: 'property',
      sensitive: true,
    },
  ],
};

/**
 * Suggested role templates (identity owns ROLE_TEMPLATES; requested in FOUNDATION_REQUESTS.md FR-MIG-2). Migration
 * permissions are deliberately NOT in the general-manager template: an organization grants them for a migration.
 */
export const MIGRATION_ROLE_TEMPLATES = [
  {
    key: 'migration_lead',
    name: 'Migration lead',
    description: 'Runs the migration: sources, mappings, rehearsals, exceptions and the cutover.',
    permissions: [
      P.read,
      P.manage,
      P.mappingReview,
      P.exceptionManage,
      P.cutoverExecute,
      P.checklistComplete,
    ],
  },
  {
    key: 'migration_finance',
    name: 'Finance controller (migration)',
    description:
      'Decides tax mappings and financial exceptions; signs off opening balances and the card plan.',
    permissions: [P.read, P.financeSignoff],
  },
  {
    key: 'migration_approver',
    name: 'Migration approver',
    description: 'Authorizes a production migration and approves its rollback; records staff acceptance.',
    permissions: [P.read, P.productionAuthorize, P.staffAccept, P.checklistComplete],
  },
] as const;
