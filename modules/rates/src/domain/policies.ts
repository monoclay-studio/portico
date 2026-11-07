/**
 * Cancellation, guarantee and deposit policies (pure, RAT-R18..R21). Deadlines are relative to arrival in the
 * PROPERTY's time zone; text is generated from the structure (never free text alone).
 */
import { addDays, currencyExponent, Decimal, type LocalDate, toMajor } from '@portico/kernel';
import type {
  CancellationStructure,
  Deadline,
  DepositStructure,
  GuaranteeStructure,
  Penalty,
  ScheduleInstance,
} from '../contracts';
import { laterDate } from './calendar';

// ───────────────────────────── Time zones ─────────────────────────────

function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant at which the wall-clock `date time` occurs in `timeZone` (DST-safe for existing times). */
export function zonedInstant(date: LocalDate, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let result = guess - tzOffsetMs(guess, timeZone);
  const second = guess - tzOffsetMs(result, timeZone);
  if (second !== result) result = second;
  return new Date(result);
}

/** Wall-clock 'YYYY-MM-DD HH:MM' of an instant in a time zone. */
export function formatLocal(instant: Date, timeZone: string): string {
  const off = tzOffsetMs(instant.getTime(), timeZone);
  return new Date(instant.getTime() + off).toISOString().slice(0, 16).replace('T', ' ');
}

export function formatAmount(amountMinor: number, currency: string): string {
  return `${currency} ${toMajor({ amountMinor, currency }).toFixed(currencyExponent(currency))}`;
}

// ───────────────────────────── Cancellation ─────────────────────────────

export interface StayTiming {
  arrival: LocalDate;
  timeZone: string;
  /** Property check-in time 'HH:MM'. */
  checkInTime: string;
}

export function deadlineInstant(d: Deadline, t: StayTiming): Date | null {
  if (d.kind === 'at_booking') return null;
  if (d.kind === 'days_before_arrival') return zonedInstant(addDays(t.arrival, -d.days), d.time, t.timeZone);
  return new Date(zonedInstant(t.arrival, t.checkInTime, t.timeZone).getTime() - d.hours * 3_600_000);
}

export function penaltyText(p: Penalty, currency: string): string {
  switch (p.kind) {
    case 'none':
      return 'no charge';
    case 'first_night':
      return 'the first night is charged';
    case 'nights':
      return p.nights === 1 ? '1 night is charged' : `${p.nights} nights are charged`;
    case 'percent_of_stay':
      return `${p.percent}% of the stay is charged`;
    case 'amount':
      return `${formatAmount(p.amountMinor, currency)} is charged`;
  }
}

function deadlineText(d: Deadline): string {
  if (d.kind === 'at_booking') return 'from booking';
  if (d.kind === 'days_before_arrival')
    return `from ${d.days} day${d.days === 1 ? '' : 's'} before arrival (${d.time} property time)`;
  return `from ${d.hours} hour${d.hours === 1 ? '' : 's'} before check-in time on the arrival day`;
}

function sortedTiers(s: CancellationStructure, t?: StayTiming) {
  return [...s.tiers].sort((a, b) => {
    const rank = (d: Deadline) =>
      d.kind === 'at_booking'
        ? Number.NEGATIVE_INFINITY
        : t
          ? (deadlineInstant(d, t)?.getTime() ?? 0)
          : d.kind === 'days_before_arrival'
            ? -d.days * 24
            : -d.hours;
    return rank(a.from) - rank(b.from);
  });
}

/** Policy text from structure (generic, not stay-specific). */
export function renderCancellationText(s: CancellationStructure, currency: string): string {
  const tiers = sortedTiers(s);
  const parts: string[] = [];
  if (tiers.length === 0) parts.push('Free cancellation at any time before arrival.');
  else if (tiers[0]?.from.kind === 'at_booking' && tiers.length === 1 && tiers[0].penalty.kind !== 'none')
    parts.push(`Non-refundable: ${penaltyText(tiers[0].penalty, currency)} if cancelled.`);
  else {
    const first = tiers[0];
    if (first && first.from.kind !== 'at_booking') parts.push('Free cancellation until the first deadline.');
    for (const tier of tiers) {
      const text = deadlineText(tier.from);
      parts.push(`${text.charAt(0).toUpperCase()}${text.slice(1)}: ${penaltyText(tier.penalty, currency)}.`);
    }
  }
  parts.push(`No-show: ${penaltyText(s.noShow, currency)}.`);
  if (s.earlyDeparture.kind !== 'none')
    parts.push(`Early departure: ${penaltyText(s.earlyDeparture, currency)}.`);
  return parts.join(' ');
}

export interface ResolvedTier {
  fromInstant: string | null;
  penalty: Penalty;
  description: string;
}

