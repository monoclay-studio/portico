import { explainVersionMiss, type Selectable, type TxContext } from '@portico/db';
import {
  localDateIn,
  NotFoundError,
  newId,
  newReferenceCode,
  requirePermission,
  ValidationError,
  VersionConflictError,
} from '@portico/kernel';
import type { LostFoundInput, LostFoundView } from '../contracts';
import { assertDisposalAllowed, assertLostFoundTransition, retentionUntil } from '../domain/lost-found';
import type { DisposalMethod, LostFoundStatus } from '../domain/model';
import type { LostFoundItemsTable } from '../tables';
import { type Deps, db, iso, loadSettings, propertyFacts } from './internal';

const PERM = 'operations.lostFound.manage';

type Row = Selectable<LostFoundItemsTable>;

function toView(r: Row): LostFoundView {
  return {
    id: r.id,
    propertyId: r.property_id,
    number: r.number,
    description: r.description,
    category: r.category,
    highValue: r.high_value,
    foundAt: new Date(r.found_at).toISOString(),
    foundLocation: r.found_location,
    foundUnitId: r.found_unit_id,
    finder: r.finder,
    storageLocation: r.storage_location,
    photos: (r.photos ?? []) as LostFoundView['photos'],
    status: r.status as LostFoundStatus,
    matchedGuestProfileId: r.matched_guest_profile_id,
    matchedStayId: r.matched_stay_id,
    releasedTo: r.released_to,
    releaseSignatureRef: r.release_signature_ref,
    releasedAt: iso(r.released_at),
    disposalMethod: r.disposal_method,
    disposedAt: iso(r.disposed_at),
    retentionUntil: r.retention_until,
    version: r.version,
  };
}

async function load(tx: TxContext, id: string): Promise<Row> {
  const r = await db(tx)
    .selectFrom('operations.lost_found_items')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!r) throw new NotFoundError('lost_found_item', id);
  return r;
}

export async function recordLostFound(
  d: Deps,
  tx: TxContext,
  input: LostFoundInput,
  meta: { source?: 'staff' | 'mobile_sync' } = {},
): Promise<LostFoundView> {
  requireAnyLostFound(tx, input.propertyId);
  const settings = await loadSettings(d, tx, input.propertyId);
  const facts = await propertyFacts(d, tx, input.propertyId);
  const foundAt = new Date(input.foundAt);
  if (foundAt.getTime() > tx.now.getTime() + settings.sync.maxClockSkewMinutes * 60_000) {
    throw new ValidationError(
      'found_in_future',
      'The time found is in the future. Check the device clock and try again.',
    );
  }
  const id = newId(tx.now.getTime());
  const row = await db(tx)
    .insertInto('operations.lost_found_items')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      number: newReferenceCode('LF'),
      description: input.description,
      category: input.category,
      high_value: input.highValue ?? false,
      found_at: foundAt,
      found_location: input.foundLocation,
      found_unit_id: input.foundUnitId ?? null,
      finder: input.finder,
      finder_user_id: input.finderUserId ?? null,
      storage_location: input.storageLocation,
      photos: JSON.stringify(input.photos ?? []),
      status: 'stored',
      matched_guest_profile_id: null,
      matched_stay_id: null,
      matched_note: null,
      released_to: null,
      release_signature_ref: null,
      released_at: null,
      disposal_method: null,
      disposal_signature_ref: null,
      disposal_reason: null,
      disposed_at: null,
      retention_until: retentionUntil(
        localDateIn(foundAt, facts.timezone),
        input.highValue ?? false,
        settings.lostFound,
      ),
      created_at: tx.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'operations.lostFound.record',
    target: { type: 'lost_found_item', id },
    propertyId: input.propertyId,
    after: {
      number: row.number,
      category: input.category,
      highValue: row.high_value,
      source: meta.source ?? 'staff',
    },
  });
  return toView(row);
}

function requireAnyLostFound(tx: TxContext, propertyId: string) {
  // Anyone who works in units (attendants) may log a found item; matching and release need lostFound.manage.
  if (tx.authz.can('operations.housekeeping.update', { propertyId })) return;
  requirePermission(tx, PERM, { propertyId });
}

