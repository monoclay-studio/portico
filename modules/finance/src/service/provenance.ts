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
  | { kind: 'none' };

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
      return peer ? { kind: 'folio_balance', folioId: peer.folio_id } : { kind: 'none' };
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
        : { kind: 'none' };
    }
    if (p.kind === 'deposit_application') {
      return p.source_type === 'booking' && p.source_id
        ? { kind: 'deposit', bookingId: p.source_id }
        : { kind: 'none' };
    }
    if (p.kind === 'refund') return { kind: 'none' };
    const owner = p.billing_rule_id
      ? await ruleOwner(tx, p.billing_rule_id)
      : await folioOwner(tx, p.folio_id);
    return owner ? { kind: 'debt', owner } : { kind: 'none' };
  }
  return { kind: 'none' };
}

/** The money (payment or deposit application) or debt owner a posting carries, for a transfer check. */
export async function postingRoot(tx: TxContext, postingId: string): Promise<Root> {
  const p = await posting(tx, postingId);
  return p ? rootOf(tx, p) : { kind: 'none' };
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
    if (root.kind === 'debt') addDebt(root.owner, amount);
    else if (root.kind === 'payment') pays.set(root.id, (pays.get(root.id) ?? 0) + amount);
    else if (root.kind === 'deposit') deps.set(root.bookingId, (deps.get(root.bookingId) ?? 0) + amount);
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
