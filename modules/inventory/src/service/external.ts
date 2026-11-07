import { sql, type TxContext } from '@portico/db';
import { BusinessRuleError, type DateRange, type EntityRef, ValidationError } from '@portico/kernel';
import { assignUnit, unassignUnit } from './assignments';
import { type ConsumptionKind, changeConsumption, consume, release } from './consumption';
import type { Deps } from './context';

export type ExternalAvailabilityOperation =
  | {
      op: 'consume';
      unitTypeId: string;
      nights: DateRange;
      quantity: number;
      ref: EntityRef;
      kind?: ConsumptionKind;
    }
  | { op: 'release'; ref: EntityRef; nights?: DateRange }
  | {
      op: 'changeConsumption';
      ref: EntityRef;
      from: { unitTypeId: string; nights: DateRange };
      to: { unitTypeId: string; nights: DateRange; quantity?: number };
    }
  | { op: 'assign'; unitId: string; ref: EntityRef; nights: DateRange }
  | { op: 'unassign'; ref: EntityRef; nights?: DateRange };

export interface ApplyExternalAvailabilityInput {
  propertyId: string;
  /** The integration connection that is the system of record for `availability` at this property. */
  connectionId: string;
  operations: ExternalAvailabilityOperation[];
}

export interface ApplyExternalAvailabilityResult {
  applied: number;
  /** Inventory conflicts opened because the external system sold beyond what Portico's ledger allows. */
  conflictIds: string[];
  lastSyncAt: string;
}

/**
 * The ONLY way availability state changes while an external system is the system of record (connected mode,
 * ADR-0014): the integration that mirrors that system applies what it received. Every other caller — desk,
 * reservations, distribution, groups — is refused by the `availability` authority guard.
 *  - Only the authoritative connection may call it; anything else is refused.
 *  - Sales are mirrored with `record_conflict`: the external system is the truth, so a difference with Portico's
 *    ledger becomes a visible inventory conflict (a discrepancy to investigate), never a refusal.
 *  - Locked assignments are overridden: the external system decides.
 *  - The time of the sync is recorded, so reads can say "external, last update 14:02".
 */
export async function applyExternalAvailability(
  deps: Deps,
  tx: TxContext,
  input: ApplyExternalAvailabilityInput,
): Promise<ApplyExternalAvailabilityResult> {
  const authority = await deps.ports.platform.getDataAuthority(tx, input.propertyId, 'availability');
  if (authority.authority !== 'external' || authority.connectionId !== input.connectionId) {
    throw new BusinessRuleError(
      'not_system_of_record',
      authority.authority === 'portico'
        ? 'Portico is the system of record for availability at this property, so external availability is not applied here. Book through Portico instead.'
        : `Only the connection that is the system of record for availability (${authority.systemName ?? 'another connection'}) can apply its state here.`,
      { propertyId: input.propertyId, connectionId: input.connectionId },
    );
  }
  if (input.operations.length > 500) {
    throw new ValidationError(
      'too_many_operations',
      'Apply at most 500 operations per call; split the batch.',
    );
  }
  const opts = { origin: { connectionId: input.connectionId } };
  const conflictIds: string[] = [];
  for (const op of input.operations) {
    switch (op.op) {
      case 'consume': {
        const r = await consume(
          deps,
          tx,
          {
            propertyId: input.propertyId,
            unitTypeId: op.unitTypeId,
            nights: op.nights,
            quantity: op.quantity,
            ref: op.ref,
            onShortfall: 'record_conflict',
            ...(op.kind ? { kind: op.kind } : {}),
          },
          opts,
        );
        conflictIds.push(...r.conflictIds);
        break;
      }
      case 'release':
        await release(deps, tx, { ref: op.ref, ...(op.nights ? { nights: op.nights } : {}) }, opts);
        break;
      case 'changeConsumption': {
        const r = await changeConsumption(
          deps,
          tx,
          { ref: op.ref, from: op.from, to: op.to, onShortfall: 'record_conflict' },
          opts,
        );
        conflictIds.push(...r.conflictIds);
        break;
      }
      case 'assign':
        await assignUnit(
          deps,
          tx,
          {
            unitId: op.unitId,
            ref: op.ref,
            nights: op.nights,
            overrideLock: true,
            allowCompositeConflict: true,
          },
          opts,
        );
        break;
      case 'unassign':
        await unassignUnit(
          deps,
          tx,
          {
            ref: op.ref,
            ...(op.nights ? { nights: op.nights } : {}),
            overrideLock: true,
            reason: 'Mirrored from the system of record',
          },
          opts,
        );
        break;
    }
  }
  await sql`
    insert into inventory.external_sync (tenant_id, property_id, connection_id, last_applied_at, operations)
    values (${tx.tenantId}, ${input.propertyId}, ${input.connectionId}, ${tx.now}, ${input.operations.length})
    on conflict (tenant_id, property_id, connection_id)
    do update set last_applied_at = excluded.last_applied_at,
                  operations = inventory.external_sync.operations + excluded.operations`.execute(tx.db);
  await tx.audit({
    action: 'inventory.external.apply',
    target: { type: 'property', id: input.propertyId },
    propertyId: input.propertyId,
    after: { connectionId: input.connectionId, operations: input.operations.length, conflictIds },
  });
  return { applied: input.operations.length, conflictIds, lastSyncAt: tx.now.toISOString() };
}

/** When the external system of record last applied its availability here (null: never → counts are incomplete). */
export async function lastExternalSync(
  tx: TxContext,
  propertyId: string,
  connectionId: string | null,
): Promise<Date | null> {
  if (!connectionId) return null;
  const { rows } = await sql<{ last_applied_at: Date }>`
    select last_applied_at from inventory.external_sync
    where property_id = ${propertyId} and connection_id = ${connectionId}`.execute(tx.db);
  return rows[0]?.last_applied_at ?? null;
}
