/**
 * Source adapters ("source-adapter port"): one definition per source system or export format. A file adapter turns
 * uploaded CSV files / XLSX sheets into canonical records through column auto-detection plus the adapter's own
 * header hints; the simulator adapter converts a simulated PMS snapshot. Each adapter carries its source assessment
 * (INT-R29) with evidence labels from the research, and a verification status: every vendor layout is
 * **unverified** until a real sample export has been checked (no pilot hotel yet, D8).
 */

import type { TableKind } from '../domain/columns';
import type { DateOrder } from '../domain/normalize';
import type { DataClass } from '../domain/records';

export type SourceKind = 'file' | 'simulator';

export interface SourceAssessment {
  exportRoute: string;
  /** Who pays, never assumed zero. */
  fees: string;
  historyLimits: string;
  accessRestrictions: string;
  /** Stored cards stay with the current provider (re-collection by default, Q142). */
  paymentTokens: string;
  masking: string;
  evidence: string;
}

export interface SourceAdapter {
  key: string;
  label: string;
  vendor: string;
  kind: SourceKind;
  verification: 'verified' | 'unverified';
  verificationNote: string;
  /** Classes this source can provide (others may come from supplementary files, e.g. the finance pack). */
  provides: DataClass[];
  /** Assumed header → field per table kind (applied on top of auto-detection; unverified for vendor formats). */
  headerHints: Partial<Record<TableKind, Record<string, string>>>;
  /** Date order the vendor's exports are assumed to use when a column is ambiguous (still needs confirmation). */
  assumedDateOrder: DateOrder | null;
  assessment: SourceAssessment;
}

const REUSE_NOTE =
  'Column layout ASSUMED from public descriptions; no real export sample has been checked (no pilot hotel yet). Auto-detection still maps each column and asks when unsure.';

