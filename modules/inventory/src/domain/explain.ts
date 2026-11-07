import type { LocalDate } from '@portico/kernel';
import {
  type CellCounts,
  type CellStatus,
  type CompositeAvailability,
  cellStatus,
  overbookingInUse,
} from './availability';

/** Plural of a unit noun for human-readable explanations ("Villa" → "Villas", "Pitch" → "Pitches"). */
export function pluralize(noun: string, n: number): string {
  if (n === 1) return noun;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

const count = (n: number, noun: string) => `${n} ${pluralize(noun, n)}`;

export interface BlockedUnitFact {
  number: string;
  reason: string;
  /** First night the unit is back (exclusive end of the block). */
  until: LocalDate;
}

export interface ExplanationFacts {
  typeName: string;
  noun: string;
  date: LocalDate;
  counts: CellCounts;
  available: number;
  inactiveUnits: number;
  outOfOrder: readonly BlockedUnitFact[];
  outOfService: readonly BlockedUnitFact[];
  houseUse: readonly BlockedUnitFact[];
  sold: {
    stays: number;
    assignedStays: number;
    houseUse: number;
    blockAllocations: number;
    compositeComponents: number;
    imports: number;
  };
  holds: ReadonlyArray<{ refLabel: string; quantity: number; expiresAt: string }>;
  allowances: ReadonlyArray<{
    quantity: number;
    reason: string;
    authorizedBy: string;
    kind: 'standing' | 'ad_hoc';
  }>;
  conflict: { shortfall: number; status: string; detectedAt: string } | null;
  composite:
    | (CompositeAvailability & { totalUnits: number; freeUnits: number; componentNotes: string[] })
    | null;
}

export interface ExplanationText {
  status: CellStatus;
  headline: string;
  formula: string;
  reasons: string[];
}

/** Turn the facts behind one availability number into sentences a desk agent can act on (brief §4 "why"). */
export function explain(f: ExplanationFacts): ExplanationText {
  const c = f.counts;
  const reasons: string[] = [];
  const noun = f.noun;
  const status = cellStatus(c, f.available);

  reasons.push(
    `${count(c.capacity, noun)} ${c.capacity === 1 ? 'is' : 'are'} in inventory for ${f.typeName} on the night of ${f.date}.` +
      (f.inactiveUnits > 0
        ? ` ${count(f.inactiveUnits, noun)} inactive or not yet open ${f.inactiveUnits === 1 ? 'is' : 'are'} not counted.`
        : ''),
  );

  if (f.outOfOrder.length > 0) {
    reasons.push(
      `${f.outOfOrder.length} out of order and not sellable: ${f.outOfOrder
        .map((u) => `${noun} ${u.number} — ${u.reason} (back on ${u.until})`)
        .join('; ')}.`,
    );
  }
  if (f.outOfService.length > 0) {
    reasons.push(
      `${f.outOfService.length} out of service — still counted as sellable but cannot be assigned: ${f.outOfService
        .map((u) => `${noun} ${u.number} — ${u.reason} (until ${u.until})`)
        .join('; ')}.`,
    );
  }

  const s = f.sold;
  if (c.sold > 0) {
    const parts: string[] = [];
    if (s.stays > 0) {
      const unassigned = s.stays - s.assignedStays;
      parts.push(
        `${s.stays} for stays` +
          (unassigned > 0
            ? ` (${s.assignedStays} assigned to a ${noun.toLowerCase()}, ${unassigned} not yet assigned)`
            : ''),
      );
    }
    if (s.houseUse > 0)
      parts.push(
        `${s.houseUse} house use (${f.houseUse.map((u) => `${noun} ${u.number}: ${u.reason}`).join('; ')})`,
      );
    if (s.blockAllocations > 0) parts.push(`${s.blockAllocations} allocated to group blocks`);
    if (s.compositeComponents > 0)
      parts.push(`${s.compositeComponents} sold as part of combined units (e.g. multi-bedroom residences)`);
    if (s.imports > 0) parts.push(`${s.imports} imported from a previous system`);
    reasons.push(`${c.sold} sold: ${parts.join(', ')}.`);
  } else {
    reasons.push('Nothing is sold yet.');
  }

  if (f.holds.length > 0) {
    reasons.push(
      `${c.held} held temporarily: ${f.holds
        .map((h) => `${h.quantity} for ${h.refLabel} until ${h.expiresAt}`)
        .join('; ')}. Holds are released automatically when they expire.`,
    );
  }

  if (c.overbookingAllowance > 0) {
    const inUse = overbookingInUse(c);
    reasons.push(
      `Authorized overbooking allows ${c.overbookingAllowance} more (${f.allowances
        .map(
          (a) =>
            `${a.quantity} ${a.kind === 'ad_hoc' ? 'for one sale' : 'standing'}, authorized by ${a.authorizedBy}: "${a.reason}"`,
        )
        .join('; ')}); ${inUse} ${inUse === 1 ? 'is' : 'are'} in use. This is deliberate, not a conflict.`,
    );
  }

  const formula = `${c.capacity} capacity − ${c.outOfOrder} out of order − ${c.sold} sold − ${c.held} held + ${c.overbookingAllowance} authorized overbooking = ${f.available}`;

  let headline: string;
  if (f.composite) {
    const k = f.composite;
    reasons.push(
      `${count(k.totalUnits, noun)} exist; ${k.freeUnits} ${k.freeUnits === 1 ? 'is' : 'are'} fully free (no component assigned or blocked)` +
        (c.held > 0 ? `, ${c.held} held` : '') +
        `, so the units themselves allow ${k.unitLimit}.`,
    );
    reasons.push(...k.componentNotes);
  }

  switch (status) {
    case 'closed':
      headline = `No ${pluralize(noun, 2).toLowerCase()} of this type exist on ${f.date}.`;
      break;
    case 'available':
      headline = `${count(f.available, noun)} available.`;
      break;
    case 'sold_out':
      headline = `Sold out — 0 ${pluralize(noun, 2).toLowerCase()} available.`;
      break;
    case 'overbooked':
      headline =
        f.available > 0
          ? `${count(f.available, noun)} available within authorized overbooking.`
          : `Sold out including authorized overbooking.`;
      break;
    case 'oversold':
      headline = `Oversold by ${-f.available} beyond authorization — inventory conflict needs resolution.`;
      break;
  }
  if (f.conflict) {
    reasons.push(
      `Inventory conflict ${f.conflict.status} since ${f.conflict.detectedAt}: short by ${f.conflict.shortfall}. Resolve it by relocating, upgrading or moving a stay, restoring a unit to service, or authorizing overbooking.`,
    );
  }
  return {
    status,
    headline,
    formula: f.composite ? compositeFormula(f.composite, f.available) : formula,
    reasons,
  };
}

function compositeFormula(k: CompositeAvailability, available: number): string {
  return k.componentLimit === null
    ? `${k.unitLimit} free combined units = ${available}`
    : `min(${k.unitLimit} free combined units, ${k.componentLimit} allowed by component availability) = ${available}`;
}