export async function getLostFound(_d: Deps, tx: TxContext, id: string): Promise<LostFoundView> {
  const r = await db(tx)
    .selectFrom('operations.lost_found_items')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!r) throw new NotFoundError('lost_found_item', id);
  requirePermission(tx, PERM, { propertyId: r.property_id });
  return toView(r);
}

export async function listLostFound(
  _d: Deps,
  tx: TxContext,
  q: { propertyId: string; status?: LostFoundStatus; stayId?: string },
): Promise<LostFoundView[]> {
  requirePermission(tx, PERM, { propertyId: q.propertyId });
  let query = db(tx)
    .selectFrom('operations.lost_found_items')
    .selectAll()
    .where('property_id', '=', q.propertyId)
    .orderBy('found_at', 'desc')
    .limit(500);
  if (q.status) query = query.where('status', '=', q.status);
  if (q.stayId) query = query.where('matched_stay_id', '=', q.stayId);
  return (await query.execute()).map(toView);
}

async function transition(
  tx: TxContext,
  row: Row,
  expectedVersion: number,
  to: LostFoundStatus,
  set: Partial<Row>,
  audit: { reason?: string | null; after: Record<string, unknown> },
): Promise<LostFoundView> {
  requirePermission(tx, PERM, { propertyId: row.property_id });
  if (row.version !== expectedVersion)
    throw new VersionConflictError('lost_found_item', row.id, expectedVersion, row.version);
  assertLostFoundTransition(row.status as LostFoundStatus, to);
  const updated = await db(tx)
    .updateTable('operations.lost_found_items')
    .set({ ...set, status: to, version: row.version + 1 })
    .where('id', '=', row.id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!updated)
    return explainVersionMiss(
      'lost_found_item',
      row.id,
      expectedVersion,
      async () => (await load(tx, row.id)).version,
    );
  await tx.audit({
    action: `operations.lostFound.${to}`,
    target: { type: 'lost_found_item', id: row.id },
    propertyId: row.property_id,
    reason: audit.reason ?? null,
    before: { status: row.status },
    after: { status: to, ...audit.after },
  });
  return toView(updated);
}

export async function matchLostFound(
  _d: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  input: { guestProfileId?: string; stayId?: string; note?: string },
): Promise<LostFoundView> {
  if (!input.guestProfileId && !input.stayId)
    throw new ValidationError('owner_required', 'Link the item to a guest profile or a stay.');
  const row = await load(tx, id);
  return transition(
    tx,
    row,
    expectedVersion,
    'matched',
    {
      matched_guest_profile_id: input.guestProfileId ?? null,
      matched_stay_id: input.stayId ?? null,
      matched_note: input.note ?? null,
    },
    {
      reason: input.note ?? null,
      after: { guestProfileId: input.guestProfileId ?? null, stayId: input.stayId ?? null },
    },
  );
}

/** Hand the item over. A signature (object-store ref) is mandatory evidence of release. */
export async function releaseLostFound(
  _d: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  input: { releasedTo: string; signatureRef: string; note?: string },
): Promise<LostFoundView> {
  const row = await load(tx, id);
  return transition(
    tx,
    row,
    expectedVersion,
    'released',
    { released_to: input.releasedTo, release_signature_ref: input.signatureRef, released_at: tx.now },
    { reason: input.note ?? null, after: { releasedTo: input.releasedTo, signatureRef: input.signatureRef } },
  );
}

export async function disposeLostFound(
  d: Deps,
  tx: TxContext,
  id: string,
  expectedVersion: number,
  input: { method: DisposalMethod; signatureRef: string; reason?: string },
): Promise<LostFoundView> {
  const row = await load(tx, id);
  const facts = await propertyFacts(d, tx, row.property_id);
  assertDisposalAllowed(facts.businessDate, row.retention_until, input.reason);
  return transition(
    tx,
    row,
    expectedVersion,
    'disposed',
    {
      disposal_method: input.method,
      disposal_signature_ref: input.signatureRef,
      disposal_reason: input.reason ?? null,
      disposed_at: tx.now,
    },
    { reason: input.reason ?? null, after: { method: input.method, signatureRef: input.signatureRef } },
  );
}
