import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

/** Permission keys of the operations module (`operations.<resource>.<action>`, property-scoped). */
export const OPERATIONS_PERMISSIONS = {
  unitRead: 'operations.unit.read',
  unitConfigure: 'operations.unit.configure',
  housekeepingUpdate: 'operations.housekeeping.update',
  housekeepingAssign: 'operations.housekeeping.assign',
  housekeepingInspect: 'operations.housekeeping.inspect',
  taskRead: 'operations.task.read',
  taskUpdate: 'operations.task.update',
  taskManage: 'operations.task.manage',
  maintenanceReport: 'operations.maintenance.report',
  maintenanceManage: 'operations.maintenance.manage',
  lostFoundManage: 'operations.lostFound.manage',
  externalSync: 'operations.external.sync',
} as const;

export const operationsManifest: ModuleManifest = {
  name: 'operations',
  schema: 'operations',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  permissions: [
    {
      key: OPERATIONS_PERMISSIONS.unitRead,
      description: 'View unit condition, occupancy, readiness and the housekeeping board',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.unitConfigure,
      description: 'Configure the unit catalog mirror, sections and housekeeping roster',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.housekeepingUpdate,
      description: 'Update unit condition, do-not-disturb, turndown and report occupancy discrepancies',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.housekeepingAssign,
      description: 'Plan housekeeping, assign and reassign attendants',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.housekeepingInspect,
      description: 'Inspect units (pass/fail) and set the inspected condition',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.taskRead,
      description: 'View tasks, service requests and their history',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.taskUpdate,
      description: 'Work on tasks assigned to me (start, block, complete, comment)',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.taskManage,
      description: 'Create, assign, verify, cancel any task and log service requests',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.maintenanceReport,
      description: 'Report a fault (create a work order without taking units out of inventory)',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.maintenanceManage,
      description:
        'Manage work orders, assets and preventive schedules; take units out of order/service and return them',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.lostFoundManage,
      description: 'Record, match, release and dispose of lost & found items',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.externalSync,
      description:
        'Apply room-status / maintenance updates from an external system of record and acknowledge forwarded changes (integration connectors)',
      scope: 'property',
      sensitive: true,
    },
  ],
  features: ['core.housekeeping', 'core.maintenance'],
};
