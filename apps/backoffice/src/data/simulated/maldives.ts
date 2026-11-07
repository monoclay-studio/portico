/**
 * SIMULATED operational data for a property — deterministic per property code and business date, with realistic
 * Maldives content (villas over the lagoon, seaplane and speedboat transfers via Velana International Airport).
 *
 * One simulation per property produces every list from the same stays, so all screens agree ("one set of
 * facts"): the desk lists and the housekeeping board come out in the REAL module contract shapes
 * (reservations `frontDeskRow`, operations `board`) and are validated with those schemas by the adapter.
 *
 * Everything here is sample data. Guest names are invented. Prices and tax lines are samples, not tax rules: real
 * prices and taxes come from the rates module's effective-dated configuration.
 */
import { addDays, diffDays, type LocalDate } from '@portico/ui';
import type {
  BoardRow,
  DeskList,
  DeskListKind,
  FrontDeskRow,
  OperationsBoard,
  ReadinessCheck,
  ReadinessView,
} from '../contracts';
import type { PropertyContext } from '../property';
import type {
  Money,
  OverviewView,
  StayChangePreview,
  StayRecordView,
  TimelineItemView,
  TimelineView,
  UnitRecordView,
  WorkItem,
} from '../views';

type Condition = 'dirty' | 'cleaning' | 'clean' | 'inspected' | 'failed_inspection';
type PaymentState = 'none' | 'authorized' | 'partially_paid' | 'paid' | 'pending_verification';
type TransportMode = 'seaplane' | 'speedboat' | 'domestic_flight';

interface UnitTypeSpec {
  name: string;
  code: string;
  section: string;
  numbers: number[];
  /** Simulated nightly rate in minor units. */
  rate: number;
  maxAdults: number;
}

interface SimUnit {
  id: string;
  number: string;
  typeId: string;
  typeCode: string;
  typeName: string;
  sectionId: string;
  section: string;
  rate: number;
  maxAdults: number;
}

interface SimStay {
  id: string;
  bookingId: string;
  bookingCode: string;
  unitId: string | null;
  unitTypeName: string;
  unitTypeId: string;
  from: LocalDate;
  to: LocalDate;
  status: 'expected' | 'in_house' | 'departed';
  guestName: string;
  adults: number;
  childrenAges: number[];
  vip: boolean;
  rate: number;
  depositMinor: number;
  payment: PaymentState;
  paidMinor: number;
  registrationComplete: boolean;
  requests: Array<{ text: string; status: 'open' | 'prepared' }>;
  /** Property-local HH:MM. */
  eta: string | null;
  transport: {
    mode: TransportMode;
    number: string;
    inbound: string;
    scheduled: string;
    estimated: string;
    delayReason?: string;
  } | null;
  checkedInAt: string | null;
  lateCheckOut: boolean;
}

export interface PropertySimulation {
  property: PropertyContext;
  units: SimUnit[];
  stays: SimStay[];
  blocks: TimelineItemView[];
  holds: TimelineItemView[];
  conditions: Map<string, Condition>;
  scenarios: Map<string, ArrivalScenario>;
  generatedAt: string;
  now: Date;
}

type ArrivalScenario =
  | 'ready_vip'
  | 'failed_inspection'
  | 'payment_pending'
  | 'unassigned'
  | 'transfer_delayed'
  | 'registration_missing'
  | 'cleaning'
  | 'checked_in'
  | 'request_open'
  | 'ready';

const SCENARIO_ORDER: ArrivalScenario[] = [
  'failed_inspection',
  'ready_vip',
  'payment_pending',
  'transfer_delayed',
  'unassigned',
  'checked_in',
  'registration_missing',
  'cleaning',
  'request_open',
  'checked_in',
];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function layoutFor(profile: string): UnitTypeSpec[] {
  switch (profile) {
    case 'resort':
      return [
        {
          name: 'Beach Villa',
          code: 'BV',
          section: 'Beach North',
          numbers: range(101, 140),
          rate: 65000,
          maxAdults: 3,
        },
        {
          name: 'Beach Villa with Pool',
          code: 'BVP',
          section: 'Beach South',
          numbers: range(141, 160),
          rate: 89000,
          maxAdults: 3,
        },
        {
          name: 'Water Villa',
          code: 'WV',
          section: 'Jetty A',
          numbers: range(201, 240),
          rate: 98000,
          maxAdults: 2,
        },
        {
          name: 'Sunset Water Villa with Pool',
          code: 'SWVP',
          section: 'Jetty B',
          numbers: range(241, 256),
          rate: 135000,
          maxAdults: 2,
        },
        {
          name: 'Two-Bedroom Beach Residence',
          code: 'RES2',
          section: 'Residences',
          numbers: range(301, 304),
          rate: 260000,
          maxAdults: 4,
        },
      ];
    case 'guesthouse':
      return [
        {
          name: 'Standard Double',
          code: 'STD',
          section: 'Ground floor',
          numbers: range(1, 6),
          rate: 8500,
          maxAdults: 2,
        },
        {
          name: 'Deluxe Sea View',
          code: 'DLX',
          section: 'First floor',
          numbers: range(7, 10),
          rate: 11000,
          maxAdults: 2,
        },
        {
          name: 'Family Room',
          code: 'FAM',
          section: 'First floor',
          numbers: range(11, 12),
          rate: 14000,
          maxAdults: 4,
        },
      ];
    case 'serviced_apartments':
      return [
        { name: 'Studio', code: 'STU', section: 'Tower', numbers: range(1, 16), rate: 12000, maxAdults: 2 },
        {
          name: 'One-Bedroom Apartment',
          code: 'APT1',
          section: 'Tower',
          numbers: range(17, 24),
          rate: 18000,
          maxAdults: 3,
        },
      ];
    default:
      return [
        {
          name: 'Superior Room',
          code: 'SUP',
          section: 'Floor 1',
          numbers: range(101, 140),
          rate: 16000,
          maxAdults: 2,
        },
        {
          name: 'Deluxe Ocean View',
          code: 'DOV',
          section: 'Floor 2',
          numbers: range(201, 220),
          rate: 22000,
          maxAdults: 2,
        },
        {
          name: 'Junior Suite',
          code: 'JS',
          section: 'Floor 3',
          numbers: range(301, 304),
          rate: 34000,
          maxAdults: 3,
        },
      ];
  }
}

