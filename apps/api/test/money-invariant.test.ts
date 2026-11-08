/**
 * Seeded, model-based test of the money invariant (ADR-0015 Amendment 6 rule 2; re-review #7 item 5).
 *
 * Each sequence builds a world over the real composition — two guests, each with two bookings (one arriving today,
 * one in ten days), a folio per stay and two saved cards with agreements (a wide one the cardholder confirmed for both
 * bookings, and a narrow staff-recorded one: guarantee and no-show on the first booking only) — and runs a random
 * sequence of every money operation against it: charges posted, card charges, holds, captures, increments, payment
 * links, cash and cheque, deposit application and forfeit, item and amount transfers, routing rules, refunds, credits
 * and write-offs (adjustments), no-show and cancellation penalties and add-stay. A share of the steps run two
 * operations concurrently on the same folio or booking.
 *
 * The REFERENCE MODEL is independent of the code under test: it reads every new posting and deposit movement after
 * each step and attributes it by how the test created it — a charge belongs to the stay it was posted for (or the
 * routing rule's owner), a penalty to its stay, a refund to the folio it was posted on, a moved item keeps its origin,
 * and the debit a moved credit leaves behind belongs to the folio the credit now benefits (Amendment 6 rule 1). Money
 * is allocated to the debt it lands on (a card's money to debt its agreement covers first). It never asks finance or
 * payments what is covered.
 *
 * After EVERY step it asserts:
 *  (a) no card ever pays more than the obligations its agreement covers — no card's money is allocated to debt it does
 *      not cover, no card deposit lands on a booking it does not cover, and no card-funded deposit is kept as revenue
 *      without a penalty owed;
 *  (b) no obligation is collected more than once across all methods — a hotel-initiated collection of card money
 *      never lands beyond what the folio still owes, and card deposits never exceed the deposit due;
 *  (c) the ledger balances — every journal entry of the property's legal entity nets to zero (and the integrity
 *      report is clean at the end of the sequence);
 * plus two consistency checks that keep the model honest: every folio's balance equals the model's, and every card's
 * money taken (payments net of refunds) equals what the model saw land on the ledger.
 *
 * CI runs a fixed seed list (and every seed a long run ever failed, kept as a regression). A longer local run:
 *   MONEY_SEEDS=1-400 MONEY_STEPS=40 npx vitest run test/money-invariant.test.ts
 * (`MONEY_SEEDS` takes `a-b` ranges and comma lists; `MONEY_CONCURRENCY` the share of concurrent steps, default 0.3.)
 */
import { writeFileSync } from 'node:fs';
import { sql, type TxContext } from '@portico/db';
import { financeForReservations } from '@portico/finance';
import { newId, type RequestContext } from '@portico/kernel';
import type { Booking } from '@portico/reservations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applied,
  bookingInput,
  cardholderConfirms,
  cardOnFile,
  organization,
  type PropertyFixture,
  property,
  type Scenario,
  type ScenarioOrg,
  startScenario,
} from './scenarios/harness';

/**
 * Seeds that failed while the generator was built, kept as regressions (each fails again if its fix is reverted):
 *  - 1: a deposit forfeited for a penalty owed with no deposit held crashed ("no result") instead of `no_deposit`;
 *  - 41: a balance transfer from a folio in credit moved debt nobody incurred (now `transfer_exceeds_balance`).
 */
const REGRESSION_SEEDS = [1, 41];
/** The CI seeds also kill the earlier mutants N7 (15, 75), R1 (41) and R3 (45, 75) with the generator alone. */
const CI_SEEDS = [11, 15, 23, 37, 45, 59, 73, 75];

function parseSeeds(v: string): number[] {
  const out: number[] = [];
  for (const part of v.split(',')) {
    const [a, b] = part.split('-').map((x) => Number(x.trim()));
    if (a === undefined || Number.isNaN(a)) continue;
    if (b === undefined || Number.isNaN(b)) out.push(a);
    else for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}
const SEEDS = process.env.MONEY_SEEDS
  ? parseSeeds(process.env.MONEY_SEEDS)
  : [...new Set([...REGRESSION_SEEDS, ...CI_SEEDS])];
const STEPS = Number(process.env.MONEY_STEPS ?? 30);
const CONCURRENT_SHARE = Number(process.env.MONEY_CONCURRENCY ?? 0.3);

/** mulberry32: a small, well-mixed 32-bit PRNG; the whole sequence is a function of the seed. */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick<T>(xs: readonly T[]): T {
      if (xs.length === 0) throw new Error('pick from an empty list');
      return xs[Math.floor(next() * xs.length)] as T;
    },
    chance: (p: number) => next() < p,
  };
}
type Rand = ReturnType<typeof prng>;

let s: Scenario;
let org: ScenarioOrg;
beforeAll(async () => {
  s = await startScenario();
  org = await organization(s);
});
afterAll(async () => s?.close());

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
const settle = <T>(p: Promise<T>) =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e: e as { code?: string; message?: string } }),
  );
const q = async <R>(text: ReturnType<typeof sql<R>>) => (await text.execute(s.t.admin.kysely)).rows;

// ───────────────────────────── world ─────────────────────────────

interface Card {
  src: string;
  id: string;
  guest: number;
  narrow: boolean;
  /** Stays the agreement covers (as they were when the cardholder consented). */
  stays: Set<string>;
  /** Bookings the card may take a deposit for (wide card only). */
  depositBookings: Set<string>;
}
interface World {
  k: PropertyFixture;
  desk: RequestContext;
  gm: RequestContext;
  auditor: RequestContext;
  simAccountId: string;
  guests: string[];
  bookings: Array<{ id: string; guest: number; arrival: string; departure: string }>;
  stays: Map<string, { booking: string; guest: number }>;
  bookingStays: Map<string, string[]>;
  cards: Card[];
}

let worldNo = 0;
async function buildWorld(): Promise<World> {
  worldNo += 1;
  const k = await property(s, org, {
    code: `M${String(worldNo).padStart(3, '0')}`,
    name: `Money Invariant Resort ${worldNo}`,
    kind: 'resort',
    businessDate: '2027-03-10',
    types: [
      { code: 'BV', name: 'Beach Villa', rank: 10, maxOccupancy: 3, units: ['B1', 'B2', 'B3', 'B4'] },
      {
        code: 'WV',
        name: 'Water Villa',
        rank: 20,
        maxOccupancy: 3,
        units: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'],
      },
    ],
  });
  const desk = org.staff('front_desk', 'Hassan', [k.id]);
  const gm = org.staff('general_manager', 'GM', [k.id]);
  const auditor = org.staff('night_auditor', 'Night audit', [k.id]);
  const simAccountId = await org.run(org.setup, async (tx) => {
    const a = (await s.c.services.payments.tx.listAccounts(tx, k.legalEntityId)).find(
      (x) => x.provider === 'simulator',
    );
    if (!a) throw new Error('no simulator account');
    return a.id;
  });
  await org.run(desk, (tx) =>
    s.c.services.finance.openCashierSession(tx, { propertyId: k.id, openingFloats: { USD: 0 } }),
  );
  const w: World = {
    k,
    desk,
    gm,
    auditor,
    simAccountId,
    guests: [],
    bookings: [],
    stays: new Map(),
    bookingStays: new Map(),
    cards: [],
  };
  const names = [
    { firstName: 'Otto', lastName: 'Lind' },
    { firstName: 'Vera', lastName: 'Sousa' },
  ];
  for (const [g, name] of names.entries()) {
    const { profileId } = await org.run(org.setup, (tx) =>
      s.c.services.guests.resolveProfile(
        tx,
        { propertyId: k.id, givenName: name.firstName, familyName: name.lastName },
        { matchStrategy: 'create_new' },
      ),
    );
    w.guests.push(profileId);
    const mine: string[] = [];
    for (const [arrival, departure] of [
      ['2027-03-10', '2027-03-12'],
      ['2027-03-20', '2027-03-22'],
    ] as const) {
      const b = applied<Booking>(
        await org.run(desk, (tx) =>
          s.c.services.reservations.createBooking(
            tx,
            bookingInput(k, { arrival, departure, guestProfileId: profileId, guest: name }),
          ),
        ),
      );
      mine.push(b.id);
      w.bookings.push({ id: b.id, guest: g, arrival, departure });
      w.bookingStays.set(
        b.id,
        b.stays.map((x) => x.id),
      );
      for (const st of b.stays) {
        w.stays.set(st.id, { booking: b.id, guest: g });
        await openStayFolio(w, st.id, profileId);
      }
    }
    const wide = await cardOnFile(s, org, k.id, k.legalEntityId, 'pm_card_visa', {
      type: 'guest_profile',
      id: profileId,
    });
    for (const b of mine) await cardholderConfirms(s, org, wide.id, b);
    const narrow = await cardOnFile(
      s,
      org,
      k.id,
      k.legalEntityId,
      'pm_card_amex',
      { type: 'guest_profile', id: profileId },
      { purposes: ['guarantee', 'no_show'], mandateFor: [mine[0] as string] },
    );
    if (narrow.id === wide.id) throw new Error('the narrow card must be a card of its own');
    const staysOf = (bs: string[]) => new Set(bs.flatMap((b) => w.bookingStays.get(b) ?? []));
    w.cards.push({
      src: `card:${wide.id}`,
      id: wide.id,
      guest: g,
      narrow: false,
      stays: staysOf(mine),
      depositBookings: new Set(mine),
    });
    w.cards.push({
      src: `card:${narrow.id}`,
      id: narrow.id,
      guest: g,
      narrow: true,
      stays: staysOf([mine[0] as string]),
      depositBookings: new Set(),
    });
  }
  return w;
}

