import { sql, type TxContext } from '@portico/db';
import { BusinessRuleError, type EntityRef, NotFoundError, newId, requirePermission } from '@portico/kernel';
import type { Handover } from '../contracts';
import { RESERVATIONS_EVENTS as E } from '../events';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import { actorKey, actorName, db, issueForReader, json } from './context';

/**
 * Shift handover (RES-R37, RES-I10, brief §6 "important information must survive a change of shift"). Items have
 * owners and persist until RESOLVED — a shift change never removes them. Publishing snapshots what was handed over
 * (manual items + open reservations issues + open relocation cases); the incoming shift acknowledges.
 */
export async function addHandoverItem(
  tx: TxContext,
  input: {
    propertyId: string;
    department: string;
    kind: 'task' | 'financial_exception' | 'guest_commitment' | 'note';
    title: string;
    detail?: string | undefined;
    ref?: EntityRef | undefined;
    ownerId: string;
    ownerName?: string | undefined;
    dueAt?: string | undefined;
  },
) {
  requirePermission(tx, P.handoverManage, { propertyId: input.propertyId });
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('reservations.handover_items')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      department: input.department,
      kind: input.kind,
      title: input.title,
      detail: input.detail ?? null,
      ref: input.ref ? json(input.ref) : null,
      owner_id: input.ownerId,
      owner_name: input.ownerName ?? null,
      due_at: input.dueAt ? new Date(input.dueAt) : null,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
  await tx.audit({
    action: 'reservations.handoverItem.create',
    target: { type: 'handover_item', id },
    propertyId: input.propertyId,
    after: { kind: input.kind, title: input.title, ownerId: input.ownerId },
  });
  return getItem(tx, id);
}

async function getItem(tx: TxContext, id: string) {
  const r = await db(tx)
    .selectFrom('reservations.handover_items')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!r) throw new NotFoundError('handover_item', id);
  return {
    id: r.id,
    propertyId: r.property_id,
    department: r.department,
    kind: r.kind as 'task' | 'financial_exception' | 'guest_commitment' | 'note',
    title: r.title,
    ...(r.detail ? { detail: r.detail } : {}),
    ...(r.ref ? { ref: r.ref as EntityRef } : {}),
    ownerId: r.owner_id,
    ...(r.owner_name ? { ownerName: r.owner_name } : {}),
    ...(r.due_at ? { dueAt: r.due_at.toISOString() } : {}),
    status: r.status as 'open' | 'resolved',
    source: 'manual' as const,
    createdAt: r.created_at.toISOString(),
    resolvedAt: r.resolved_at?.toISOString() ?? null,
    resolution: r.resolution,
  };
}

/** Items are removed from handovers only by resolving the underlying item (RES-I10). */
export async function resolveHandoverItem(tx: TxContext, input: { itemId: string; resolution: string }) {
  const r = await db(tx)
    .selectFrom('reservations.handover_items')
    .selectAll()
    .where('id', '=', input.itemId)
    .forUpdate()
    .executeTakeFirst();
  if (!r) throw new NotFoundError('handover_item', input.itemId);
  requirePermission(tx, P.handoverManage, { propertyId: r.property_id });
  if (r.status === 'resolved') return getItem(tx, r.id);
  await db(tx)
    .updateTable('reservations.handover_items')
    .set({
      status: 'resolved',
      resolved_at: tx.now,
      resolved_by: actorKey(tx),
      resolution: input.resolution,
      version: sql`version + 1`,
    })
    .where('id', '=', r.id)
    .execute();
  await tx.audit({
    action: 'reservations.handoverItem.resolve',
    target: { type: 'handover_item', id: r.id },
    propertyId: r.property_id,
    reason: input.resolution,
  });
  return getItem(tx, r.id);
}

/** Open items for a department: manual items + reservations issues + relocation cases (each with an owner). */
export async function openHandoverItems(tx: TxContext, input: { propertyId: string; department: string }) {
  requirePermission(tx, P.handoverManage, { propertyId: input.propertyId });
  const manual = await db(tx)
    .selectFrom('reservations.handover_items')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('department', '=', input.department)
    .where('status', '=', 'open')
    .orderBy('created_at')
    .execute();
  const issues = await db(tx)
    .selectFrom('reservations.issues')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('status', '=', 'open')
    .orderBy('created_at')
    .execute();
  const relocations = await db(tx)
    .selectFrom('reservations.relocation_cases')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('status', 'in', ['open', 'option_selected'])
    .execute();
  return [
    ...manual.map((m) => ({
      itemId: m.id,
      kind: m.kind,
      title: m.title,
      ownerId: m.owner_id,
      ownerName: m.owner_name,
      source: 'manual',
    })),
    ...issues.map((i) => ({
      itemId: `issue:${i.id}`,
      kind: ['payment_follow_up', 'departed_with_balance'].includes(i.kind) ? 'financial_exception' : 'task',
      title: issueForReader(tx, i.property_id, i).message,
      ownerId: i.owner_id,
      ownerName: null,
      source: 'reservations_issue',
    })),
    ...relocations.map((r) => ({
      itemId: `relocation:${r.id}`,
      kind: 'guest_commitment',
      title: `Relocation case for stay ${r.stay_id} (${r.cause.replace('_', ' ')})`,
      ownerId: r.owner_id,
      ownerName: null,
      source: 'relocation',
    })),
  ];
}