export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [
  {
    key: 'portico.pack.v1',
    label: 'Portico migration templates (CSV or Excel)',
    vendor: 'Portico',
    kind: 'file',
    verification: 'verified',
    verificationNote: 'Portico’s own template pack; verified against the templates it ships (tests).',
    provides: [
      'unit_type',
      'unit',
      'rate_plan',
      'guest',
      'reservation',
      'deposit',
      'in_house_balance',
      'ar_open_item',
    ],
    headerHints: {},
    assumedDateOrder: 'ymd',
    assessment: {
      exportRoute: 'The hotel fills Portico’s templates (from spreadsheets, paper or any system’s reports).',
      fees: 'None from Portico (Q143 default: migration included for planning; nothing published).',
      historyLimits: 'Whatever the hotel enters; future business first, history may follow.',
      accessRestrictions: 'None.',
      paymentTokens:
        'Never in files: a file containing a card number is refused and nothing from it is stored.',
      masking: 'Not expected; masked values are detected and refused as truth.',
      evidence: 'Portico template definition (this repository).',
    },
  },
  {
    key: 'littlehotelier.csv',
    label: 'Little Hotelier reservations export (CSV)',
    vendor: 'SiteMinder (Little Hotelier)',
    kind: 'file',
    verification: 'unverified',
    verificationNote: REUSE_NOTE,
    provides: ['reservation', 'guest'],
    headerHints: {
      reservations: {
        'Booking Reference': 'confirmation',
        'Check In': 'arrival',
        'Check Out': 'departure',
        'Room Type': 'unit_type_code',
        'Guest First Name': 'guest_given_name',
        'Guest Last Name': 'guest_family_name',
        'Total Room Charges': 'room_total',
        'Channel Booking ID': 'channel_booking_id',
      },
    },
    assumedDateOrder: 'dmy',
    assessment: {
      exportRoute: 'Reservations CSV export from the Little Hotelier back office [S, DD11 §3.6].',
      fees: 'Unconfirmed — ask the vendor ("quote required", never assumed zero).',
      historyLimits: 'At most 365 days per export [S]; search reaches back about 548 days [3P].',
      accessRestrictions: 'The SiteMinder channel-manager relationship must be ended or moved at cutover.',
      paymentTokens: 'Held by the current payment provider; not portable by file — re-collect (Q142).',
      masking:
        'Guest details are reported to be masked 180 days after check-out [3P] — detected, never imported as truth.',
      evidence: 'docs/research/05-market-deep-dive/11-one-button-migration.md §3.6 (labels as cited there).',
    },
  },
  {
    key: 'cloudbeds.csv',
    label: 'Cloudbeds reservations report (CSV)',
    vendor: 'Cloudbeds',
    kind: 'file',
    verification: 'unverified',
    verificationNote: REUSE_NOTE,
    provides: ['reservation', 'guest'],
    headerHints: {
      reservations: {
        'Reservation Number': 'confirmation',
        'Check in Date': 'arrival',
        'Check out Date': 'departure',
        'Accommodation Total': 'room_total',
        'Grand Total': 'total',
        'Third Party Confirmation Number': 'channel_booking_id',
        Source: 'channel',
      },
    },
    assumedDateOrder: null,
    assessment: {
      exportRoute:
        'Reservation list / reports exported to CSV [S, DD11 §3.5]; API v1.3 exists [S] (not used in this increment).',
      fees: 'Unconfirmed ("quote required").',
      historyLimits: 'Unconfirmed.',
      accessRestrictions: 'Access ends when the account is deactivated: export BEFORE giving notice [S].',
      paymentTokens:
        'Cloudbeds Payments tokens are not portable without provider cooperation [unconfirmed] — re-collect.',
      masking: 'Unconfirmed.',
      evidence: 'docs/research/05-market-deep-dive/11-one-button-migration.md §3.5.',
    },
  },
  {
    key: 'ezee.csv',
    label: 'eZee Absolute reservation list (CSV/Excel)',
    vendor: 'eZee (Yanolja)',
    kind: 'file',
    verification: 'unverified',
    verificationNote: REUSE_NOTE,
    provides: ['reservation', 'guest'],
    headerHints: {
      reservations: {
        'Res. No': 'confirmation',
        'Rate Type': 'rate_plan_code',
        'Room Charges': 'room_total',
        'Total Amount': 'total',
        'Business Source': 'channel',
        'Voucher No': 'channel_booking_id',
        Mobile: 'guest_phone',
      },
    },
    assumedDateOrder: 'dmy',
    assessment: {
      exportRoute: 'Report exports; guest database export to Excel needs a privilege [S, DD11 §3.8].',
      fees: 'Unconfirmed ("quote required").',
      historyLimits: 'Unconfirmed; reservations export not confirmed [S].',
      accessRestrictions:
        'Bundled channel manager (eZee Centrix) must be disconnected in a controlled order.',
      paymentTokens: 'Gateway-dependent; treat as non-portable — re-collect.',
      masking: 'Unconfirmed.',
      evidence: 'docs/research/05-market-deep-dive/11-one-button-migration.md §3.8.',
    },
  },
  {
    key: 'pms.simulator',
    label: 'Portico PMS simulator',
    vendor: 'Portico (simulator)',
    kind: 'simulator',
    verification: 'verified',
    verificationNote:
      'Simulated system built into Portico; never a real hotel system (all data labelled simulated). Refused in live organizations.',
    provides: ['unit_type', 'unit', 'rate_plan', 'guest', 'reservation'],
    headerHints: {},
    assumedDateOrder: 'ymd',
    assessment: {
      exportRoute: 'Read through the simulator account (integration).',
      fees: 'None (simulator).',
      historyLimits: 'Simulator keeps current reservations only.',
      accessRestrictions: 'Not available in live organizations.',
      paymentTokens: 'None simulated.',
      masking: 'None.',
      evidence: 'modules/integration (pms.simulator connector).',
    },
  },
];

export function sourceAdapter(key: string): SourceAdapter | undefined {
  return SOURCE_ADAPTERS.find((a) => a.key === key);
}
