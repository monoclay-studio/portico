import { explainVersionMiss, sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  type LocalDate,
  type Money,
  money,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { Folio, FolioDetail, OpenFolioInput, OwnerRef, Posting } from '../contracts';
import { assertCanClose, assertCanSettle, assertCanVoid, destinationAction } from '../domain/folio';
import type { FolioOwnerType, PayerType } from '../domain/types';
import { folioInvoicing, folioRecord, type InvoicingState, invoicingState } from './records';
import {
  type Deps,
  db,
  displayName,
  type FolioRow,
  folioBalance,
  hasActiveInvoice,
  loadFolio,
  ownerDeparture,
} from './support';

export function toFolio(r: FolioRow, balanceMinor: number, invoicing: InvoicingState): Folio {
  return {
    id: r.id,
    propertyId: r.property_id,
    legalEntityId: r.legal_entity_id,
    attachedTo: { type: r.owner_type as FolioOwnerType, id: r.owner_id },
    payer: {
      type: r.payer_type as PayerType,
      ...(r.payer_id ? { id: r.payer_id } : {}),
      name: r.payer_name,
    },
    label: r.label,
    displayName: displayName(r),
    currency: r.currency,
    isDefault: r.is_default,
    status: {
      folio: r.status,
      balance: balanceMinor > 0 ? 'due' : balanceMinor < 0 ? 'credit' : 'zero',
      invoicing,
    },
    reopenCount: r.reopen_count,
    reopenedReason: r.reopened_reason,
    supplementaryOf: r.supplementary_of,
    postDeparture: r.post_departure,
    balance: { amountMinor: balanceMinor, currency: r.currency },
    version: r.version,
  };
}

async function folioView(tx: TxContext, r: FolioRow, balanceMinor: number): Promise<Folio> {
  const inv = await folioInvoicing(tx, r.id);
  return toFolio(r, balanceMinor, invoicingState(inv.invoiced, inv.uninvoicedCharges));
}

/** Provider form of `openFolio`: another module may reference the payer by id only (the name is then resolved). */
export type OpenFolioCommand = Omit<OpenFolioInput, 'payer'> & {
  payer: { type: OpenFolioInput['payer']['type']; id?: string; name?: string };
};

const PLACEHOLDER_PAYER: Record<OpenFolioInput['payer']['type'], string> = {
  guest: 'Guest',
  company: 'Company account',
  agency: 'Travel agency',
  house: 'House account',
};

/** Open a folio for a payer. The first folio of an owner becomes its default folio. */
export async function openFolio(
  tx: TxContext,
  deps: Deps,
  command: OpenFolioCommand,
): Promise<{ folioId: string }> {
  requirePermission(tx, 'finance.folio.manage', { propertyId: command.propertyId });
  await deps.ports.platform.assertWritable(tx, command.propertyId, 'charges');
  const property = await deps.ports.platform.getProperty(tx, command.propertyId);
  // A payer referenced by id only is named from the directory (guests); otherwise a placeholder is kept and
  // flagged, and a live tax invoice asks for the buyer's name before it is issued.
  let payerName = command.payer.name?.trim() || null;
  if (!payerName && command.payer.id && command.payer.type !== 'house') {
    const found = await deps.ports.payers.describePayer(tx, {
      type: command.payer.type,
      id: command.payer.id,
      propertyId: command.propertyId,
    });
    payerName = found?.name.trim() || null;
  }
  const unresolved = !payerName && command.payer.type !== 'house';
  const input: OpenFolioInput = {
    ...command,
    payer: { ...command.payer, name: payerName ?? PLACEHOLDER_PAYER[command.payer.type] },
  };
  // Serialize folio creation per owner so "first folio is default" holds under concurrency.
  await sql`select pg_advisory_xact_lock(hashtext(${`finance.folio-owner:${input.owner.type}:${input.owner.id}`}))`.execute(
    tx.db,
  );
  const existingDefault = await db(tx)
    .selectFrom('finance.folios')
    .select(['id', 'property_id', 'legal_entity_id'])
    .where('owner_type', '=', input.owner.type)
    .where('owner_id', '=', input.owner.id)
    .where('is_default', '=', true)
    .executeTakeFirst();
  if (existingDefault && existingDefault.legal_entity_id !== property.legalEntityId) {
    throw new BusinessRuleError(
      'intercompany_folio',
      'This record already has folios with another legal entity. Folios of one record must belong to the same legal entity.',
    );
  }
  const isDefault = !existingDefault || input.isDefault === true;
  if (existingDefault && input.isDefault) {
    await db(tx)
      .updateTable('finance.folios')
      .set({ is_default: false, version: sql`version + 1` })
      .where('id', '=', existingDefault.id)
      .execute();
  }
  const id = newId(tx.now.getTime());
  const currency = input.currency ?? property.baseCurrency;
  await db(tx)
    .insertInto('finance.folios')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      legal_entity_id: property.legalEntityId,
      owner_type: input.owner.type,
      owner_id: input.owner.id,
      payer_type: input.payer.type,
      payer_id: input.payer.id ?? null,
      payer_name: input.payer.name,
      payer_name_unresolved: unresolved,
      label: input.label ?? null,
      currency,
      is_default: isDefault,
      reopened_reason: null,
      supplementary_of: null,
      opened_at: tx.now,
      settled_at: null,
    })
    .execute();
  await tx.audit({
    action: 'finance.folio.open',
    target: { type: 'folio', id },
    propertyId: input.propertyId,
    after: { ...input, currency, isDefault, payerNameUnresolved: unresolved },
  });
  await tx.emit({
    type: 'finance.folio.opened',
    propertyId: input.propertyId,
    aggregate: { type: 'folio', id },
    payload: { folioId: id, owner: input.owner, payer: input.payer, currency, isDefault },
  });
  return { folioId: id };
}