async function openStayFolio(w: World, stayId: string, payer: string) {
  return (
    await org.run(org.setup, (tx) =>
      financeForReservations(s.c.services.finance).openFolio(tx, {
        propertyId: w.k.id,
        owner: { type: 'stay', id: stayId },
        payer: { type: 'profile', id: payer },
      }),
    )
  ).folioId;
}

// ───────────────────────────── reference model ─────────────────────────────

type LotKind = 'charge' | 'penalty' | 'refund' | 'moved_credit';
interface Meta {
  origins: string[];
  kind: LotKind;
  /** A refund returns this card's money: the card's own credit may meet it. */
  refundOf?: string;
}
interface Piece {
  src: string;
  amount: number;
}
interface Lot {
  meta: Meta;
  folio: string;
  open: number;
  paid: Piece[];
}
interface FolioState {
  owner: string;
  lots: Lot[];
  credits: Piece[];
}
interface PostingRow {
  id: string;
  folio_id: string;
  kind: string;
  amount: number;
  corrects_posting_id: string | null;
  parent_posting_id: string | null;
  transfer_peer_id: string | null;
  billing_rule_id: string | null;
  payment_ref_type: string | null;
  payment_ref_id: string | null;
  entry_id: string;
  idempotency_key: string;
}
interface MovementRow {
  id: string;
  booking_id: string;
  kind: string;
  amount: number;
  entry_id: string;
  folio_id: string | null;
  payment_ref_type: string | null;
  payment_ref_id: string | null;
}

class Model {
  folios = new Map<string, FolioState>();
  lotOf = new Map<string, Lot>();
  metaOf = new Map<string, Meta>();
  creditOf = new Map<string, Piece[]>();
  creditFolio = new Map<string, string>();
  pool = new Map<string, Piece[]>();
  received = new Map<string, number>();
  paid = new Map<string, number>();
  due = new Map<string, number>();
  seenPostings = new Set<string>();
  seenMovements = new Set<string>();
  violations: string[] = [];
  trace: string[] = [];
  srcCache = new Map<string, string>();
  ruleOwner = new Map<string, string>();
  unmodelled = new Map<string, number>();
  unpostedRefunds = 0;
  cards: Map<string, Card>;

  constructor(readonly w: World) {
    this.cards = new Map(w.cards.map((c) => [c.src, c]));
  }

  card(src: string) {
    return this.cards.get(src);
  }
  covers(card: Card, meta: Meta) {
    if (meta.refundOf === card.src) return true;
    if (card.narrow && meta.kind === 'charge') return false;
    return meta.origins.length > 0 && meta.origins.every((o) => card.stays.has(o));
  }
  coverability(meta: Meta) {
    let n = 0;
    for (const c of this.cards.values()) if (this.covers(c, meta)) n++;
    return n;
  }
  folio(id: string) {
    const f = this.folios.get(id);
    if (!f) throw new Error(`model: unknown folio ${id}`);
    return f;
  }
  violate(inv: 'a' | 'b' | 'model', msg: string) {
    this.violations.push(`(${inv}) ${msg}`);
  }
  describe(meta: Meta) {
    return `${meta.kind} of ${meta.origins.map((o) => this.stayName(o)).join('+')}`;
  }
  stayName(id: string) {
    const st = this.w.stays.get(id);
    if (!st) return id.startsWith('?') ? id : `stay ${id.slice(-6)}`;
    return `the stay ${id.slice(-4)} of ${this.bookingName(st.booking)}`;
  }
  bookingName(id: string) {
    const b = this.w.bookings.find((x) => x.id === id);
    if (!b) return `booking ${id.slice(-6)}`;
    const n = this.w.bookings.filter((x) => x.guest === b.guest).indexOf(b) + 1;
    return `guest ${b.guest}'s booking ${n}`;
  }
  folioName(id: string) {
    const owner = this.folios.get(id)?.owner ?? '';
    const st = this.w.stays.get(owner);
    if (!st) return `folio ${id.slice(-6)}`;
    const first = (this.w.bookingStays.get(st.booking) ?? [])[0] === owner;
    return `folio of ${this.bookingName(st.booking)}${first ? '' : ` (added stay ${owner.slice(-4)})`}`;
  }
  cardName(src: string) {
    const c = this.card(src);
    return c ? `guest ${c.guest}'s ${c.narrow ? 'narrow' : 'wide'} card` : src;
  }

  landDebt(folioId: string, meta: Meta, amount: number, postingIds: string[]) {
    const f = this.folio(folioId);
    const lot: Lot = { meta, folio: folioId, open: amount, paid: [] };
    f.lots.push(lot);
    for (const id of postingIds) {
      this.lotOf.set(id, lot);
      this.metaOf.set(id, meta);
    }
    const rank = (c: Piece) => {
      const card = this.card(c.src);
      if (!card) return 1;
      return this.covers(card, meta) ? 0 : 2;
    };
    for (const c of [...f.credits].sort((x, y) => rank(x) - rank(y))) {
      const take = Math.min(c.amount, lot.open);
      if (take <= 0) continue;
      const card = this.card(c.src);
      if (card && !this.covers(card, meta)) {
        this.violate(
          'a',
          `${this.cardName(c.src)}'s money on ${this.folioName(folioId)} now meets ${take} of ${this.describe(meta)}, which its agreement does not cover`,
        );
      }
      c.amount -= take;
      lot.open -= take;
      lot.paid.push({ src: c.src, amount: take });
    }
    f.credits = f.credits.filter((c) => c.amount > 0);
    return lot;
  }

  landCredit(
    folioId: string,
    src: string,
    amount: number,
    opts: { collection: boolean; prefer?: Lot; what: string; mostCoverableFirst?: boolean },
  ): Array<{ meta: Meta; amount: number }> {
    const allocations: Array<{ meta: Meta; amount: number }> = [];
    const f = this.folio(folioId);
    const card = this.card(src);
    let left = amount;
    const open = f.lots.filter((l) => l.open > 0 && l !== opts.prefer);
    const ordered = card
      ? [...open.filter((l) => this.covers(card, l.meta)), ...open.filter((l) => !this.covers(card, l.meta))]
      : [...open].sort(
          (x, y) =>
            (this.coverability(x.meta) - this.coverability(y.meta)) * (opts.mostCoverableFirst ? -1 : 1),
        );
    if (opts.prefer && opts.prefer.folio === folioId && opts.prefer.open > 0) ordered.unshift(opts.prefer);
    for (const lot of ordered) {
      if (left <= 0) break;
      const take = Math.min(lot.open, left);
      if (card && !this.covers(card, lot.meta)) {
        this.violate(
          'a',
          `${opts.what}: ${this.cardName(src)} paid ${take} of ${this.describe(lot.meta)} on ${this.folioName(folioId)}, which its agreement does not cover`,
        );
      }
      lot.open -= take;
      lot.paid.push({ src, amount: take });
      allocations.push({ meta: lot.meta, amount: take });
      left -= take;
    }
    if (left > 0) {
      if (card && opts.collection) {
        this.violate(
          'b',
          `${opts.what}: ${this.cardName(src)} collected ${left} more than ${this.folioName(folioId)} still owed`,
        );
      }
      f.credits.push({ src, amount: left });
    }
    return allocations;
  }

