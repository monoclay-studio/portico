/**
 * Inventory provider API (docs/architecture/domain-map.md § inventory). `createInventoryService(ports)` binds the
 * module's ports once (composition root) and returns the functions other modules call with their `tx`.
 */
import type { TxContext } from '@portico/db';
import type { DateRange, EntityRef, LocalDate } from '@portico/kernel';
import type {
  Assignment,
  AvailabilityCell,
  AvailabilityExplanation,
  AvailabilityGrid,
  CompositeUnitInput,
  Feature,
  FeatureInput,
  Hold,
  InventoryConflict,
  OverbookingAllowance,
  OverbookingAllowanceInput,
  Unit,
  UnitBlock,
  UnitCandidate,
  UnitInput,
  UnitType,
  UnitTypeInput,
  UnitTypeUpdate,
  UnitUpdate,
} from './contracts';
import type { InventoryPorts } from './ports';
import * as assignments from './service/assignments';
import * as blocks from './service/blocks';
import * as catalog from './service/catalog';
import * as consumption from './service/consumption';
import type { ChangeOrigin, Deps } from './service/context';
import * as holds from './service/holds';
import * as overbooking from './service/overbooking';
import * as reads from './service/reads';

export type {
  AssignUnitInput,
  AssignUnitResult,
  FindAssignableInput,
  UnassignUnitInput,
} from './service/assignments';
export type { BlockUnitInput, BlockUnitResult } from './service/blocks';
export type {
  ChangeConsumptionInput,
  ChangeConsumptionResult,
  ConsumeInput,
  ConsumeResult,
  ReleaseInput,
  ReleaseResult,
  TransferConsumptionInput,
} from './service/consumption';
export type { ChangeOrigin } from './service/context';
export type { CreateHoldInput } from './service/holds';

type Origin = { origin?: ChangeOrigin };

