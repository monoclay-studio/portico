// Public API contracts for the inventory module. No server-only imports here: web apps import this file.
import { z } from 'zod';

const localDate = z.iso.date();
const timestamp = z.string();
const featureCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,62}$/, 'Use lowercase letters, digits and underscores, e.g. sea_view');

export const nightRange = z
  .object({ from: localDate, to: localDate })
  .describe('Half-open night range [from, to): from = arrival, to = departure');
export type NightRange = z.infer<typeof nightRange>;

export const entityRef = z.object({ type: z.string().min(1).max(60), id: z.uuid() });
export type EntityRefDto = z.infer<typeof entityRef>;

export const unitKind = z.enum(['room', 'villa', 'suite', 'apartment', 'bed', 'tent', 'pitch', 'other']);
export type UnitKind = z.infer<typeof unitKind>;

export const provenance = z.enum(['live', 'simulated', 'sandbox', 'copied', 'delayed', 'incomplete', 'external']);

export const dataAuthoritySummary = z.object({
  authority: z.enum(['portico', 'external']),
  systemName: z.string().nullable(),
  writeMode: z.enum(['exclusive', 'forward', 'read_only']),
});

// ───────────────────────────── Universal record contract ─────────────────────────────
// Mirrors RecordAction / RecordIssue / RecordOwner / RecordLink in @portico/kernel (records.ts).

export const recordAction = z.object({
  action: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  reason: z.string().optional(),
  previewRequired: z.boolean().optional(),
});
export const recordIssue = z.object({
  code: z.string(),
  severity: z.enum(['blocking', 'warning', 'info']),
  message: z.string(),
  owner: z
    .object({ kind: z.enum(['user', 'department']), id: z.string(), name: z.string().optional() })
    .optional(),
  since: z.string().optional(),
});
export const recordOwner = z.object({
  kind: z.enum(['user', 'department']),
  id: z.string(),
  name: z.string().optional(),
});
export const recordLink = z.object({
  rel: z.string(),
  type: z.string(),
  id: z.string(),
  title: z.string().optional(),
});
export const recordFields = {
  /** One entry per status family — never merged into one field. */
  status: z.record(z.string(), z.string()),
  /** The business date the status families describe ("tonight"). */
  statusAsOf: localDate.nullable(),
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  owner: recordOwner.nullable(),
  links: z.array(recordLink),
  provenance: provenance.optional(),
};

// ───────────────────────────── Features ─────────────────────────────

export const featureCategory = z.enum(['view', 'location', 'layout', 'amenity', 'accessibility', 'general']);
export const featureInput = z.object({
  code: featureCode,
  name: z.string().min(1).max(120),
  category: featureCategory.optional(),
  description: z.string().max(500).optional(),
});
export type FeatureInput = z.infer<typeof featureInput>;
export const featureUpdate = z.object({
  name: z.string().min(1).max(120).optional(),
  category: featureCategory.optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
});
export const feature = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  code: z.string(),
  name: z.string(),
  category: featureCategory,
  description: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  version: z.number().int(),
});
export type Feature = z.infer<typeof feature>;

// ───────────────────────────── Unit types ─────────────────────────────

export const unitTypeInput = z.object({
  code: z
    .string()
    .regex(
      /^[A-Z0-9][A-Z0-9_-]{0,19}$/,
      'Use 1–20 capital letters, digits, dashes or underscores, e.g. WV-POOL',
    ),
  name: z.string().min(1).max(120),
  kind: unitKind,
  noun: z.string().min(1).max(40).optional(),
  description: z.string().max(2000).optional(),
  baseOccupancy: z.number().int().min(1).max(50),
  maxAdults: z.number().int().min(1).max(50),
  maxChildren: z.number().int().min(0).max(50),
  maxOccupancy: z.number().int().min(1).max(50),
  bedding: z.string().max(200).optional(),
  sizeSqm: z.number().int().positive().max(100_000).optional(),
  rank: z.number().int().min(0).max(1000).optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  sellable: z.boolean().optional(),
  isComposite: z.boolean().optional(),
  features: z.array(featureCode).max(50).optional(),
});
export type UnitTypeInput = z.infer<typeof unitTypeInput>;
export const unitTypeUpdate = unitTypeInput
  .omit({ code: true, isComposite: true })
  .partial()
  .extend({
    status: z.enum(['active', 'archived']).optional(),
    description: z.string().max(2000).nullable().optional(),
  });