  /**
   * Net a folio's unapplied credits against its open debt the way its balance nets them: a card's money only against
   * debt that card covers (a refund of its own money included), any other credit against what is least coverable.
   */
  net(folioId: string) {
    const f = this.folio(folioId);
    for (const c of f.credits) {
      const card = this.card(c.src);
      const lots = f.lots
        .filter((l) => l.open > 0 && (!card || this.covers(card, l.meta)))
        .sort((x, y) => (card ? 0 : this.coverability(x.meta) - this.coverability(y.meta)));
      for (const lot of lots) {
        const take = Math.min(lot.open, c.amount);
        if (take <= 0) continue;
        lot.open -= take;
        c.amount -= take;
        lot.paid.push({ src: c.src, amount: take });
      }
    }
    f.credits = f.credits.filter((c) => c.amount > 0);
  }

  /** Take `amount` off a lot: its open part first, then the money that paid it, which becomes unapplied credit. */
  takeFromLot(lot: Lot, amount: number) {
    const f = this.folio(lot.folio);
    let left = amount;
    const fromOpen = Math.min(lot.open, left);
    lot.open -= fromOpen;
    left -= fromOpen;
    while (left > 0 && lot.paid.length > 0) {
      const p = lot.paid[lot.paid.length - 1] as Piece;
      const take = Math.min(p.amount, left);
      p.amount -= take;
      left -= take;
      f.credits.push({ src: p.src, amount: take });
      if (p.amount === 0) lot.paid.pop();
    }
    if (lot.open === 0 && lot.paid.every((p) => p.amount === 0)) f.lots = f.lots.filter((l) => l !== lot);
    this.net(lot.folio);
    return left;
  }

  async srcOfRef(type: string | null, id: string | null): Promise<string> {
    if (!type || !id) return 'other';
    const key = `${type}:${id}`;
    const hit = this.srcCache.get(key);
    if (hit) return hit;
    let method: string | null | undefined;
    if (type === 'payment') {
      method = (
        await q(
          sql<{ method_id: string | null }>`select method_id from payments.payments where id::text = ${id}`,
        )
      )[0]?.method_id;
    } else if (type === 'refund') {
      method = (
        await q(sql<{ method_id: string | null }>`select p.method_id from payments.refunds r
            join payments.payments p on p.id = r.payment_id where r.id::text = ${id}`)
      )[0]?.method_id;
    }
    const src = method && this.cards.has(`card:${method}`) ? `card:${method}` : 'other';
    this.srcCache.set(key, src);
    return src;
  }

  addPaid(src: string, amount: number) {
    if (this.card(src)) this.paid.set(src, (this.paid.get(src) ?? 0) + amount);
  }

  allStaysCovered(card: Card, bookingId: string) {
    return (this.w.bookingStays.get(bookingId) ?? []).every((x) => card.stays.has(x));
  }

  depositReceived(m: MovementRow, src: string) {
    const card = this.card(src);
    const before = this.received.get(m.booking_id) ?? 0;
    if (card) {
      if (!card.depositBookings.has(m.booking_id) || !this.allStaysCovered(card, m.booking_id)) {
        this.violate(
          'a',
          `${this.cardName(src)} paid a deposit of ${m.amount} on ${this.bookingName(m.booking_id)}, which its agreement does not cover as a whole`,
        );
      }
      const due = this.due.get(m.booking_id) ?? 0;
      if (before + m.amount > due) {
        this.violate(
          'b',
          `${this.cardName(src)} paid a deposit of ${m.amount} on ${this.bookingName(m.booking_id)} with ${before} already received of ${due} due`,
        );
      }
    }
    this.received.set(m.booking_id, before + m.amount);
    const pool = this.pool.get(m.booking_id) ?? [];
    pool.push({ src, amount: m.amount });
    this.pool.set(m.booking_id, pool);
    this.addPaid(src, m.amount);
  }

  drawPool(bookingId: string, amount: number, order: (p: Piece) => number): Piece[] {
    const pool = this.pool.get(bookingId) ?? [];
    let left = amount;
    const out: Piece[] = [];
    for (const p of [...pool].sort((x, y) => order(x) - order(y))) {
      if (left <= 0) break;
      const take = Math.min(p.amount, left);
      if (take <= 0) continue;
      p.amount -= take;
      left -= take;
      out.push({ src: p.src, amount: take });
    }
    this.pool.set(
      bookingId,
      pool.filter((p) => p.amount > 0),
    );
    if (left > 0) {
      this.violate(
        'model',
        `${this.bookingName(bookingId)}: ${left} of deposit moved that the model never saw held`,
      );
      out.push({ src: 'other', amount: left });
    }
    return out;
  }

  /** The pieces of a deposit applied to a folio: card money up to the debt that card covers there, then the rest. */
  drawForFolio(bookingId: string, amount: number, folioId: string): Piece[] {
    const f = this.folio(folioId);
    const pool = this.pool.get(bookingId) ?? [];
    const out: Piece[] = [];
    let left = amount;
    const room = new Map<string, number>();
    for (const p of pool) {
      const card = this.card(p.src);
      if (!card || room.has(p.src)) continue;
      room.set(
        p.src,
        f.lots.filter((l) => this.covers(card, l.meta)).reduce((n, l) => n + l.open, 0),
      );
    }
    for (const p of pool) {
      const r = room.get(p.src);
      if (r === undefined || left <= 0) continue;
      const take = Math.min(p.amount, r, left);
      if (take <= 0) continue;
      p.amount -= take;
      room.set(p.src, r - take);
      left -= take;
      out.push({ src: p.src, amount: take });
    }
    this.pool.set(
      bookingId,
      pool.filter((p) => p.amount > 0),
    );
    if (left > 0) out.push(...this.drawPool(bookingId, left, (p) => (this.card(p.src) ? 1 : 0)));
    return out;
  }

  originOfCharge(p: PostingRow, owner: string): Meta {
    const m = /^penalty:[a-z_]+:([0-9a-f-]{36})$/.exec(p.idempotency_key);
    if (m) return { origins: [m[1] as string], kind: 'penalty' };
    if (p.billing_rule_id)
      return { origins: [this.ruleOwner.get(p.billing_rule_id) ?? '?rule'], kind: 'charge' };
    return { origins: [owner], kind: 'charge' };
  }

  snapshot() {
    return structuredClone({
      folios: this.folios,
      lotOf: this.lotOf,
      metaOf: this.metaOf,
      creditOf: this.creditOf,
      creditFolio: this.creditFolio,
      pool: this.pool,
      received: this.received,
      paid: this.paid,
      seenPostings: this.seenPostings,
      seenMovements: this.seenMovements,
      violations: this.violations,
    });
  }
  restore(x: ReturnType<Model['snapshot']>) {
    const y = structuredClone(x);
    Object.assign(this, y);
  }

