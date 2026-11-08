/**
 * Build canonical source records from the tables of a file pack (CSV files or XLSX sheets). Pure.
 * Each row becomes exactly one record (or one problem row): nothing is silently dropped (INT-R31, MG-08).
 */
import { addDays, diffDays, sha256Hex } from '@portico/kernel';
import { type ColumnMatch, FIELD_DICTIONARY, type TableKind } from './columns';
import type { Table } from './csv';
import {
  cleanText,
  type DateOrder,
  detectDateOrder,
  normalizeEmail,
  normalizeStatus,
  parseBool,
  parseDate,
  parseIntStrict,
  parseMoney,
} from './normalize';
import {
  arKey,
  type BookingStatus,
  type ControlTotal,
  DATA_CLASSES,
  type DataClass,
  depositKey,
  type Guarantee,
  type GuestRecord,
  inHouseKey,
  normalizeSourceKey,
  type Problem,
  type ReservationRecord,
  type SourceRecord,
  type TaxAmount,
  unitKey,
} from './records';
import { isMasked } from './sensitive';

/** Stable, non-personal key for a guest derived from reservation rows (hash of the email or name+phone). */
export function derivedGuestKey(identity: string): string {
  return `guest-${sha256Hex(identity.trim().toLowerCase()).slice(0, 16)}`;
}

export interface PackTable {
  /** File or sheet name. */
  name: string;
  kind: TableKind;
  table: Table;
  columns: ColumnMatch[];
  /** From a workbook: numeric date cells are Excel serials. */
  spreadsheet: boolean;
}

export interface PackOptions {
  /** Currency for amounts without one (the property's base currency). */
  defaultCurrency: string;
  /** Decided date order for ambiguous numeric dates (plan decision), if any. */
  dateOrder?: DateOrder | null;
  /** Reviewed status vocabulary (source word → status) on top of the built-in one. */
  statusMap?: Record<string, BookingStatus>;
}

export interface PackResult {
  records: SourceRecord[];
  controlTotals: ControlTotal[];
  /** Columns whose numeric dates are ambiguous (needs a decision) — `file:column`. */
  ambiguousDateColumns: string[];
  /** Status words the source used that are not known (needs a decision). */
  unknownStatuses: string[];
}

function getter(t: PackTable) {
  const index = new Map(t.columns.map((c) => [c.field, c.index]));
  return (row: readonly string[], field: string): string => {
    const i = index.get(field);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
}

function rawRow(t: PackTable, row: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  t.table.headers.forEach((h, i) => {
    out[h] = (row[i] ?? '').slice(0, 200);
  });
  return out;
}

const problem = (code: string, severity: Problem['severity'], message: string, field?: string): Problem => ({
  code,
  severity,
  message,
  ...(field ? { field } : {}),
});

function splitName(full: string): { given: string | null; family: string } {
  const v = full.trim();
  if (v.includes(',')) {
    const [family, given] = v.split(',', 2).map((s) => s.trim());
    return { given: given || null, family: family || v };
  }
  const parts = v.split(/\s+/);
  if (parts.length === 1) return { given: null, family: v };
  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] as string };
}

function guaranteeOf(raw: string): Guarantee {
  const v = raw.trim().toLowerCase();
  if (!v) return 'unknown';
  if (/card|cc|credit/.test(v)) return 'card_at_previous_psp';
  if (/deposit|prepaid|pre-paid|paid/.test(v)) return 'deposit';
  if (/company|corporate|agent|agency|city ledger|ar/.test(v)) return 'company';
  if (/none|non[- ]?guaranteed|6 ?pm|4 ?pm/.test(v)) return 'none';
  return 'unknown';
}

