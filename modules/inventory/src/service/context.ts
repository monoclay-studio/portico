import { type TxContext, typed } from '@portico/db';
import {
  actorId,
  actorLabel,
  BusinessRuleError,
  type EntityRef,
  ForbiddenError,
  isUuid,
  NotFoundError,
  ValidationError,
} from '@portico/kernel';
import type { InventoryDataDomain, InventoryPorts } from '../ports';
import type { InventoryDB } from '../tables';

export const idb = (tx: TxContext) => typed<InventoryDB>(tx.db);

export interface Deps {
  ports: InventoryPorts;
}

/** Stable text identifying who acted (`user:<id>`, `system:<process>` …), stored on records. */
export function actorKey(tx: TxContext): string {
  return `${tx.actor.kind}:${actorId(tx.actor)}`;
}

export function actorName(tx: TxContext): string {
  return actorLabel(tx.actor);
}

/** Passes when the actor holds at least one of the permissions for the property. */
export function requireAnyPermission(
  tx: TxContext,
  permissions: readonly string[],
  propertyId: string,
): void {
  if (permissions.some((p) => tx.authz.can(p, { propertyId }))) return;
  throw new ForbiddenError(permissions.join(' or '), { propertyId });
}

export function assertRef(ref: EntityRef, field = 'ref'): EntityRef {
  if (
    !ref ||
    typeof ref.type !== 'string' ||
    ref.type.length === 0 ||
    ref.type.length > 60 ||
    !isUuid(ref.id)
  ) {
    throw new ValidationError(
      'invalid_ref',
      `${field} must name what consumes inventory, e.g. { type: "stay", id: "<uuid>" }.`,
      { field },
    );
  }
  return { type: ref.type, id: ref.id };
}

export function assertQuantity(quantity: number, max = 500): number {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
    throw new ValidationError('invalid_quantity', `Quantity must be a whole number from 1 to ${max}.`, {
      quantity,
    });
  }
  return quantity;
}

export function assertUuid(id: string, entity: string): string {
  if (!isUuid(id)) throw new NotFoundError(entity, id);
  return id;
}

/** Origin of a change made on behalf of an integration mirroring the system of record. */
export interface ChangeOrigin {
  /** The integration connection that is the system of record; mirroring writes from it are allowed. */
  connectionId: string;
}

/** Options internal callers pass through provider functions (never exposed on the public provider inputs). */
export interface WriteOptions {
  origin?: ChangeOrigin;
}

/**
 * Data authority guard (ADR-0014, CLAUDE.md §4.15). Inventory owns the `availability` domain, so EVERY write to the
 * ledger, holds, assignments, blocks, allowances and the catalog passes through here — including provider calls
 * made inside other modules' commands (reservations, distribution, groups). When an external system is the system
 * of record, Portico does not change availability itself: read-only connections are refused with an explanation,
 * and forward-mode connections are refused with guidance until forwarding exists. The mirroring integration passes
 * its own connection as `origin` (see `applyExternalAvailability`). `maintenance` is checked the same way for
 * out-of-order / out-of-service blocks.
 */
export async function guardDomainWrite(
  tx: TxContext,
  deps: Deps,
  propertyId: string,
  domain: InventoryDataDomain,
  origin?: ChangeOrigin,
): Promise<void> {
  const authority = await deps.ports.platform.getDataAuthority(tx, propertyId, domain);
  if (authority.authority === 'portico') return;
  if (origin && authority.connectionId && origin.connectionId === authority.connectionId) return;
  const mode = await deps.ports.platform.assertWritable(tx, propertyId, domain);
  if (mode === 'forward') {
    const system = authority.systemName ?? 'the external system of record';
    throw new BusinessRuleError(
      'forwarding_not_available',
      `${system} is the system of record for ${domain} at this property. Forwarding this change to it is not available yet, so make the change in ${system}; Portico will show it once it is received.`,
      { domain, systemName: authority.systemName, connectionId: authority.connectionId },
    );
  }
}

export function guardAvailabilityWrite(
  tx: TxContext,
  deps: Deps,
  propertyId: string,
  origin?: ChangeOrigin,
): Promise<void> {
  return guardDomainWrite(tx, deps, propertyId, 'availability', origin);
}

export const iso = (d: Date | string | null): string | null =>
  d === null ? null : typeof d === 'string' ? new Date(d).toISOString() : d.toISOString();

export function isoRequired(d: Date | string): string {
  return typeof d === 'string' ? new Date(d).toISOString() : d.toISOString();
}

export const DEFAULT_NOUNS: Record<string, string> = {
  room: 'Room',
  villa: 'Villa',
  suite: 'Suite',
  apartment: 'Apartment',
  bed: 'Bed',
  tent: 'Tent',
  pitch: 'Pitch',
  other: 'Unit',
};
