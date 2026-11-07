import { sql, type TxContext, typed } from '@portico/db';
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
import type { InventoryPorts } from '../ports';
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

/** Origin of a catalog/manual change made on behalf of an integration mirroring the system of record. */
export interface ChangeOrigin {
  /** The integration connection that is the system of record; mirroring writes from it are allowed. */
  connectionId: string;
}

/**
 * Data authority guard for configuration and manual inventory changes (ADR-0014). When an external system is the
 * system of record for `availability`, Portico does not change availability itself: read-only connections reject
 * the change with an explanation, and forward-mode connections need the integration to forward it (not yet
 * available in wave 1, so the change is rejected with guidance). Integrations mirroring the system of record pass
 * their connection as `origin`.
 */
export async function guardAvailabilityWrite(
  tx: TxContext,
  deps: Deps,
  propertyId: string,
  origin?: ChangeOrigin,
): Promise<void> {
  const authority = await deps.ports.platform.getDataAuthority(tx, propertyId, 'availability');
  if (authority.authority === 'portico') return;
  if (origin && authority.connectionId && origin.connectionId === authority.connectionId) return;
  const mode = await deps.ports.platform.assertWritable(tx, propertyId, 'availability');
  if (mode === 'forward') {
    const system = authority.systemName ?? 'the external system of record';
    throw new BusinessRuleError(
      'forwarding_not_available',
      `${system} is the system of record for availability at this property. Forwarding this change to it is not available yet, so make the change in ${system}; Portico will show it once it is received.`,
      { domain: 'availability', systemName: authority.systemName, connectionId: authority.connectionId },
    );
  }
}

export const iso = (d: Date | string | null): string | null =>
  d === null ? null : typeof d === 'string' ? new Date(d).toISOString() : d.toISOString();

export function isoRequired(d: Date | string): string {
  return typeof d === 'string' ? new Date(d).toISOString() : d.toISOString();
}

/** Postgres error code helper. */
export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'constraint' in err
    ? String((err as { constraint: unknown }).constraint)
    : undefined;
}

/**
 * Run `fn` inside a savepoint so that a failure leaves the surrounding transaction usable and unchanged
 * (callers may catch the error and continue, e.g. to offer alternatives).
 */
export async function withSavepoint<T>(tx: TxContext, name: string, fn: () => Promise<T>): Promise<T> {
  const sp = sql.raw(name);
  await sql`savepoint ${sp}`.execute(tx.db);
  try {
    const result = await fn();
    await sql`release savepoint ${sp}`.execute(tx.db);
    return result;
  } catch (err) {
    await sql`rollback to savepoint ${sp}`.execute(tx.db);
    await sql`release savepoint ${sp}`.execute(tx.db);
    throw err;
  }
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
