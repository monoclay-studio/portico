import { explainVersionMiss, type Selectable, sql, type TxContext, typed } from '@portico/db';
import { ConflictError, NotFoundError, newId, requirePermission, ValidationError } from '@portico/kernel';
import type { Outlet, OutletInput } from '../contracts';
import { type OpeningInterval, validateOpeningHours } from '../domain/opening-hours';
import { getLegalEntity } from '../service';
import type { OutletsTable, PlatformDB } from '../tables';

/** Outlets: revenue points at a property (restaurant, bar, spa, dive centre, boutique, transfer desk …). */
const db = (tx: TxContext) => typed<PlatformDB>(tx.db);

function toOutlet(r: Selectable<OutletsTable>): Outlet {
  return {
    id: r.id,
    propertyId: r.property_id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    legalEntityId: r.legal_entity_id,
    defaultChargeCodeKey: r.default_charge_code_key,
    openingHours: (r.opening_hours ?? []) as Outlet['openingHours'],
    acceptsRoomCharge: r.accepts_room_charge,
    status: r.status,
    version: r.version,
  };
}

function assertHours(hours: readonly OpeningInterval[]) {
  const problems = validateOpeningHours(hours);
  if (problems.length) throw new ValidationError('invalid_opening_hours', problems.join(' '), { problems });
}

async function propertyLegalEntity(tx: TxContext, propertyId: string): Promise<string> {
  const p = await db(tx)
    .selectFrom('platform.properties')
    .select('legal_entity_id')
    .where('id', '=', propertyId)
    .executeTakeFirst();
  if (!p) throw new NotFoundError('property', propertyId);
  return p.legal_entity_id;
}

export async function createOutlet(tx: TxContext, propertyId: string, input: OutletInput): Promise<Outlet> {
  requirePermission(tx, 'platform.outlet.manage', { propertyId });
  const hours = (input.openingHours ?? []) as OpeningInterval[];
  assertHours(hours);
  const legalEntityId = input.legalEntityId ?? (await propertyLegalEntity(tx, propertyId));
  await getLegalEntity(tx, legalEntityId);
  const id = newId();
  try {
    const row = await db(tx)
      .insertInto('platform.outlets')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: propertyId,
        code: input.code,
        name: input.name,
        kind: input.kind,
        legal_entity_id: legalEntityId,
        default_charge_code_key: input.defaultChargeCodeKey ?? null,
        opening_hours: JSON.stringify(hours),
        accepts_room_charge: input.acceptsRoomCharge ?? false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const outlet = toOutlet(row);
    await tx.audit({
      action: 'platform.outlet.create',
      target: { type: 'outlet', id },
      propertyId,
      after: outlet,
    });
    await tx.emit({
      type: 'platform.outlet.created',
      propertyId,
      aggregate: { type: 'outlet', id },
      payload: { outletId: id, code: input.code, kind: input.kind },
    });
    return outlet;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505')
      throw new ConflictError(
        'outlet_code_taken',
        `Outlet code ${input.code} is already used at this property.`,
      );
    if (code === '23503') throw new NotFoundError('property', propertyId);
    throw err;
  }
}

export async function getOutlet(tx: TxContext, id: string): Promise<Outlet> {
  const row = await db(tx).selectFrom('platform.outlets').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row || !tx.authz.can('platform.property.read', { propertyId: row.property_id }))
    throw new NotFoundError('outlet', id);
  return toOutlet(row);
}

export async function listOutlets(
  tx: TxContext,
  propertyId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<Outlet[]> {
  requirePermission(tx, 'platform.property.read', { propertyId });
  let q = db(tx)
    .selectFrom('platform.outlets')
    .selectAll()
    .where('property_id', '=', propertyId)
    .orderBy('name');
  if (!opts.includeArchived) q = q.where('status', '=', 'active');
  return (await q.execute()).map(toOutlet);
}

export async function updateOutlet(
  tx: TxContext,
  id: string,
  expectedVersion: number,
  patch: Partial<Omit<OutletInput, 'code'>> & { status?: 'active' | 'archived' },
): Promise<Outlet> {
  const before = await getOutlet(tx, id);
  requirePermission(tx, 'platform.outlet.manage', { propertyId: before.propertyId });
  if (patch.openingHours) assertHours(patch.openingHours as OpeningInterval[]);
  if (patch.legalEntityId) await getLegalEntity(tx, patch.legalEntityId);
  const row = await db(tx)
    .updateTable('platform.outlets')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.legalEntityId !== undefined ? { legal_entity_id: patch.legalEntityId } : {}),
      ...(patch.defaultChargeCodeKey !== undefined
        ? { default_charge_code_key: patch.defaultChargeCodeKey }
        : {}),
      ...(patch.openingHours !== undefined ? { opening_hours: JSON.stringify(patch.openingHours) } : {}),
      ...(patch.acceptsRoomCharge !== undefined ? { accepts_room_charge: patch.acceptsRoomCharge } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row)
    return explainVersionMiss('outlet', id, expectedVersion, async () => (await getOutlet(tx, id)).version);
  const after = toOutlet(row);
  await tx.audit({
    action: patch.status === 'archived' ? 'platform.outlet.archive' : 'platform.outlet.update',
    target: { type: 'outlet', id },
    propertyId: after.propertyId,
    before,
    after,
  });
  await tx.emit({
    type: 'platform.outlet.updated',
    propertyId: after.propertyId,
    aggregate: { type: 'outlet', id },
    payload: { outletId: id, status: after.status },
  });
  return after;
}
