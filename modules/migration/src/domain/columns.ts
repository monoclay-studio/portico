/**
 * Column auto-detection. Each table kind (a sheet or CSV file of a pack) has a field dictionary with the header
 * names exports commonly use. A file is matched to the kind whose required fields it covers best, and each header
 * to the field it names; the user confirms anything below the confidence threshold (INT-R10/R11 spirit).
 */

export const TABLE_KINDS = [
  'unit_types',
  'units',
  'rate_plans',
  'guests',
  'reservations',
  'reservation_nights',
  'deposits',
  'in_house_balances',
  'ar_open_items',
  'control_totals',
] as const;
export type TableKind = (typeof TABLE_KINDS)[number];

export interface FieldSpec {
  field: string;
  label: string;
  required: boolean;
  synonyms: string[];
}

const f = (field: string, label: string, required: boolean, synonyms: string[]): FieldSpec => ({
  field,
  label,
  required,
  synonyms: [field.replace(/_/g, ' '), label, ...synonyms],
});

export const FIELD_DICTIONARY: Record<TableKind, FieldSpec[]> = {
  unit_types: [
    f('code', 'Unit type code', true, [
      'room type code',
      'room type',
      'type code',
      'category code',
      'roomtype',
    ]),
    f('name', 'Unit type name', true, ['room type name', 'description', 'category', 'type name']),
    f('max_occupancy', 'Maximum occupancy', false, ['max occupancy', 'max guests', 'max pax', 'capacity']),
    f('base_occupancy', 'Base occupancy', false, ['standard occupancy', 'base pax', 'default occupancy']),
  ],
  units: [
    f('number', 'Unit number', true, [
      'room',
      'room number',
      'room no',
      'room #',
      'unit',
      'villa',
      'unit no',
    ]),
    f('unit_type_code', 'Unit type code', true, ['room type', 'room type code', 'type', 'category']),
    f('name', 'Unit name', false, ['room name', 'villa name', 'description']),
  ],
  rate_plans: [
    f('code', 'Rate plan code', true, ['rate code', 'rate', 'plan code', 'rate plan']),
    f('name', 'Rate plan name', true, ['rate name', 'description', 'plan name']),
    f('currency', 'Currency', false, ['ccy', 'currency code']),
  ],
  guests: [
    f('guest_id', 'Guest id', true, [
      'guest id',
      'profile id',
      'customer id',
      'guest no',
      'guest number',
      'id',
    ]),
    f('given_name', 'First name', false, ['first name', 'firstname', 'given name', 'forename']),
    f('family_name', 'Last name', false, ['last name', 'lastname', 'surname', 'family name']),
    f('full_name', 'Guest name', false, ['name', 'guest name', 'full name', 'customer name']),
    f('email', 'Email', false, ['email address', 'e-mail', 'mail']),
    f('phone', 'Phone', false, ['phone number', 'mobile', 'telephone', 'tel', 'contact number']),
    f('nationality', 'Nationality', false, ['country', 'nationality code', 'country code']),
    f('date_of_birth', 'Date of birth', false, ['dob', 'birth date', 'birthday']),
    f('language', 'Language', false, ['preferred language', 'lang']),
    f('marketing_consent', 'Marketing consent', false, [
      'marketing opt in',
      'newsletter',
      'opt in',
      'consent',
    ]),
  ],
  reservations: [
    f('confirmation', 'Confirmation number', true, [
      'reservation id',
      'reservation number',
      'booking id',
      'booking reference',
      'booking no',
      'confirmation no',
      'conf no',
      'res id',
      'reference',
    ]),
    f('status', 'Status', true, ['booking status', 'reservation status', 'res status']),
    f('arrival', 'Arrival date', true, [
      'arrival',
      'check in',
      'check-in',
      'checkin',
      'check in date',
      'from',
      'arrive',
    ]),
    f('departure', 'Departure date', true, [
      'departure',
      'check out',
      'check-out',
      'checkout',
      'check out date',
      'to',
      'depart',
    ]),
    f('unit_type_code', 'Unit type code', true, ['room type', 'room type code', 'room category', 'category']),
    f('unit_number', 'Unit number', false, ['room', 'room number', 'room no', 'villa', 'assigned room']),
    f('guest_id', 'Guest id', false, ['guest id', 'profile id', 'customer id']),
    f('guest_name', 'Guest name', false, ['guest', 'name', 'guest full name', 'booker', 'customer']),
    f('guest_given_name', 'Guest first name', false, ['guest first name', 'first name', 'firstname']),
    f('guest_family_name', 'Guest last name', false, ['guest last name', 'last name', 'lastname', 'surname']),
    f('guest_email', 'Guest email', false, ['email', 'email address', 'e-mail']),
    f('guest_phone', 'Guest phone', false, ['phone', 'mobile', 'telephone', 'phone number']),
    f('adults', 'Adults', false, ['adult', 'no of adults', 'pax adults', 'guests']),
    f('children', 'Children', false, ['child', 'kids', 'no of children']),
    f('rate_plan_code', 'Rate plan code', false, ['rate code', 'rate plan', 'rate']),
    f('currency', 'Currency', true, ['ccy', 'currency code']),
    f('room_total', 'Room total', true, [
      'accommodation total',
      'room revenue',
      'room amount',
      'room charges',
    ]),
    f('tax_total', 'Tax total', false, ['taxes', 'tax', 'tax amount', 'total tax']),
    f('tgst', 'TGST', false, ['tourism gst', 't-gst']),
    f('green_tax', 'Green tax', false, ['green tax amount']),
    f('service_charge', 'Service charge', false, ['service', 'svc charge']),
    f('taxes_included', 'Taxes included', false, ['tax inclusive', 'incl tax', 'inclusive']),
    f('total', 'Grand total', false, ['total amount', 'grand total', 'booking total', 'total price']),
    f('channel', 'Channel', false, ['source', 'booking source', 'channel name', 'ota']),
    f('channel_booking_id', 'Channel booking id', false, [
      'ota reference',
      'channel reference',
      'channel ref',
      'external reference',
      'ota id',
    ]),
    f('guarantee', 'Guarantee', false, ['guarantee type', 'payment guarantee', 'guaranteed by']),
  ],
  reservation_nights: [
    f('confirmation', 'Confirmation number', true, ['reservation id', 'booking id', 'booking reference']),
    f('date', 'Stay date', true, ['night', 'stay date', 'date']),
    f('amount', 'Nightly price', true, ['rate', 'price', 'room rate', 'nightly rate', 'amount']),
  ],
  deposits: [
    f('confirmation', 'Confirmation number', true, ['reservation id', 'booking id', 'booking reference']),
    f('amount', 'Deposit amount', true, ['deposit', 'deposit held', 'amount held', 'balance']),
    f('currency', 'Currency', true, ['ccy']),
    f('tax_declared', 'Tax already declared', false, ['tax declared', 'tgst declared', 'declared tax']),
    f('tax_code', 'Tax code', false, ['tax type']),
    f('received_on', 'Received on', false, ['payment date', 'received', 'date received']),
  ],
  in_house_balances: [
    f('confirmation', 'Confirmation number', true, ['reservation id', 'booking id', 'booking reference']),
    f('folio', 'Folio', true, ['folio number', 'folio no', 'window', 'bill']),
    f('charges', 'Charges', false, ['total charges', 'debits']),
    f('payments', 'Payments', false, ['total payments', 'credits']),
    f('balance', 'Balance', true, ['open balance', 'balance due', 'outstanding']),
    f('currency', 'Currency', true, ['ccy']),
  ],
  ar_open_items: [
    f('account_code', 'Account code', true, ['account', 'ar account', 'account no', 'debtor code']),
    f('account_name', 'Account name', false, ['company', 'debtor', 'customer']),
    f('invoice', 'Invoice', true, ['invoice number', 'invoice no', 'document', 'reference']),
    f('invoice_date', 'Invoice date', true, ['date', 'document date']),
    f('due_date', 'Due date', false, ['due']),
    f('open_amount', 'Open amount', true, ['open', 'outstanding', 'balance', 'amount due']),
    f('currency', 'Currency', true, ['ccy']),
  ],
  control_totals: [
    f('data_class', 'Data class', true, ['report', 'ledger', 'section']),
    f('currency', 'Currency', false, ['ccy']),
    f('count', 'Record count', false, ['records', 'number of records', 'rows']),
    f('amount', 'Closing balance', false, ['total', 'balance', 'closing balance', 'amount']),
  ],
};