export async function getFolioBalance(tx: TxContext, folioId: string): Promise<Money> {
  const f = await loadFolio(tx, folioId);
  requirePermission(tx, 'finance.folio.read', { propertyId: f.property_id });
  return money(await folioBalance(tx, folioId), f.currency);
}

export async function getFolio(tx: TxContext, folioId: string): Promise<FolioDetail> {
  const f = await loadFolio(tx, folioId);
  requirePermission(tx, 'finance.folio.read', { propertyId: f.property_id });
  const rows = await db(tx)
    .selectFrom('finance.postings as p')
    .leftJoin('finance.posting_document_locks as l', 'l.posting_id', 'p.id')
    .selectAll('p')
    .select('l.document_id')
    .where('p.folio_id', '=', folioId)
    .orderBy('p.created_at')
    .orderBy('p.id')
    .execute();
  // Route D verification is a separate fact (the posting stays immutable): a matched statement line shows as verified.
  const verifiedIds = new Set(
    (
      await db(tx)
        .selectFrom('finance.payment_verifications')
        .select(['payment_ref_type', 'payment_ref_id'])
        .where(
          'payment_ref_id',
          'in',
          rows.flatMap((r) => (r.payment_verification === 'recorded_unverified' && r.payment_ref_id ? [r.payment_ref_id] : [])).concat(['-']),
        )
        .execute()
    ).map((v) => `${v.payment_ref_type}:${v.payment_ref_id}`),
  );
  const postings: Posting[] = rows.map((p) => ({
    id: p.id,
    folioId: p.folio_id,
    entryId: p.entry_id,
    kind: p.kind as Posting['kind'],
    amount: { amountMinor: Number(p.amount_minor), currency: p.currency },
    originalAmount:
      p.original_amount_minor !== null && p.original_currency
        ? { amountMinor: Number(p.original_amount_minor), currency: p.original_currency }
        : null,
    chargeCode: p.charge_code,
    taxName: p.tax_name,
    description: p.description,
    quantity: p.quantity === null ? null : String(p.quantity),
    serviceDate: p.service_date,
    revenueDate: p.revenue_date,
    businessDate: p.business_date,
    parentPostingId: p.parent_posting_id,
    correctsPostingId: p.corrects_posting_id,
    billingRuleId: p.billing_rule_id,
    allowanceInstanceId: p.allowance_instance_id,
    paymentRef:
      p.payment_ref_type && p.payment_ref_id ? { type: p.payment_ref_type, id: p.payment_ref_id } : null,
    paymentMethod: p.payment_method,
    paymentVerification:
      p.payment_verification === 'recorded_unverified' && verifiedIds.has(`${p.payment_ref_type}:${p.payment_ref_id}`)
        ? 'recorded_verified'
        : ((p.payment_verification as Posting['paymentVerification']) ?? null),
    postDeparture: p.post_departure,
    invoicedOn: p.document_id ?? null,
    createdAt: new Date(p.created_at).toISOString(),
  }));
  const balance = postings.reduce((s, p) => s + p.amount.amountMinor, 0);
  const view = await folioView(tx, f, balance);
  const record = await folioRecord(tx, {
    id: f.id,
    propertyId: f.property_id,
    status: f.status,
    balanceMinor: balance,
    currency: f.currency,
    owner: view.attachedTo,
    payer: view.payer,
    payerNameUnresolved: f.payer_name_unresolved,
    supplementaryOf: f.supplementary_of,
    postDeparture: f.post_departure,
    reopenedReason: f.reopened_reason,
    postingCount: postings.length,
    invoicing: view.status.invoicing,
  });
  return { ...view, postings, ...record };
}

