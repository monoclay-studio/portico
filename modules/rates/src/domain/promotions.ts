/**
 * Promotions applied on top of a plan's nightly prices (pure, RAT-R11/R12). Whole-stay conditions (booking
 * window, advance, length of stay, channel, unit type, plan, promo code) decide eligibility; stay window and
 * blackout dates apply per night. At most one exclusive promotion applies; stackable promotions combine only
 * with promotions they list (either direction). The combination with the largest discount wins (ties: codes).
 */
import { Decimal, diffDays, type LocalDate } from '@portico/kernel';
import type { PromotionConditions, PromotionDiscount, PromotionEffect } from '../contracts';

export interface PromotionCandidate {
  id: string;
  version: number;
  code: string;
  name: string;
  discount: PromotionDiscount;
  conditions: PromotionConditions;
  combinability: 'exclusive' | 'stackable';
  stackableWith: string[];
  sequence: number;
}

export interface PromotionContext {
  arrival: LocalDate;
  departure: LocalDate;
  nights: number;
  bookingDate: LocalDate;
  channelId?: string | undefined;
  unitTypeId: string;
  ratePlanId: string;
  promoCode?: string | undefined;
}

export function isEligible(p: PromotionCandidate, ctx: PromotionContext): boolean {
  const c = p.conditions;
  if (c.promoCode && c.promoCode.toUpperCase() !== (ctx.promoCode ?? '').toUpperCase()) return false;
  const advance = diffDays(ctx.bookingDate, ctx.arrival);
  if (c.minAdvanceDays !== undefined && advance < c.minAdvanceDays) return false;
  if (c.maxAdvanceDays !== undefined && advance > c.maxAdvanceDays) return false;
  if (c.minNights !== undefined && ctx.nights < c.minNights) return false;
  if (c.maxNights !== undefined && ctx.nights > c.maxNights) return false;
  if (c.bookingWindow?.from && ctx.bookingDate < c.bookingWindow.from) return false;
  if (c.bookingWindow?.to && ctx.bookingDate > c.bookingWindow.to) return false;
  if (c.channels && !c.channels.includes(ctx.channelId ?? 'direct')) return false;
  if (c.unitTypeIds && !c.unitTypeIds.includes(ctx.unitTypeId)) return false;
  if (c.ratePlanIds && !c.ratePlanIds.includes(ctx.ratePlanId)) return false;
  return true;
}

function nightEligible(p: PromotionCandidate, date: LocalDate): boolean {
  const c = p.conditions;
  if (c.blackoutDates.includes(date)) return false;
  if (c.stayWindow?.from && date < c.stayWindow.from) return false;
  if (c.stayWindow?.to && date > c.stayWindow.to) return false;
  return true;
}

export interface NightAmount {
  date: LocalDate;
  amountMinor: number;
}

interface Applied {
  effects: Map<LocalDate, Array<Omit<PromotionEffect, 'discount'> & { discountMinor: number }>>;
  totalDiscount: number;
  amounts: Map<LocalDate, number>;
}

function applySet(set: readonly PromotionCandidate[], nights: readonly NightAmount[]): Applied {
  const amounts = new Map(nights.map((n) => [n.date, n.amountMinor]));
  const effects: Applied['effects'] = new Map();
  let total = 0;
  const push = (date: LocalDate, p: PromotionCandidate, kind: PromotionEffect['kind'], discountMinor: number, percent: string | null) => {
    if (discountMinor <= 0) return;
    amounts.set(date, (amounts.get(date) ?? 0) - discountMinor);
    total += discountMinor;
    effects.set(date, [
      ...(effects.get(date) ?? []),
      { promotionId: p.id, promotionVersion: p.version, code: p.code, kind, percent, discountMinor },
    ]);
  };
  for (const p of set) {
    const eligible = nights.filter((n) => nightEligible(p, n.date));
    const d = p.discount;
    if (d.kind === 'percent') {
      for (const n of eligible) {
        const running = amounts.get(n.date) ?? 0;
        push(n.date, p, 'percent', new Decimal(running).mul(d.percent).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(), d.percent);
      }
    } else if (d.kind === 'amount_per_night') {
      for (const n of eligible) push(n.date, p, 'amount_per_night', Math.min(amounts.get(n.date) ?? 0, d.amountMinor), null);
    } else {
      const free = Math.floor(eligible.length / d.stayNights) * d.freeNights;
      const ordered =
        d.which === 'last'
          ? [...eligible].sort((a, b) => (a.date < b.date ? 1 : -1))
          : [...eligible].sort((a, b) => (amounts.get(a.date) ?? 0) - (amounts.get(b.date) ?? 0) || (a.date < b.date ? 1 : -1));
      for (const n of ordered.slice(0, free)) push(n.date, p, 'free_night', amounts.get(n.date) ?? 0, null);
    }
  }
  return { effects, totalDiscount: total, amounts };
}

const combinable = (a: PromotionCandidate, b: PromotionCandidate) =>
  a.combinability === 'stackable' &&
  b.combinability === 'stackable' &&
  (a.stackableWith.includes(b.code) || b.stackableWith.includes(a.code));

export interface PromotionOutcome {
  chosen: PromotionCandidate[];
  effects: Map<LocalDate, Array<Omit<PromotionEffect, 'discount'> & { discountMinor: number }>>;
  amounts: Map<LocalDate, number>;
}

/** Pick and apply the best eligible combination. */
export function applyPromotions(
  candidates: readonly PromotionCandidate[],
  ctx: PromotionContext,
  nights: readonly NightAmount[],
): PromotionOutcome {
  const eligible = candidates
    .filter((p) => isEligible(p, ctx))
    .sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code));
  const sets: PromotionCandidate[][] = eligible.filter((p) => p.combinability === 'exclusive').map((p) => [p]);
  const stackables = eligible.filter((p) => p.combinability === 'stackable');
  for (const seed of stackables) {
    const group = [seed];
    for (const p of stackables) if (!group.includes(p) && group.every((g) => combinable(g, p))) group.push(p);
    sets.push(group.sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code)));
  }
  let best: { set: PromotionCandidate[]; applied: Applied } | null = null;
  for (const set of sets) {
    const applied = applySet(set, nights);
    if (applied.totalDiscount <= 0) continue;
    const key = set.map((p) => p.code).join('+');
    if (
      !best ||
      applied.totalDiscount > best.applied.totalDiscount ||
      (applied.totalDiscount === best.applied.totalDiscount && key < best.set.map((p) => p.code).join('+'))
    )
      best = { set, applied };
  }
  if (!best) return { chosen: [], effects: new Map(), amounts: new Map(nights.map((n) => [n.date, n.amountMinor])) };
  return { chosen: best.set, effects: best.applied.effects, amounts: best.applied.amounts };
}

/** Re-apply recorded per-night effects to a new base amount (occupancy change on an agreed night). */
export function reapplyEffects(
  baseMinor: number,
  effects: ReadonlyArray<Pick<PromotionEffect, 'kind' | 'percent'> & { discount: { amountMinor: number } }>,
): { amountMinor: number; discounts: number[] } {
  let running = baseMinor;
  const discounts: number[] = [];
  for (const e of effects) {
    let d = 0;
    if (e.kind === 'percent' && e.percent !== null)
      d = new Decimal(running).mul(e.percent).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    else if (e.kind === 'amount_per_night') d = Math.min(running, e.discount.amountMinor);
    else if (e.kind === 'free_night') d = running;
    running -= d;
    discounts.push(d);
  }
  return { amountMinor: running, discounts };
}
