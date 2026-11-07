import type { LocalDate } from '@portico/kernel';

/** The ledger terms of one (unit type, night) cell. */
export interface CellCounts {
  capacity: number;
  outOfOrder: number;
  sold: number;
  held: number;
  overbookingAllowance: number;
}

/** Glossary formula: capacity − out of order − sold − held + authorized overbooking. May be negative. */
export function availableOf(c: CellCounts): number {
  return c.capacity - c.outOfOrder - c.sold - c.held + c.overbookingAllowance;
}

/** What is left of the physical inventory, ignoring overbooking allowances. Negative = selling into allowance. */
export function physicalRemaining(c: CellCounts): number {
  return c.capacity - c.outOfOrder - c.sold - c.held;
}

/** Portion of the authorized allowance currently used. */
export function overbookingInUse(c: CellCounts): number {
  return Math.min(c.overbookingAllowance, Math.max(0, -physicalRemaining(c)));
}

/** Units sold beyond capacity AND beyond authorization (an inventory conflict when > 0). */
export function oversoldBy(c: CellCounts): number {
  return Math.max(0, -availableOf(c));
}

export type CellStatus =
  /** No units exist for this type on this night. */
  | 'closed'
  | 'available'
  | 'sold_out'
  /** Selling into an authorized overbooking allowance (amber, deliberate). */
  | 'overbooked'
  /** Oversold beyond authorization — an inventory conflict that needs resolution (red, unintended). */
  | 'oversold';

export function cellStatus(c: CellCounts, available = availableOf(c)): CellStatus {
  if (available < 0) return 'oversold';
  if (c.capacity === 0 && c.sold === 0 && c.held === 0 && c.overbookingAllowance === 0) return 'closed';
  if (overbookingInUse(c) > 0) return 'overbooked';
  return available > 0 ? 'available' : 'sold_out';
}

export interface ShortNight {
  date: LocalDate;
  available: number;
}

/** Nights where `quantity` more units would not fit. `available` is reported as computed (can be negative). */
export function shortNights(
  cells: ReadonlyArray<{ night: LocalDate; available: number }>,
  quantity: number,
): ShortNight[] {
  return cells.filter((c) => c.available < quantity).map((c) => ({ date: c.night, available: c.available }));
}

/**
 * How many units an ad-hoc authorized overbooking must add to a night so that one sale of `quantity` is fully
 * authorized. Never authorizes an existing deficit retroactively (that stays an inventory conflict).
 */
export function adHocAllowanceNeeded(available: number, quantity: number): number {
  return Math.max(0, quantity - Math.max(available, 0));
}

// ───────────────────────────── Composite units ─────────────────────────────

export interface CompositeComponentTerm {
  unitTypeId: string;
  /** Number of components of this type in each composite unit (k_T). */
  perComposite: number;
  /** Availability of the component type on the night (glossary formula). */
  available: number;
}

export interface CompositeCellInput {
  /** Active composite units none of whose units (composite or components) is assigned or blocked on the night. */
  freeUnits: number;
  /** Active holds on the composite type. */
  held: number;
  /** Composite consumption without a composite assignment (only possible via onShortfall: record_conflict). */
  unassignedSold: number;
  components: readonly CompositeComponentTerm[];
}

export interface CompositeAvailability {
  available: number;
  /** freeUnits − held − unassignedSold: what the composite units themselves allow. */
  unitLimit: number;
  /** min over component types of floor(available_T / k_T); null when the type has no components yet. */
  componentLimit: number | null;
  limitingComponentTypeId: string | null;
}

/**
 * Spec INV-R07: available = min(freeComposites − heldComposite, min_T floor(available_T / k_T)).
 * Selling a component type therefore reduces composite availability, and selling a composite consumes k_T of
 * every component type, so the two views can never both sell the same physical unit.
 */
export function compositeAvailability(input: CompositeCellInput): CompositeAvailability {
  const unitLimit = input.freeUnits - input.held - input.unassignedSold;
  let componentLimit: number | null = null;
  let limiting: string | null = null;
  for (const c of input.components) {
    if (c.perComposite <= 0) continue;
    const limit = Math.floor(c.available / c.perComposite);
    if (componentLimit === null || limit < componentLimit) {
      componentLimit = limit;
      limiting = c.unitTypeId;
    }
  }
  const available = componentLimit === null ? unitLimit : Math.min(unitLimit, componentLimit);
  return {
    available,
    unitLimit,
    componentLimit,
    limitingComponentTypeId:
      limiting && componentLimit !== null && componentLimit < unitLimit ? limiting : null,
  };
}

// ───────────────────────────── Inventory conflicts ─────────────────────────────

export type ConflictResolution =
  | 'relocated'
  | 'upgraded'
  | 'moved_dates'
  | 'cancelled'
  | 'allowance_authorized'
  | 'capacity_restored'
  | 'other';

export type ConflictCauseKind =
  | 'consumption'
  | 'release'
  | 'consumption_change'
  | 'upgrade'
  | 'hold'
  | 'hold_closed'
  | 'block'
  | 'block_released'
  | 'capacity_change'
  | 'allowance_change'
  | 'assignment';

/** Which resolution kind a change records when it makes an oversold cell whole again. */
export function resolutionFor(kind: ConflictCauseKind): ConflictResolution {
  switch (kind) {
    case 'release':
    case 'hold_closed':
      return 'cancelled';
    case 'consumption_change':
      return 'moved_dates';
    case 'upgrade':
      return 'upgraded';
    case 'assignment':
      return 'relocated';
    case 'allowance_change':
      return 'allowance_authorized';
    case 'block_released':
    case 'capacity_change':
      return 'capacity_restored';
    default:
      return 'other';
  }
}

export type ConflictAction = 'none' | 'open' | 'update' | 'resolve';

/** Decide what to do with a cell's conflict record after a change (INV-I03: no oversold cell without one). */
export function conflictAction(hasOpenConflict: boolean, available: number): ConflictAction {
  if (available < 0) return hasOpenConflict ? 'update' : 'open';
  return hasOpenConflict ? 'resolve' : 'none';
}

// ───────────────────────────── Consumption changes ─────────────────────────────

export interface ConsumptionCell {
  unitTypeId: string;
  night: LocalDate;
  quantity: number;
}

export interface ConsumptionDiff {
  /** Cells the ref stops consuming (or consumes with a different quantity). */
  remove: ConsumptionCell[];
  /** Cells the ref starts consuming (or consumes with a different quantity). */
  add: ConsumptionCell[];
  /** Cells that stay exactly as they are (their assignments are kept). */
  keep: ConsumptionCell[];
}

/**
 * Minimal change between a ref's current and desired consumption. Cells that are unchanged are kept, so an
 * extension only touches the new nights and keeps the existing unit assignment (scenario 3).
 */
export function diffConsumption(
  current: readonly ConsumptionCell[],
  desired: readonly ConsumptionCell[],
): ConsumptionDiff {
  const key = (c: ConsumptionCell) => `${c.unitTypeId}|${c.night}`;
  const cur = new Map(current.map((c) => [key(c), c]));
  const want = new Map(desired.map((c) => [key(c), c]));
  const diff: ConsumptionDiff = { remove: [], add: [], keep: [] };
  for (const [k, c] of cur) {
    const w = want.get(k);
    if (!w) diff.remove.push(c);
    else if (w.quantity === c.quantity) diff.keep.push(c);
    else {
      diff.remove.push(c);
      diff.add.push(w);
    }
  }
  for (const [k, w] of want) if (!cur.has(k)) diff.add.push(w);
  return diff;
}
