/**
 * Product mapping (DST-R02): unit types ↔ channel room types (availability) and unit type × rate plan ↔ channel
 * rate plans (rates and restrictions), with the completeness counter that blocks go-live. A mapping change
 * re-publishes the product and re-processes bookings parked because they were unmapped.
 */
import { sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  newId,
  VersionConflictError,
} from '@portico/kernel';
import type { CompletenessView } from '../contracts';
import { P, RECORD } from '../manifest';
import { activeMappings, markDirty, windowFor } from './ari-dirty';
import {
  actorKey,
  type ConnectionRow,
  type DistributionDeps,
  db,
  loadConnection,
  requireOnConnection,
  scheduleTenant,
} from './common';

export function roomMappingView(r: {
  id: string;
  connection_id: string;
  unit_type_id: string;
  channel_room_type_id: string;
  status: string;
  version: number;
}) {
  return {
    id: r.id,
    kind: 'room' as const,
    connectionId: r.connection_id,
    unitTypeId: r.unit_type_id,
    ratePlanId: null,
    channelCode: r.channel_room_type_id,
    status: { mapping: r.status },
    version: r.version,
  };
}

export function rateMappingView(r: {
  id: string;
  connection_id: string;
  unit_type_id: string;
  rate_plan_id: string;
  channel_rate_plan_id: string;
  status: string;
  version: number;
}) {
  return {
    id: r.id,
    kind: 'rate' as const,
    connectionId: r.connection_id,
    unitTypeId: r.unit_type_id,
    ratePlanId: r.rate_plan_id,
    channelCode: r.channel_rate_plan_id,
    status: { mapping: r.status },
    version: r.version,
  };
}

/** Sellable products of the property for this connection's channel, and how many are mapped. */
export async function completeness(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
): Promise<CompletenessView> {
  const [types, plans, m] = await Promise.all([
    deps.ports.inventory.listUnitTypes(tx, conn.property_id),
    deps.ports.rates.listRatePlans(tx, conn.property_id),
    activeMappings(tx, conn.id),
  ]);
  const sellableTypes = types.filter((t) => t.sellable);
  const activePlans = plans.filter(
    (p) => p.status === 'active' && (p.channels === null || p.channels.includes(conn.channel_code)),
  );
  const rooms = new Set(m.rooms.map((r) => r.unit_type_id));
  const rates = new Set(m.rates.map((r) => `${r.unit_type_id}|${r.rate_plan_id}`));
  const unmapped: CompletenessView['unmapped'] = [];
  let total = 0;
  let mapped = 0;
  for (const t of sellableTypes) {
    for (const p of activePlans) {
      total++;
      if (!rooms.has(t.id))
        unmapped.push({
          unitTypeId: t.id,
          ratePlanId: p.id,
          label: `${t.name} · ${p.name}`,
          missing: 'room',
        });
      else if (!rates.has(`${t.id}|${p.id}`))
        unmapped.push({
          unitTypeId: t.id,
          ratePlanId: p.id,
          label: `${t.name} · ${p.name}`,
          missing: 'rate',
        });
      else mapped++;
    }
  }
  const typeIds = new Set(sellableTypes.map((t) => t.id));
  const planIds = new Set(activePlans.map((p) => p.id));
  const invalid: CompletenessView['invalid'] = [
    ...m.rooms
      .filter((r) => !typeIds.has(r.unit_type_id))
      .map((r) => ({
        mappingId: r.id,
        problem:
          'The unit type is no longer sellable; the channel keeps its last value for it. Retire the mapping or close it at the channel.',
      })),
    ...m.rates
      .filter((r) => !planIds.has(r.rate_plan_id) || !typeIds.has(r.unit_type_id))
      .map((r) => ({
        mappingId: r.id,
        problem:
          'The rate plan is not active for this channel (or the unit type is not sellable); nothing is published for it.',
      })),
  ];
  return {
    connectionId: conn.id,
    mapped,
    total,
    complete: total > 0 && mapped === total && invalid.length === 0,
    summary: `${mapped} of ${total} sellable product(s) mapped`,
    unmapped,
    invalid,
  };
}

export async function getCompleteness(tx: TxContext, deps: DistributionDeps, connectionId: string) {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.channelRead);
  return completeness(tx, deps, conn);
}