function toHandover(
  r: {
    id: string;
    property_id: string;
    department: string;
    shift_label: string;
    status: string;
    notes: string | null;
    items: unknown;
    published_by_name: string;
    published_at: Date;
    acknowledged_by_name: string | null;
    acknowledged_at: Date | null;
    version: number;
  },
  stillOpen: Set<string>,
): Handover {
  const items = r.items as Array<Omit<Handover['items'][number], 'stillOpen'>>;
  return {
    id: r.id,
    propertyId: r.property_id,
    department: r.department,
    shiftLabel: r.shift_label,
    status: r.status as Handover['status'],
    notes: r.notes,
    items: items.map((i) => ({ ...i, stillOpen: stillOpen.has(i.itemId) })),
    publishedBy: r.published_by_name,
    publishedAt: r.published_at.toISOString(),
    acknowledgedBy: r.acknowledged_by_name,
    acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
    version: r.version,
  };
}

export async function publishHandover(
  tx: TxContext,
  input: { propertyId: string; department: string; shiftLabel: string; notes?: string | undefined },
): Promise<Handover> {
  const items = await openHandoverItems(tx, input);
  const unowned = items.filter((i) => !i.ownerId);
  if (unowned.length) {
    throw new BusinessRuleError(
      'handover_items_without_owner',
      `${unowned.length} open item(s) have no owner. Every handed-over item needs an owner: assign one, then publish.`,
      { items: unowned.map((i) => ({ itemId: i.itemId, title: i.title })) },
    );
  }
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('reservations.handovers')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      department: input.department,
      shift_label: input.shiftLabel,
      status: 'published',
      notes: input.notes ?? null,
      items: json(items),
      published_by: actorKey(tx),
      published_by_name: actorName(tx),
      published_at: tx.now,
    })
    .execute();
  await tx.audit({
    action: 'reservations.handover.publish',
    target: { type: 'handover', id },
    propertyId: input.propertyId,
    after: { department: input.department, shiftLabel: input.shiftLabel, items: items.length },
  });
  await tx.emit({
    type: E.handoverPublished,
    propertyId: input.propertyId,
    aggregate: { type: 'handover', id },
    payload: { handoverId: id, department: input.department, items: items.length },
  });
  return getHandover(tx, id);
}

export async function getHandover(tx: TxContext, id: string): Promise<Handover> {
  const r = await db(tx)
    .selectFrom('reservations.handovers')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!r) throw new NotFoundError('handover', id);
  requirePermission(tx, P.handoverManage, { propertyId: r.property_id });
  const open = await openHandoverItems(tx, { propertyId: r.property_id, department: r.department });
  return toHandover(r, new Set(open.map((o) => o.itemId)));
}

/** The incoming shift acknowledges (If-Match on the handover version). */
export async function acknowledgeHandover(
  tx: TxContext,
  input: { handoverId: string; expectedVersion: number },
): Promise<Handover> {
  const r = await db(tx)
    .selectFrom('reservations.handovers')
    .selectAll()
    .where('id', '=', input.handoverId)
    .forUpdate()
    .executeTakeFirst();
  if (!r) throw new NotFoundError('handover', input.handoverId);
  requirePermission(tx, P.handoverManage, { propertyId: r.property_id });
  if (r.status === 'acknowledged') {
    throw new BusinessRuleError(
      'handover_already_acknowledged',
      `This handover was already acknowledged by ${r.acknowledged_by_name}.`,
    );
  }
  if (r.version !== input.expectedVersion) {
    throw new BusinessRuleError(
      'version_conflict',
      'This handover changed since you opened it. Reload and acknowledge again.',
    );
  }
  if (r.published_by === actorKey(tx)) {
    throw new BusinessRuleError(
      'self_acknowledgement',
      'The incoming shift acknowledges a handover, not the person who wrote it.',
    );
  }
  await db(tx)
    .updateTable('reservations.handovers')
    .set({
      status: 'acknowledged',
      acknowledged_by: actorKey(tx),
      acknowledged_by_name: actorName(tx),
      acknowledged_at: tx.now,
      version: sql`version + 1`,
    })
    .where('id', '=', r.id)
    .execute();
  await tx.audit({
    action: 'reservations.handover.acknowledge',
    target: { type: 'handover', id: r.id },
    propertyId: r.property_id,
  });
  await tx.emit({
    type: E.handoverAcknowledged,
    propertyId: r.property_id,
    aggregate: { type: 'handover', id: r.id },
    payload: { handoverId: r.id, department: r.department },
  });
  return getHandover(tx, r.id);
}

export async function listHandovers(
  tx: TxContext,
  input: { propertyId: string; department?: string | undefined; limit?: number },
) {
  requirePermission(tx, P.handoverManage, { propertyId: input.propertyId });
  let q = db(tx)
    .selectFrom('reservations.handovers')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .orderBy('published_at', 'desc')
    .limit(input.limit ?? 20);
  if (input.department) q = q.where('department', '=', input.department);
  const rowsOut = await q.execute();
  const result: Handover[] = [];
  for (const r of rowsOut) {
    const open = await openHandoverItems(tx, { propertyId: r.property_id, department: r.department });
    result.push(toHandover(r, new Set(open.map((o) => o.itemId))));
  }
  return result;
}