export function buildPack(tables: readonly PackTable[], opts: PackOptions): PackResult {
  const records: SourceRecord[] = [];
  const controlTotals: ControlTotal[] = [];
  const ambiguousDateColumns: string[] = [];
  const unknownStatuses = new Set<string>();
  const nights = new Map<string, Array<{ date: string | null; amountRaw: string }>>();
  const hasGuestTable = tables.some((t) => t.kind === 'guests');
  const derivedGuests = new Map<string, { origin: { file: string; row: number }; payload: GuestRecord }>();
  /** Index in `records` of each reservation row → its confirmation as written (multi-room vs conflict). */
  const verbatimConf = new Map<number, string>();

  // Date order per date column: detected from its values, else the reviewed plan decision.
  const orderFor = (t: PackTable, field: string): DateOrder | null => {
    const col = t.columns.find((c) => c.field === field);
    if (!col) return null;
    const detected = detectDateOrder(t.table.rows.map((r) => r[col.index] ?? ''));
    if (detected) return detected;
    return opts.dateOrder ?? null;
  };
  const dateIn = (
    t: PackTable,
    row: readonly string[],
    field: string,
    problems: Problem[],
    required: boolean,
  ) => {
    const g = getter(t);
    const p = parseDate(g(row, field), { order: orderFor(t, field), spreadsheet: t.spreadsheet });
    if (p.ok) return p.date;
    if (p.reason === 'empty') {
      if (required)
        problems.push(problem('required_missing', 'blocking', `${label(t, field)} is missing.`, field));
      return null;
    }
    if (p.reason === 'ambiguous') {
      const ref = `${t.name}:${field}`;
      if (!ambiguousDateColumns.includes(ref)) ambiguousDateColumns.push(ref);
      problems.push(
        problem(
          'date_ambiguous',
          'blocking',
          `${label(t, field)} "${g(row, field)}" could be day/month or month/day. Confirm the date order of this file in the mapping step.`,
          field,
        ),
      );
      return null;
    }
    problems.push(
      problem('date_invalid', 'blocking', `${label(t, field)} "${g(row, field)}" is not a date.`, field),
    );
    return null;
  };
  const moneyIn = (
    t: PackTable,
    row: readonly string[],
    field: string,
    currency: string,
    problems: Problem[],
    required: boolean,
  ): number | null => {
    const raw = getter(t)(row, field);
    const p = parseMoney(raw, currency);
    if (p.ok) return p.minor;
    if (p.reason === 'empty') {
      if (required)
        problems.push(problem('required_missing', 'blocking', `${label(t, field)} is missing.`, field));
      return null;
    }
    const why =
      p.reason === 'too_precise'
        ? `has more decimals than ${currency} allows`
        : p.reason === 'ambiguous_separator'
          ? 'could be read with the separator as thousands or as decimals'
          : 'is not an amount';
    problems.push(
      problem(
        `amount_${p.reason}`,
        'blocking',
        `${label(t, field)} "${raw}" ${why}. Amounts are never rounded or guessed: correct the export and upload it again.`,
        field,
      ),
    );
    return null;
  };
  const currencyIn = (t: PackTable, row: readonly string[], problems: Problem[]): string => {
    const raw = getter(t)(row, 'currency').toUpperCase();
    if (!raw) return opts.defaultCurrency;
    if (!/^[A-Z]{3}$/.test(raw)) {
      problems.push(
        problem('currency_invalid', 'blocking', `Currency "${raw}" is not an ISO code.`, 'currency'),
      );
      return opts.defaultCurrency;
    }
    return raw;
  };

  // Nightly prices first (they attach to reservations; amounts are parsed in the booking's currency).
  for (const t of tables.filter((x) => x.kind === 'reservation_nights')) {
    const g = getter(t);
    t.table.rows.forEach((row) => {
      const conf = normalizeSourceKey(g(row, 'confirmation'));
      if (!conf) return;
      const date = dateIn(t, row, 'date', [], true);
      const list = nights.get(conf) ?? [];
      list.push({ date, amountRaw: g(row, 'amount') });
      nights.set(conf, list);
    });
  }

  for (const t of tables) {
    const g = getter(t);
    t.table.rows.forEach((row, ri) => {
      const origin = { file: t.name, row: ri + 1 };
      const problems: Problem[] = [];
      switch (t.kind) {
        case 'unit_types': {
          const code = g(row, 'code').toUpperCase();
          const name = cleanText(g(row, 'name'), 120);
          if (!code)
            problems.push(problem('required_missing', 'blocking', 'Unit type code is missing.', 'code'));
          if (!name)
            problems.push(problem('required_missing', 'blocking', 'Unit type name is missing.', 'name'));
          const max = g(row, 'max_occupancy') ? parseIntStrict(g(row, 'max_occupancy')) : null;
          const base = g(row, 'base_occupancy') ? parseIntStrict(g(row, 'base_occupancy')) : null;
          push(
            'unit_type',
            code || `row:${t.name}:${ri + 1}`,
            code && name ? { code, name, maxOccupancy: max, baseOccupancy: base } : null,
          );
          break;
        }
        case 'units': {
          const number = g(row, 'number');
          const typeCode = g(row, 'unit_type_code').toUpperCase();
          if (!number)
            problems.push(problem('required_missing', 'blocking', 'Unit number is missing.', 'number'));
          if (!typeCode)
            problems.push(problem('required_missing', 'blocking', 'Unit type is missing.', 'unit_type_code'));
          push(
            'unit',
            number ? unitKey(number) : `row:${t.name}:${ri + 1}`,
            number && typeCode
              ? { number: number.trim(), unitTypeCode: typeCode, name: cleanText(g(row, 'name'), 120) }
              : null,
          );
          break;
        }
        case 'rate_plans': {
          const code = g(row, 'code').toUpperCase();
          const name = cleanText(g(row, 'name'), 120);
          if (!code)
            problems.push(problem('required_missing', 'blocking', 'Rate plan code is missing.', 'code'));
          push(
            'rate_plan',
            code || `row:${t.name}:${ri + 1}`,
            code ? { code, name: name ?? code, currency: g(row, 'currency').toUpperCase() || null } : null,
          );
          break;
        }
        case 'guests': {
          const id = normalizeSourceKey(g(row, 'guest_id'));
          let given = cleanText(g(row, 'given_name'), 80);
          let family = cleanText(g(row, 'family_name'), 80);
          const full = cleanText(g(row, 'full_name'), 160);
          if (!family && full) {
            const s = splitName(full);
            given = given ?? s.given;
            family = s.family;
          }
          if (!id) problems.push(problem('required_missing', 'blocking', 'Guest id is missing.', 'guest_id'));
          if (!family)
            problems.push(problem('required_missing', 'blocking', 'Guest name is missing.', 'family_name'));
          if (isMasked(family) || isMasked(given))
            problems.push(
              problem(
                'masked_identity',
                'blocking',
                'The guest name is masked in this export. Masked data is never imported as truth: re-export over a secure delivery (SFTP/HTTPS) with unmasked names.',
                'family_name',
              ),
            );
          const emailRaw = g(row, 'email');
          const phoneRaw = g(row, 'phone');
          let email = normalizeEmail(emailRaw);
          let phone = cleanText(phoneRaw, 40);
          if (isMasked(emailRaw)) {
            email = null;
            problems.push(
              problem(
                'masked_contact',
                'warning',
                'The email is masked in this export; it is not imported.',
                'email',
              ),
            );
          } else if (emailRaw && !email)
            problems.push(
              problem(
                'contact_invalid',
                'warning',
                'The email address is not valid; it is not imported.',
                'email',
              ),
            );
          if (isMasked(phoneRaw)) {
            phone = null;
            problems.push(
              problem(
                'masked_contact',
                'warning',
                'The phone number is masked in this export; it is not imported.',
                'phone',
              ),
            );
          }
          const dob = g(row, 'date_of_birth') ? dateIn(t, row, 'date_of_birth', [], false) : null;
          const nat = g(row, 'nationality').toUpperCase();
          push(
            'guest',
            id || `row:${t.name}:${ri + 1}`,
            id && family
              ? {
                  givenName: given,
                  familyName: family,
                  email,
                  phone,
                  nationality: /^[A-Z]{2}$/.test(nat) ? nat : null,
                  dateOfBirth: dob,
                  language: cleanText(g(row, 'language'), 20),
                  marketingConsent: parseBool(g(row, 'marketing_consent')),
                }
              : null,
          );
          break;
        }
        case 'reservations': {
          const verbatim = g(row, 'confirmation');
          const conf = normalizeSourceKey(verbatim);
          if (conf) verbatimConf.set(records.length, verbatim.trim());
          if (!conf)
            problems.push(
              problem('required_missing', 'blocking', 'Confirmation number is missing.', 'confirmation'),
            );
          const sourceStatus = g(row, 'status');
          const status = sourceStatus
            ? (opts.statusMap?.[sourceStatus.trim().toLowerCase()] ?? normalizeStatus(sourceStatus))
            : null;
          if (!sourceStatus)
            problems.push(problem('required_missing', 'blocking', 'Status is missing.', 'status'));
          else if (!status) {
            unknownStatuses.add(sourceStatus.trim().toLowerCase());
            problems.push(
              problem(
                'status_unmapped',
                'blocking',
                `Status "${sourceStatus}" is not known. Map it to a Portico status in the mapping step.`,
                'status',
              ),
            );
          }
          const arrival = dateIn(t, row, 'arrival', problems, true);
          const departure = dateIn(t, row, 'departure', problems, true);
          const typeCode = g(row, 'unit_type_code').toUpperCase();
          if (!typeCode)
            problems.push(problem('required_missing', 'blocking', 'Unit type is missing.', 'unit_type_code'));
          const currency = currencyIn(t, row, problems);
          const roomTotal = moneyIn(t, row, 'room_total', currency, problems, true);
          const taxes: TaxAmount[] = [];
          for (const [field, code, name] of [
            ['tgst', 'TGST', 'T-GST'],
            ['green_tax', 'GREEN', 'Green Tax'],
            ['service_charge', 'SVC', 'Service charge'],
          ] as const) {
            const amt = moneyIn(t, row, field, currency, problems, false);
            if (amt !== null && amt !== 0) taxes.push({ code, name, amountMinor: amt });
          }
          const taxTotal = moneyIn(t, row, 'tax_total', currency, problems, false);
          if (taxes.length === 0 && taxTotal !== null && taxTotal !== 0)
            taxes.push({ code: 'TAX', name: 'Taxes (as stated by the source)', amountMinor: taxTotal });
          const inclusive = parseBool(g(row, 'taxes_included')) ?? false;
          const taxSum = taxes.reduce((s, x) => s + x.amountMinor, 0);
          const total = moneyIn(t, row, 'total', currency, problems, false);
          const expectedTotal = roomTotal === null ? null : inclusive ? roomTotal : roomTotal + taxSum;
          if (total !== null && expectedTotal !== null && total !== expectedTotal)
            problems.push(
              problem(
                'total_mismatch',
                'blocking',
                `The grand total (${total}) is not the room total plus taxes (${expectedTotal}) in minor units. Agreed amounts are never guessed: correct the export or confirm the amounts with finance.`,
                'total',
              ),
            );
          if (arrival && departure && departure <= arrival)
            problems.push(
              problem('dates_inverted', 'blocking', 'Departure is not after arrival.', 'departure'),
            );
          const givenCol = cleanText(g(row, 'guest_given_name'), 80);
          const familyCol = cleanText(g(row, 'guest_family_name'), 80);
          const guestName =
            cleanText(g(row, 'guest_name'), 160) ??
            (familyCol ? [givenCol, familyCol].filter(Boolean).join(' ') : null) ??
            (g(row, 'guest_id') ? `Guest ${g(row, 'guest_id')}` : null);
          let guestKey = cleanText(normalizeSourceKey(g(row, 'guest_id')), 120);
          if (!guestKey && !hasGuestTable && guestName && !isMasked(guestName)) {
            // SMB exports carry the guest on the reservation row: derive one profile per person.
            const email = normalizeEmail(g(row, 'guest_email'));
            const phone = cleanText(g(row, 'guest_phone'), 40);
            const split = familyCol ? { given: givenCol, family: familyCol } : splitName(guestName);
            // The key identifies the person without being personal data itself (keys appear in exceptions and logs).
            guestKey = derivedGuestKey(
              email ? `email:${email}` : `name:${guestName.toLowerCase()}|${phone ?? ''}`,
            );
            if (!derivedGuests.has(guestKey))
              derivedGuests.set(guestKey, {
                origin,
                payload: {
                  givenName: split.given,
                  familyName: split.family,
                  email: isMasked(g(row, 'guest_email')) ? null : email,
                  phone: isMasked(g(row, 'guest_phone')) ? null : phone,
                  nationality: null,
                  dateOfBirth: null,
                  language: null,
                  marketingConsent: null,
                },
              });
          }
          if (isMasked(g(row, 'guest_name')) || isMasked(familyCol))
            problems.push(
              problem(
                'masked_identity',
                'blocking',
                'The guest name on this reservation is masked in the export. Re-export with unmasked data.',
                'guest_name',
              ),
            );
          let nightly: ReservationRecord['nightly'] = null;
          const rawNights = nights.get(conf);
          if (rawNights && arrival && departure) {
            const list: Array<{ date: string; amountMinor: number }> = [];
            for (const n of rawNights) {
              const amt = parseMoney(n.amountRaw, currency);
              if (!n.date || !amt.ok) {
                problems.push(
                  problem(
                    'nightly_invalid',
                    'blocking',
                    'A nightly price row for this booking cannot be read.',
                    'nightly',
                  ),
                );
                continue;
              }
              list.push({ date: n.date, amountMinor: amt.minor });
            }
            list.sort((a, b) => (a.date < b.date ? -1 : 1));
            const expected = diffDays(arrival, departure);
            const covers = list.length === expected && list.every((n, i) => n.date === addDays(arrival, i));
            if (!covers)
              problems.push(
                problem(
                  'nightly_incomplete',
                  'blocking',
                  'Nightly prices do not cover every night of the stay exactly once.',
                  'nightly',
                ),
              );
            else if (roomTotal !== null && list.reduce((s, n) => s + n.amountMinor, 0) !== roomTotal)
              problems.push(
                problem(
                  'nightly_total_mismatch',
                  'blocking',
                  'Nightly prices do not add up to the room total.',
                  'nightly',
                ),
              );
            nightly = list;
          }
          const adults = parseIntStrict(g(row, 'adults')) ?? 1;
          const children = parseIntStrict(g(row, 'children')) ?? 0;
          const channelCode = cleanText(g(row, 'channel'), 60);
          const channelId = cleanText(g(row, 'channel_booking_id'), 120);
          push(
            'reservation',
            conf || `row:${t.name}:${ri + 1}`,
            conf && status && arrival && departure && typeCode && roomTotal !== null && guestName
              ? {
                  status,
                  sourceStatus,
                  arrival,
                  departure,
                  unitTypeCode: typeCode,
                  unitNumber: cleanText(g(row, 'unit_number'), 20),
                  guestKey,
                  guestName,
                  adults,
                  children,
                  ratePlanCode: g(row, 'rate_plan_code').toUpperCase() || null,
                  currency,
                  nightly,
                  roomTotalMinor: roomTotal,
                  taxes,
                  taxInclusive: inclusive,
                  totalMinor: total ?? (expectedTotal as number),
                  channel: channelCode && channelId ? { code: channelCode, bookingId: channelId } : null,
                  guarantee: guaranteeOf(g(row, 'guarantee')),
                }
              : null,
          );
          break;
        }
        case 'deposits': {
          const conf = normalizeSourceKey(g(row, 'confirmation'));
          if (!conf)
            problems.push(
              problem('required_missing', 'blocking', 'Confirmation number is missing.', 'confirmation'),
            );
          const currency = currencyIn(t, row, problems);
          const amount = moneyIn(t, row, 'amount', currency, problems, true);
          const tax = moneyIn(t, row, 'tax_declared', currency, problems, false);
          const code = g(row, 'tax_code').toUpperCase() || 'TGST';
          const received = g(row, 'received_on') ? dateIn(t, row, 'received_on', problems, false) : null;
          push(
            'deposit',
            conf ? depositKey(conf) : `row:${t.name}:${ri + 1}`,
            conf && amount !== null
              ? {
                  bookingKey: conf,
                  amountMinor: amount,
                  currency,
                  taxDeclared: tax
                    ? [{ code, name: code === 'TGST' ? 'T-GST' : code, amountMinor: tax }]
                    : [],
                  receivedOn: received,
                }
              : null,
          );
          break;
        }
        case 'in_house_balances': {
          const conf = normalizeSourceKey(g(row, 'confirmation'));
          const folio = g(row, 'folio') || '1';
          const currency = currencyIn(t, row, problems);
          const balance = moneyIn(t, row, 'balance', currency, problems, true);
          const charges = moneyIn(t, row, 'charges', currency, problems, false);
          const payments = moneyIn(t, row, 'payments', currency, problems, false);
          if (!conf)
            problems.push(
              problem('required_missing', 'blocking', 'Confirmation number is missing.', 'confirmation'),
            );
          if (balance !== null && charges !== null && payments !== null && charges - payments !== balance)
            problems.push(
              problem(
                'folio_not_balancing',
                'blocking',
                `Charges minus payments (${charges - payments}) is not the balance (${balance}). A finance person must confirm this folio.`,
                'balance',
              ),
            );
          push(
            'in_house_balance',
            conf ? inHouseKey(conf, folio) : `row:${t.name}:${ri + 1}`,
            conf && balance !== null
              ? {
                  bookingKey: conf,
                  folioRef: folio,
                  chargesMinor: charges ?? balance + (payments ?? 0),
                  paymentsMinor: payments ?? 0,
                  balanceMinor: balance,
                  currency,
                }
              : null,
          );
          break;
        }
        case 'ar_open_items': {
          const account = normalizeSourceKey(g(row, 'account_code'));
          const invoice = normalizeSourceKey(g(row, 'invoice'));
          const currency = currencyIn(t, row, problems);
          const open = moneyIn(t, row, 'open_amount', currency, problems, true);
          const invoiceDate = dateIn(t, row, 'invoice_date', problems, true);
          const due = g(row, 'due_date') ? dateIn(t, row, 'due_date', problems, false) : null;
          if (!account)
            problems.push(
              problem('required_missing', 'blocking', 'Account code is missing.', 'account_code'),
            );
          if (!invoice)
            problems.push(problem('required_missing', 'blocking', 'Invoice is missing.', 'invoice'));
          push(
            'ar_open_item',
            account && invoice ? arKey(account, invoice) : `row:${t.name}:${ri + 1}`,
            account && invoice && open !== null && invoiceDate
              ? {
                  accountCode: account,
                  accountName: cleanText(g(row, 'account_name'), 160) ?? account,
                  invoiceRef: invoice,
                  invoiceDate,
                  dueDate: due,
                  openMinor: open,
                  currency,
                }
              : null,
          );
          break;
        }
        case 'control_totals': {
          const dc = g(row, 'data_class')
            .toLowerCase()
            .replace(/[^a-z_]/g, '_');
          const klass = (DATA_CLASSES as readonly string[]).includes(dc) ? (dc as DataClass) : null;
          if (!klass) return;
          const currency = g(row, 'currency').toUpperCase() || null;
          const cnt = g(row, 'count') ? parseIntStrictLarge(g(row, 'count')) : null;
          const amt = g(row, 'amount') && currency ? parseMoney(g(row, 'amount'), currency) : null;
          controlTotals.push({
            dataClass: klass,
            currency,
            count: cnt,
            amountMinor: amt?.ok ? amt.minor : null,
          });
          break;
        }
        case 'reservation_nights':
          break;
      }

      function push<C extends DataClass>(dataClass: C, key: string, payload: SourceRecord<C>['payload']) {
        const failed = payload === null;
        if (failed && !problems.some((p) => p.severity === 'blocking'))
          problems.push(problem('unreadable_row', 'blocking', 'This row could not be read.'));
        records.push({
          dataClass,
          key,
          payload,
          ...(failed || problems.some((p) => p.severity === 'blocking') ? { raw: rawRow(t, row) } : {}),
          origin,
          problems: [...problems],
        } as SourceRecord);
      }
    });
  }
  for (const [key, g] of derivedGuests)
    records.push({ dataClass: 'guest', key, payload: g.payload, origin: g.origin, problems: [] });
  groupReservationRows(records, verbatimConf);
  return { records, controlTotals, ambiguousDateColumns, unknownStatuses: [...unknownStatuses] };
}