export type UnitTypeUpdate = z.infer<typeof unitTypeUpdate>;
export const unitType = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  code: z.string(),
  name: z.string(),
  kind: unitKind,
  noun: z.string(),
  description: z.string().nullable(),
  baseOccupancy: z.number().int(),
  maxAdults: z.number().int(),
  maxChildren: z.number().int(),
  maxOccupancy: z.number().int(),
  bedding: z.string().nullable(),
  sizeSqm: z.number().int().nullable(),
  rank: z.number().int(),
  sortOrder: z.number().int(),
  sellable: z.boolean(),
  isComposite: z.boolean(),
  features: z.array(z.string()),
  status: z.enum(['active', 'archived']),
  /** For composite types: how many units of each component type every composite unit combines. */
  composition: z.array(z.object({ unitTypeId: z.uuid(), perComposite: z.number().int() })).nullable(),
  version: z.number().int(),
});
export type UnitType = z.infer<typeof unitType>;

// ───────────────────────────── Units ─────────────────────────────

export const unitLocation = z.object({
  building: z.string().max(80).nullable().optional(),
  floor: z.string().max(40).nullable().optional(),
  zone: z.string().max(80).nullable().optional(),
});
export const unitInput = z.object({
  unitTypeId: z.uuid(),
  number: z.string().min(1).max(20),
  name: z.string().max(120).optional(),
  location: unitLocation.optional(),
  features: z.array(featureCode).max(50).optional(),
  maxOccupancyOverride: z.number().int().min(1).max(50).optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  /** First night the unit counts in inventory. Default: the property's current business date. */
  inInventoryFrom: localDate.optional(),
  notes: z.string().max(2000).optional(),
});
export type UnitInput = z.infer<typeof unitInput>;
export const compositeUnitInput = unitInput.extend({
  /** Units combined into this composite unit (e.g. two connecting villas). At least two. */
  componentUnitIds: z.array(z.uuid()).min(2).max(20),
});
export type CompositeUnitInput = z.infer<typeof compositeUnitInput>;
export const unitUpdate = z.object({
  name: z.string().max(120).nullable().optional(),
  location: unitLocation.optional(),
  features: z.array(featureCode).max(50).optional(),
  maxOccupancyOverride: z.number().int().min(1).max(50).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  status: z.enum(['active', 'inactive', 'retired']).optional(),
  /** First night the unit no longer counts in inventory (exclusive). */
  inInventoryTo: localDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UnitUpdate = z.infer<typeof unitUpdate>;
export const unit = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  unitTypeId: z.uuid(),
  number: z.string(),
  name: z.string().nullable(),
  location: z.object({
    building: z.string().nullable(),
    floor: z.string().nullable(),
    zone: z.string().nullable(),
  }),
  features: z.array(z.string()),
  maxOccupancyOverride: z.number().int().nullable(),
  sortOrder: z.number().int(),
  status: z.enum(['active', 'inactive', 'retired']),
  inInventoryFrom: localDate,
  inInventoryTo: localDate.nullable(),
  isComposite: z.boolean(),
  componentUnitIds: z.array(z.uuid()),
  memberOfCompositeUnitIds: z.array(z.uuid()),
  notes: z.string().nullable(),
  version: z.number().int(),
});
export type Unit = z.infer<typeof unit>;

// ───────────────────────────── Availability ─────────────────────────────

export const cellStatus = z.enum(['closed', 'available', 'sold_out', 'overbooked', 'oversold']);
export const availabilityCell = z.object({
  unitTypeId: z.uuid(),
  date: localDate,
  capacity: z.number().int(),
  outOfOrder: z.number().int(),
  sold: z.number().int(),
  held: z.number().int(),
  overbookingAllowance: z.number().int(),
  /** capacity − outOfOrder − sold − held + overbookingAllowance (composite types: see `composite`). */
  available: z.number().int(),
  /** What may be published/sold: never negative (an oversold type shows 0, with `oversoldBy` > 0). */
  sellable: z.number().int(),
  /** Informational: units out of service (counted, not assignable) and units in house use (inside `sold`). */
  outOfService: z.number().int(),
  houseUse: z.number().int(),
  overbookingInUse: z.number().int(),
  /** > 0 when the cell is oversold beyond authorization (an inventory conflict). */
  oversoldBy: z.number().int(),
  conflictId: z.uuid().nullable(),
  status: cellStatus,
  composite: z
    .object({
      totalUnits: z.number().int(),
      freeUnits: z.number().int(),
      unassignedSold: z.number().int(),
      unitLimit: z.number().int(),
      componentLimit: z.number().int().nullable(),
      limitingComponentTypeId: z.uuid().nullable(),
    })
    .nullable(),
});
export type AvailabilityCell = z.infer<typeof availabilityCell>;