export interface InventoryService {
  // ── consumption (provider calls; authorized by the caller's command) ──
  consume(tx: TxContext, input: consumption.ConsumeInput): Promise<consumption.ConsumeResult>;
  release(tx: TxContext, input: consumption.ReleaseInput): Promise<consumption.ReleaseResult>;
  changeConsumption(
    tx: TxContext,
    input: consumption.ChangeConsumptionInput,
  ): Promise<consumption.ChangeConsumptionResult>;
  transferConsumption(
    tx: TxContext,
    input: consumption.TransferConsumptionInput,
  ): Promise<{ nights: LocalDate[] }>;
  // ── holds ──
  createHold(tx: TxContext, input: holds.CreateHoldInput): Promise<{ holdId: string; expiresAt: string }>;
  convertHold(
    tx: TxContext,
    input: { holdId: string; ref: EntityRef },
  ): Promise<consumption.ConsumeResult & { holdId: string }>;
  releaseHold(tx: TxContext, input: { holdId: string; reason?: string }): Promise<{ released: boolean }>;
  extendHold(tx: TxContext, input: { holdId: string; expiresAt: Date | string }): Promise<Hold>;
  getHold(tx: TxContext, holdId: string): Promise<Hold>;
  expireDueHolds(tx: TxContext, opts?: { limit?: number }): Promise<{ expired: number }>;
  // ── assignments ──
  assignUnit(tx: TxContext, input: assignments.AssignUnitInput): Promise<assignments.AssignUnitResult>;
  unassignUnit(
    tx: TxContext,
    input: assignments.UnassignUnitInput,
  ): Promise<{ unassigned: Array<{ unitId: string; nights: DateRange }> }>;
  findAssignableUnits(tx: TxContext, input: assignments.FindAssignableInput): Promise<UnitCandidate[]>;
  listAssignments(
    tx: TxContext,
    filter: { propertyId: string; range: DateRange; unitId?: string; ref?: EntityRef },
  ): Promise<Assignment[]>;
  // ── unit blocks ──
  blockUnit(tx: TxContext, input: blocks.BlockUnitInput, opts?: Origin): Promise<blocks.BlockUnitResult>;
  releaseBlock(
    tx: TxContext,
    input: { blockId: string; reason?: string; expectedVersion?: number },
    opts?: Origin,
  ): Promise<UnitBlock>;
  getBlock(tx: TxContext, blockId: string): Promise<UnitBlock>;
  listBlocks(
    tx: TxContext,
    filter: { propertyId: string; range: DateRange; unitId?: string; status?: 'active' | 'released' | 'all' },
  ): Promise<UnitBlock[]>;
  // ── availability ──
  getAvailability(
    tx: TxContext,
    input: { propertyId: string; unitTypeIds?: string[]; range: DateRange },
  ): Promise<AvailabilityCell[]>;
  getAvailabilityGrid(
    tx: TxContext,
    input: { propertyId: string; unitTypeIds?: string[]; range: DateRange },
  ): Promise<AvailabilityGrid>;
  explainAvailability(
    tx: TxContext,
    input: { propertyId: string; unitTypeId: string; date: LocalDate },
  ): Promise<AvailabilityExplanation>;
  // ── overbooking & conflicts ──
  setOverbookingAllowance(
    tx: TxContext,
    propertyId: string,
    input: OverbookingAllowanceInput,
    opts?: Origin,
  ): Promise<{ allowances: OverbookingAllowance[]; conflictsResolved: string[] }>;
  listOverbookingAllowances(
    tx: TxContext,
    filter: { propertyId: string; range: DateRange; unitTypeId?: string; includeInactive?: boolean },
  ): Promise<OverbookingAllowance[]>;
  listConflicts(
    tx: TxContext,
    filter: {
      propertyId: string;
      status?: 'unresolved' | 'open' | 'resolving' | 'resolved' | 'all';
      range?: DateRange;
    },
  ): Promise<InventoryConflict[]>;
  getConflict(tx: TxContext, conflictId: string): Promise<InventoryConflict>;
  updateConflict(
    tx: TxContext,
    conflictId: string,
    expectedVersion: number,
    patch: { status?: 'open' | 'resolving'; ownerUserId?: string | null },
  ): Promise<InventoryConflict>;
  // ── catalog ──
  createFeature(tx: TxContext, propertyId: string, input: FeatureInput, opts?: Origin): Promise<Feature>;
  updateFeature(
    tx: TxContext,
    id: string,
    expectedVersion: number,
    patch: {
      name?: string;
      category?: Feature['category'];
      description?: string | null;
      status?: Feature['status'];
    },
  ): Promise<Feature>;
  listFeatures(tx: TxContext, propertyId: string, opts?: { includeArchived?: boolean }): Promise<Feature[]>;
  createUnitType(tx: TxContext, propertyId: string, input: UnitTypeInput, opts?: Origin): Promise<UnitType>;
  updateUnitType(
    tx: TxContext,
    id: string,
    expectedVersion: number,
    patch: UnitTypeUpdate,
    opts?: Origin,
  ): Promise<UnitType>;
  getUnitType(tx: TxContext, id: string): Promise<UnitType>;
  listUnitTypes(tx: TxContext, propertyId: string, opts?: { includeArchived?: boolean }): Promise<UnitType[]>;
  createUnit(tx: TxContext, propertyId: string, input: UnitInput, opts?: Origin): Promise<Unit>;
  createCompositeUnit(
    tx: TxContext,
    propertyId: string,
    input: CompositeUnitInput,
    opts?: Origin,
  ): Promise<Unit>;
  updateUnit(
    tx: TxContext,
    id: string,
    expectedVersion: number,
    patch: UnitUpdate,
    opts?: Origin,
  ): Promise<Unit>;
  getUnit(tx: TxContext, id: string): Promise<Unit>;
  listUnits(
    tx: TxContext,
    propertyId: string,
    filter?: { unitTypeId?: string; status?: Unit['status'] | 'all' },
  ): Promise<Unit[]>;
}

