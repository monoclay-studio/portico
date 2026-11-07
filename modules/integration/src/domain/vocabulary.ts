/**
 * Portico's own status vocabularies (docs/product/glossary.md). External status codes map onto these through
 * `status` mappings. These are contract values, not another module's tables.
 */
import type { MappingKind } from '../contracts';

export type StatusDomain = 'roomStatus' | 'bookingStatus' | 'stayStatus';

export interface VocabularyEntry {
  value: string;
  label: string;
  /** Common external spellings/codes (structural hints for the suggestion engine). */
  aliases: readonly string[];
}

export const STATUS_VOCABULARIES: Record<StatusDomain, readonly VocabularyEntry[]> = {
  roomStatus: [
    {
      value: 'dirty',
      label: 'Dirty',
      aliases: ['vd', 'od', 'vacant dirty', 'occupied dirty', 'unclean', 'du'],
    },
    { value: 'cleaning', label: 'Cleaning', aliases: ['ip', 'in progress', 'cleaning in progress', 'pu'] },
    { value: 'clean', label: 'Clean', aliases: ['vc', 'oc', 'vacant clean', 'occupied clean', 'cl'] },
    { value: 'inspected', label: 'Inspected', aliases: ['vi', 'ins', 'insp', 'vacant inspected', 'checked'] },
    {
      value: 'failed_inspection',
      label: 'Failed inspection',
      aliases: ['fi', 'failed', 'reclean', 'inspection failed'],
    },
    { value: 'out_of_order', label: 'Out of order', aliases: ['ooo', 'out of order'] },
    { value: 'out_of_service', label: 'Out of service', aliases: ['oos', 'out of service'] },
  ],
  bookingStatus: [
    { value: 'inquiry', label: 'Inquiry', aliases: ['enq', 'enquiry', 'inq'] },
    { value: 'quoted', label: 'Quoted', aliases: ['quote'] },
    { value: 'held', label: 'Held', aliases: ['hold', 'option'] },
    { value: 'tentative', label: 'Tentative', aliases: ['tent', 'prov', 'provisional'] },
    {
      value: 'confirmed',
      label: 'Confirmed',
      aliases: ['conf', 'cnf', 'reserved', 'guaranteed', 'gtd', 'res'],
    },
    { value: 'cancelled', label: 'Cancelled', aliases: ['cxl', 'canc', 'canceled', 'xx'] },
    { value: 'declined', label: 'Declined', aliases: ['refused', 'rejected'] },
    { value: 'expired', label: 'Expired', aliases: ['lapsed'] },
    { value: 'completed', label: 'Completed', aliases: ['checked out', 'co', 'departed', 'closed'] },
  ],
  stayStatus: [
    { value: 'expected', label: 'Expected', aliases: ['due in', 'arrival', 'exp'] },
    { value: 'in_house', label: 'In house', aliases: ['ih', 'checked in', 'ci', 'inhouse'] },
    { value: 'departed', label: 'Departed', aliases: ['co', 'checked out', 'dep'] },
    { value: 'cancelled', label: 'Cancelled', aliases: ['cxl', 'canceled'] },
    { value: 'no_show', label: 'No-show', aliases: ['ns', 'noshow', 'no show'] },
    { value: 'waitlisted', label: 'Waitlisted', aliases: ['wl', 'waitlist'] },
  ],
};

/** Kinds whose mapping affects money: always require a human review before activation. */
export const FINANCIALLY_SIGNIFICANT_KINDS: ReadonlySet<MappingKind> = new Set<MappingKind>([
  'ratePlan',
  'outlet',
  'chargeCode',
  'taxRule',
  'ledgerAccount',
]);

/** Kinds where two external records must not point at the same Portico record. */
export const ONE_TO_ONE_KINDS: ReadonlySet<MappingKind> = new Set<MappingKind>([
  'property',
  'unitType',
  'unit',
]);

export const MAPPING_KIND_LABELS: Record<MappingKind, string> = {
  property: 'property',
  unitType: 'unit type',
  unit: 'unit',
  ratePlan: 'rate plan',
  outlet: 'outlet',
  chargeCode: 'charge code',
  taxRule: 'tax rule',
  ledgerAccount: 'ledger account',
  status: 'status',
};

/** Common hospitality abbreviations, expanded before comparing names. */
export const ABBREVIATIONS: Readonly<Record<string, string>> = {
  dlx: 'deluxe',
  dx: 'deluxe',
  std: 'standard',
  stnd: 'standard',
  sup: 'superior',
  supr: 'superior',
  ste: 'suite',
  jr: 'junior',
  jnr: 'junior',
  vla: 'villa',
  vl: 'villa',
  ov: 'overwater',
  owv: 'overwater',
  wv: 'water villa',
  bv: 'beach villa',
  bch: 'beach',
  gdn: 'garden',
  ocn: 'ocean',
  ocv: 'ocean view',
  sv: 'sea view',
  lgn: 'lagoon',
  pl: 'pool',
  pv: 'pool villa',
  fam: 'family',
  dbl: 'double',
  sgl: 'single',
  twn: 'twin',
  tw: 'twin',
  kg: 'king',
  qn: 'queen',
  rm: 'room',
  bb: 'bed breakfast',
  hb: 'half board',
  fb: 'full board',
  ai: 'all inclusive',
  ro: 'room only',
  bar: 'best available rate',
  rack: 'rack rate',
  corp: 'corporate',
  pkg: 'package',
  hmn: 'honeymoon',
  fnb: 'food beverage',
  bkf: 'breakfast',
  bfst: 'breakfast',
  mb: 'minibar',
  mbar: 'minibar',
  ldy: 'laundry',
  lndry: 'laundry',
  spa: 'spa',
  tfr: 'transfer',
  trf: 'transfer',
  sp: 'seaplane',
  rest: 'restaurant',
  rst: 'restaurant',
  bev: 'beverage',
  svc: 'service charge',
  sc: 'service charge',
  tgst: 'tourism goods services tax',
  gst: 'goods services tax',
  gt: 'green tax',
};
