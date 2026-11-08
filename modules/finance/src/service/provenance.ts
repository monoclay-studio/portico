/**
 * Where a folio's debt and money come from (ADR-0015 Amendment 4 rule 2; integration-step re-review #5 R5-P1-2).
 *
 * Card money taken under a cardholder's agreement may pay only for what that agreement covers, wherever the money is
 * applied or moved. Netting happens on a folio: its credit pays all of its debt. So finance reports, per folio:
 *  - the owners of its debt other than the folio's own owner — charges transferred onto it (followed through every
 *    hop to the original posting, so a two-hop transfer cannot launder the origin), charges routed to it by a billing
 *    rule, a balance transferred from another folio (that folio's whole debt), and every active billing rule that
 *    routes charges here (debt that will arrive);
 *  - the money on it: payments (by the payments module's payment id) and deposit applications (by booking), including
 *    money transferred onto it.
 * Payments decides coverage (`cardMoneyMayMeet`, `LedgerPort.debtOriginsOf`); finance never reads an agreement.
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError } from '@portico/kernel';
import { type Deps, db } from './support';

export interface Owner {
  type: string;
  id: string;
}

export interface FolioProvenance {
  owner: Owner;
  /** Owners of debt on the folio other than its own owner (net positive per owner), plus active routing owners. */
  debtOwners: Owner[];
  /** Payments-module payment ids whose money is on the folio (net credit per payment). */
  paymentIds: string[];
  /** Bookings whose deposits were applied to the folio (net credit per booking). */
  depositBookingIds: string[];
}

type Root =
  | { kind: 'debt'; owner: Owner }
  | { kind: 'payment'; id: string }
  | { kind: 'deposit'; bookingId: string }
  | { kind: 'folio_balance'; folioId: string }
  /** Money with no cardholder agreement behind it (cash, tender, cheque): no coverage constraint. */
  | { kind: 'other_money' }
  /** A posting whose origin cannot be established: treated as debt of an unknown owner (fails closed). */
  | { kind: 'unknown'; postingId: string };

const key = (o: Owner) => `${o.type}:${o.id}`;

interface PostingLite {
  id: string;
  folio_id: string;
  kind: string;
  amount_minor: number;
  corrects_posting_id: string | null;
  transfer_peer_id: string | null;
  parent_posting_id: string | null;
  billing_rule_id: string | null;
  payment_ref_type: string | null;
  payment_ref_id: string | null;
  source_type: string | null;
  source_id: string | null;
}

const COLUMNS = [
  'id',
  'folio_id',
  'kind',
  'amount_minor',
  'corrects_posting_id',
  'transfer_peer_id',
  'parent_posting_id',
  'billing_rule_id',
  'payment_ref_type',
  'payment_ref_id',
  'source_type',
  'source_id',
] as const;

async function posting(tx: TxContext, id: string): Promise<PostingLite | undefined> {
  return db(tx).selectFrom('finance.postings').select(COLUMNS).where('id', '=', id).executeTakeFirst();
}

async function folioOwner(tx: TxContext, folioId: string): Promise<Owner | null> {
  const f = await db(tx)
    .selectFrom('finance.folios')
    .select(['owner_type', 'owner_id'])
    .where('id', '=', folioId)
    .executeTakeFirst();
  return f ? { type: f.owner_type, id: f.owner_id } : null;
}

async function ruleOwner(tx: TxContext, ruleId: string): Promise<Owner | null> {
  const r = await db(tx)
    .selectFrom('finance.billing_rules')
    .select(['owner_type', 'owner_id'])
    .where('id', '=', ruleId)
    .executeTakeFirst();
  return r ? { type: r.owner_type, id: r.owner_id } : null;
}

/** The original posting a line stands for, followed through transfers, taxes and adjustments (bounded). */
async function rootOf(tx: TxContext, p0: PostingLite): Promise<Root> {
  let p: PostingLite | undefined = p0;
  for (let hop = 0; p && hop < 64; hop++) {
    if (p.kind === 'transfer_in' || p.kind === 'transfer_out') {
      if (p.corrects_posting_id) {
        p = await posting(tx, p.corrects_posting_id);
        continue;
      }
      // A balance transfer (no item): it carries the other folio's debt.
      const peer = p.transfer_peer_id ? await posting(tx, p.transfer_peer_id) : undefined;
      return peer ? { kind: 'folio_balance', folioId: peer.folio_id } : { kind: 'unknown', postingId: p.id };
    }
    if (p.kind === 'tax' && p.parent_posting_id) {
      p = await posting(tx, p.parent_posting_id);
      continue;
    }
    if (p.kind === 'adjustment' && p.corrects_posting_id) {
      p = await posting(tx, p.corrects_posting_id);
      continue;
    }
    if (p.kind === 'payment') {
      return p.payment_ref_type === 'payment' && p.payment_ref_id
        ? { kind: 'payment', id: p.payment_ref_id }
        : { kind: 'other_money' };
    }
    if (p.kind === 'deposit_application') {
      return p.source_type === 'booking' && p.source_id
        ? { kind: 'deposit', bookingId: p.source_id }
        : { kind: 'unknown', postingId: p.id };
    }
    // Re-review #6 R6-P1-2 (Amendment 5 rule 2): every other posting — a refund (it takes back credit), a reversal, a
    // correction, an allowance, a forfeit, a receivables transfer, a paid-out — is debt (or a debt reduction) of the
    // owner of the folio it was first posted on (or of the billing rule that routed it). Nothing is "none".
    const owner = p.billing_rule_id
      ? await ruleOwner(tx, p.billing_rule_id)
      : await folioOwner(tx, p.folio_id);
    return owner ? { kind: 'debt', owner } : { kind: 'unknown', postingId: p.id };
  }
  return { kind: 'unknown', postingId: p0.id };
}