  /** `order` 1 applies the step's non-debt entries in reverse: two concurrent commits may land either way round. */
  async sync(order: 0 | 1 = 0): Promise<void> {
    this.trace = [];
    const w = this.w;
    const owners = [...w.stays.keys(), ...w.bookings.map((b) => b.id)];
    const folios = await q(sql<{ id: string; owner_type: string; owner_id: string }>`
      select id, owner_type, owner_id from finance.folios where owner_id in (${sql.join(owners)})`);
    for (const f of folios) {
      if (!this.folios.has(f.id)) {
        this.folios.set(f.id, {
          owner: f.owner_type === 'stay' ? f.owner_id : `?${f.owner_type}:${f.owner_id}`,
          lots: [],
          credits: [],
        });
      }
    }
    const rules = await q(sql<{ id: string; owner_type: string; owner_id: string }>`
      select id, owner_type, owner_id from finance.billing_rules where property_id = ${w.k.id}`);
    for (const r of rules)
      this.ruleOwner.set(r.id, r.owner_type === 'stay' ? r.owner_id : `?${r.owner_type}:${r.owner_id}`);
    const folioIds = [...this.folios.keys()];
    const postings = (
      await q(sql<PostingRow>`
        select p.id, p.folio_id, p.kind, p.amount_minor::int as amount, p.corrects_posting_id, p.parent_posting_id,
               p.transfer_peer_id, p.billing_rule_id, p.payment_ref_type, p.payment_ref_id, p.entry_id, e.idempotency_key
          from finance.postings p join finance.journal_entries e on e.id = p.entry_id
         where p.folio_id in (${sql.join(folioIds)}) order by p.id`)
    ).filter((p) => !this.seenPostings.has(p.id));
    const movements = (
      await q(sql<MovementRow>`
        select id, booking_id, kind, amount_minor::int as amount, entry_id, folio_id, payment_ref_type, payment_ref_id
          from finance.deposit_movements where booking_id in (${sql.join(w.bookings.map((b) => b.id))})
         order by id`)
    ).filter((m) => !this.seenMovements.has(m.id));
    for (const m of movements) this.seenMovements.add(m.id);
    for (const p of postings) this.seenPostings.add(p.id);

    for (const m of movements.filter((x) => x.kind === 'received')) {
      this.depositReceived(m, await this.srcOfRef(m.payment_ref_type, m.payment_ref_id));
    }
    const bookingOfEntry = new Map(movements.map((m) => [m.entry_id, m.booking_id]));
    const byId = new Map(postings.map((p) => [p.id, p]));
    const entries: string[] = [];
    for (const p of postings) if (!entries.includes(p.entry_id)) entries.push(p.entry_id);
    // Two concurrent operations commit in an order the ids do not show; a collection accepted under the lock saw the
    // debt committed before it, so entries that only add debt (charges, penalties) are applied first.
    const debtOnly = (e: string) =>
      postings
        .filter((p) => p.entry_id === e)
        .every((p) => p.amount >= 0 && (p.kind === 'charge' || p.kind === 'tax'));
    entries.sort((a, b) => Number(debtOnly(b)) - Number(debtOnly(a)));
    if (order === 1) {
      const firsts = entries.filter(debtOnly);
      entries.splice(0, entries.length, ...firsts, ...entries.filter((e) => !debtOnly(e)).reverse());
    }
    const prio = (p: PostingRow) =>
      p.kind === 'transfer_out'
        ? 0
        : p.kind === 'charge'
          ? 1
          : p.kind === 'tax'
            ? 2
            : p.kind === 'transfer_in'
              ? 4
              : 3;
    for (const entry of entries) {
      const stash = new Map<string, { metas: Array<{ meta: Meta; amount: number }>; pieces: Piece[] }>();
      const ps = postings.filter((p) => p.entry_id === entry).sort((x, y) => prio(x) - prio(y));
      for (const p of ps) {
        if (p.amount === 0) continue;
        await this.apply(p, byId, stash, bookingOfEntry);
      }
    }
    for (const m of movements.filter((x) => x.kind === 'refunded')) {
      const src = await this.srcOfRef(m.payment_ref_type, m.payment_ref_id);
      const amount = -m.amount;
      this.drawPool(m.booking_id, amount, (p) => (p.src === src ? 0 : this.card(p.src) ? 1 : 2));
      this.received.set(m.booking_id, (this.received.get(m.booking_id) ?? 0) - amount);
      this.addPaid(src, -amount);
    }
    for (const m of movements.filter((x) => x.kind === 'forfeited')) {
      const pieces = this.drawPool(m.booking_id, -m.amount, (p) => (this.card(p.src) ? 1 : 0));
      for (const piece of pieces) {
        if (this.card(piece.src)) {
          this.violate(
            'a',
            `${this.cardName(piece.src)}'s deposit money (${piece.amount}) on ${this.bookingName(m.booking_id)} was kept as revenue without a penalty owed`,
          );
        }
      }
    }
  }