// Unique names: first name × family name (1 024 combinations), then a middle initial — never a repeat.
const FIRST = [
  'Sophie',
  'Wei',
  'Arjun',
  'Fatima',
  'Elena',
  'James',
  'Hiroshi',
  'Lukas',
  'Priya',
  'Marco',
  'Chloé',
  'Ahmed',
  'Anna',
  'Daniel',
  'Mei',
  'Rahul',
  'Isabella',
  'Thomas',
  'Yuki',
  'Olga',
  'Liam',
  'Sara',
  'Kenji',
  'Noura',
  'Mateo',
  'Emma',
  'Vikram',
  'Camille',
  'Jonas',
  'Ayesha',
  'Li',
  'Gabriel',
];
const FAMILY = [
  'Laurent',
  'Zhang',
  'Mehta',
  'Al Mansouri',
  'Petrova',
  'Carter',
  'Tanaka',
  'Becker',
  'Nair',
  'Rossi',
  'Martin',
  'Al Rashid',
  'Kowalska',
  'Schneider',
  'Lin',
  'Kapoor',
  'García',
  'Müller',
  'Sato',
  'Ivanova',
  'O’Connor',
  'Lindqvist',
  'Watanabe',
  'Al Hashimi',
  'Fernández',
  'Johansson',
  'Singh',
  'Dubois',
  'Andersen',
  'Khan',
  'Na',
  'Costa',
];
const guestName = (i: number) => {
  const period = FIRST.length * FAMILY.length;
  const n = i % period;
  const round = Math.floor(i / period);
  const initial = round > 0 ? ` ${'ABCDEFGHJKLMNPRSTW'[(round - 1) % 18]}.` : '';
  return `${FIRST[n % FIRST.length]}${initial} ${FAMILY[(n + Math.floor(n / FIRST.length)) % FAMILY.length]}`;
};
/** Housekeeping attendants (never the front-desk team). */
const ATTENDANTS = ['Mariyam', 'Hawwa', 'Fathimath', 'Shifza', 'Ibrahim', 'Ali', 'Hussain', 'Mohamed'];
const INBOUND = [
  'EK 652 from Dubai',
  'QR 674 from Doha',
  'SQ 452 from Singapore',
  'TK 734 from Istanbul',
  'UL 101 from Colombo',
  'EY 278 from Abu Dhabi',
];
const OOO_REASONS = [
  'Air-conditioning compressor replacement',
  'Deck boards replaced after storm',
  'Desalinated water line leak',
  'Pool pump service',
];
const TRANSPORT_LABEL: Record<TransportMode, string> = {
  seaplane: 'Seaplane',
  speedboat: 'Speedboat',
  domestic_flight: 'Domestic flight + speedboat',
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic RFC 9562 version-8 UUID for a simulated entity (the real contracts require UUIDs). */
export function simUuid(key: string): string {
  const hex = ['a', 'b', 'c', 'd']
    .map((salt) => hash(`${salt}:${key}`).toString(16).padStart(8, '0'))
    .join('');
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T,
    chance: (p: number) => next() < p,
  };
}