export function normalizeHeader(h: string): string {
  return h
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/#/g, ' no ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface ColumnMatch {
  field: string;
  header: string;
  index: number;
  confidence: number;
}

export interface TableDetection {
  kind: TableKind;
  /** 0..1: share of required fields found, weighted by match quality. */
  confidence: number;
  columns: ColumnMatch[];
  missingRequired: string[];
  unmappedHeaders: string[];
}

function matchScore(header: string, spec: FieldSpec): number {
  const h = normalizeHeader(header);
  let best = 0;
  for (const s of spec.synonyms) {
    const n = normalizeHeader(s);
    if (!n) continue;
    if (h === n) return 1;
    if (h.split(' ').length > 1 && (h.startsWith(`${n} `) || h.endsWith(` ${n}`))) best = Math.max(best, 0.8);
  }
  return best;
}

/** Map headers to fields of one table kind (each header used once, best score first). */
export function mapColumns(
  kind: TableKind,
  headers: readonly string[],
  overrides: Record<string, string> = {},
): TableDetection {
  const specs = FIELD_DICTIONARY[kind];
  const candidates: ColumnMatch[] = [];
  headers.forEach((header, index) => {
    for (const spec of specs) {
      const forced = overrides[header];
      const score = forced ? (forced === spec.field ? 1 : 0) : matchScore(header, spec);
      if (score > 0) candidates.push({ field: spec.field, header, index, confidence: score });
    }
  });
  candidates.sort((a, b) => b.confidence - a.confidence || a.index - b.index);
  const usedHeaders = new Set<number>();
  const usedFields = new Set<string>();
  const columns: ColumnMatch[] = [];
  for (const c of candidates) {
    if (usedHeaders.has(c.index) || usedFields.has(c.field)) continue;
    usedHeaders.add(c.index);
    usedFields.add(c.field);
    columns.push(c);
  }
  const required = specs.filter((s) => s.required);
  const missingRequired = required.filter((s) => !usedFields.has(s.field)).map((s) => s.field);
  const requiredScore =
    required.reduce((sum, s) => sum + (columns.find((c) => c.field === s.field)?.confidence ?? 0), 0) /
    Math.max(1, required.length);
  return {
    kind,
    confidence: Math.round(requiredScore * 100) / 100,
    columns,
    missingRequired,
    unmappedHeaders: headers.filter((_h, i) => !usedHeaders.has(i)),
  };
}