  async apply(
    p: PostingRow,
    byId: Map<string, PostingRow>,
    stash: Map<string, { metas: Array<{ meta: Meta; amount: number }>; pieces: Piece[] }>,
    bookingOfEntry: Map<string, string>,
  ) {
    const f = this.folio(p.folio_id);
    const amt = Math.abs(p.amount);
    this.trace.push(
      `${p.kind} ${p.amount} on ${this.folioName(p.folio_id)}${p.corrects_posting_id ? ` corrects ${p.corrects_posting_id.slice(-6)}` : ''}${p.transfer_peer_id ? ' (transfer)' : ''} [${p.id.slice(-6)}]`,
    );
    const peerFolio = async () => {
      if (!p.transfer_peer_id) return undefined;
      const peer =
        byId.get(p.transfer_peer_id) ??
        (await q(sql<PostingRow>`select folio_id from finance.postings where id = ${p.transfer_peer_id}`))[0];
      return peer?.folio_id;
    };
    const stashKey = (out: boolean) => (out ? (p.transfer_peer_id ?? p.entry_id) : p.id);
    switch (p.kind) {
      case 'charge':
      case 'tax': {
        if (p.amount > 0) {
          const parent = p.parent_posting_id ? this.metaOf.get(p.parent_posting_id) : undefined;
          const meta = parent ?? this.originOfCharge(p, f.owner);
          this.landDebt(p.folio_id, meta, amt, [p.id]);
        } else {
          this.correct(p, amt);
        }
        return;
      }
      case 'adjustment': {
        if (p.amount < 0) this.correct(p, amt);
        else {
          const meta = (p.corrects_posting_id && this.metaOf.get(p.corrects_posting_id)) || {
            origins: [f.owner],
            kind: 'charge' as const,
          };
          this.landDebt(p.folio_id, meta, amt, [p.id]);
        }
        return;
      }
      case 'payment': {
        const src = await this.srcOfRef(p.payment_ref_type, p.payment_ref_id);
        if (p.amount < 0) {
          this.addPaid(src, amt);
          this.setCredit(p, [{ src, amount: amt }]);
          this.landCredit(p.folio_id, src, amt, { collection: !!this.card(src), what: 'card payment' });
        } else {
          this.addPaid(src, -amt);
          this.landDebt(p.folio_id, { origins: [f.owner], kind: 'refund', refundOf: src }, amt, [p.id]);
        }
        return;
      }
      case 'refund': {
        const src = await this.srcOfRef(p.payment_ref_type, p.payment_ref_id);
        if (p.amount > 0) {
          this.addPaid(src, -amt);
          // The refunded part of the payment posting is no longer the card's money wherever that posting goes next.
          // (A refund posted on a folio without a link to the posting it returns — a deposit refunded after part of it
          // was applied — returns the card's money in the credits on that folio.)
          const linked = p.corrects_posting_id ? this.creditOf.get(p.corrects_posting_id) : undefined;
          const candidates = linked
            ? [linked]
            : [...this.creditOf.entries()]
                .filter(([id]) => this.creditFolio.get(id) === p.folio_id)
                .map(([, pieces]) => pieces);
          let left = amt;
          for (const pieces of candidates) {
            for (const piece of pieces.filter((x) => x.src === src)) {
              const take = Math.min(piece.amount, left);
              piece.amount -= take;
              left -= take;
              if (take > 0) pieces.push({ src: 'returned', amount: take });
            }
          }
          this.landDebt(p.folio_id, { origins: [f.owner], kind: 'refund', refundOf: src }, amt, [p.id]);
        } else {
          this.addPaid(src, amt);
          this.setCredit(p, [{ src, amount: amt }]);
          this.landCredit(p.folio_id, src, amt, { collection: false, what: 'refund reversal' });
        }
        return;
      }
      case 'deposit_application': {
        const booking = bookingOfEntry.get(p.entry_id);
        if (p.amount < 0) {
          if (!booking) {
            this.violate(
              'model',
              `deposit application ${p.id.slice(-6)} with no deposit movement in its entry`,
            );
            return;
          }
          const pieces = this.drawForFolio(booking, amt, p.folio_id);
          this.setCredit(p, pieces);
          for (const piece of pieces) {
            // Applying a deposit moves money already collected; what it does not settle stays the guest's credit.
            this.landCredit(p.folio_id, piece.src, piece.amount, {
              collection: false,
              what: 'deposit applied',
            });
          }
        } else {
          this.landDebt(p.folio_id, { origins: [f.owner], kind: 'refund' }, amt, [p.id]);
        }
        return;
      }
      case 'transfer_out': {
        const moved = p.corrects_posting_id;
        if (p.amount < 0) {
          // Debt leaves this folio.
          if (moved) {
            const lot = this.lotOf.get(moved);
            if (!lot || lot.folio !== p.folio_id) {
              this.violate(
                'model',
                `transfer of ${moved.slice(-6)} from a folio the model does not hold it on`,
              );
              return;
            }
            this.takeFromLot(lot, amt);
          } else {
            // A balance transfer is a credit on the source that settles part of what it owes (the debt it settles is
            // what moves); the postings it settled keep their amounts, so a later move of one of them frees it.
            const metas = this.landCredit(p.folio_id, 'moved', amt, {
              collection: false,
              what: 'balance moved',
              mostCoverableFirst: true,
            });
            if (metas.reduce((n, x) => n + x.amount, 0) < amt)
              this.violate(
                'b',
                `a balance transfer moved ${amt} off ${this.folioName(p.folio_id)}, more than it owed: debt nobody incurred`,
              );
            stash.set(stashKey(true), { metas, pieces: [] });
          }
        } else {
          // A credit leaves this folio: its money stays with what it paid; the debit it leaves behind belongs to the
          // folio the credit now benefits (Amendment 6 rule 1).
          const dest = await peerFolio();
          const beneficiary = dest ? this.folio(dest).owner : '?unknown';
          const pieces = moved ? scale(this.creditOf.get(moved) ?? [{ src: 'other', amount: amt }], amt) : [];
          let debit = amt;
          if (moved) {
            for (const piece of pieces) {
              for (const c of f.credits.filter((x) => x.src === piece.src)) {
                const take = Math.min(c.amount, piece.amount, debit);
                c.amount -= take;
                debit -= take;
              }
            }
          } else {
            for (const c of f.credits) {
              const take = Math.min(c.amount, debit);
              if (take <= 0) continue;
              c.amount -= take;
              debit -= take;
              pieces.push({ src: c.src, amount: take });
            }
            if (debit > 0) pieces.push({ src: 'other', amount: debit });
          }
          f.credits = f.credits.filter((c) => c.amount > 0);
          if (debit > 0)
            this.landDebt(p.folio_id, { origins: [beneficiary], kind: 'moved_credit' }, debit, [p.id]);
          stash.set(stashKey(true), { metas: [], pieces });
        }
        return;
      }
      case 'transfer_in': {
        const moved = p.corrects_posting_id;
        if (p.amount > 0) {
          if (moved) {
            const meta = this.metaOf.get(moved);
            if (!meta) {
              this.violate('model', `moved posting ${moved.slice(-6)} has no known origin`);
              return;
            }
            const lot = this.landDebt(p.folio_id, meta, amt, [p.id]);
            this.lotOf.set(moved, lot);
          } else {
            const st = stash.get(stashKey(false)) ?? stash.get(p.entry_id);
            const metas = st?.metas ?? [];
            const origins = [...new Set(metas.flatMap((m) => m.meta.origins))];
            const kinds = [...new Set(metas.map((m) => m.meta.kind))];
            const meta: Meta = {
              origins: origins.length ? origins : ['?unknown'],
              kind: kinds.length === 1 ? (kinds[0] as LotKind) : 'charge',
            };
            this.landDebt(p.folio_id, meta, amt, [p.id]);
          }
        } else {
          const st = stash.get(stashKey(false)) ?? stash.get(p.entry_id);
          const pieces = (moved ? scale(this.creditOf.get(moved) ?? [], amt) : st?.pieces) ?? [
            { src: 'other', amount: amt },
          ];
          const total = pieces.reduce((n, x) => n + x.amount, 0);
          if (total < amt) pieces.push({ src: 'other', amount: amt - total });
          this.setCredit(p, pieces);
          for (const piece of pieces) {
            if (piece.amount > 0)
              this.landCredit(p.folio_id, piece.src, piece.amount, {
                collection: false,
                what: 'credit moved in',
              });
          }
        }
        return;
      }
      default: {
        this.unmodelled.set(p.kind, (this.unmodelled.get(p.kind) ?? 0) + 1);
        if (p.amount > 0) this.landDebt(p.folio_id, { origins: [f.owner], kind: 'charge' }, amt, [p.id]);
        else this.landCredit(p.folio_id, 'credit', amt, { collection: false, what: p.kind });
      }
    }
  }

  setCredit(p: PostingRow, pieces: Piece[]) {
    this.creditOf.set(p.id, pieces);
    this.creditFolio.set(p.id, p.folio_id);
  }

  /** A credit correcting a posting: it reduces that posting's lot (where it still is), the rest is a plain credit. */
  correct(p: PostingRow, amt: number) {
    const lot = p.corrects_posting_id ? this.lotOf.get(p.corrects_posting_id) : undefined;
    let left = amt;
    if (lot && lot.folio === p.folio_id) left = this.takeFromLot(lot, amt);
    if (left > 0) this.landCredit(p.folio_id, 'credit', left, { collection: false, what: 'credit' });
  }

  balance(folioId: string) {
    const f = this.folio(folioId);
    return f.lots.reduce((n, l) => n + l.open, 0) - f.credits.reduce((n, c) => n + c.amount, 0);
  }
}

function scale(pieces: Piece[], amount: number): Piece[] {
  const total = pieces.reduce((n, p) => n + p.amount, 0);
  if (total === amount || total === 0) return pieces.map((p) => ({ ...p }));
  let left = amount;
  return pieces.map((p, i) => {
    const take = i === pieces.length - 1 ? left : Math.round((p.amount * amount) / total);
    left -= take;
    return { src: p.src, amount: take };
  });
}

// ───────────────────────────── invariants ─────────────────────────────