function offsetFor(timeZone: string, date: LocalDate): string {
  try {
    const part = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${date}T12:00:00Z`))
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = /GMT([+-]\d{2}:\d{2})/.exec(part ?? '');
    return m?.[1] ?? '+00:00';
  } catch {
    return '+00:00';
  }
}

const code = (r: ReturnType<typeof rng>) =>
  Array.from({ length: 8 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[r.int(0, 29)]).join('');
const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

function at(sim: PropertySimulation, date: LocalDate, time: string): string {
  return `${date}T${time}:00${offsetFor(sim.property.timezone, date)}`;
}
/** A past instant for "already happened today" events: never later than now. */
function notAfterNow(sim: PropertySimulation, iso: string): string {
  return Date.parse(iso) <= sim.now.getTime()
    ? iso
    : new Date(sim.now.getTime() - 10 * 60_000).toISOString().replace('Z', '+00:00');
}

const requiredCondition = (profile: string): 'clean' | 'inspected' =>
  profile === 'guesthouse' ? 'clean' : 'inspected';
const RANK: Record<Condition, number> = {
  failed_inspection: 0,
  dirty: 1,
  cleaning: 2,
  clean: 3,
  inspected: 4,
};
const meets = (c: Condition, required: 'clean' | 'inspected') =>
  c !== 'failed_inspection' && RANK[c] >= RANK[required];

export function simulateProperty(property: PropertyContext, now: Date = new Date()): PropertySimulation {
  // Content is seeded by property CODE + business date, so a fresh database shows the same sample day.
  const r = rng(hash(`${property.code}:${property.businessDate}`));
  const idOf = (key: string) => simUuid(`${property.id}:${key}`);
  const bd = property.businessDate;
  const resort = property.profile === 'resort';
  const units: SimUnit[] = layoutFor(property.profile).flatMap((t) =>
    t.numbers.map((n) => ({
      id: idOf(`unit:${n}`),
      number: resort ? `Villa ${n}` : property.profile === 'guesthouse' ? `Room ${n}` : `${n}`,
      typeId: idOf(`type:${t.code}`),
      typeCode: t.code,
      typeName: t.name,
      sectionId: idOf(`section:${t.section}`),
      section: t.section,
      rate: t.rate,
      maxAdults: t.maxAdults,
    })),
  );

  const blocks: TimelineItemView[] = [];
  const blockedNights = new Map<string, Array<[LocalDate, LocalDate]>>();
  const blockCount = Math.max(1, Math.round(units.length / 40));
  for (let i = 0; i < blockCount; i++) {
    const u = units[r.int(0, units.length - 1)] as SimUnit;
    const from = addDays(bd, r.int(-1, 9));
    const to = addDays(from, r.int(2, 5));
    blocks.push({
      id: idOf(`block:${u.id}:${i}`),
      unitId: u.id,
      kind: 'block',
      from,
      to,
      label: r.pick(OOO_REASONS),
      blockKind: 'out_of_order',
      flags: [],
    });
    blockedNights.set(u.id, [...(blockedNights.get(u.id) ?? []), [from, to]]);
  }

  const stays: SimStay[] = [];
  const holds: TimelineItemView[] = [];
  let guestIdx = r.int(0, FIRST.length - 1);
  const windowStart = addDays(bd, -14);
  const windowEnd = addDays(bd, 60);
  const shortStays = property.profile === 'guesthouse' || property.profile === 'hotel';
  for (const u of units) {
    let cursor = addDays(windowStart, r.int(-6, 3));
    while (cursor < windowEnd) {
      const gap = r.chance(0.35) ? r.int(1, 4) : 0;
      const from = addDays(cursor, gap);
      const nights = shortStays ? r.int(1, 5) : r.int(3, 9);
      const to = addDays(from, nights);
      cursor = to;
      const blocked = (blockedNights.get(u.id) ?? []).some(([bf, bt]) => from < bt && bf < to);
      if (blocked) {
        cursor = addDays(to, 1);
        continue;
      }
      if (from > addDays(bd, 3) && r.chance(0.04)) {
        holds.push({
          id: idOf(`hold:${u.id}:${from}`),
          unitId: u.id,
          kind: 'hold',
          from,
          to,
          label: `Option ${code(r).slice(0, 5)}`,
          flags: [],
        });
        continue;
      }
      // Departing today: about a third have not checked out yet (late check-out / seaplane later today).
      const status: SimStay['status'] =
        to < bd || (to === bd && r.chance(0.65)) ? 'departed' : from < bd ? 'in_house' : 'expected';
      const adults = Math.min(u.maxAdults, r.chance(0.8) ? 2 : r.int(1, u.maxAdults));
      const childrenAges = u.maxAdults >= 3 && r.chance(0.25) ? [r.int(2, 12)] : [];
      const deposit = Math.round((u.rate * nights * 0.3) / 100) * 100;
      const total = stayTotals(u.rate, nights, adults + childrenAges.length, property.profile).total;
      // Payment facts: fully prepaid (balance 0), deposit paid (part paid), or a card authorization only.
      const pay = r.next();
      const payment: PaymentState = pay < 0.25 ? 'paid' : pay < 0.6 ? 'partially_paid' : 'authorized';
      stays.push({
        id: idOf(`stay:${u.id}:${from}`),
        bookingId: idOf(`booking:${u.id}:${from}`),
        bookingCode: code(r),
        unitId: u.id,
        unitTypeName: u.typeName,
        unitTypeId: u.typeId,
        from,
        to,
        status,
        guestName: guestName(guestIdx++),
        adults,
        childrenAges,
        vip: r.chance(0.08),
        rate: u.rate,
        depositMinor: deposit,
        payment,
        paidMinor: payment === 'paid' ? total : payment === 'partially_paid' ? deposit : 0,
        registrationComplete: status !== 'expected' || r.chance(0.9),
        requests: [],
        eta: null,
        transport: null,
        checkedInAt: status === 'expected' ? null : `${from}T14:10:00${offsetFor(property.timezone, from)}`,
        lateCheckOut: status === 'in_house' && to === bd && r.chance(0.4),
      });
    }
  }

  const sim: PropertySimulation = {
    property,
    units,
    stays,
    blocks,
    holds,
    conditions: new Map(),
    scenarios: new Map(),
    generatedAt: now.toISOString(),
    now,
  };

  // Arrivals today: curated situations (vision 07:30) in a stable order, each with ONE clear blocker.
  const arrivalsToday = stays
    .filter((s) => s.from === bd)
    .sort((a, b) => (a.bookingCode < b.bookingCode ? -1 : 1));
  arrivalsToday.forEach((s, i) => {
    const sc = SCENARIO_ORDER[i] ?? (r.chance(0.7) ? 'ready' : 'request_open');
    sim.scenarios.set(s.id, sc);
    const mode: TransportMode = !resort
      ? 'speedboat'
      : i % 4 === 3
        ? 'domestic_flight'
        : i % 5 === 4
          ? 'speedboat'
          : 'seaplane';
    const hour = 8 + ((i * 7) % 9);
    const minute = (i * 25) % 60;
    const scheduled = hhmm(hour, minute);
    const delayed = sc === 'transfer_delayed';
    const estimated = delayed ? hhmm(Math.min(hour + 3, 17), minute) : scheduled;
    s.transport = {
      mode,
      number:
        mode === 'seaplane' ? `SP ${10 + i}` : mode === 'domestic_flight' ? `Q2 ${120 + i}` : `SB ${i + 1}`,
      inbound: INBOUND[i % INBOUND.length] as string,
      scheduled,
      estimated,
      ...(delayed ? { delayReason: 'Weather at Velana (MLE)' } : {}),
    };
    s.eta = estimated;
    s.registrationComplete = sc !== 'registration_missing';
    if (sc === 'payment_pending') {
      s.payment = 'pending_verification';
      s.paidMinor = 0;
    }
    if (sc === 'ready_vip') {
      s.vip = true;
      s.requests = [
        { text: 'Honeymoon set-up', status: 'prepared' },
        { text: 'Champagne on arrival', status: 'prepared' },
      ];
    }
    if (sc === 'request_open') s.requests = [{ text: 'Baby cot', status: 'open' }];
    if (sc === 'checked_in') {
      s.status = 'in_house';
      s.eta = '07:30';
      s.transport = { ...s.transport, scheduled: '07:30', estimated: '07:30' };
      s.checkedInAt = notAfterNow(sim, at(sim, bd, '07:55'));
    }
    if (sc === 'unassigned') s.unitId = null;
  });

  for (const u of units) {
    const inHouse = stays.find(
      (s) => s.unitId === u.id && s.status === 'in_house' && s.from < bd && s.to > bd,
    );
    const departing = stays.find((s) => s.unitId === u.id && s.to === bd);
    const arriving = stays.find((s) => s.unitId === u.id && s.from === bd);
    const sc = arriving ? sim.scenarios.get(arriving.id) : undefined;
    let c: Condition;
    if (sc === 'failed_inspection') c = 'failed_inspection';
    else if (sc === 'cleaning') c = 'cleaning';
    else if (arriving) c = 'inspected';
    else if (departing) c = r.pick(['dirty', 'dirty', 'cleaning', 'clean'] as const);
    else if (inHouse) c = r.pick(['dirty', 'clean', 'clean', 'cleaning'] as const);
    else c = r.chance(0.85) ? 'inspected' : 'clean';
    sim.conditions.set(u.id, c);
  }
  return sim;
}

// ───────────────────────── money (sample) ─────────────────────────

const SAMPLE_TAX = {
  /** SAMPLE ONLY — real rules are configuration in the rates module with source citations. */
  serviceChargeBp: 1000,
  tgstBp: 1700,
  greenTaxPerPersonNightMinor: (profile: string) => (profile === 'resort' ? 1200 : 600),
};

export interface StayTotals {
  room: number;
  serviceCharge: number;
  tgst: number;
  greenTax: number;
  total: number;
}

/** Integer minor-unit arithmetic; percentages in basis points, rounded once per line (half up). */
export function stayTotals(rate: number, nights: number, persons: number, profile: string): StayTotals {
  const room = rate * nights;
  const serviceCharge = Math.round((room * SAMPLE_TAX.serviceChargeBp) / 10_000);
  const tgst = Math.round(((room + serviceCharge) * SAMPLE_TAX.tgstBp) / 10_000);
  const greenTax = SAMPLE_TAX.greenTaxPerPersonNightMinor(profile) * persons * nights;
  return { room, serviceCharge, tgst, greenTax, total: room + serviceCharge + tgst + greenTax };
}

const money = (amountMinor: number, currency: string): Money => ({ amountMinor, currency });
const totalOf = (sim: PropertySimulation, s: SimStay) =>
  stayTotals(s.rate, diffDays(s.from, s.to), s.adults + s.childrenAges.length, sim.property.profile).total;
const balanceOf = (sim: PropertySimulation, s: SimStay) =>
  money(s.status === 'departed' ? 0 : totalOf(sim, s) - s.paidMinor, sim.property.baseCurrency);

// ───────────────────────── reservations: desk lists (real `frontDeskRow`) ─────────────────────────

const unitOf = (sim: PropertySimulation, id: string | null) => sim.units.find((u) => u.id === id) ?? null;

/** The attendant responsible for a unit today (same rule on every board). */
function attendantFor(sim: PropertySimulation, unitId: string): string {
  const i = sim.units.findIndex((u) => u.id === unitId);
  return ATTENDANTS[(Math.max(0, i) * 3) % ATTENDANTS.length] as string;
}

/** Expected ready time (an ESTIMATE) for a unit that is not ready yet. */
function expectedReady(sim: PropertySimulation, unitId: string): string {
  const i = sim.units.findIndex((u) => u.id === unitId);
  return at(sim, sim.property.businessDate, hhmm(11 + (i % 5), [10, 25, 40, 55][i % 4] ?? 10));
}

/** Mirrors reservations' composeReadiness: distinct facts, exactly one blocker (the first non-ok check). */
function readinessFor(sim: PropertySimulation, s: SimStay): ReadinessView {
  const checks: ReadinessCheck[] = [];
  const bd = sim.property.businessDate;
  const unit = unitOf(sim, s.unitId);
  const required = requiredCondition(sim.property.profile);
  if (!unit) {
    const free = sim.units.filter(
      (u) =>
        u.typeName === s.unitTypeName &&
        meets(sim.conditions.get(u.id) ?? 'dirty', required) &&
        !sim.stays.some((o) => o.unitId === u.id && o.from <= bd && bd < o.to),
    ).length;
    checks.push({
      key: 'unit_assigned',
      status: 'blocking',
      message: `No unit assigned yet — ${free} ${s.unitTypeName} ${free === 1 ? 'is' : 'are'} ready and free today.`,
    });
    checks.push({ key: 'unit_ready', status: 'blocking', message: 'Assign a unit to see its condition.' });
  } else {
    checks.push({ key: 'unit_assigned', status: 'ok', message: `${unit.number} assigned.` });
    const c = sim.conditions.get(unit.id) ?? 'dirty';
    const ready = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: sim.property.timezone,
    }).format(new Date(expectedReady(sim, unit.id)));
    checks.push(
      meets(c, required)
        ? {
            key: 'unit_ready',
            status: 'ok',
            message: `${unit.number} is ${c === 'inspected' ? 'inspected' : 'clean'}.`,
          }
        : {
            key: 'unit_ready',
            status: 'blocking',
            message:
              c === 'failed_inspection'
                ? `${unit.number} failed inspection (shower drain) — re-clean assigned to ${attendantFor(sim, unit.id)}, ready about ${ready} (estimate).`
                : c === 'cleaning'
                  ? `${unit.number} is being cleaned — ready about ${ready} (estimate).`
                  : c === 'clean'
                    ? `${unit.number} is clean and waiting for inspection.`
                    : `${unit.number} is dirty; cleaning has not started.`,
          },
    );
  }
  checks.push(
    s.payment === 'pending_verification'
      ? {
          key: 'payment_secured',
          status: 'blocking',
          message:
            'Payment outcome is pending verification — do not take payment again; reconciliation will resolve it.',
        }
      : s.payment === 'authorized'
        ? { key: 'payment_secured', status: 'ok', message: 'Card authorized (not yet charged).' }
        : s.payment === 'partially_paid'
          ? {
              key: 'payment_secured',
              status: 'ok',
              message: 'Deposit received; the balance is due at check-out.',
            }
          : s.payment === 'paid'
            ? { key: 'payment_secured', status: 'ok', message: 'Payment received.' }
            : {
                key: 'payment_secured',
                status: 'blocking',
                message: 'No card authorization or deposit yet.',
              },
  );
  checks.push(
    s.registrationComplete
      ? { key: 'registration', status: 'ok', message: 'Registration details received.' }
      : {
          key: 'registration',
          status: 'blocking',
          message: `Passport details missing for ${s.adults} ${s.adults === 1 ? 'adult' : 'adults'} (guest register).`,
        },
  );
  const open = s.requests.filter((q) => q.status === 'open');
  checks.push(
    open.length
      ? {
          key: 'requests',
          status: 'blocking',
          message: `${open.map((q) => q.text).join(', ')} — not yet prepared by housekeeping.`,
        }
      : {
          key: 'requests',
          status: 'ok',
          message: s.requests.length ? 'Requests prepared.' : 'No open requests.',
        },
  );
  const blocker = checks.find((c) => c.status !== 'ok');
  return {
    ready: !blocker,
    checks,
    blockingReason: blocker ? { key: blocker.key, message: blocker.message } : null,
  };
}

function deskRow(sim: PropertySimulation, s: SimStay, date: LocalDate): FrontDeskRow {
  const unit = unitOf(sim, s.unitId);
  const flags: string[] = [];
  if (s.from === date) flags.push('arriving_today');
  if (s.to === date) flags.push('departing_today');
  if (s.status === 'in_house' && date > s.to) flags.push('overstay');
  if (s.status === 'expected' && s.from < date) flags.push('late_arrival');
  if (s.lateCheckOut) flags.push('late_check_out');
  const pendingRun = s.status === 'expected' && s.payment === 'pending_verification';
  if (pendingRun) flags.push('check_in_in_progress');
  return {
    stayId: s.id,
    bookingId: s.bookingId,
    bookingCode: s.bookingCode,
    bookingStatus: 'confirmed',
    stayStatus: s.status,
    guestName: s.guestName,
    arrival: s.from,
    departure: s.to,
    unitTypeId: s.unitTypeId,
    unitId: unit?.id ?? null,
    unitName: unit?.number ?? null,
    eta: s.eta,
    occupancy: { adults: s.adults, childrenAges: s.childrenAges },
    flags,
    // Reservations composes readiness only for stays still expected.
    readiness: s.status === 'expected' ? readinessFor(sim, s) : null,
    balance: balanceOf(sim, s),
    checkInRun:
      s.status === 'in_house' && s.from === date
        ? { status: 'completed', remaining: [] }
        : pendingRun
          ? { status: 'in_progress', remaining: ['payment', 'access'] }
          : null,
  };
}

export function deskListFor(sim: PropertySimulation, kind: DeskListKind): DeskList {
  const bd = sim.property.businessDate;
  const pick =
    kind === 'arrivals'
      ? (s: SimStay) => s.from === bd && (s.status === 'expected' || s.status === 'in_house')
      : kind === 'departures'
        ? (s: SimStay) => s.status === 'in_house' && s.to <= bd
        : (s: SimStay) => s.status === 'in_house';
  const items = sim.stays
    .filter(pick)
    .map((s) => deskRow(sim, s, bd))
    .sort(
      (a, b) => (a.eta ?? '99').localeCompare(b.eta ?? '99') || a.bookingCode.localeCompare(b.bookingCode),
    );
  const counts: Record<string, number> = { total: items.length };
  if (kind === 'arrivals') counts.ready = items.filter((r) => r.readiness?.ready).length;
  if (kind === 'departures')
    counts.withBalance = items.filter((r) => (r.balance?.amountMinor ?? 0) !== 0).length;
  return { date: bd, businessDate: bd, items, counts };
}

// ───────────────────────── operations: housekeeping board (real `board`) ─────────────────────────

export function boardFor(sim: PropertySimulation): OperationsBoard {
  const bd = sim.property.businessDate;
  const r = rng(hash(`${sim.property.code}:hk:${bd}`));
  const required = requiredCondition(sim.property.profile);
  const rows: BoardRow[] = sim.units.map((u, i) => {
    const condition = sim.conditions.get(u.id) ?? 'clean';
    const inHouse = sim.stays.find(
      (s) => s.unitId === u.id && s.status === 'in_house' && s.from <= bd && s.to > bd,
    );
    const departing = sim.stays.find((s) => s.unitId === u.id && s.to === bd);
    const arriving = sim.stays.find((s) => s.unitId === u.id && s.from === bd && s.status === 'expected');
    const block = sim.blocks.find((b) => b.unitId === u.id && b.from <= bd && bd < b.to);
    const ready = meets(condition, required) && !block;
    const reasons: string[] = [];
    let priority: BoardRow['topPriority'] = null;
    if (arriving && !ready) {
      priority = condition === 'failed_inspection' ? 'urgent' : 'high';
      reasons.push(`Arrival today${arriving.eta ? ` (ETA ${arriving.eta})` : ''}`);
      if (arriving.vip) reasons.push('VIP');
    } else if (departing && !meets(condition, required)) {
      priority = 'normal';
      reasons.push('Departure clean');
    } else if (inHouse && condition === 'dirty') {
      priority = 'low';
      reasons.push('Stayover service');
    }
    if (condition === 'failed_inspection') reasons.push('Failed inspection — re-clean');
    const needsWork = !meets(condition, required) && !block;
    const kind =
      condition === 'failed_inspection'
        ? 'reclean'
        : departing
          ? 'departure_clean'
          : inHouse
            ? 'stayover'
            : 'vacant_clean';
    const dnd = Boolean(inHouse) && r.chance(0.12);
    const discrepancy = inHouse && i % 37 === 5 ? 'skip' : !inHouse && i % 53 === 7 ? 'sleep' : 'none';
    const occupancy = inHouse ? 'occupied' : 'vacant';
    return {
      unit: {
        unitId: u.id,
        propertyId: sim.property.id,
        unitNumber: u.number,
        unitTypeId: u.typeId,
        unitTypeCode: u.typeCode,
        sectionId: u.sectionId,
        sectionName: u.section,
        floor: null,
        features: [],
        condition,
        conditionChangedAt: notAfterNow(sim, at(sim, bd, '07:00')),
        occupancy,
        occupancyStayId: inHouse?.id ?? null,
        observedOccupancy: null,
        observedAt: null,
        discrepancy,
        dnd,
        dndSince: dnd ? notAfterNow(sim, at(sim, bd, '08:10')) : null,
        turndown: 'not_required',
        lastCleanedAt: null,
        lastInspectedAt: null,
        lastInspectionResult:
          condition === 'failed_inspection' ? 'failed' : condition === 'inspected' ? 'passed' : null,
        block: block
          ? {
              kind: 'out_of_order',
              blockId: block.id,
              from: block.from,
              to: block.to,
              reason: block.label,
              workOrderId: null,
            }
          : null,
        readiness: {
          ready,
          requiredCondition: required,
          reasons: block
            ? [{ code: 'blocked', message: `Out of order: ${block.label}` }]
            : ready
              ? []
              : [
                  {
                    code: 'condition',
                    message: `${u.number} is ${condition.replace('_', ' ')}; ${required} required.`,
                  },
                ],
          readyAt: null,
          expectedReadyAt: needsWork ? expectedReady(sim, u.id) : null,
          estimateBasis: needsWork ? ['Typical cleaning time for this unit type (sample)'] : [],
          assessedAt: sim.generatedAt,
        },
        pendingChange: null,
        provenance: 'simulated',
        externalSyncedAt: null,
        version: 1,
        status: { condition, occupancy },
        allowedActions: [],
        issues: [],
        links: [],
      },
      arrival: arriving
        ? {
            stayId: arriving.id,
            eta: arriving.eta ? at(sim, bd, arriving.eta) : null,
            vip: arriving.vip,
            earlyCheckIn: false,
            guestLabel: arriving.guestName.split(' ').at(-1) ?? arriving.guestName,
          }
        : null,
      departureToday: departing ? { stayId: departing.id, status: departing.status } : null,
      topPriority: priority,
      priorityReasons: reasons,
      openTasks:
        needsWork || (inHouse && condition === 'dirty')
          ? [
              {
                taskId: simUuid(`${u.id}:task:${bd}`),
                kind,
                status: condition === 'cleaning' ? 'in_progress' : 'open',
                priority: priority ?? 'normal',
                assigneeUserId: null,
                assigneeName: attendantFor(sim, u.id),
              },
            ]
          : [],
    };
  });
  const tally = (f: (row: BoardRow) => string) =>
    rows.reduce<Record<string, number>>((m, row) => {
      const k = f(row);
      m[k] = (m[k] ?? 0) + 1;
      return m;
    }, {});
  return {
    propertyId: sim.property.id,
    businessDate: bd,
    generatedAt: sim.generatedAt,
    counts: {
      byCondition: tally((x) => x.unit.condition),
      byOccupancy: tally((x) => x.unit.occupancy),
      discrepancies: rows.filter((x) => x.unit.discrepancy !== 'none').length,
      dnd: rows.filter((x) => x.unit.dnd).length,
      arrivalsNotReady: rows.filter((x) => x.arrival && !x.unit.readiness.ready).length,
    },
    rows,
  };
}

// ───────────────────────── timeline ─────────────────────────

export function timelineFor(sim: PropertySimulation, from: LocalDate, days: number): TimelineView {
  const end = addDays(from, days);
  const cur = sim.property.baseCurrency;
  const items: TimelineItemView[] = [
    ...sim.stays
      .filter((s) => s.unitId && s.to > from && s.from < end)
      .map((s) => ({
        id: s.id,
        unitId: s.unitId as string,
        kind: 'stay' as const,
        from: s.from,
        to: s.to,
        label: s.guestName,
        bookingCode: s.bookingCode,
        stayStatus: s.status,
        flags: [...(s.vip ? ['VIP'] : [])],
        guests: s.adults + s.childrenAges.length,
        nightlyRate: money(s.rate, cur),
      })),
    ...sim.blocks.filter((b) => b.to > from && b.from < end),
    ...sim.holds.filter((h) => h.to > from && h.from < end),
  ];
  return {
    from,
    days,
    units: sim.units.map((u) => ({
      unitId: u.id,
      unitNumber: u.number,
      unitTypeName: u.typeName,
      condition: sim.conditions.get(u.id) ?? 'clean',
    })),
    items,
  };
}

// ───────────────────────── change preview (extend stay) ─────────────────────────

const fmtMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'code' }).format(minor / 100);
const fmtDelta = (minor: number, currency: string) =>
  minor === 0 ? '' : `${minor > 0 ? '+' : '−'}${fmtMoney(Math.abs(minor), currency)}`;

/** Free units of a type for a night (assigned stays and blocks consume units). */
function freeUnits(sim: PropertySimulation, typeName: string, night: LocalDate): number {
  const ofType = sim.units.filter((u) => u.typeName === typeName);
  return ofType.filter(
    (u) =>
      !sim.stays.some(
        (s) => s.unitId === u.id && s.from <= night && night < s.to && s.status !== 'departed',
      ) && !sim.blocks.some((b) => b.unitId === u.id && b.from <= night && night < b.to),
  ).length;
}

/** A problem the simulated module would answer with (mapped to problem+json by the adapter). */
export class SimulatedProblem extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const notFound = () =>
  new SimulatedProblem('stay_not_found', 404, 'This stay could not be found. It may have been cancelled.');

export function previewExtension(
  sim: PropertySimulation,
  stayId: string,
  extraNights: number,
  now: Date,
): StayChangePreview {
  const s = sim.stays.find((x) => x.id === stayId);
  if (!s) throw notFound();
  const cur = sim.property.baseCurrency;
  const persons = s.adults + s.childrenAges.length;
  const nights = diffDays(s.from, s.to);
  const before = stayTotals(s.rate, nights, persons, sim.property.profile);
  const after = stayTotals(s.rate, nights + extraNights, persons, sim.property.profile);
  const unit = unitOf(sim, s.unitId);
  const newTo = addDays(s.to, extraNights);
  const blockers: string[] = [];
  const availability = Array.from({ length: extraNights }, (_, i) => {
    const night = addDays(s.to, i);
    const free = freeUnits(sim, s.unitTypeName, night);
    const other = sim.stays.find(
      (o) => o.id !== s.id && o.unitId === s.unitId && o.from <= night && night < o.to,
    );
    if (other && !blockers.length)
      blockers.push(
        `${unit?.number ?? 'The assigned unit'} is booked by another guest from ${other.from}. Shorten the extension to end before then, or move the guest to another unit first.`,
      );
    return {
      label: `${s.unitTypeName} · night of ${night}`,
      before: `${free} free`,
      after: `${Math.max(free - 1, 0)} free${free - 1 < 0 ? ' (oversold)' : ''}`,
      delta: '−1',
      changed: true,
      ...(other ? { attention: 'danger' as const } : free - 1 <= 0 ? { attention: 'warning' as const } : {}),
    };
  });
  const paid = s.paidMinor;
  return {
    token: `pv-${s.id}-${extraNights}`,
    stayId: s.id,
    title: `Extend stay of ${s.guestName} by ${extraNights} night${extraNights === 1 ? '' : 's'}`,
    summary: `${unit?.number ?? s.unitTypeName} · departure ${s.to} → ${newTo}. Agreed prices for existing nights are kept; new nights are priced at the stay's rate.`,
    validUntil: new Date(now.getTime() + 10 * 60_000).toISOString(),
    feasible: blockers.length === 0,
    blockers,
    sections: [
      { kind: 'availability', rows: availability },
      {
        kind: 'price',
        rows: [
          {
            label: 'Nights',
            before: String(nights),
            after: String(nights + extraNights),
            delta: `+${extraNights}`,
            changed: true,
          },
          {
            label: 'Accommodation',
            before: fmtMoney(before.room, cur),
            after: fmtMoney(after.room, cur),
            delta: fmtDelta(after.room - before.room, cur),
            changed: true,
          },
        ],
      },
      {
        kind: 'taxes',
        rows: [
          {
            label: 'Service charge (10%)',
            before: fmtMoney(before.serviceCharge, cur),
            after: fmtMoney(after.serviceCharge, cur),
            delta: fmtDelta(after.serviceCharge - before.serviceCharge, cur),
            changed: true,
          },
          {
            label: 'TGST (17%)',
            before: fmtMoney(before.tgst, cur),
            after: fmtMoney(after.tgst, cur),
            delta: fmtDelta(after.tgst - before.tgst, cur),
            changed: true,
          },
          {
            label: `Green Tax (${persons} guests)`,
            before: fmtMoney(before.greenTax, cur),
            after: fmtMoney(after.greenTax, cur),
            delta: fmtDelta(after.greenTax - before.greenTax, cur),
            changed: true,
          },
        ],
        note: 'Sample amounts for demonstration — not this property’s tax configuration.',
      },
      {
        kind: 'deposits',
        rows: [
          {
            label: 'Received so far (held as a liability)',
            before: fmtMoney(paid, cur),
            after: fmtMoney(paid, cur),
            changed: false,
          },
        ],
        note: 'No additional deposit is required by the agreed terms.',
      },
      {
        kind: 'balance',
        rows: [
          {
            label: 'Balance due at check-out',
            before: fmtMoney(before.total - paid, cur),
            after: fmtMoney(after.total - paid, cur),
            delta: fmtDelta(after.total - before.total, cur),
            changed: true,
          },
        ],
      },
    ],
    consequences: [
      `Departure moves from ${s.to} to ${newTo}; the departure clean is re-planned.`,
      `Housekeeping: stayover service continues for ${extraNights} more night${extraNights === 1 ? '' : 's'}.`,
      'Nothing is charged now; the folio receives the new nights at Day Close.',
    ],
  };
}