export const availabilityQuery = z.object({
  from: localDate,
  to: localDate,
  unitTypeIds: z
    .string()
    .optional()
    .describe('Comma-separated unit type ids; omit for all unit types of the property'),
});
export const availabilityGrid = z.object({
  propertyId: z.uuid(),
  range: nightRange,
  generatedAt: timestamp,
  provenance,
  authority: dataAuthoritySummary,
  unitTypes: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      noun: z.string(),
      isComposite: z.boolean(),
    }),
  ),
  cells: z.array(availabilityCell),
  /** When the external system of record last applied its state (connected mode); null otherwise. */
  lastSyncAt: timestamp.nullable(),
  /**
   * House totals per night over every physical (non-composite) unit type of the property, even when `cells` is
   * filtered. Combined units are not added on top (their components already count). `sellable` is the most that
   * may be sold across all types that night; channels must not publish more in total.
   */
  houseTotals: z.array(
    z.object({
      date: localDate,
      capacity: z.number().int(),
      outOfOrder: z.number().int(),
      outOfService: z.number().int(),
      sold: z.number().int(),
      houseUse: z.number().int(),
      held: z.number().int(),
      overbookingAllowance: z.number().int(),
      available: z.number().int(),
      sellable: z.number().int(),
      oversoldTypes: z.number().int(),
    }),
  ),
});
export type AvailabilityGrid = z.infer<typeof availabilityGrid>;

export const unitNightState = z.enum([
  'free',
  'assigned',
  'out_of_order',
  'out_of_service',
  'house_use',
  'inactive',
]);
export const blockKind = z.enum(['out_of_order', 'out_of_service', 'house_use']);
export type BlockKind = z.infer<typeof blockKind>;

export const conflictStatus = z.enum(['open', 'resolving', 'resolved']);
export const conflictResolution = z.enum([
  'relocated',
  'upgraded',
  'moved_dates',
  'cancelled',
  'allowance_authorized',
  'capacity_restored',
  'other',
]);
export const conflictCause = z.object({
  at: timestamp,
  kind: z.string(),
  by: z.string(),
  ref: entityRef.nullable(),
  note: z.string().nullable(),
});
export const inventoryConflict = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  unitTypeId: z.uuid(),
  night: localDate,
  shortfall: z.number().int(),
  maxShortfall: z.number().int(),
  causes: z.array(conflictCause),
  status: conflictStatus,
  ownerUserId: z.uuid().nullable(),
  resolution: conflictResolution.nullable(),
  detectedAt: timestamp,
  resolvedAt: timestamp.nullable(),
  previousConflictId: z.uuid().nullable(),
  version: z.number().int(),
});
export type InventoryConflict = z.infer<typeof inventoryConflict>;
export const conflictUpdate = z.object({
  status: z.enum(['open', 'resolving']).optional(),
  ownerUserId: z.uuid().nullable().optional(),
});
export const conflictQuery = z.object({
  status: z.enum(['unresolved', 'open', 'resolving', 'resolved', 'all']).default('unresolved'),
  from: localDate.optional(),
  to: localDate.optional(),
});

export const overbookingAllowance = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  unitTypeId: z.uuid(),
  night: localDate,
  quantity: z.number().int(),
  kind: z.enum(['standing', 'ad_hoc']),
  reason: z.string(),
  authorizedBy: z.string(),
  enteredBy: z.string(),
  ref: entityRef.nullable(),
  expiresAt: timestamp.nullable(),
  status: z.enum(['active', 'revoked', 'expired', 'superseded']),
  createdAt: timestamp,
});
export type OverbookingAllowance = z.infer<typeof overbookingAllowance>;
export const overbookingAllowanceInput = z.object({
  unitTypeId: z.uuid(),
  nights: nightRange,
  /** Units allowed beyond capacity on each night; 0 removes the standing allowance. */
  quantity: z.number().int().min(0).max(100),
  reason: z.string().min(3).max(500),
  expiresAt: z.iso.datetime().optional(),
});
export type OverbookingAllowanceInput = z.infer<typeof overbookingAllowanceInput>;
export const overbookingAllowanceResult = z.object({
  allowances: z.array(overbookingAllowance),
  conflictsResolved: z.array(z.uuid()),
});