/** Bookings parked because a room or rate was unmapped are processed again (they may now map). */
export async function wakeParkedUnmapped(tx: TxContext, connectionId: string): Promise<number> {
  const res = await db(tx)
    .updateTable('distribution.revision_processing')
    .set({
      state: 'received',
      park_reason: null,
      next_attempt_at: tx.now,
      updated_at: tx.now,
      version: sql`version + 1`,
    })
    .where('connection_id', '=', connectionId)
    .where('state', '=', 'parked')
    .where('park_reason', '=', 'unmapped')
    .executeTakeFirst();
  const n = Number(res.numUpdatedRows ?? 0);
  if (n > 0) await scheduleTenant(tx, tx.now);
  return n;
}

async function republishUnitType(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  unitTypeId: string,
) {
  const window = await windowFor(tx, deps, conn);
  const m = await activeMappings(tx, conn.id);
  if (m.rooms.some((r) => r.unit_type_id === unitTypeId)) {
    await markDirty(tx, deps, conn, {
      kind: 'availability',
      products: [{ unitTypeId, ratePlanId: null }],
      ranges: [window],
    });
  }
  const rates = m.rates
    .filter((r) => r.unit_type_id === unitTypeId)
    .map((r) => ({ unitTypeId, ratePlanId: r.rate_plan_id }));
  await markDirty(tx, deps, conn, { kind: 'restrictions', products: rates, ranges: [window] });
}

const uniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';