export function commitExtension(sim: PropertySimulation, stayId: string, extraNights: number) {
  const s = sim.stays.find((x) => x.id === stayId);
  if (!s) throw notFound();
  const newTo = addDays(s.to, extraNights);
  const clash = sim.stays.find(
    (o) => o.id !== s.id && o.unitId === s.unitId && o.from < newTo && s.to < o.to,
  );
  if (clash) {
    throw new SimulatedProblem(
      'unit_assignment_conflict',
      409,
      `The assigned unit is booked by another guest from ${clash.from}, so the stay was not extended. Shorten the extension or move the guest to another unit first.`,
    );
  }
  s.to = newTo;
  return { stayId: s.id, departure: s.to };
}

// ───────────────────────── records ─────────────────────────

export function stayRecord(sim: PropertySimulation, stayId: string): StayRecordView | null {
  const s = sim.stays.find((x) => x.id === stayId);
  if (!s) return null;
  const unit = unitOf(sim, s.unitId);
  const booked = addDays(s.from, -30 - (s.bookingCode.charCodeAt(0) % 40));
  const agent = { kind: 'user', label: 'Reservations agent' };
  const events = [
    { at: at(sim, booked, '09:14'), action: 'reservations.booking.confirm', actor: agent, reason: null },
    ...(s.payment !== 'none'
      ? [
          {
            at: at(sim, addDays(booked, 1), '11:02'),
            action: 'payments.paymentRequest.create',
            actor: agent,
            reason: 'Deposit 30% per agreed terms',
          },
        ]
      : []),
    ...(s.transport
      ? [
          {
            at: at(sim, addDays(s.from, -3), '16:40'),
            action: 'reservations.stay.arrivalDetails.update',
            actor: { kind: 'system', label: 'Pre-arrival form' },
            reason: null,
          },
        ]
      : []),
    ...(unit
      ? [
          {
            at: at(sim, addDays(s.from, -1), '18:05'),
            action: 'inventory.assignment.create',
            actor: { kind: 'user', label: 'Aishath (front desk)' },
            reason: null,
          },
        ]
      : []),
    ...(s.checkedInAt
      ? [
          {
            at: s.checkedInAt,
            action: 'reservations.stay.checkIn',
            actor: { kind: 'user', label: 'Ahmed (front desk)' },
            reason: null,
          },
        ]
      : []),
  ]
    // History never contains the future.
    .filter((e) => Date.parse(e.at) <= sim.now.getTime())
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return {
    stayId: s.id,
    bookingId: s.bookingId,
    bookingCode: s.bookingCode,
    bookingStatus: 'confirmed',
    stayStatus: s.status,
    guestName: s.guestName,
    vip: s.vip,
    unitId: unit?.id ?? null,
    unitName: unit?.number ?? null,
    unitTypeName: s.unitTypeName,
    unitCondition: unit ? (sim.conditions.get(unit.id) ?? null) : null,
    arrival: s.from,
    departure: s.to,
    occupancy: { adults: s.adults, childrenAges: s.childrenAges },
    eta: s.eta,
    arrivalDetails: s.transport
      ? {
          transportMode: s.transport.mode,
          carrier: TRANSPORT_LABEL[s.transport.mode],
          number: s.transport.number,
          inbound: s.transport.inbound,
          scheduledTime: s.transport.scheduled,
          estimatedTime: s.transport.estimated,
          ...(s.transport.delayReason ? { delayReason: s.transport.delayReason } : {}),
          arrivalPoint: 'Velana International Airport (MLE)',
        }
      : null,
    paymentStatus: s.payment,
    balance: balanceOf(sim, s),
    nightlyRate: money(s.rate, sim.property.baseCurrency),
    requests: s.requests,
    readiness: s.status === 'expected' ? readinessFor(sim, s) : null,
    checkedInAt: s.checkedInAt,
    history: events,
  };
}