/** Tiers with absolute instants for a stay, plus stay-specific text. */
export function resolveCancellationTiers(
  s: CancellationStructure,
  t: StayTiming,
  currency: string,
): ResolvedTier[] {
  return sortedTiers(s, t).map((tier) => {
    const at = deadlineInstant(tier.from, t);
    return {
      fromInstant: at ? at.toISOString() : null,
      penalty: tier.penalty,
      description: at
        ? `From ${formatLocal(at, t.timeZone)} (${t.timeZone}): ${penaltyText(tier.penalty, currency)}.`
        : `From booking: ${penaltyText(tier.penalty, currency)}.`,
    };
  });
}

/** The tier in force at an instant (latest tier whose deadline has passed), or null = free cancellation. */
export function tierInForce(tiers: readonly ResolvedTier[], at: Date): ResolvedTier | null {
  let found: ResolvedTier | null = null;
  for (const tier of tiers)
    if (tier.fromInstant === null || Date.parse(tier.fromInstant) <= at.getTime()) found = tier;
  return found;
}

/** Penalty amount over the given nights (ordered by date) in minor units. */
export function penaltyAmount(p: Penalty, nights: ReadonlyArray<{ amountMinor: number }>): number {
  const total = nights.reduce((s, n) => s + n.amountMinor, 0);
  switch (p.kind) {
    case 'none':
      return 0;
    case 'first_night':
      return nights[0]?.amountMinor ?? 0;
    case 'nights':
      return nights.slice(0, p.nights).reduce((s, n) => s + n.amountMinor, 0);
    case 'percent_of_stay':
      return new Decimal(total).mul(p.percent).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    case 'amount':
      return Math.min(total, p.amountMinor);
  }
}

// ───────────────────────────── Guarantee & deposit ─────────────────────────────

export function renderGuaranteeText(s: GuaranteeStructure): string {
  const labels: Record<string, string> = {
    none: 'no guarantee',
    card: 'a card on file',
    deposit: 'a deposit',
    company: 'a company guarantee',
    agency: 'an agency guarantee',
    prepaid_channel: 'prepayment through the booking channel',
  };
  const accepted = s.accepted.map((k) => labels[k] ?? k).join(' or ');
  return `Guaranteed by ${accepted}.${s.holdUntil ? ` Non-guaranteed bookings are held until ${s.holdUntil} property time on the arrival day.` : ''}`;
}

export function renderDepositText(s: DepositStructure, currency: string): string {
  if (s.items.length === 0) return 'No deposit required; pay at the property.';
  return s.items
    .map((i) => {
      const amount =
        i.amount.basis === 'percent'
          ? `${i.amount.percent}% of the stay`
          : i.amount.basis === 'nights'
            ? `${i.amount.nights} night${i.amount.nights === 1 ? '' : 's'}`
            : i.amount.basis === 'amount'
              ? formatAmount(i.amount.amountMinor, currency)
              : 'the remaining balance';
      const when =
        i.due.offsetDays === 0
          ? `at ${i.due.anchor}`
          : `${Math.abs(i.due.offsetDays)} days ${i.due.offsetDays < 0 ? 'before' : 'after'} ${i.due.anchor}`;
      return `${i.kind === 'preauthorization' ? 'Pre-authorization' : i.kind === 'balance' ? 'Balance' : 'Deposit'} of ${amount} ${when}.`;
    })
    .join(' ');
}

/** Payment schedule instance for a stay (RAT-R20): amounts never exceed the total; due dates never before booking. */
export function instantiateSchedule(
  s: DepositStructure,
  c: {
    bookingDate: LocalDate;
    arrival: LocalDate;
    departure: LocalDate;
    nightsGrossMinor: readonly number[];
    totalGrossMinor: number;
    currency: string;
  },
): ScheduleInstance[] {
  let scheduled = 0;
  return s.items.map((i) => {
    const remaining = c.totalGrossMinor - scheduled;
    let amount: number;
    switch (i.amount.basis) {
      case 'percent':
        amount = new Decimal(c.totalGrossMinor)
          .mul(i.amount.percent)
          .div(100)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toNumber();
        break;
      case 'nights':
        amount = c.nightsGrossMinor.slice(0, i.amount.nights).reduce((x, y) => x + y, 0);
        break;
      case 'amount':
        amount = i.amount.amountMinor;
        break;
      case 'remaining':
        amount = remaining;
        break;
    }
    amount = Math.max(0, Math.min(amount, remaining));
    // A pre-authorization holds funds; it is not collected, so it does not reduce what remains to schedule.
    if (i.kind !== 'preauthorization') scheduled += amount;
    const anchor =
      i.due.anchor === 'booking' ? c.bookingDate : i.due.anchor === 'arrival' ? c.arrival : c.departure;
    const due = addDays(anchor, i.due.offsetDays);
    return {
      kind: i.kind,
      dueDate: laterDate(due, c.bookingDate),
      amount: { amountMinor: amount, currency: c.currency },
      method: i.method,
      onOverdue: i.onOverdue,
    };
  });
}