/** Folios of an owner (stay, booking, group, company, house) with balances. */
export async function listFolios(tx: TxContext, input: { owner: OwnerRef }): Promise<Folio[]> {
  const rows = await db(tx)
    .selectFrom('finance.folios as f')
    .selectAll('f')
    .select((eb) =>
      eb
        .selectFrom('finance.postings as p')
        .select(sql<number>`coalesce(sum(p.amount_minor), 0)::bigint`.as('b'))
        .whereRef('p.folio_id', '=', 'f.id')
        .as('balance'),
    )
    .where('f.owner_type', '=', input.owner.type)
    .where('f.owner_id', '=', input.owner.id)
    .orderBy('f.is_default', 'desc')
    .orderBy('f.opened_at')
    .execute();
  const first = rows[0];
  if (first) requirePermission(tx, 'finance.folio.read', { propertyId: first.property_id });
  const out: Folio[] = [];
  for (const r of rows) out.push(await folioView(tx, r, Number(r.balance ?? 0)));
  return out;
}

async function changeStatus(
  tx: TxContext,
  f: FolioRow,
  expectedVersion: number,
  set: Record<string, unknown>,
  action: string,
  reason?: string,
): Promise<FolioRow> {
  const row = await db(tx)
    .updateTable('finance.folios')
    .set({ ...set, version: sql`version + 1` })
    .where('id', '=', f.id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row)
    return explainVersionMiss(
      'folio',
      f.id,
      expectedVersion,
      async () => (await loadFolio(tx, f.id)).version,
    );
  await tx.audit({
    action,
    target: { type: 'folio', id: f.id },
    propertyId: f.property_id,
    ...(reason ? { reason } : {}),
    before: { status: f.status },
    after: { status: row.status },
  });
  return row;
}

/** Settle a folio (zero balance). Emits finance.folio.settled. */
export async function settleFolio(tx: TxContext, folioId: string, expectedVersion: number): Promise<Folio> {
  const f = await loadFolio(tx, folioId, { forUpdate: true });
  requirePermission(tx, 'finance.folio.manage', { propertyId: f.property_id });
  const balance = await folioBalance(tx, folioId);
  assertCanSettle(f.status, balance, f.currency);
  const row = await changeStatus(
    tx,
    f,
    expectedVersion,
    { status: 'settled', settled_at: tx.now },
    'finance.folio.settle',
  );
  await tx.emit({
    type: 'finance.folio.settled',
    propertyId: f.property_id,
    aggregate: { type: 'folio', id: folioId },
    payload: { folioId, owner: { type: f.owner_type, id: f.owner_id } },
  });
  return folioView(tx, row, balance);
}