export function unitRecord(sim: PropertySimulation, unitId: string): UnitRecordView | null {
  const row = boardFor(sim).rows.find((r) => r.unit.unitId === unitId);
  if (!row) return null;
  const bd = sim.property.businessDate;
  const stays = timelineFor(sim, addDays(bd, -3), 21).items.filter((i) => i.unitId === unitId);
  return { row, stays };
}

// ───────────────────────── My work + overview ─────────────────────────

const AREA_BY_CHECK: Record<string, WorkItem['area']> = {
  unit_assigned: 'front_desk',
  unit_ready: 'housekeeping',
  payment_secured: 'payments',
  registration: 'front_desk',
  requests: 'housekeeping',
};

export function workItemsFor(sim: PropertySimulation): WorkItem[] {
  const bd = sim.property.businessDate;
  const items: WorkItem[] = [];
  for (const a of deskListFor(sim, 'arrivals').items) {
    const b = a.readiness?.blockingReason;
    if (!b) continue;
    items.push({
      id: `ex-${a.stayId}`,
      kind: 'exception',
      area: AREA_BY_CHECK[b.key] ?? 'front_desk',
      title: `${a.guestName ?? a.bookingCode}: ${(b.message.split(' — ')[0] ?? b.message).replace(/\.$/, '')}`,
      detail: b.message,
      priority: b.key === 'unit_ready' || b.key === 'payment_secured' ? 'urgent' : 'high',
      assignee: null,
      dueAt: a.eta ? at(sim, bd, a.eta) : null,
      record: { type: 'stay', id: a.stayId, title: a.guestName ?? a.bookingCode },
    });
  }
  for (const r of boardFor(sim)
    .rows.filter((x) => x.topPriority === 'urgent' || x.topPriority === 'high')
    .slice(0, 6)) {
    items.push({
      id: `task-${r.unit.unitId}`,
      kind: 'task',
      area: 'housekeeping',
      title: `${r.unit.condition === 'failed_inspection' ? 'Re-clean' : 'Clean and inspect'} ${r.unit.unitNumber}`,
      detail: r.priorityReasons.join(' · '),
      priority: r.topPriority ?? 'normal',
      assignee: r.openTasks[0]?.assigneeName ?? null,
      dueAt: r.unit.readiness.expectedReadyAt,
      record: { type: 'unit', id: r.unit.unitId, title: r.unit.unitNumber },
    });
  }
  // Approvals and handover reference this property's own units and types (never another property's).
  const type = sim.units[sim.units.length - 1];
  const inHouse = sim.stays.find((s) => s.status === 'in_house' && s.unitId);
  const handoverUnit = unitOf(sim, inHouse?.unitId ?? null);
  if (type) {
    items.push({
      id: 'appr-rate',
      kind: 'approval',
      area: 'rates',
      title: `Approve rate override: ${type.typeName}, 3 nights at −15%`,
      detail: 'Requested by the reservations team for a returning guest.',
      priority: 'normal',
      assignee: null,
      dueAt: at(sim, bd, '17:00'),
      record: null,
    });
  }
  items.push({
    id: 'handover-night',
    kind: 'handover',
    area: 'front_desk',
    title: 'Night shift handover: 2 items to acknowledge',
    detail: `Late arrival by speedboat after 22:00${handoverUnit ? `; minibar charge disputed in ${handoverUnit.number}` : ''}.`,
    priority: 'normal',
    assignee: null,
    dueAt: notAfterNow(sim, at(sim, bd, '08:00')),
    record: null,
  });
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
  return items.sort(
    (a, b) => rank[a.priority] - rank[b.priority] || (a.dueAt ?? '').localeCompare(b.dueAt ?? ''),
  );
}

