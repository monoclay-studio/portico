import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

/** Permission keys of the day-close module (`dayClose.<resource>.<action>`, property-scoped). Spec §8. */
export const DAY_CLOSE_PERMISSIONS = {
  runRead: 'dayClose.run.read',
  runStart: 'dayClose.run.start',
  runResume: 'dayClose.run.resume',
  runCancel: 'dayClose.run.cancel',
  exceptionOverride: 'dayClose.exception.override',
  issueResolve: 'dayClose.issue.resolve',
  policyManage: 'dayClose.policy.manage',
  reportRead: 'dayClose.report.read',
} as const;

/** Advancing the business date is platform's sensitive permission, checked by platform on the acting user. */
export const ADVANCE_PERMISSION = 'platform.businessDate.advance';

export const DAY_CLOSE_RECORD_TYPES = { run: 'day_close_run', report: 'day_report' } as const;

export const dayCloseManifest: ModuleManifest = {
  name: 'day-close',
  schema: 'day_close',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  features: ['core.dayClose'],
  recordTypes: [
    {
      type: DAY_CLOSE_RECORD_TYPES.run,
      label: 'Day Close run',
      readPermission: DAY_CLOSE_PERMISSIONS.runRead,
      route: '/day-close/runs/:id',
    },
    {
      type: DAY_CLOSE_RECORD_TYPES.report,
      label: 'Day report',
      readPermission: DAY_CLOSE_PERMISSIONS.reportRead,
      route: '/day-close/reports/:id',
    },
  ],
  permissions: [
    {
      key: DAY_CLOSE_PERMISSIONS.runRead,
      description: 'View Day Close readiness (open items with owners), runs, steps and progress',
      scope: 'property',
    },
    {
      key: DAY_CLOSE_PERMISSIONS.runStart,
      description:
        'Start Day Close for the current business date (advancing also needs platform.businessDate.advance)',
      scope: 'property',
    },
    {
      key: DAY_CLOSE_PERMISSIONS.runResume,
      description: 'Resume a blocked, failed or interrupted Day Close run',
      scope: 'property',
    },
    {
      key: DAY_CLOSE_PERMISSIONS.runCancel,
      description: 'Cancel a Day Close run before anything was posted (with a reason)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: DAY_CLOSE_PERMISSIONS.exceptionOverride,
      description: 'Let Day Close proceed past a blocking item, with a reason per item',
      scope: 'property',
      sensitive: true,
    },
    {
      key: DAY_CLOSE_PERMISSIONS.issueResolve,
      description: 'Resolve Day Close follow-ups (e.g. a no-show fee collected outside Portico) with a note',
      scope: 'property',
    },
    {
      key: DAY_CLOSE_PERMISSIONS.policyManage,
      description:
        'Change the property Day Close policy: what blocks, no-show handling, schedule and auto-close',
      scope: 'property',
      sensitive: true,
    },
    {
      key: DAY_CLOSE_PERMISSIONS.reportRead,
      description: 'View day reports (manager flash, trial balance, exceptions) and frozen day statistics',
      scope: 'property',
    },
  ],
};

/**
 * What each role template needs from day-close (identity owns the templates — contract request in README).
 * `night_auditor` and `general_manager` already hold `dayClose.*` and `platform.businessDate.advance`.
 */
export const DAY_CLOSE_ROLE_GRANTS = {
  night_auditor: ['dayClose.*', ADVANCE_PERMISSION],
  front_office_manager: [
    DAY_CLOSE_PERMISSIONS.runRead,
    DAY_CLOSE_PERMISSIONS.runStart,
    DAY_CLOSE_PERMISSIONS.runResume,
    DAY_CLOSE_PERMISSIONS.runCancel,
    DAY_CLOSE_PERMISSIONS.exceptionOverride,
    DAY_CLOSE_PERMISSIONS.issueResolve,
    DAY_CLOSE_PERMISSIONS.reportRead,
    ADVANCE_PERMISSION,
  ],
  finance: [
    DAY_CLOSE_PERMISSIONS.runRead,
    DAY_CLOSE_PERMISSIONS.reportRead,
    DAY_CLOSE_PERMISSIONS.issueResolve,
  ],
} as const;