/** Internal settle used after receivables transfer (no version check, folio already locked). */
export async function settleLocked(tx: TxContext, f: FolioRow): Promise<void> {
  const balance = await folioBalance(tx, f.id);
  assertCanSettle(f.status === 'settled' ? 'open' : f.status, balance, f.currency);
  if (f.status === 'settled') return;
  await changeStatus(tx, f, f.version, { status: 'settled', settled_at: tx.now }, 'finance.folio.settle');
  await tx.emit({
    type: 'finance.folio.settled',
    propertyId: f.property_id,
    aggregate: { type: 'folio', id: f.id },
    payload: { folioId: f.id, owner: { type: f.owner_type, id: f.owner_id } },
  });
}

export async function closeFolio(tx: TxContext, folioId: string, expectedVersion: number): Promise<Folio> {
  const f = await loadFolio(tx, folioId, { forUpdate: true });
  requirePermission(tx, 'finance.folio.manage', { propertyId: f.property_id });
  assertCanClose(f.status);
  const row = await changeStatus(tx, f, expectedVersion, { status: 'closed' }, 'finance.folio.close');
  return folioView(tx, row, await folioBalance(tx, folioId));
}

export async function voidFolio(
  tx: TxContext,
  folioId: string,
  expectedVersion: number,
  reason: string,
): Promise<Folio> {
  const f = await loadFolio(tx, folioId, { forUpdate: true });
  requirePermission(tx, 'finance.folio.manage', { propertyId: f.property_id });
  const n = await db(tx)
    .selectFrom('finance.postings')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('folio_id', '=', folioId)
    .executeTakeFirstOrThrow();
  assertCanVoid(f.status, n.n);
  const rules = await db(tx)
    .selectFrom('finance.billing_rules')
    .select('id')
    .where('destination_folio_id', '=', folioId)
    .where('active', '=', true)
    .executeTakeFirst();
  if (rules) {
    throw new BusinessRuleError(
      'folio_has_billing_rules',
      'Active billing rules send charges to this folio. Change or deactivate those rules before voiding it.',
    );
  }
  const row = await changeStatus(
    tx,
    f,
    expectedVersion,
    { status: 'voided', is_default: false },
    'finance.folio.void',
    reason,
  );
  return folioView(tx, row, 0);
}

/**
 * Make a folio ready to receive a new posting (scenario 10). Returns the folio id to post on — the same folio,
 * the same folio re-opened, or a supplementary folio for the same payer when issued invoices must stay intact.
 */
export async function prepareDestination(
  tx: TxContext,
  f: FolioRow,
  reason: 'late_charge' | 'new_charge' | 'payment' | 'correction' | 'transfer',
): Promise<{ folio: FolioRow; action: 'post' | 'reopen' | 'supplementary' }> {
  const action = destinationAction({ status: f.status, hasActiveInvoice: await hasActiveInvoice(tx, f.id) });
  if (action === 'post') return { folio: f, action };
  if (action === 'reopen') {
    const row = await db(tx)
      .updateTable('finance.folios')
      .set({
        status: 'open',
        settled_at: null,
        reopen_count: sql`reopen_count + 1`,
        reopened_reason: reason,
        version: sql`version + 1`,
      })
      .where('id', '=', f.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'finance.folio.reopen',
      target: { type: 'folio', id: f.id },
      propertyId: f.property_id,
      reason,
      before: { status: f.status },
      after: { status: 'open' },
    });
    await tx.emit({
      type: 'finance.folio.reopened',
      propertyId: f.property_id,
      aggregate: { type: 'folio', id: f.id },
      payload: { folioId: f.id, reason },
    });
    return { folio: row, action };
  }
  const existing = await db(tx)
    .selectFrom('finance.folios')
    .selectAll()
    .where('supplementary_of', '=', f.id)
    .where('status', '=', 'open')
    .forUpdate()
    .executeTakeFirst();
  if (existing) return { folio: existing, action };
  const id = newId(tx.now.getTime());
  const row = await db(tx)
    .insertInto('finance.folios')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: f.property_id,
      legal_entity_id: f.legal_entity_id,
      owner_type: f.owner_type,
      owner_id: f.owner_id,
      payer_type: f.payer_type,
      payer_id: f.payer_id,
      payer_name: f.payer_name,
      label: `${f.label ? `${f.label} — ` : ''}supplementary (${reason.replace('_', ' ')})`,
      currency: f.currency,
      is_default: false,
      reopened_reason: null,
      supplementary_of: f.id,
      opened_at: tx.now,
      settled_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'finance.folio.openSupplementary',
    target: { type: 'folio', id },
    propertyId: f.property_id,
    reason,
    after: { supplementaryOf: f.id },
  });
  await tx.emit({
    type: 'finance.folio.opened',
    propertyId: f.property_id,
    aggregate: { type: 'folio', id },
    payload: { folioId: id, supplementaryOf: f.id, reason },
  });
  return { folio: row, action };
}