export const holdDto = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  unitTypeId: z.uuid(),
  nights: nightRange,
  quantity: z.number().int(),
  ref: entityRef,
  status: z.enum(['active', 'converted', 'released', 'expired']),
  expiresAt: timestamp,
  createdBy: z.string(),
  createdAt: timestamp,
  closedAt: timestamp.nullable(),
  closeReason: z.string().nullable(),
  version: z.number().int(),
});
export type Hold = z.infer<typeof holdDto>;

export const availabilityExplanation = z.object({
  propertyId: z.uuid(),
  unitTypeId: z.uuid(),
  unitTypeName: z.string(),
  date: localDate,
  status: cellStatus,
  headline: z.string(),
  formula: z.string(),
  available: z.number().int(),
  terms: z.object({
    capacity: z.number().int(),
    outOfOrder: z.number().int(),
    sold: z.number().int(),
    held: z.number().int(),
    overbookingAllowance: z.number().int(),
  }),
  reasons: z.array(z.string()),
  units: z.array(
    z.object({
      unitId: z.uuid(),
      number: z.string(),
      state: unitNightState,
      ref: entityRef.nullable(),
      viaCompositeUnitId: z.uuid().nullable(),
      blockId: z.uuid().nullable(),
      reason: z.string().nullable(),
      until: localDate.nullable(),
    }),
  ),
  sold: z.array(z.object({ ref: entityRef, quantity: z.number().int(), kind: z.string() })),
  holds: z.array(holdDto),
  allowances: z.array(overbookingAllowance),
  conflict: inventoryConflict.nullable(),
  composite: availabilityCell.shape.composite,
  provenance,
  lastSyncAt: timestamp.nullable(),
  authority: dataAuthoritySummary,
  generatedAt: timestamp,
});
export type AvailabilityExplanation = z.infer<typeof availabilityExplanation>;
export const explanationQuery = z.object({ unitTypeId: z.uuid(), date: localDate });

// ───────────────────────────── Assignments ─────────────────────────────

export const assignment = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  unitId: z.uuid(),
  unitNumber: z.string(),
  unitTypeId: z.uuid(),
  ref: entityRef,
  nights: nightRange,
  locked: z.boolean(),
  lockReason: z.string().nullable(),
  upgrade: z.object({ fromUnitTypeId: z.uuid(), reason: z.string(), chargeable: z.boolean() }).nullable(),
  /** Set on component rows: the composite unit whose assignment created this row. */
  viaCompositeUnitId: z.uuid().nullable(),
  createdBy: z.string(),
  createdAt: timestamp,
});
export type Assignment = z.infer<typeof assignment>;
export const assignmentsQuery = z.object({
  from: localDate,
  to: localDate,
  unitId: z.uuid().optional(),
  refType: z.string().max(60).optional(),
  refId: z.uuid().optional(),
});

export const unitCandidate = z.object({
  unitId: z.uuid(),
  number: z.string(),
  name: z.string().nullable(),
  unitTypeId: z.uuid(),
  location: unit.shape.location,
  features: z.array(z.string()),
  assignable: z.boolean(),
  score: z.number().int(),
  isComponent: z.boolean(),
  isComposite: z.boolean(),
  compositeUnitIds: z.array(z.uuid()),
  matchedFeatures: z.array(z.string()),
  missingFeatures: z.array(z.string()),
  exclusions: z.array(
    z.object({
      code: z.enum([
        'assigned',
        'out_of_order',
        'out_of_service',
        'house_use',
        'inactive',
        'component_unavailable',
        'composite_in_use',
      ]),
      message: z.string(),
      ref: entityRef.nullable(),
      nights: nightRange.nullable(),
      blockId: z.uuid().nullable(),
    }),
  ),
  ranking: z.array(z.string()),
});
export type UnitCandidate = z.infer<typeof unitCandidate>;
export const assignableQuery = z.object({
  unitTypeId: z.uuid(),
  from: localDate,
  to: localDate,
  features: z.string().optional().describe('Comma-separated feature codes the guest asked for'),
  refType: z.string().max(60).optional(),
  refId: z.uuid().optional(),
});