async function checkInvariants(m: Model): Promise<string[]> {
  const out = [...m.violations];
  m.violations = [];
  const w = m.w;
  // Model consistency: every folio's balance as the model holds it equals the ledger's.
  const balances = await q(sql<{ folio_id: string; b: number }>`
    select folio_id, coalesce(sum(amount_minor), 0)::int as b from finance.postings
     where folio_id in (${sql.join([...m.folios.keys()])}) group by folio_id`);
  for (const [id] of m.folios) {
    const db = balances.find((r) => r.folio_id === id)?.b ?? 0;
    if (db !== m.balance(id))
      out.push(`(model) ${m.folioName(id)} balance ${db} on the ledger, ${m.balance(id)} in the model`);
  }
  // Every card's money taken (net of refunds) is on the ledger where the model saw it land.
  // (A refund counts once it is on the ledger: one the provider returned but finance could not post yet is an owned
  // exception for staff — the card has less money in, never more — and is counted in the run's statistics.)
  const taken = await q(sql<{ method_id: string; n: number; unposted: number }>`
    select p.method_id,
           (sum(p.amount_minor) - coalesce(sum((select sum(r.amount_minor) from payments.refunds r
              where r.payment_id = p.id and r.status in ('processing', 'pending_verification', 'succeeded')
                and r.ledger_status = 'posted')), 0))::int as n,
           coalesce(sum((select count(*) from payments.refunds r where r.payment_id = p.id
              and r.status = 'succeeded' and r.ledger_status <> 'posted')), 0)::int as unposted
      from payments.payments p
     where p.method_id in (${sql.join(w.cards.map((c) => c.id))})
       and p.status in ('processing', 'pending_verification', 'succeeded') group by p.method_id`);
  m.unpostedRefunds = taken.reduce((n, r) => n + r.unposted, 0);
  if (m.unpostedRefunds > 0) {
    for (const e of await q(sql<{ e: string | null }>`
      select distinct r.ledger_error::text as e from payments.refunds r join payments.payments p on p.id = r.payment_id
       where p.method_id in (${sql.join(w.cards.map((c) => c.id))}) and r.status = 'succeeded'
         and r.ledger_status <> 'posted'`))
      unpostedReasons.add(String(e.e).slice(0, 200));
  }
  for (const c of w.cards) {
    const db = taken.find((r) => r.method_id === c.id)?.n ?? 0;
    const seen = m.paid.get(c.src) ?? 0;
    if (db !== seen)
      out.push(`(model) ${m.cardName(c.src)}: ${db} taken by payments, ${seen} landed on the ledger`);
  }
  // (c) the ledger balances: every entry of the property's legal entity nets to zero.
  const unbalanced = await q(sql<{ id: string; n: number }>`
    select e.id, sum(l.functional_amount_minor)::int as n from finance.journal_entries e
      join finance.journal_lines l on l.entry_id = e.id
     where e.legal_entity_id = ${w.k.legalEntityId}
     group by e.id having sum(l.functional_amount_minor) <> 0`);
  for (const e of unbalanced) out.push(`(c) journal entry ${e.id.slice(-6)} is unbalanced by ${e.n}`);
  return out;
}

// ───────────────────────────── operations ─────────────────────────────

interface Op {
  name: string;
  label: string;
  run: () => Promise<unknown>;
}

async function folioBalances(m: Model) {
  return new Map([...m.folios.keys()].map((id) => [id, m.balance(id)]));
}

