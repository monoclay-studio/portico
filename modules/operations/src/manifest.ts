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
  housekeepingRead: 'operations.housekeeping.read',
  maintenanceRead: 'operations.maintenance.read',
  maintenanceSetInventoryImpact: 'operations.maintenance.setInventoryImpact',
  assetManage: 'operations.asset.manage',
  syncConflictResolve: 'operations.syncConflict.resolve',
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
    {
      key: OPERATIONS_PERMISSIONS.housekeepingRead,
      description:
        'View the housekeeping board, unit condition and readiness (alias of operations.unit.read)',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.maintenanceRead,
      description: 'View work orders, assets, preventive schedules and their history',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.maintenanceSetInventoryImpact,
      description: 'Take units out of order / out of service for maintenance and return them to sale',
      scope: 'property',
      sensitive: true,
    },
    {
      key: OPERATIONS_PERMISSIONS.assetManage,
      description: 'Maintain the asset register and preventive maintenance schedules',
      scope: 'property',
    },
    {
      key: OPERATIONS_PERMISSIONS.syncConflictResolve,
      description: 'Review offline sync conflicts reported by staff devices',
      scope: 'property',
    },
  ],
  features: ['core.housekeeping', 'core.maintenance'],
  // Room-status changes are audited under target type `unit` so they appear on the unit's cross-module timeline;
  // the `unit` record type itself is declared by inventory (which owns the unit catalog).
  recordTypes: [
    { type: 'task', label: 'Task', readPermission: 'operations.task.read', route: '/operations/tasks/:id' },
    {
      type: 'service_request',
      label: 'Service request',
      readPermission: 'operations.task.read',
      route: '/operations/service-requests/:id',
    },
    {
      type: 'work_order',
      label: 'Work order',
      readPermission: 'operations.maintenance.read',
      route: '/operations/work-orders/:id',
    },
    {
      type: 'asset',
      label: 'Asset',
      readPermission: 'operations.maintenance.read',
      route: '/operations/assets/:id',
    },
    {
      type: 'preventive_schedule',
      label: 'Preventive schedule',
      readPermission: 'operations.maintenance.read',
      route: '/operations/preventive-schedules/:id',
    },
    {
      type: 'resolution_item',
      label: 'Stay affected by maintenance',
      readPermission: 'operations.unit.read',
      route: '/operations/resolution-items/:id',
    },
    {
      type: 'lost_found_item',
      label: 'Lost & found item',
      readPermission: 'operations.lostFound.manage',
      route: '/operations/lost-found/:id',
    },
  ],
};