/** The money (payment or deposit application) or debt owner a posting carries, for a transfer check. */
export async function postingRoot(tx: TxContext, postingId: string): Promise<Root> {
  const p = await posting(tx, postingId);
  return p ? rootOf(tx, p) : { kind: 'unknown', postingId };
}

export async function folioProvenance(
  tx: TxContext,
  folioId: string,
  seen: Set<string> = new Set(),
): Promise<FolioProvenance> {
  seen.add(folioId);
  const owner = (await folioOwner(tx, folioId)) ?? { type: 'folio', id: folioId };
  const rows = await db(tx)
    .selectFrom('finance.postings')
    .select(COLUMNS)
    .where('folio_id', '=', folioId)
    .execute();
  const debt = new Map<string, { owner: Owner; net: number }>();
  const pays = new Map<string, number>();
  const deps = new Map<string, number>();
  const addDebt = (o: Owner, n: number) => {
    const k = key(o);
    const cur = debt.get(k) ?? { owner: o, net: 0 };
    cur.net += n;
    debt.set(k, cur);
  };
  for (const p of rows) {
    const amount = Number(p.amount_minor);
    if (amount === 0) continue;
    const root = await rootOf(tx, p);
    // Re-review #7 R7-P1-2 (Amendment 6): a CREDIT moving between folios (money, or a debt reduction) leaves behind — or
    // brings — a debit owned by whoever the credit benefits on the other side: the peer folio's owner. A credit moved
    // back nets that owner out again.
    const creditMoving =
      (p.kind === 'transfer_out' && amount > 0) || (p.kind === 'transfer_in' && amount < 0);
    if (creditMoving) {
      const peer = p.transfer_peer_id ? await posting(tx, p.transfer_peer_id) : undefined;
      const peerOwner = peer ? await folioOwner(tx, peer.folio_id) : null;
      addDebt(peerOwner ?? { type: 'unknown_origin', id: p.id }, amount);
      if (root.kind === 'payment') pays.set(root.id, (pays.get(root.id) ?? 0) + amount);
      else if (root.kind === 'deposit') deps.set(root.bookingId, (deps.get(root.bookingId) ?? 0) + amount);
      continue;
    }
    if (root.kind === 'debt') addDebt(root.owner, amount);
    else if (root.kind === 'payment') pays.set(root.id, (pays.get(root.id) ?? 0) + amount);
    else if (root.kind === 'deposit') deps.set(root.bookingId, (deps.get(root.bookingId) ?? 0) + amount);
    else if (root.kind === 'unknown')
      addDebt({ type: 'unknown_origin', id: root.postingId }, Math.abs(amount));
    else if (root.kind === 'folio_balance' && amount > 0 && !seen.has(root.folioId)) {
      // A balance moved here from another folio carries that folio's owner and every origin of its debt.
      const other = await folioProvenance(tx, root.folioId, seen);
      addDebt(other.owner, amount);
      for (const o of other.debtOwners) addDebt(o, amount);
    }
  }
  const routed = await db(tx)
    .selectFrom('finance.billing_rules')
    .select(['owner_type', 'owner_id'])
    .where('destination_folio_id', '=', folioId)
    .where('active', '=', true)
    .execute();
  const owners = new Map<string, Owner>();
  for (const { owner: o, net } of debt.values()) if (net > 0 && key(o) !== key(owner)) owners.set(key(o), o);
  for (const r of routed) {
    const o = { type: r.owner_type, id: r.owner_id };
    if (key(o) !== key(owner)) owners.set(key(o), o);
  }
  return {
    owner,
    debtOwners: [...owners.values()],
    paymentIds: [...pays.entries()].filter(([, n]) => n < 0).map(([id]) => id),
    depositBookingIds: [...deps.entries()].filter(([, n]) => n < 0).map(([id]) => id),
  };
}

/** Refuse a move when card money from `sources` would meet debt of `owners` its agreement does not cover. */
export async function assertCardCoverage(
  tx: TxContext,
  deps: Deps,
  input: {
    sources: { paymentIds?: string[]; depositBookingIds?: string[]; folioIds?: string[] };
    owners: Owner[];
  },
  code: string,
): Promise<void> {
  if (input.owners.length === 0) return;
  const r = await deps.ports.payments.cardMoneyMayMeet(tx, input);
  if (!r.covered) throw new BusinessRuleError(code, r.reason);
}

