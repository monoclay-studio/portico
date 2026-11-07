import type { PorticoDatabase, TxContext } from '@portico/db';
import type { RequestContext } from '@portico/kernel';
import type { SyncBatchInput } from '../contracts';
import type { OperationsPorts } from '../ports';
import * as hk from './housekeeping';
import * as insp from './inspections';
import type { Deps } from './internal';
import * as lf from './lost-found';
import * as mx from './maintenance';
import * as sync from './sync';
import * as tasks from './tasks';
import * as units from './units';

type Rest<F> = F extends (d: Deps, ...args: infer A) => infer R ? (...args: A) => R : never;

function bind<T extends Record<string, unknown>>(d: Deps, mod: T) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v === 'function')
      out[k] = (...args: unknown[]) => (v as (...a: unknown[]) => unknown)(d, ...args);
  }
  return out;
}

/**
 * The operations service bound to its ports. Every function takes the command's `TxContext` (one transaction
 * per command) except `applySyncBatch`, which runs one transaction per offline mutation.
 */
export function createOperationsService(ports: OperationsPorts) {
  const d: Deps = { ports };
  const pick = <K extends string, M extends Record<K, unknown>>(mod: M, keys: readonly K[]) => {
    const b = bind(d, mod as Record<string, unknown>);
    return Object.fromEntries(keys.map((k) => [k, b[k]])) as { [P in K]: Rest<M[P]> };
  };
  return {
    // ── provider contract (domain-map § operations) ──
    getUnitCondition: (tx: TxContext, unitId: string) => units.getUnitCondition(d, tx, unitId),
    listUnitConditions: (tx: TxContext, input: { propertyId: string }) =>
      units.listUnitConditions(d, tx, input),
    createTask: (tx: TxContext, input: Parameters<typeof tasks.createTaskForModule>[2]) =>
      tasks.createTaskForModule(d, tx, input),
    // ── units & room status ──
    ...pick(units, [
      'upsertUnits',
      'syncUnitsFromInventory',
      'getUnit',
      'getUnitReadiness',
      'setCondition',
      'setDnd',
      'reportOccupancy',
      'setTurndown',
      'board',
      'arrivalReadiness',
      'upsertStayProjection',
      'listForwards',
      'acknowledgeForward',
      'applyExternalRoomStatus',
    ] as const),
    // ── tasks & service requests ──
    ...pick(tasks, [
      'getTask',
      'listTasks',
      'transitionTask',
      'assignTask',
      'commentTask',
      'runEscalations',
      'createServiceRequest',
      'getServiceRequest',
      'listServiceRequests',
      'listMyWork',
      'setGuestWaiting',
    ] as const),
    createGenericTask: (tx: TxContext, input: Parameters<typeof tasks.createTask>[2]) =>
      tasks.createTask(d, tx, input),
    // ── housekeeping planning ──
    ...pick(hk, [
      'createSection',
      'listSections',
      'upsertAttendant',
      'listAttendants',
      'generateDayPlan',
      'suggestAssignments',
      'applyAssignments',
    ] as const),
    // ── inspections ──
    ...pick(insp, ['createChecklistTemplate', 'listChecklistTemplates', 'recordInspection'] as const),
    // ── maintenance ──
    ...pick(mx, [
      'createAsset',
      'updateAsset',
      'getAsset',
      'listAssets',
      'assetHistory',
      'createWorkOrder',
      'getWorkOrder',
      'listWorkOrders',
      'requestUnitBlock',
      'addWorkOrderParts',
      'addWorkOrderPhotos',
      'completeWorkOrder',
      'returnToService',
      'listResolutionItems',
      'getResolutionItem',
      'getPreventiveSchedule',
      'resolveResolutionItem',
      'createPreventiveSchedule',
      'listPreventiveSchedules',
      'runPreventiveSchedules',
    ] as const),
    // ── lost & found ──
    ...pick(lf, [
      'recordLostFound',
      'getLostFound',
      'listLostFound',
      'matchLostFound',
      'releaseLostFound',
      'disposeLostFound',
    ] as const),
    // ── offline sync ──
    pullChanges: (tx: TxContext, q: Parameters<typeof sync.pullChanges>[2]) => sync.pullChanges(d, tx, q),
    listSyncConflicts: (tx: TxContext, propertyId: string, q: { since?: Date } = {}) =>
      sync.listSyncConflicts(d, tx, propertyId, q),
    applySyncBatch: (database: PorticoDatabase, ctx: RequestContext, input: SyncBatchInput) =>
      sync.applySyncBatch(d, database, ctx, input),
  };
}

export type OperationsService = ReturnType<typeof createOperationsService>;