export function createInventoryService(ports: InventoryPorts): InventoryService {
  const deps: Deps = { ports };
  return {
    consume: (tx, input) => consumption.consume(deps, tx, input),
    release: (tx, input) => consumption.release(deps, tx, input),
    changeConsumption: (tx, input) => consumption.changeConsumption(deps, tx, input),
    transferConsumption: (tx, input) => consumption.transferConsumption(deps, tx, input),
    createHold: (tx, input) => holds.createHold(deps, tx, input),
    convertHold: (tx, input) => holds.convertHold(deps, tx, input),
    releaseHold: (tx, input) => holds.releaseHold(deps, tx, input),
    extendHold: (tx, input) => holds.extendHold(deps, tx, input),
    getHold: (tx, holdId) => holds.getHold(tx, holdId),
    expireDueHolds: (tx, opts) => holds.expireDueHolds(deps, tx, opts),
    assignUnit: (tx, input) => assignments.assignUnit(deps, tx, input),
    unassignUnit: (tx, input) => assignments.unassignUnit(deps, tx, input),
    findAssignableUnits: (tx, input) => assignments.findAssignableUnits(tx, input),
    listAssignments: (tx, filter) => assignments.listAssignments(tx, filter),
    blockUnit: (tx, input, opts) => blocks.blockUnit(deps, tx, input, opts),
    releaseBlock: (tx, input, opts) => blocks.releaseBlock(deps, tx, input, opts),
    getBlock: (tx, blockId) => blocks.getBlock(tx, blockId),
    listBlocks: (tx, filter) => blocks.listBlocks(tx, filter),
    getAvailability: (tx, input) => reads.getAvailability(deps, tx, input),
    getAvailabilityGrid: (tx, input) => reads.getAvailabilityGrid(deps, tx, input),
    explainAvailability: (tx, input) => reads.explainAvailability(deps, tx, input),
    setOverbookingAllowance: (tx, propertyId, input, opts) =>
      overbooking.setOverbookingAllowance(deps, tx, propertyId, input, opts),
    listOverbookingAllowances: (tx, filter) => overbooking.listOverbookingAllowances(tx, filter),
    listConflicts: (tx, filter) => overbooking.listConflicts(tx, filter),
    getConflict: (tx, id) => overbooking.getConflict(tx, id),
    updateConflict: (tx, id, v, patch) => overbooking.updateConflict(tx, id, v, patch),
    createFeature: (tx, propertyId, input, opts) => catalog.createFeature(deps, tx, propertyId, input, opts),
    updateFeature: (tx, id, v, patch) => catalog.updateFeature(deps, tx, id, v, patch),
    listFeatures: (tx, propertyId, opts) => catalog.listFeatures(tx, propertyId, opts),
    createUnitType: (tx, propertyId, input, opts) =>
      catalog.createUnitType(deps, tx, propertyId, input, opts),
    updateUnitType: (tx, id, v, patch, opts) => catalog.updateUnitType(deps, tx, id, v, patch, opts),
    getUnitType: (tx, id) => catalog.getUnitType(tx, id),
    listUnitTypes: (tx, propertyId, opts) => catalog.listUnitTypes(tx, propertyId, opts),
    createUnit: (tx, propertyId, input, opts) => catalog.createUnit(deps, tx, propertyId, input, opts),
    createCompositeUnit: (tx, propertyId, input, opts) =>
      catalog.createCompositeUnit(deps, tx, propertyId, input, opts),
    updateUnit: (tx, id, v, patch, opts) => catalog.updateUnit(deps, tx, id, v, patch, opts),
    getUnit: (tx, id) => catalog.getUnit(tx, id),
    listUnits: (tx, propertyId, filter) => catalog.listUnits(tx, propertyId, filter),
  };
}
