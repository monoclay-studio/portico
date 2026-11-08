/**
 * ARI cell values (pure). Distribution never computes availability or prices: it receives them from inventory
 * (`sellable`) and rates (price + effective restrictions) and only decides WHAT TO PUBLISH (stop-sell closures)
 * and HOW TO PACK it (runs of equal values become one range).
 */
import { addDays, canonicalJson, type DateRange, type LocalDate } from '@portico/kernel';

export type AriKind = 'availability' | 'restrictions';
export const ARI_KINDS: readonly AriKind[] = ['availability', 'restrictions'];

export interface AvailabilityValue {
  availability: number;
}

export interface RestrictionValue {
  /** Price for the rate plan's base occupancy, in minor units; null when rates has no price for the night. */
  rateMinor: number | null;
  currency: string | null;
  stopSell: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minStayArrival: number | null;
  minStayThrough: number | null;
  maxStay: number | null;
}

export type CellValue = AvailabilityValue | RestrictionValue;

/** Why a published value differs from Portico's own figure. */
export type PublishReason = 'stop_sell' | 'protection' | 'no_price';

export interface AriCell {
  unitTypeId: string;
  ratePlanId: string | null;
  date: LocalDate;
  value: CellValue;
  reason?: PublishReason;
}

/** Effective restrictions as rates reports them (kinds distribution can publish; others are listed as not sent). */
export interface EffectiveRestrictionInput {
  closed?: boolean | null;
  closedToArrival?: boolean | null;
  closedToDeparture?: boolean | null;
  minLos?: number | null;
  minLosThrough?: number | null;
  maxLos?: number | null;
  minAdvanceDays?: number | null;
  maxAdvanceDays?: number | null;
  salesLimit?: number | null;
}

/** Restriction kinds Portico has but a hub restriction value cannot carry (shown to staff, never dropped silently). */
export const UNPUBLISHED_RESTRICTIONS = ['minAdvanceDays', 'maxAdvanceDays', 'salesLimit'] as const;

/**
 * The value to publish for a rate plan × unit type night. A night without a price is published CLOSED (stop-sell)
 * with no rate: Portico never invents a price.
 */
export function restrictionValueFrom(
  price: { amountMinor: number; currency: string } | null,
  r: EffectiveRestrictionInput,
): { value: RestrictionValue; reason?: PublishReason } {
  const value: RestrictionValue = {
    rateMinor: price ? price.amountMinor : null,
    currency: price ? price.currency : null,
    stopSell: r.closed === true || price === null,
    closedToArrival: r.closedToArrival === true,
    closedToDeparture: r.closedToDeparture === true,
    minStayArrival: r.minLos ?? null,
    minStayThrough: r.minLosThrough ?? null,
    maxStay: r.maxLos ?? null,
  };
  return price === null ? { value, reason: 'no_price' } : { value };
}

export interface ClosureState {
  /** A manual stop-sell covers this unit type and night. */
  manual: boolean;
  /** Stop-sell protection is active on the connection with this threshold. */
  protectionThreshold: number | null;
}

/** Availability to publish: a manual stop-sell closes; protection closes the last `threshold` units; never < 0. */
export function publishedAvailability(
  sellable: number,
  closure: ClosureState,
): { value: AvailabilityValue; reason?: PublishReason } {
  const safe = Math.max(0, Math.floor(sellable));
  if (closure.manual) return { value: { availability: 0 }, reason: 'stop_sell' };
  if (closure.protectionThreshold !== null && safe > 0 && safe <= closure.protectionThreshold) {
    return { value: { availability: 0 }, reason: 'protection' };
  }
  return { value: { availability: safe } };
}

export function sameValue(a: CellValue | null | undefined, b: CellValue | null | undefined): boolean {
  if (!a || !b) return a === b;
  return canonicalJson(a) === canonicalJson(b);
}

export interface Run<V> {
  from: LocalDate;
  /** Exclusive. */
  to: LocalDate;
  value: V;
}

/** Pack consecutive nights with identical values into ranges (one hub value per run). Input order is irrelevant. */
export function compressRuns<V extends CellValue>(
  cells: ReadonlyArray<{ date: LocalDate; value: V }>,
): Run<V>[] {
  const sorted = [...cells].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const runs: Run<V>[] = [];
  for (const c of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.to === c.date && sameValue(last.value, c.value)) {
      last.to = addDays(c.date, 1);
    } else {
      runs.push({ from: c.date, to: addDays(c.date, 1), value: c.value });
    }
  }
  return runs;
}

export type CellSyncState =
  | 'in_sync'
  | 'pending'
  | 'never_sent'
  | 'differs'
  | 'not_accepted'
  | 'pending_verification';

/**
 * Compare what Portico would publish now with what the channel last acknowledged (DST-R06).
 *  - pending: a change is queued or in flight for this cell;
 *  - not_accepted: the hub refused the last value sent for this cell (payload error);
 *  - differs: no pending work explains the difference — a discrepancy once older than the freshness target.
 */
export function compareCell(input: {
  expected: CellValue | null;
  acked: CellValue | null;
  pending: boolean;
  rejected: boolean;
  /** Sent in a message whose answer was not recognised, with no later acknowledgement (P2-3). */
  unverified?: boolean;
}): CellSyncState {
  if (input.pending) return 'pending';
  if (input.unverified) return 'pending_verification';
  if (input.rejected) return 'not_accepted';
  if (input.acked === null) return input.expected === null ? 'in_sync' : 'never_sent';
  return sameValue(input.expected, input.acked) ? 'in_sync' : 'differs';
}

/** The publication window: from the business date for `horizonDays` nights. */
export function publicationWindow(businessDate: LocalDate, horizonDays: number): DateRange {
  return { from: businessDate, to: addDays(businessDate, horizonDays) };
}

/**
 * The next full resync instant (P3-7). The default daily resync is anchored to a quiet hour of the PROPERTY's local
 * day (never "24 h after activation", which could fall on the morning peak); other intervals stay interval-based.
 * Always strictly later than `now` and at least one hour away.
 */
export function nextFullResyncAt(now: Date, timezone: string, everyHours: number, localHour: number): Date {
  if (everyHours !== 24) return new Date(now.getTime() + everyHours * 3_600_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  // Offset of the zone at `now` (minutes): local wall time read as UTC minus the instant.
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  const offsetMs = wallAsUtc - Math.floor(now.getTime() / 60_000) * 60_000;
  for (let day = 0; day < 3; day++) {
    const candidate = Date.UTC(get('year'), get('month') - 1, get('day') + day, localHour, 0) - offsetMs;
    if (candidate - now.getTime() >= 3_600_000) return new Date(candidate);
  }
  return new Date(now.getTime() + 24 * 3_600_000);
}