/**
 * Several reservation rows with one confirmation (R-P2-5): written identically, they are the rooms of one
 * multi-room booking — each room becomes its own record `${conf}/${line}` (lines ordered by content, so a re-sorted
 * export keeps its keys) and deposits / folio balances of that confirmation attach to room 1. Written differently
 * but normalising alike (`0012` and `12`, `CN1` and `cn1`), they are different identifiers that collide: every row
 * is reported as `duplicate_key_conflict` and none is imported until a person decides. A source row is never dropped.
 */
function groupReservationRows(records: SourceRecord[], verbatim: ReadonlyMap<number, string>): void {
  const groups = new Map<string, number[]>();
  records.forEach((r, i) => {
    if (r.dataClass !== 'reservation' || !verbatim.has(i)) return;
    groups.set(r.key, [...(groups.get(r.key) ?? []), i]);
  });
  const multiRoom = new Set<string>();
  for (const [conf, idx] of groups) {
    if (idx.length < 2) continue;
    const spellings = new Set(idx.map((i) => verbatim.get(i)));
    const where = idx.map((i) => `${records[i]?.origin.file} row ${records[i]?.origin.row}`).join(', ');
    if (spellings.size > 1) {
      for (const i of idx)
        (records[i] as SourceRecord).problems.push(
          problem(
            'duplicate_key_conflict',
            'blocking',
            `${idx.length} rows have confirmations that read alike (${[...spellings].map((x) => `"${x}"`).join(', ')}; ${where}) but are written differently. Portico treats them as one identifier; decide which booking is which (correct the confirmation in the source, or exclude the wrong row).`,
            'confirmation',
          ),
        );
      continue;
    }
    multiRoom.add(conf);
    const sortKey = (i: number) => {
      const p = records[i]?.payload as ReservationRecord | null;
      return p
        ? JSON.stringify([
            0,
            p.unitTypeCode,
            p.arrival,
            p.departure,
            p.unitNumber ?? '',
            p.guestName,
            p.roomTotalMinor,
          ])
        : JSON.stringify([1, records[i]?.origin.row ?? 0]);
    };
    const ordered = [...idx].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
    ordered.forEach((i, n) => {
      const r = records[i] as SourceRecord<'reservation'>;
      r.key = `${conf}/${n + 1}`;
      if (r.payload) r.payload = { ...r.payload, group: { ref: conf, line: n + 1, lines: idx.length } };
    });
  }
  if (multiRoom.size === 0) return;
  for (const r of records) {
    if (r.dataClass !== 'deposit' && r.dataClass !== 'in_house_balance') continue;
    const p = r.payload as { bookingKey: string } | null;
    if (p && multiRoom.has(p.bookingKey)) r.payload = { ...p, bookingKey: `${p.bookingKey}/1` } as never;
  }
}

function parseIntStrictLarge(raw: string): number | null {
  const v = raw.replace(/[,\s]/g, '');
  return /^\d{1,9}$/.test(v) ? Number(v) : null;
}

function label(t: PackTable, field: string): string {
  return FIELD_DICTIONARY[t.kind].find((s) => s.field === field)?.label ?? field;
}