async function generate(
  r: Rand,
  w: World,
  m: Model,
  focus?: { folio: string; booking: string },
): Promise<Op> {
  const { payments, finance, reservations } = s.c.services;
  const folioIds = [...m.folios.keys()];
  const balances = await folioBalances(m);
  const folio = focus?.folio ?? r.pick(folioIds);
  const booking = focus?.booking ?? r.pick(w.bookings).id;
  const bal = balances.get(folio) ?? 0;
  const someAmount = (base: number) =>
    r.pick([base, Math.ceil(base / 2), base + 1, 5_000, 12_000].filter((x) => x > 0));
  const owesPenalty = !!m.folios.get(folio)?.lots.some((l) => l.meta.kind === 'penalty' && l.open > 0);
  const label = () =>
    owesPenalty
      ? r.pick(['no_show', 'no_show', undefined] as const)
      : r.pick([undefined, undefined, undefined, 'no_show', 'balance'] as const);
  const stayOfFolio = m.folios.get(folio)?.owner ?? '';
  // Mostly a card of the guest whose folio or booking it is (the interesting paths), sometimes anyone's.
  const folioGuest = w.stays.get(stayOfFolio)?.guest;
  const card =
    folioGuest !== undefined && r.chance(0.75)
      ? r.pick(w.cards.filter((c) => c.guest === folioGuest))
      : r.pick(w.cards);
  const businessKey = newId();
  const weights: Array<[string, number]> = [
    ['owe', 3],
    ['card_charge', 4],
    ['hold', 2.5],
    ['capture', 2.5],
    ['increment', 0.8],
    ['link', 1.2],
    ['cash', 2],
    ['apply_deposit', 1.5],
    ['forfeit', 1.2],
    ['transfer_item', 3],
    ['transfer_amount', 1],
    ['route', 1],
    ['refund', 1.5],
    ['credit', 1.5],
    ['write_off', 0.5],
    ['no_show', 1],
    ['cancel', 0.8],
    ['add_stay', 0.6],
  ];
  const total = weights.reduce((n, [, x]) => n + x, 0);
  let roll = r.next() * total;
  let name = 'owe';
  for (const [n, x] of weights) {
    roll -= x;
    if (roll <= 0) {
      name = n;
      break;
    }
  }
  const run = (ctx: RequestContext, fn: (tx: TxContext) => Promise<unknown>) => org.run(ctx, fn);
  switch (name) {
    case 'card_charge': {
      const toBooking = r.chance(0.2);
      const ref = toBooking
        ? { type: 'booking' as const, id: booking }
        : { type: 'folio' as const, id: folio };
      const due = m.due.get(booking) ?? 0;
      const amount = toBooking
        ? someAmount(Math.max(1, due - (m.received.get(booking) ?? 0)))
        : someAmount(Math.max(1, bal));
      const purpose = toBooking ? undefined : label();
      return {
        name,
        label: `${m.cardName(card.src)} charges ${amount} on ${ref.type === 'booking' ? m.bookingName(ref.id) : m.folioName(ref.id)}${purpose ? ` as ${purpose}` : ''}`,
        run: () =>
          payments.chargeNow(w.desk, {
            propertyId: w.k.id,
            methodId: card.id,
            amount: usd(amount),
            ref,
            ...(purpose ? { purpose } : {}),
            businessKey,
          }),
      };
    }
    case 'hold': {
      const toBooking = r.chance(0.3);
      const ref = toBooking
        ? { type: 'booking' as const, id: booking }
        : { type: 'folio' as const, id: folio };
      const amount = r.pick([10_000, 25_000, 60_000, Math.max(1, bal)]);
      return {
        name,
        label: `${m.cardName(card.src)} holds ${amount} on ${ref.type === 'booking' ? m.bookingName(ref.id) : m.folioName(ref.id)}`,
        run: async () => {
          const a = await run(w.desk, (tx) =>
            payments.tx.authorize(tx, {
              propertyId: w.k.id,
              methodId: card.id,
              amount: usd(amount),
              ref,
              businessKey,
            }),
          );
          await payments.settle(w.desk, { type: 'authorization', id: (a as { id: string }).id });
        },
      };
    }
    case 'capture':
    case 'increment': {
      const holds = await q(sql<{
        id: string;
        method_id: string;
        amount: number;
        captured: number;
        ref_id: string;
      }>`
        select id, method_id, amount_minor::int as amount, captured_minor::int as captured, ref_id
          from payments.authorizations
         where method_id in (${sql.join(w.cards.map((c) => c.id))}) and status in ('authorized', 'partially_captured')`);
      if (holds.length === 0) return generate(r, w, m, focus);
      const h = holds.find((x) => x.ref_id === folio || x.ref_id === booking) ?? r.pick(holds);
      const holder = w.cards.find((c) => c.id === h.method_id) as Card;
      if (name === 'increment') {
        const extra = r.pick([5_000, 20_000]);
        return {
          name,
          label: `${m.cardName(holder.src)}'s hold ${h.id.slice(-6)} increased by ${extra}`,
          run: async () => {
            await run(w.desk, (tx) =>
              payments.tx.increment(tx, { authorizationId: h.id, additionalAmount: usd(extra) }),
            );
            await payments.settle(w.desk, { type: 'authorization', id: h.id });
          },
        };
      }
      const left = h.amount - h.captured;
      const amount = r.pick([left, Math.ceil(left / 2), Math.max(1, bal), Math.max(1, Math.min(left, bal))]);
      const ledgerRef = r.chance(0.3) ? { type: 'folio' as const, id: r.pick(folioIds) } : undefined;
      const purpose = label();
      return {
        name,
        label: `${m.cardName(holder.src)}'s hold ${h.id.slice(-6)} captured for ${amount}${ledgerRef ? ` onto ${m.folioName(ledgerRef.id)}` : ''}${purpose ? ` as ${purpose}` : ''}`,
        run: async () => {
          await run(w.desk, (tx) =>
            payments.tx.capture(tx, {
              authorizationId: h.id,
              amount: usd(amount),
              ...(ledgerRef ? { ledgerRef } : {}),
              ...(purpose ? { purpose } : {}),
              businessKey,
            }),
          );
          await payments.settle(w.desk, { type: 'authorization', id: h.id });
        },
      };
    }
    case 'link': {
      const toBooking = r.chance(0.35);
      const due = Math.max(0, (m.due.get(booking) ?? 0) - (m.received.get(booking) ?? 0));
      const amount = toBooking ? someAmount(Math.max(1, due)) : someAmount(Math.max(1, bal));
      const ref = toBooking
        ? { type: 'booking' as const, id: booking }
        : { type: 'folio' as const, id: folio };
      const guest = w.guests[w.bookings.find((b) => b.id === booking)?.guest ?? 0] as string;
      return {
        name,
        label: `payment link for ${amount} on ${ref.type === 'booking' ? m.bookingName(ref.id) : m.folioName(ref.id)} paid by the guest`,
        run: async () => {
          const req = await run(w.desk, (tx) =>
            payments.tx.createPaymentRequest(tx, {
              propertyId: w.k.id,
              payer: { type: 'guest_profile', id: guest, name: 'Guest' },
              amount: usd(amount),
              purpose: toBooking ? 'deposit' : 'balance',
              ref,
              expiresAt: new Date(s.clock.now().getTime() + 86_400_000).toISOString(),
              businessKey,
            }),
          );
          const id = (req as { id: string }).id;
          await payments.ensurePaymentLink(w.gm, id);
          await payments.simulateRequestPayment(w.gm, id);
          await payments.deliverSimulatorWebhooks(w.gm, w.simAccountId);
        },
      };
    }
    case 'cash': {
      if (bal <= 0) return generate(r, w, m, focus);
      const amount = r.pick([bal, Math.ceil(bal / 2)]);
      const method = r.pick(['cash', 'cheque'] as const);
      return {
        name,
        label: `${method} ${amount} on ${m.folioName(folio)}`,
        run: () =>
          run(w.desk, (tx) =>
            finance.collectPayment(tx, {
              folioId: folio,
              tenders: [{ method, amount: usd(amount), reference: `R-${businessKey.slice(-6)}` }],
              idempotencyKey: businessKey,
            }),
          ),
      };
    }
    case 'apply_deposit': {
      const amount = r.chance(0.4) ? undefined : someAmount(Math.max(1, bal));
      return {
        name,
        label: `deposit of ${m.bookingName(booking)} applied to ${m.folioName(folio)}${amount ? ` (${amount})` : ''}`,
        run: () =>
          run(w.gm, (tx) =>
            finance.applyDeposits(tx, {
              bookingId: booking,
              toFolioId: folio,
              ...(amount ? { amountMinor: amount } : {}),
              idempotencyKey: businessKey,
            }),
          ),
      };
    }
    case 'forfeit': {
      const amount = r.chance(0.4) ? undefined : r.pick([5_000, 10_000, 30_000, 100_000]);
      return {
        name,
        label: `deposit of ${m.bookingName(booking)} forfeited${amount ? ` (${amount})` : ''}`,
        run: () =>
          run(w.gm, (tx) =>
            finance.forfeitDeposit(tx, {
              bookingId: booking,
              chargeCode: 'CXL',
              ...(amount ? { amountMinor: amount } : {}),
              reason: 'Cancellation penalty',
              idempotencyKey: businessKey,
            }),
          ),
      };
    }
    case 'transfer_item': {
      const candidates = (
        await q(sql<{ id: string; folio_id: string; kind: string }>`
          select id, folio_id, kind from finance.postings
           where folio_id in (${sql.join(folioIds)}) and amount_minor <> 0
             and kind in ('charge', 'payment', 'refund', 'deposit_application', 'transfer_in')
             and parent_posting_id is null`)
      ).filter((p) => !focus || p.folio_id === focus.folio);
      if (candidates.length === 0) return generate(r, w, m, focus);
      // Interesting postings (money, refunds, moved items) are picked more often than plain charges.
      const weighted = candidates.flatMap((p) => (p.kind === 'charge' ? [p] : [p, p, p]));
      const p = r.pick(weighted);
      const dest = r.pick(folioIds.filter((x) => x !== p.folio_id));
      return {
        name,
        label: `${p.kind} ${p.id.slice(-6)} moved from ${m.folioName(p.folio_id)} to ${m.folioName(dest)}`,
        run: () =>
          run(w.gm, (tx) =>
            finance.transferPostings(tx, {
              fromFolioId: p.folio_id,
              toFolioId: dest,
              items: [{ postingId: p.id }],
              reason: 'Moved by the desk',
              idempotencyKey: businessKey,
            }),
          ),
      };
    }
    case 'transfer_amount': {
      if (bal === 0) return generate(r, w, m, focus);
      const dest = r.pick(folioIds.filter((x) => x !== folio));
      const amount = r.pick([Math.abs(bal), Math.ceil(Math.abs(bal) / 2)]);
      return {
        name,
        label: `${amount} of ${m.folioName(folio)}'s ${bal > 0 ? 'balance' : 'credit'} moved to ${m.folioName(dest)}`,
        run: () =>
          run(w.gm, (tx) =>
            finance.transferPostings(tx, {
              fromFolioId: folio,
              toFolioId: dest,
              amountMinor: amount,
              reason: 'Balance moved by the desk',
              idempotencyKey: businessKey,
            }),
          ),
      };
    }
    case 'route': {
      const owner = r.pick([...w.stays.keys()]);
      const dest = r.pick(folioIds.filter((x) => m.folios.get(x)?.owner !== owner));
      return {
        name,
        label: `charges of ${m.stayName(owner)} routed to ${m.folioName(dest)}`,
        run: () =>
          run(w.gm, (tx) =>
            finance.createBillingRule(tx, {
              propertyId: w.k.id,
              owner: { type: 'stay', id: owner },
              destinationFolioId: dest,
              label: 'Routed by the desk',
              selector: { chargeCodes: ['MISC'] },
            }),
          ),
      };
    }
    case 'refund': {
      const paidRows = await q(sql<{ id: string; left: number }>`
        select id, (amount_minor - refunded_minor)::int as left from payments.payments
         where method_id in (${sql.join(w.cards.map((c) => c.id))}) and status = 'succeeded'
           and amount_minor > refunded_minor`);
      if (paidRows.length === 0) return generate(r, w, m, focus);
      const p = r.pick(paidRows);
      const amount = r.pick([p.left, Math.ceil(p.left / 2)]);
      return {
        name,
        label: `card payment ${p.id.slice(-6)} refunded ${amount}`,
        run: async () => {
          const rf = await run(w.gm, (tx) =>
            payments.tx.refund(tx, {
              paymentId: p.id,
              amount: usd(amount),
              reason: 'Refund at the desk',
              businessKey,
            }),
          );
          await payments.settle(w.gm, { type: 'refund', id: (rf as { id: string }).id });
        },
      };
    }
    case 'credit':
    case 'write_off': {
      const charges = (
        await q(sql<{ id: string; folio_id: string }>`
          select id, folio_id from finance.postings where folio_id in (${sql.join(folioIds)})
             and kind = 'charge' and amount_minor > 0`)
      ).filter((p) => !focus || p.folio_id === focus.folio);
      if (charges.length === 0) return generate(r, w, m, focus);
      const p = r.pick(charges);
      const amountMinor = r.chance(0.5) ? undefined : r.pick([1_000, 5_000]);
      return {
        name,
        label: `${name === 'credit' ? 'goodwill credit' : 'write-off'} on charge ${p.id.slice(-6)}${amountMinor ? ` (${amountMinor})` : ''}`,
        run: () =>
          run(w.gm, (tx) =>
            finance.adjustPosting(tx, {
              postingId: p.id,
              ...(amountMinor ? { amountMinor } : {}),
              reasonCode: name === 'credit' ? 'goodwill' : 'write_off',
              note: name === 'credit' ? 'Goodwill credit' : 'Written off as uncollectable',
              idempotencyKey: businessKey,
            }),
          ),
      };
    }
    case 'no_show': {
      const stays = [...w.stays.entries()].filter(
        ([, v]) => w.bookings.find((b) => b.id === v.booking)?.arrival === '2027-03-10',
      );
      const [stayId] = r.pick(stays);
      return {
        name,
        label: `night audit marks ${m.stayName(stayId)} a no-show`,
        run: () =>
          run(w.auditor, (tx) => reservations.markNoShow(tx, { stayId, idempotencyKey: businessKey })),
      };
    }
    case 'cancel': {
      const stays = [...w.stays.keys()];
      const stayId = stays.includes(stayOfFolio) && r.chance(0.5) ? stayOfFolio : r.pick(stays);
      return {
        name,
        label: `${m.stayName(stayId)} cancelled`,
        run: async () => {
          const preview = await run(w.gm, (tx) =>
            reservations.previewChange(tx, { kind: 'cancel_stay', stayId } as never),
          );
          await reservations.commitChangeSafely(s.t.db, w.gm, {
            previewToken: (preview as { token: string }).token,
          });
        },
      };
    }
    case 'add_stay': {
      const b = w.bookings.find((x) => x.id === booking) as World['bookings'][number];
      return {
        name,
        label: `a stay added to ${m.bookingName(b.id)}`,
        run: async () => {
          const extra = bookingInput(w.k, {
            arrival: b.arrival,
            departure: b.departure,
            type: 'WV',
            guestProfileId: w.guests[b.guest] as string,
          }).stays[0];
          const preview = await run(w.gm, (tx) =>
            reservations.previewChange(tx, { kind: 'add_stay', bookingId: b.id, stay: extra } as never),
          );
          await reservations.commitChangeSafely(s.t.db, w.gm, {
            previewToken: (preview as { token: string }).token,
          });
          const now = await run(w.gm, (tx) => reservations.getBooking(tx, b.id));
          for (const st of (now as Booking).stays) {
            if (w.stays.has(st.id)) continue;
            w.stays.set(st.id, { booking: b.id, guest: b.guest });
            w.bookingStays.set(b.id, [...(w.bookingStays.get(b.id) ?? []), st.id]);
            await openStayFolio(w, st.id, w.guests[b.guest] as string);
          }
        },
      };
    }
    default: {
      const stays = [...w.stays.keys()];
      const stayId = stays.includes(stayOfFolio) && r.chance(0.7) ? stayOfFolio : r.pick(stays);
      const amount = r.pick([5_000, 12_000, 20_000]);
      return {
        name: 'owe',
        label: `${amount} posted to ${m.stayName(stayId)}`,
        run: () =>
          run(w.desk, (tx) =>
            finance.postCharge(tx, {
              propertyId: w.k.id,
              target: { type: 'stay', id: stayId },
              chargeCode: 'MISC',
              amount: usd(amount),
              priceMode: 'inclusive',
              description: 'Dinner',
              serviceDate: '2027-03-10',
              sourceRef: { type: 'pos_check', id: newId() },
              idempotencyKey: `pos:${businessKey}`,
            }),
          ),
      };
    }
  }
}

