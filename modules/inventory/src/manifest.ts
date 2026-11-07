import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

/** Permission keys used by the inventory module (`inventory.<resource>.<action>`). */
export const INVENTORY_PERMISSIONS = {
  unitRead: 'inventory.unit.read',
  unitTypeManage: 'inventory.unitType.manage',
  unitManage: 'inventory.unit.manage',
  availabilityRead: 'inventory.availability.read',
  availabilityManage: 'inventory.availability.manage',
  overbookingAuthorize: 'inventory.overbooking.authorize',
  blockManage: 'inventory.block.manage',
  houseUseCreate: 'inventory.houseUse.create',
  assignmentManage: 'inventory.assignment.manage',
  assignmentOverrideLock: 'inventory.assignment.overrideLock',
} as const;

export const inventoryManifest: ModuleManifest = {
  name: 'inventory',
  schema: 'inventory',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  permissions: [
    {
      key: INVENTORY_PERMISSIONS.unitRead,
      description: 'View unit types, units, features, composite units, assignments and unit blocks',
      scope: 'property',
    },
    {
      key: INVENTORY_PERMISSIONS.unitTypeManage,
      description: 'Create and edit unit types and the unit features catalog',
      scope: 'property',
    },
    {
      key: INVENTORY_PERMISSIONS.unitManage,
      description: 'Create and edit units and composite units (connecting rooms, multi-bedroom residences)',
      scope: 'property',
    },
    {
      key: INVENTORY_PERMISSIONS.availabilityRead,
      description: 'View the availability grid, availability explanations and inventory conflicts',
      scope: 'property',
    },
    {
      key: INVENTORY_PERMISSIONS.availabilityManage,
      description: 'Manage holds and take ownership of inventory conflicts',
      scope: 'property',
    },
    {
      key: INVENTORY_PERMISSIONS.overbookingAuthorize,
      description: 'Authorize selling beyond capacity (authorized overbooking) for a unit type and night',
      scope: 'property',
      sensitive: true,
    },
    {
      key: INVENTORY_PERMISSIONS.blockManage,
      description: 'Place and release out-of-order and out-of-service blocks on units',
      scope: 'property',
    },
    {
      key: INVENTORY_PERMISSIONS.houseUseCreate,
      description: 'Take a unit for house use (consumes inventory, no revenue)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: INVENTORY_PERMISSIONS.assignmentManage,
      description: 'Assign, move and unassign specific units for stays',
      scope: 'property',
    },
    {
      key: INVENTORY_PERMISSIONS.assignmentOverrideLock,
      description: 'Move or remove an assignment that is locked to its unit',
      scope: 'property',
      sensitive: true,
    },
  ],
};
