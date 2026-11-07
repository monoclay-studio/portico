import { sql, type TxContext } from '@portico/db';
import { BusinessRuleError, NotFoundError, newId, requirePermission } from '@portico/kernel';
import { RESERVATIONS_EVENTS as E } from '../events';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import { actorKey, type Deps, db, json } from './context';

export interface ForwardedChange {
  id: string;
  kind: string;
  status: 'pending' | 'acknowledged' | 'rejected';
  systemName: string | null;
  bookingId: string | null;
  stayId: string | null;
  createdAt: string;
}

/** Result of a command when an external system is the system of record with write mode `forward`. */
export interface ForwardedResult {
  forwarded: true;
  forwardedChange: ForwardedChange;
  message: string;
}

export function isForwarded(value: unknown): value is ForwardedResult {
  return typeof value === 'object' && value !== null && (value as { forwarded?: unknown }).forwarded === true;
}

/**
 * Data authority guard (ADR-0014, CLAUDE.md rule 15). `portico` → proceed. `read_only` → the platform throws an
 * explanatory `external_system_of_record` error. `forward` → record a PENDING forwarded change (delivered by the
 * integration module) and do NOT apply the change locally: it becomes effective only when acknowledged.
 */
export async function guardAuthority(
  deps: Deps,
  tx: TxContext,
  input: {
    propertyId: string;
    kind: string;
    payload: unknown;
    bookingId?: string | null;
    stayId?: string | null;
  },
): Promise<ForwardedResult | null> {
  const mode = await deps.ports.platform.assertWritable(tx, input.propertyId, 'reservations');
  if (mode === 'portico') return null;
  const authority = await deps.ports.platform.getDataAuthority(tx, input.propertyId, 'reservations');
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('reservations.forwarded_changes')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      booking_id: input.bookingId ?? null,
      stay_id: input.stayId ?? null,
      kind: input.kind,
      connection_id: authority.connectionId,
      system_name: authority.systemName,
      payload: json(input.payload),
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
  await tx.audit({
    action: 'reservations.forwardedChange.create',
    target: { type: 'forwarded_change', id },
    propertyId: input.propertyId,
    after: { kind: input.kind, bookingId: input.bookingId ?? null, stayId: input.stayId ?? null },
  });
  await tx.emit({
    type: E.forwardedChangeCreated,
    propertyId: input.propertyId,
    aggregate: { type: 'forwarded_change', id },
    payload: {
      forwardedChangeId: id,
      kind: input.kind,
      connectionId: authority.connectionId,
      bookingId: input.bookingId ?? null,
      stayId: input.stayId ?? null,
    },
  });
  const system = authority.systemName ?? 'the external system of record';
  return {
    forwarded: true,
    forwardedChange: {
      id,
      kind: input.kind,
      status: 'pending',
      systemName: authority.systemName,
      bookingId: input.bookingId ?? null,
      stayId: input.stayId ?? null,
      createdAt: tx.now.toISOString(),
    },
    message: `${system} is the system of record for reservations here. Your change was sent to it and is pending until it confirms; nothing has changed in Portico yet.`,
  };
}

/** The integration module records the external system's answer. Effects arrive later via the inbound sync. */
export async function acknowledgeForwardedChange(
  tx: TxContext,
  input: { id: string; outcome: 'acknowledged' | 'rejected'; externalRef?: string; detail?: string },
): Promise<ForwardedChange> {
  const row = await db(tx)
    .selectFrom('reservations.forwarded_changes')
    .selectAll()
    .where('id', '=', input.id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new NotFoundError('forwarded_change', input.id);
  requirePermission(tx, P.forwardAcknowledge, { propertyId: row.property_id });
  if (row.status !== 'pending') {
    throw new BusinessRuleError(
      'forwarded_change_resolved',
      `This forwarded change was already ${row.status}; acknowledgements are recorded once.`,
    );
  }
  await db(tx)
    .updateTable('reservations.forwarded_changes')
    .set({
      status: input.outcome,
      external_ref: input.externalRef ?? null,
      detail: input.detail ?? null,
      resolved_at: tx.now,
      version: sql`version + 1`,
    })
    .where('id', '=', input.id)
    .execute();
  await tx.audit({
    action: `reservations.forwardedChange.${input.outcome}`,
    target: { type: 'forwarded_change', id: input.id },
    propertyId: row.property_id,
    after: { externalRef: input.externalRef ?? null, detail: input.detail ?? null },
  });
  return {
    id: row.id,
    kind: row.kind,
    status: input.outcome,
    systemName: row.system_name,
    bookingId: row.booking_id,
    stayId: row.stay_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listForwardedChanges(tx: TxContext, input: { propertyId: string; status?: string }) {
  requirePermission(tx, P.bookingRead, { propertyId: input.propertyId });
  const rows = await db(tx)
    .selectFrom('reservations.forwarded_changes')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('status', '=', input.status ?? 'pending')
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status as ForwardedChange['status'],
    systemName: r.system_name,
    bookingId: r.booking_id,
    stayId: r.stay_id,
    createdAt: r.created_at.toISOString(),
  }));
}