async function refreshDue(m: Model) {
  for (const b of m.w.bookings) {
    const d = await org.run(org.setup, (tx) =>
      s.c.services.reservations.describeReference(tx, { type: 'booking', id: b.id }),
    );
    m.due.set(b.id, d?.depositDue?.amountMinor ?? 0);
  }
}

// ───────────────────────────── the sequences ─────────────────────────────

const outcomes = new Map<string, number>();
const failures: Array<{ seed: number; step: number; violations: string[] }> = [];
let sequencesRun = 0;
let unpostedRefunds = 0;
const unpostedReasons = new Set<string>();
let concurrentSteps = 0;
let stepsRun = 0;

async function runSequence(seed: number) {
  const r = prng(seed);
  const w = await buildWorld();
  const m = new Model(w);
  await refreshDue(m);
  await m.sync();
  const log: string[] = [];
  const history: string[] = [];
  for (let step = 1; step <= STEPS; step++) {
    const concurrent = r.chance(CONCURRENT_SHARE);
    if (concurrent) concurrentSteps += 1;
    const ops: Op[] = [];
    if (concurrent) {
      const folio = r.pick([...m.folios.keys()]);
      const owner = m.folios.get(folio)?.owner ?? '';
      const booking = w.stays.get(owner)?.booking ?? r.pick(w.bookings).id;
      ops.push(await generate(r, w, m, { folio, booking }));
      ops.push(await generate(r, w, m, { folio, booking }));
    } else {
      ops.push(await generate(r, w, m));
    }
    const results = await Promise.all(ops.map((op) => settle(op.run())));
    const drained = await settle(s.drain());
    for (const [i, op] of ops.entries()) {
      const res = results[i] as Awaited<ReturnType<typeof settle>>;
      const code = res.ok ? 'accepted' : (res.e.code ?? `error: ${String(res.e.message).slice(0, 80)}`);
      outcomes.set(`${op.name} → ${code}`, (outcomes.get(`${op.name} → ${code}`) ?? 0) + 1);
      log.push(`${step}${concurrent ? `.${i + 1} (concurrent)` : ''}: ${op.label} → ${code}`);
      // An operation that fails without a stable error code crashed (a 500 to the user): a defect in itself.
      if (!res.ok && !res.e.code) m.violations.push(`(error) ${op.label} crashed: ${res.e.message}`);
    }
    if (!drained.ok) log.push(`${step}: event delivery failed: ${drained.e.message}`);
    // A deposit is judged against what was due when it landed: during a step that changed a stay, the larger of the
    // deposit due before and after; from the next step on, what is due now.
    const dueBefore = new Map(m.due);
    if (ops.some((op) => ['add_stay', 'cancel', 'no_show'].includes(op.name))) await refreshDue(m);
    const dueAfter = new Map(m.due);
    for (const [b, v] of dueBefore) m.due.set(b, Math.max(v, dueAfter.get(b) ?? 0));
    const before = m.snapshot();
    await m.sync();
    let violations = await checkInvariants(m);
    if (violations.length > 0 && concurrent) {
      // The ids do not show which of two concurrent commits came first: the step passes if either order explains it.
      const first = { state: m.snapshot(), trace: m.trace };
      m.restore(before);
      await m.sync(1);
      const other = await checkInvariants(m);
      if (other.length === 0) violations = other;
      else {
        m.restore(first.state);
        m.trace = first.trace;
      }
    }
    m.due = dueAfter;
    for (const t of m.trace) history.push(`${step}: ${t}`);
    stepsRun += 1;
    if (violations.length > 0) {
      failures.push({ seed, step, violations });
      throw new Error(
        `seed ${seed} broke the money invariant at step ${step}:\n  ${violations.join('\n  ')}\n\nsequence:\n  ${log.join('\n  ')}\n\nlast ledger postings:\n  ${history.slice(-30).join('\n  ')}`,
      );
    }
  }
  const report = await org.run(org.setup, (tx) =>
    s.c.services.finance.integrityReport(tx, w.k.legalEntityId),
  );
  expect(report.checks.filter((c) => !c.ok)).toEqual([]);
  unpostedRefunds += m.unpostedRefunds;
  sequencesRun += 1;
}

describe('money invariant — seeded model-based sequences over the real composition (ADR-0015 Amendment 6)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: ${STEPS} random money operations keep (a) card coverage, (b) one collection per obligation, (c) a balanced ledger`, async () => {
      await runSequence(seed);
    }, 600_000);
  }
  afterAll(() => {
    const lines = [...outcomes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}: ${v}`);
    const report = `money invariant: ${sequencesRun} sequences passed, ${stepsRun} steps (${concurrentSteps} concurrent), ${unpostedRefunds} refund(s) left for staff to post${unpostedReasons.size ? ` (${[...unpostedReasons].join('; ')})` : ''}, ${failures.length} failing seed(s)${failures.length ? `: ${failures.map((f) => `${f.seed}@${f.step}`).join(', ')}` : ''}\n${lines.join('\n')}`;
    if (process.env.MONEY_REPORT) writeFileSync(process.env.MONEY_REPORT, `${report}\n`);
  });
});