export async function setRoomMapping(
  tx: TxContext,
  deps: DistributionDeps,
  connectionId: string,
  input: { unitTypeId: string; channelRoomTypeId: string },
) {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.mappingManage);
  if (conn.status === 'disconnected')
    throw new BusinessRuleError('connection_disconnected', 'A disconnected connection cannot be changed.');
  const types = await deps.ports.inventory.listUnitTypes(tx, conn.property_id);
  if (!types.some((t) => t.id === input.unitTypeId)) throw new NotFoundError('unit_type', input.unitTypeId);
  const taken = await db(tx)
    .selectFrom('distribution.room_mappings')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .where('status', '=', 'active')
    .where('channel_room_type_id', '=', input.channelRoomTypeId)
    .executeTakeFirst();
  if (taken && taken.unit_type_id !== input.unitTypeId) {
    throw new ConflictError(
      'channel_room_already_mapped',
      `Channel room type ${input.channelRoomTypeId} is already mapped to another unit type. A channel room type sells one unit type; retire the other mapping first.`,
      { mappingId: taken.id },
    );
  }
  if (taken) return roomMappingView(taken);
  const previous = await db(tx)
    .updateTable('distribution.room_mappings')
    .set({ status: 'retired', retired_at: tx.now, version: sql`version + 1` })
    .where('connection_id', '=', conn.id)
    .where('unit_type_id', '=', input.unitTypeId)
    .where('status', '=', 'active')
    .returningAll()
    .executeTakeFirst();
  const id = newId(tx.now.getTime());
  let row: Awaited<ReturnType<typeof insertRoom>>;
  async function insertRoom() {
    return db(tx)
      .insertInto('distribution.room_mappings')
      .values({
        id,
        tenant_id: tx.tenantId,
        connection_id: conn.id,
        unit_type_id: input.unitTypeId,
        channel_room_type_id: input.channelRoomTypeId,
        status: 'active',
        created_by: actorKey(tx),
        created_at: tx.now,
        retired_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  try {
    row = await insertRoom();
  } catch (err) {
    if (uniqueViolation(err)) {
      throw new ConflictError(
        'mapping_changed',
        'Someone changed this mapping at the same time. Reload and try again.',
      );
    }
    throw err;
  }
  await tx.audit({
    action: 'distribution.mapping.room.set',
    target: { type: RECORD.roomMapping, id },
    propertyId: conn.property_id,
    before: previous ? roomMappingView(previous) : null,
    after: roomMappingView(row),
  });
  await republishUnitType(tx, deps, conn, input.unitTypeId);
  await wakeParkedUnmapped(tx, conn.id);
  return roomMappingView(row);
}

export async function setRateMapping(
  tx: TxContext,
  deps: DistributionDeps,
  connectionId: string,
  input: { unitTypeId: string; ratePlanId: string; channelRatePlanId: string },
) {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.mappingManage);
  if (conn.status === 'disconnected')
    throw new BusinessRuleError('connection_disconnected', 'A disconnected connection cannot be changed.');
  const room = await db(tx)
    .selectFrom('distribution.room_mappings')
    .select(['id'])
    .where('connection_id', '=', conn.id)
    .where('unit_type_id', '=', input.unitTypeId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (!room) {
    throw new BusinessRuleError(
      'room_mapping_required',
      'Map the unit type to a channel room type first: a channel rate plan belongs to one room type.',
    );
  }
  const plans = await deps.ports.rates.listRatePlans(tx, conn.property_id);
  const plan = plans.find((p) => p.id === input.ratePlanId);
  if (!plan) throw new NotFoundError('rate_plan', input.ratePlanId);
  const taken = await db(tx)
    .selectFrom('distribution.rate_mappings')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .where('status', '=', 'active')
    .where('channel_rate_plan_id', '=', input.channelRatePlanId)
    .executeTakeFirst();
  if (taken && (taken.unit_type_id !== input.unitTypeId || taken.rate_plan_id !== input.ratePlanId)) {
    throw new ConflictError(
      'channel_rate_already_mapped',
      `Channel rate plan ${input.channelRatePlanId} is already mapped to another product. Retire that mapping first.`,
      { mappingId: taken.id },
    );
  }
  if (taken) return rateMappingView(taken);
  const previous = await db(tx)
    .updateTable('distribution.rate_mappings')
    .set({ status: 'retired', retired_at: tx.now, version: sql`version + 1` })
    .where('connection_id', '=', conn.id)
    .where('unit_type_id', '=', input.unitTypeId)
    .where('rate_plan_id', '=', input.ratePlanId)
    .where('status', '=', 'active')
    .returningAll()
    .executeTakeFirst();
  const id = newId(tx.now.getTime());
  let row: Awaited<ReturnType<typeof insertRate>>;
  async function insertRate() {
    return db(tx)
      .insertInto('distribution.rate_mappings')
      .values({
        id,
        tenant_id: tx.tenantId,
        connection_id: conn.id,
        unit_type_id: input.unitTypeId,
        rate_plan_id: input.ratePlanId,
        channel_rate_plan_id: input.channelRatePlanId,
        status: 'active',
        created_by: actorKey(tx),
        created_at: tx.now,
        retired_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  try {
    row = await insertRate();
  } catch (err) {
    if (uniqueViolation(err)) {
      throw new ConflictError(
        'mapping_changed',
        'Someone changed this mapping at the same time. Reload and try again.',
      );
    }
    throw err;
  }
  await tx.audit({
    action: 'distribution.mapping.rate.set',
    target: { type: RECORD.rateMapping, id },
    propertyId: conn.property_id,
    before: previous ? rateMappingView(previous) : null,
    after: rateMappingView(row),
  });
  const window = await windowFor(tx, deps, conn);
  await markDirty(tx, deps, conn, {
    kind: 'restrictions',
    products: [{ unitTypeId: input.unitTypeId, ratePlanId: input.ratePlanId }],
    ranges: [window],
  });
  await wakeParkedUnmapped(tx, conn.id);
  return rateMappingView(row);
}

export async function retireMapping(
  tx: TxContext,
  kind: 'room' | 'rate',
  id: string,
  expectedVersion: number,
) {
  const table = kind === 'room' ? 'distribution.room_mappings' : 'distribution.rate_mappings';
  const row = await db(tx).selectFrom(table).selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!row) throw new NotFoundError(`${kind}_mapping`, id);
  const conn = await loadConnection(tx, row.connection_id);
  requireOnConnection(tx, conn, P.mappingManage);
  if (row.version !== expectedVersion)
    throw new VersionConflictError(`${kind}_mapping`, id, expectedVersion, row.version);
  if (row.status !== 'active')
    throw new BusinessRuleError('mapping_not_active', 'This mapping is already retired.');
  await db(tx)
    .updateTable(table)
    .set({ status: 'retired', retired_at: tx.now, version: sql`version + 1` })
    .where('id', '=', id)
    .execute();
  if (kind === 'room') {
    // A channel rate plan belongs to its room type: without the room, its rates cannot be published either.
    await db(tx)
      .updateTable('distribution.rate_mappings')
      .set({ status: 'retired', retired_at: tx.now, version: sql`version + 1` })
      .where('connection_id', '=', row.connection_id)
      .where('unit_type_id', '=', row.unit_type_id)
      .where('status', '=', 'active')
      .execute();
  }
  await tx.audit({
    action: `distribution.mapping.${kind}.retired`,
    target: { type: kind === 'room' ? RECORD.roomMapping : RECORD.rateMapping, id },
    propertyId: conn.property_id,
    before: { status: 'active' },
    after: { status: 'retired' },
  });
  return { id, status: 'retired' as const };
}

export async function listMappings(tx: TxContext, connectionId: string) {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.channelRead);
  const m = await activeMappings(tx, conn.id);
  return { rooms: m.rooms.map(roomMappingView), rates: m.rates.map(rateMappingView) };
}
