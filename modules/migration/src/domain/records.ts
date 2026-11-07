/**
 * Canonical (source-neutral) migration records. Every source adapter — Portico template pack, SMB PMS exports,
 * the PMS simulator — normalizes into these shapes, so mapping, quality checks, import, delta detection and
 * reconciliation are written once. Amounts are integer minor units in the record's currency (CLAUDE.md §5).
 */
import { canonicalJson, type LocalDate, sha256Hex } from '@portico/kernel';

import { BOOKING_STATUSES, type BookingStatus, DATA_CLASSES, type DataClass } from '../vocabulary';

export { BOOKING_STATUSES, type BookingStatus, DATA_CLASSES, type DataClass };

export const DATA_CLASS_LABELS: Record<DataClass, string> = {
  unit_type: 'Unit types',
  unit: 'Units',
  rate_plan: 'Rate plans',
  guest: 'Guest profiles',
  reservation: 'Reservations',
  deposit: 'Deposits held',
  in_house_balance: 'In-house folio balances',
  ar_open_item: 'Receivables (open items)',
};

/** Classes that carry money: their mappings, exceptions and sign-off belong to finance (INT-R11, M5). */
export const FINANCIAL_CLASSES: ReadonlySet<DataClass> = new Set([
  'deposit',
  'in_house_balance',
  'ar_open_item',
]);

/** Statuses that hold inventory (future or current stays). History statuses never consume it. */
export const CONSUMING_STATUSES: ReadonlySet<BookingStatus> = new Set(['confirmed', 'tentative', 'in_house']);

export type Guarantee = 'card_at_previous_psp' | 'deposit' | 'company' | 'none' | 'unknown';

export interface TaxAmount {
  /** Source code (e.g. 'TGST', 'GREEN'). Kept as the source states it; never recomputed. */
  code: string;
  name: string;
  amountMinor: number;
}

export interface UnitTypeRecord {
  code: string;
  name: string;
  maxOccupancy: number | null;
  baseOccupancy: number | null;
}
export interface UnitRecord {
  number: string;
  unitTypeCode: string;
  name: string | null;
}
export interface RatePlanRecord {
  code: string;
  name: string;
  currency: string | null;
}
export interface GuestRecord {
  givenName: string | null;
  familyName: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  dateOfBirth: LocalDate | null;
  language: string | null;
  /** Consent flags are carried only when the source states them; never invented (M1). */
  marketingConsent: boolean | null;
}
export interface ReservationRecord {
  status: BookingStatus;
  /** Status exactly as the source wrote it (for the exception list and the archive). */
  sourceStatus: string;
  arrival: LocalDate;
  departure: LocalDate;
  unitTypeCode: string;
  unitNumber: string | null;
  /** Source key of the booker / main guest (guest data class), when the source links them. */
  guestKey: string | null;
  guestName: string;
  adults: number;
  children: number;
  ratePlanCode: string | null;
  currency: string;
  /** Agreed price per night as the source states it. Null when the source gives only a stay total. */
  nightly: Array<{ date: LocalDate; amountMinor: number }> | null;
  roomTotalMinor: number;
  taxes: TaxAmount[];
  /** True when roomTotal already includes the taxes (source declaration; never guessed). */
  taxInclusive: boolean;
  totalMinor: number;
  channel: { code: string; bookingId: string } | null;
  guarantee: Guarantee;
}
export interface DepositRecord {
  /** Source key of the reservation this deposit belongs to. */
  bookingKey: string;
  amountMinor: number;
  currency: string;
  /** Tax the previous system already declared on receipt (released, never declared twice). */
  taxDeclared: TaxAmount[];
  receivedOn: LocalDate | null;
}
export interface InHouseBalanceRecord {
  bookingKey: string;
  folioRef: string;
  chargesMinor: number;
  paymentsMinor: number;
  balanceMinor: number;
  currency: string;
}
export interface ArOpenItemRecord {
  accountCode: string;
  accountName: string;
  invoiceRef: string;
  invoiceDate: LocalDate;
  dueDate: LocalDate | null;
  openMinor: number;
  currency: string;
}

export interface PayloadByClass {
  unit_type: UnitTypeRecord;
  unit: UnitRecord;
  rate_plan: RatePlanRecord;
  guest: GuestRecord;
  reservation: ReservationRecord;
  deposit: DepositRecord;
  in_house_balance: InHouseBalanceRecord;
  ar_open_item: ArOpenItemRecord;
}

export interface Problem {
  code: string;
  severity: 'blocking' | 'warning';
  field?: string;
  message: string;
}

/**
 * One normalized source record. `key` is the source's own identifier within its class. `payload` is null when the
 * row could not be read (then `raw` keeps the cells for the exception list); such a record is never imported.
 */
export interface SourceRecord<C extends DataClass = DataClass> {
  dataClass: C;
  key: string;
  payload: PayloadByClass[C] | null;
  raw?: Record<string, string>;
  /** Where it came from (file + row, or API id) — shown in the exception list and searchable. */
  origin: { file: string; row: number | null };
  problems: Problem[];
}

export const hasBlocking = (r: { problems: readonly Problem[] }) =>
  r.problems.some((p) => p.severity === 'blocking');

/** Control totals the source reports (closing balances, counts) — the other side of reconciliation (S18). */
export interface ControlTotal {
  dataClass: DataClass;
  currency: string | null;
  count: number | null;
  amountMinor: number | null;
}

/** Content hash of a record payload: stable across key order, used for delta detection and idempotency. */
export function contentHash(payload: unknown): string {
  return sha256Hex(canonicalJson(payload)).slice(0, 32);
}

/** Natural key of a unit: number is unique per property. */
export const unitKey = (number: string) => number.trim().toUpperCase();
/** Natural key of a deposit / in-house balance: one per booking (and folio). */
export const depositKey = (bookingKey: string) => bookingKey;
export const inHouseKey = (bookingKey: string, folioRef: string) => `${bookingKey}#${folioRef}`;
export const arKey = (accountCode: string, invoiceRef: string) => `${accountCode}#${invoiceRef}`;