function occupiedOn(sim: PropertySimulation, date: LocalDate, typeName?: string) {
  const units = sim.units.filter((u) => !typeName || u.typeName === typeName);
  const ids = new Set(units.map((u) => u.id));
  const ooo = sim.blocks.filter((b) => ids.has(b.unitId) && b.from <= date && date < b.to).length;
  const occupied = sim.stays.filter(
    (s) => s.unitId && ids.has(s.unitId) && s.from <= date && date < s.to,
  ).length;
  return { occupied, sellable: units.length - ooo, outOfOrder: ooo };
}

/** Figures the boards don't show. Everything is derived from the same stays — no adjustments. */
export function overviewFor(sim: PropertySimulation): OverviewView {
  const bd = sim.property.businessDate;
  const tonight = occupiedOn(sim, bd);
  const lw = occupiedOn(sim, addDays(bd, -7));
  const pending = sim.stays.filter((s) => s.payment === 'pending_verification' && s.status !== 'departed');
  const types = [...new Set(sim.units.map((u) => u.typeName))];
  return {
    businessDate: bd,
    occupancy: { ...tonight, lastWeek: { occupied: lw.occupied, sellable: lw.sellable } },
    pendingVerification: {
      count: pending.length,
      amount: money(
        pending.reduce((n, s) => n + s.depositMinor, 0),
        sim.property.baseCurrency,
      ),
      stays: pending.map((s) => ({ stayId: s.id, title: s.guestName })),
    },
    forecast: types.map((t) => ({
      unitTypeName: t,
      nights: Array.from({ length: 14 }, (_, i) => {
        const date = addDays(bd, i);
        const o = occupiedOn(sim, date, t);
        return { date, occupied: o.occupied, sellable: o.sellable };
      }),
    })),
  };
}