/** Reopen a settled or closed folio in place (corrections must stay on the folio that holds the original). */
export async function reopenInPlace(tx: TxContext, f: FolioRow, reason: string): Promise<FolioRow> {
  if (f.status === 'open') return f;
  if (f.status === 'voided') {
    throw new BusinessRuleError('folio_voided', 'This folio was voided and cannot receive postings.');
  }
  const row = await db(tx)
    .updateTable('finance.folios')
    .set({
      status: 'open',
      settled_at: null,
      reopen_count: sql`reopen_count + 1`,
      reopened_reason: reason,
      version: sql`version + 1`,
    })
    .where('id', '=', f.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'finance.folio.reopen',
    target: { type: 'folio', id: f.id },
    propertyId: f.property_id,
    reason,
    before: { status: f.status },
    after: { status: 'open' },
  });
  await tx.emit({
    type: 'finance.folio.reopened',
    propertyId: f.property_id,
    aggregate: { type: 'folio', id: f.id },
    payload: { folioId: f.id, reason },
  });
  return row;
}

/** Record that a stay/booking departed (from reservations at check-out, directly or via event). Idempotent. */
export async function markOwnerDeparted(
  tx: TxContext,
  input: {
    propertyId: string;
    owner: { type: 'stay' | 'booking' | 'group'; id: string };
    departedOn: LocalDate;
  },
): Promise<void> {
  await db(tx)
    .insertInto('finance.owner_departures')
    .values({
      tenant_id: tx.tenantId,
      owner_type: input.owner.type,
      owner_id: input.owner.id,
      property_id: input.propertyId,
      departed_on: input.departedOn,
      recorded_at: tx.now,
    })
    .onConflict((oc) =>
      oc.columns(['tenant_id', 'owner_type', 'owner_id']).doUpdateSet({ departed_on: input.departedOn }),
    )
    .execute();
}

/** Undo a departure mark (e.g. check-out reverted). */
export async function clearOwnerDeparture(tx: TxContext, owner: { type: string; id: string }): Promise<void> {
  await db(tx)
    .deleteFrom('finance.owner_departures')
    .where('owner_type', '=', owner.type)
    .where('owner_id', '=', owner.id)
    .execute();
}

export async function isDeparted(tx: TxContext, owner: { type: string; id: string }): Promise<boolean> {
  return (await ownerDeparture(tx, owner)) !== null;
}

export async function defaultFolio(tx: TxContext, owner: { type: string; id: string }): Promise<FolioRow> {
  const row = await db(tx)
    .selectFrom('finance.folios')
    .selectAll()
    .where('owner_type', '=', owner.type)
    .where('owner_id', '=', owner.id)
    .where('is_default', '=', true)
    .executeTakeFirst();
  if (!row) {
    throw new BusinessRuleError(
      'no_default_folio',
      `There is no folio for this ${owner.type} yet. Open a folio for the payer first (reservations opens one at booking or check-in).`,
      { owner },
    );
  }
  return row;
}

export function assertSameProperty(f: FolioRow, propertyId: string): void {
  if (f.property_id !== propertyId) {
    throw new ValidationError('folio_property_mismatch', 'The folio belongs to another property.', {
      folioId: f.id,
    });
  }
}