// ───────────────────────────── Unit blocks ─────────────────────────────

export const affectedAssignment = z.object({
  ref: entityRef,
  nights: nightRange,
  unitId: z.uuid(),
  viaCompositeUnitId: z.uuid().nullable(),
});
export type AffectedAssignment = z.infer<typeof affectedAssignment>;
export const unitBlock = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  unitId: z.uuid(),
  unitNumber: z.string(),
  unitTypeId: z.uuid(),
  kind: blockKind,
  nights: nightRange,
  /** Nights the block is actually in force (shorter than `nights` after an early release; null when none). */
  effectiveNights: nightRange.nullable(),
  reason: z.string(),
  sourceRef: entityRef.nullable(),
  status: z.enum(['active', 'released']),
  /** Assignments that overlapped the block when it was placed. */
  affectedAssignments: z.array(affectedAssignment),
  /** Of those, the ones still on the unit during the block — they need relocation. */
  outstandingAssignments: z.array(affectedAssignment),
  createdBy: z.string(),
  createdAt: timestamp,
  releasedAt: timestamp.nullable(),
  releasedBy: z.string().nullable(),
  releaseReason: z.string().nullable(),
  version: z.number().int(),
});
export type UnitBlock = z.infer<typeof unitBlock>;
export const unitBlockInput = z.object({
  unitId: z.uuid(),
  nights: nightRange,
  kind: blockKind,
  reason: z.string().min(3).max(500),
  sourceRef: entityRef.optional(),
});
export type UnitBlockInput = z.infer<typeof unitBlockInput>;
export const unitBlockResult = z.object({
  block: unitBlock,
  affectedAssignments: z.array(affectedAssignment),
  conflictsCreated: z.array(z.uuid()),
});
export const releaseBlockInput = z.object({ reason: z.string().min(3).max(500).optional() });
export const blocksQuery = z.object({
  from: localDate,
  to: localDate,
  unitId: z.uuid().optional(),
  status: z.enum(['active', 'released', 'all']).default('active'),
});

export const propertyParams = z.object({ propertyId: z.uuid() });
export const listQuery = z.object({ includeArchived: z.enum(['true', 'false']).optional() });
export const unitsQuery = z.object({
  unitTypeId: z.uuid().optional(),
  status: z.enum(['active', 'inactive', 'retired', 'all']).default('all'),
});

// ───────────────────────────── Records (GET responses) ─────────────────────────────

export const unitRecord = unit.extend(recordFields);
export type UnitRecord = z.infer<typeof unitRecord>;
export const unitTypeRecord = unitType.extend(recordFields);
export type UnitTypeRecord = z.infer<typeof unitTypeRecord>;
export const unitBlockRecord = unitBlock.extend(recordFields);
export type UnitBlockRecord = z.infer<typeof unitBlockRecord>;
export const inventoryConflictRecord = inventoryConflict.extend(recordFields);
export type InventoryConflictRecord = z.infer<typeof inventoryConflictRecord>;

/** What placing a block would do, computed by the same code path and rolled back (nothing is committed). */
export const unitBlockPreview = z.object({
  affectedAssignments: z.array(affectedAssignment),
  /** Nights that would become oversold beyond authorization (inventory conflicts). */
  oversoldNights: z.array(z.object({ unitTypeId: z.uuid(), night: localDate, shortfall: z.number().int() })),
  availabilityAfter: z.array(availabilityCell),
});
export type UnitBlockPreview = z.infer<typeof unitBlockPreview>;

export const unitChangePreviewInput = z.object({
  status: z.enum(['active', 'inactive', 'retired']).optional(),
  inInventoryTo: localDate.nullable().optional(),
});
export const unitChangePreview = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
  affectedAssignments: z.array(z.object({ ref: entityRef, nights: nightRange })),
  oversoldNights: z.array(z.object({ unitTypeId: z.uuid(), night: localDate, shortfall: z.number().int() })),
});