/** Card money landing on `folioId` (a deposit applied, money transferred in) must cover the folio and its debt. */
export async function assertMoneyMayLand(
  tx: TxContext,
  deps: Deps,
  folioId: string,
  sources: { paymentIds?: string[]; depositBookingIds?: string[] },
  code: string,
): Promise<void> {
  const dest = await folioProvenance(tx, folioId);
  await assertCardCoverage(tx, deps, { sources, owners: [dest.owner, ...dest.debtOwners] }, code);
}

/** Debt of `owners` arriving on `folioId` (transferred or routed) must be covered by the card money already there. */
export async function assertDebtMayLand(
  tx: TxContext,
  deps: Deps,
  folioId: string,
  owners: Owner[],
  code: string,
): Promise<void> {
  const dest = await folioProvenance(tx, folioId);
  const foreign = owners.filter((o) => key(o) !== key(dest.owner));
  await assertCardCoverage(
    tx,
    deps,
    {
      sources: {
        paymentIds: dest.paymentIds,
        depositBookingIds: dest.depositBookingIds,
        folioIds: [folioId],
      },
      owners: foreign,
    },
    code,
  );
}

async function penaltyRoots(tx: TxContext, stayId: string): Promise<Set<string>> {
  const keys = [`penalty:no_show:${stayId}`, `penalty:cancellation:${stayId}`];
  const roots = await db(tx)
    .selectFrom('finance.postings as p')
    .innerJoin('finance.journal_entries as e', 'e.id', 'p.entry_id')
    .select('p.id')
    .where('e.idempotency_key', 'in', keys)
    .execute();
  return new Set(roots.map((r) => r.id));
}

/** The original posting a line stands for (through transfers, corrections and taxes), or undefined. */
async function rootRow(tx: TxContext, p0: PostingLite): Promise<PostingLite | undefined> {
  let p: PostingLite | undefined = p0;
  for (let hop = 0; p && hop < 64; hop++) {
    const next: string | null =
      p.kind === 'transfer_in' || p.kind === 'transfer_out' || p.kind === 'adjustment'
        ? p.corrects_posting_id
        : p.kind === 'tax'
          ? p.parent_posting_id
          : null;
    if (!next) return p;
    p = await posting(tx, next);
  }
  return undefined;
}

/**
 * Re-review #6 R6-P2-1 and #7 R7-P1-1 / R7-P2-1 (Amendment 6 rule 1: one balance per obligation): what the stay's
 * no-show / cancellation penalty STILL OWES on this folio, as the ledger stands —
 *  - the penalty postings (journal entries `penalty:no_show:<stay>` / `penalty:cancellation:<stay>`, with taxes) on the
 *    folio, followed through corrections and transfers: posted, less credited, less moved off, plus moved on;
 *  - less every money posting on the folio, by any method (card, cash, cheque, terminal, link, deposit applied —
 *    including a forfeited deposit, which is applied to the penalty), net of refunds: money on a folio that carries a
 *    penalty pays the penalty first.
 * Floored at 0, never more than the penalty on the folio.
 */
export async function penaltyOn(tx: TxContext, folioId: string, stayId: string): Promise<number> {
  const rootIds = await penaltyRoots(tx, stayId);
  if (rootIds.size === 0) return 0;
  const rows = await db(tx)
    .selectFrom('finance.postings')
    .select(COLUMNS)
    .where('folio_id', '=', folioId)
    .execute();
  let penalty = 0;
  let money = 0;
  for (const p0 of rows) {
    const amount = Number(p0.amount_minor);
    const root = await rootRow(tx, p0);
    if (!root) continue;
    if (rootIds.has(root.id)) penalty += amount;
    else if (root.kind === 'payment' || root.kind === 'deposit_application' || root.kind === 'refund')
      money -= amount;
  }
  return Math.max(0, Math.min(penalty, penalty - money));
}

/** The folios a stay's penalty postings sit on now (where posted, and wherever they were moved). */
export async function penaltyFoliosOfStay(tx: TxContext, stayId: string): Promise<string[]> {
  let ids = [...(await penaltyRoots(tx, stayId))];
  const folios = new Set<string>();
  const seen = new Set<string>(ids);
  for (let hop = 0; ids.length > 0 && hop < 8; hop++) {
    const rows = await db(tx)
      .selectFrom('finance.postings')
      .select(['id', 'folio_id'])
      .where((eb) => eb.or([eb('id', 'in', ids), eb('corrects_posting_id', 'in', ids)]))
      .execute();
    for (const r of rows) folios.add(r.folio_id);
    ids = rows.map((r) => r.id).filter((id) => !seen.has(id));
    for (const id of ids) seen.add(id);
  }
  return [...folios];
}