/** Which table kind a file is (best covered required fields; ties broken by total matched columns). */
export function detectTable(headers: readonly string[], hint?: TableKind): TableDetection {
  if (hint) return mapColumns(hint, headers);
  let best: TableDetection | null = null;
  for (const kind of TABLE_KINDS) {
    const d = mapColumns(kind, headers);
    if (
      !best ||
      d.confidence > best.confidence ||
      (d.confidence === best.confidence && d.columns.length > best.columns.length)
    )
      best = d;
  }
  return best as TableDetection;
}

/** Guess a table kind from a file or sheet name (units.csv, "Reservations", deposits_2026.csv …). */
export function kindFromName(name: string): TableKind | null {
  const n = normalizeHeader(name.replace(/\.(csv|txt|xlsx)$/i, ''));
  const rules: Array<[RegExp, TableKind]> = [
    [/night/, 'reservation_nights'],
    [/control|totals|closing/, 'control_totals'],
    [/in house|inhouse|folio/, 'in_house_balances'],
    [/receivable|\bar\b|city ledger|debtor/, 'ar_open_items'],
    [/deposit/, 'deposits'],
    [/unit type|room type|categor/, 'unit_types'],
    [/rate/, 'rate_plans'],
    [/guest|profile|customer/, 'guests'],
    [/reserv|booking/, 'reservations'],
    [/unit|room|villa/, 'units'],
  ];
  for (const [re, kind] of rules) if (re.test(n)) return kind;
  return null;
}

/** Minimum confidence for a table detection to be used without a person confirming it. */
export const AUTO_ACCEPT_CONFIDENCE = 0.9;
