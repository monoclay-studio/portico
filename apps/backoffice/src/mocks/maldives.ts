/**
 * SIMULATED operational data for a property — deterministic per property id and business date, with realistic
 * Maldives content (villas over the lagoon, seaplane and speedboat transfers via Velana International Airport).
 *
 * One simulation per property produces the arrivals board, the housekeeping board and the timeline from the
 * same stays, so the three screens agree with each other ("one set of facts").
 *
 * Everything here is sample data. Guest names are invented. Prices and the tax lines are SIMULATOR SAMPLES, not
 * tax rules: real prices and taxes come from the rates module's effective-dated configuration.
 */
import { addDays, diffDays, type LocalDate } from '@portico/ui';
import type {
  ArrivalRow,
  HousekeepingRow,
  Money,
  ReadinessCheck,
  StayChangePreview,
  TimelineItemView,
  TimelineView,
} from './contracts';
import { computeReadiness } from './readiness';

export interface SimProperty {
  id: string;
  code: string;
  name: string;
  profile: string;
  businessDate: LocalDate;
  timezone: string;
  baseCurrency: string;
}

interface UnitTypeSpec {
  name: string;
  section: string;
  numbers: number[];
  /** Simulated nightly rate in minor units. */
  rate: number;
  maxAdults: number;
}

interface SimUnit {
  id: string;
  number: string;
  typeName: string;
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
  from: LocalDate;
  to: LocalDate;
  status: ArrivalRow['stayStatus'];
  guestName: string;
  adults: number;
  childrenAges: number[];
  vip: boolean;
  rate: number;
  depositMinor: number;
  flags: string[];
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function layoutFor(profile: string): UnitTypeSpec[] {
  switch (profile) {
    case 'resort':
      return [
        { name: 'Beach Villa', section: 'Beach North', numbers: range(101, 140), rate: 65000, maxAdults: 3 },
        {
          name: 'Beach Villa with Pool',
          section: 'Beach South',
          numbers: range(141, 160),
          rate: 89000,
          maxAdults: 3,
        },
        { name: 'Water Villa', section: 'Jetty A', numbers: range(201, 240), rate: 98000, maxAdults: 2 },
        {
          name: 'Sunset Water Villa with Pool',
          section: 'Jetty B',
          numbers: range(241, 256),
          rate: 135000,
          maxAdults: 2,
        },
        {
          name: 'Two-Bedroom Beach Residence',
          section: 'Residences',
          numbers: range(301, 304),
          rate: 260000,
          maxAdults: 4,
        },
      ];
    case 'guesthouse':
      return [
        { name: 'Standard Double', section: 'Ground floor', numbers: range(1, 6), rate: 8500, maxAdults: 2 },
        { name: 'Deluxe Sea View', section: 'First floor', numbers: range(7, 10), rate: 11000, maxAdults: 2 },
        { name: 'Family Room', section: 'First floor', numbers: range(11, 12), rate: 14000, maxAdults: 4 },
      ];
    case 'serviced_apartments':
      return [
        { name: 'Studio', section: 'Tower', numbers: range(1, 16), rate: 12000, maxAdults: 2 },
        {
          name: 'One-Bedroom Apartment',
          section: 'Tower',
          numbers: range(17, 24),
          rate: 18000,
          maxAdults: 3,
        },
      ];
    default:
      return [
        { name: 'Superior Room', section: 'Floor 1', numbers: range(101, 140), rate: 16000, maxAdults: 2 },
        {
          name: 'Deluxe Ocean View',
          section: 'Floor 2',
          numbers: range(201, 220),
          rate: 22000,
          maxAdults: 2,
        },
        { name: 'Junior Suite', section: 'Floor 3', numbers: range(301, 304), rate: 34000, maxAdults: 3 },
      ];
  }
}

const GUESTS = [
  'Sophie Laurent',
  'Wei Zhang',
  'Arjun Mehta',
  'Fatima Al Mansouri',
  'Elena Petrova',
  'James & Olivia Carter',
  'Hiroshi Tanaka',
  'Lukas Becker',
  'Priya Nair',
  'Marco Rossi',
  'Chloé Martin',
  'Ahmed Al Rashid',
  'Anna Kowalska',
  'Daniel Schneider',
  'Mei Lin',
  'Rahul Kapoor',
  'Isabella García',
  'Thomas Müller',
  'Yuki Sato',
  'Olga Ivanova',
  'Liam O’Connor',
  'Sara Lindqvist',
  'Kenji Watanabe',
  'Noura Al Hashimi',
  'Mateo Fernández',
  'Emma Johansson',
  'Vikram Singh',
  'Camille Dubois',
  'Jonas Andersen',
  'Ayesha Khan',
  'Li Na',
  'Gabriel Costa',
];
const STAFF = ['Mariyam', 'Aishath', 'Fathimath', 'Hawwa', 'Ibrahim', 'Ali', 'Hussain', 'Shifza'];
const DESK = ['Aishath (front desk)', 'Ahmed (front desk)', 'Nashwa (guest relations)'];
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

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

export interface PropertySimulation {
  property: SimProperty;
  units: SimUnit[];
  stays: SimStay[];
  blocks: TimelineItemView[];
  holds: TimelineItemView[];
  conditions: Map<string, HousekeepingRow['condition']>;
  scenarios: Map<string, ArrivalScenario>;
  generatedAt: string;
}

type ArrivalScenario =
  | 'ready_vip'
  | 'failed_inspection'
  | 'payment_pending'
  | 'unassigned'
  | 'transfer_delayed'
  | 'documents_missing'
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
  'documents_missing',
  'cleaning',
  'request_open',
  'checked_in',
];

export function simulateProperty(property: SimProperty, now: Date = new Date()): PropertySimulation {
  const r = rng(hash(`${property.id}:${property.businessDate}`));
  const bd = property.businessDate;
  const units: SimUnit[] = layoutFor(property.profile).flatMap((t) =>
    t.numbers.map((n) => ({
      id: `${property.code}-u${n}`,
      number:
        property.profile === 'resort'
          ? `Villa ${n}`
          : property.profile === 'guesthouse'
            ? `Room ${n}`
            : `${n}`,
      typeName: t.name,
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
      id: `blk-${u.id}-${i}`,
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
  let guestIdx = r.int(0, GUESTS.length - 1);
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
          id: `hold-${u.id}-${from}`,
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
      const guestName = GUESTS[guestIdx++ % GUESTS.length] as string;
      stays.push({
        id: `stay-${u.id}-${from}`,
        bookingId: `bkg-${u.id}-${from}`,
        bookingCode: code(r),
        unitId: u.id,
        unitTypeName: u.typeName,
        from,
        to,
        status,
        guestName,
        adults,
        childrenAges,
        vip: r.chance(0.08),
        rate: u.rate,
        depositMinor: Math.round((u.rate * nights * 0.3) / 100) * 100,
        flags: [],
      });
    }
  }

  // Arrivals today: apply curated scenarios (S05, S07, S12 …) in ETA order.
  const scenarios = new Map<string, ArrivalScenario>();
  const conditions = new Map<string, HousekeepingRow['condition']>();
  const arrivalsToday = stays
    .filter((s) => s.from === bd)
    .sort((a, b) => (a.bookingCode < b.bookingCode ? -1 : 1));
  arrivalsToday.forEach((s, i) => {
    const sc = SCENARIO_ORDER[i] ?? (r.chance(0.7) ? 'ready' : 'request_open');
    scenarios.set(s.id, sc);
    if (sc === 'ready_vip') {
      s.vip = true;
      s.flags.push('Honeymoon');
    }
    if (sc === 'checked_in') s.status = 'in_house';
    if (sc === 'unassigned') s.unitId = null;
  });

  for (const u of units) {
    const inHouse = stays.find(
      (s) => s.unitId === u.id && s.status === 'in_house' && s.from < bd && s.to > bd,
    );
    const departing = stays.find((s) => s.unitId === u.id && s.to === bd);
    const arriving = stays.find((s) => s.unitId === u.id && s.from === bd);
    const sc = arriving ? scenarios.get(arriving.id) : undefined;
    let c: HousekeepingRow['condition'];
    if (sc === 'failed_inspection') c = 'failed_inspection';
    else if (sc === 'cleaning') c = 'cleaning';
    else if (sc === 'checked_in') c = 'inspected';
    else if (arriving) c = departing ? (r.chance(0.5) ? 'inspected' : 'clean') : 'inspected';
    else if (departing) c = r.pick(['dirty', 'dirty', 'cleaning', 'clean'] as const);
    else if (inHouse) c = r.pick(['dirty', 'clean', 'clean', 'cleaning'] as const);
    else c = r.chance(0.85) ? 'inspected' : 'clean';
    conditions.set(u.id, c);
  }

  return { property, units, stays, blocks, holds, conditions, scenarios, generatedAt: now.toISOString() };
}

// ───────────────────────── projections ─────────────────────────

function at(sim: PropertySimulation, date: LocalDate, hhmm: string): string {
  return `${date}T${hhmm}:00${offsetFor(sim.property.timezone, date)}`;
}

const SIM_TAX = {
  /** SIMULATOR SAMPLE ONLY — real rules are configuration in the rates module with source citations. */
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
  const serviceCharge = Math.round((room * SIM_TAX.serviceChargeBp) / 10_000);
  const tgst = Math.round(((room + serviceCharge) * SIM_TAX.tgstBp) / 10_000);
  const greenTax = SIM_TAX.greenTaxPerPersonNightMinor(profile) * persons * nights;
  return { room, serviceCharge, tgst, greenTax, total: room + serviceCharge + tgst + greenTax };
}

const money = (amountMinor: number, currency: string): Money => ({ amountMinor, currency });

export function arrivalsFor(sim: PropertySimulation): ArrivalRow[] {
  const bd = sim.property.businessDate;
  const cur = sim.property.baseCurrency;
  const r = rng(hash(`${sim.property.id}:arrivals:${bd}`));
  const resort = sim.property.profile === 'resort';
  return sim.stays
    .filter((s) => s.from === bd)
    .map((s, i) => {
      const sc = sim.scenarios.get(s.id) ?? 'ready';
      const unit = sim.units.find((u) => u.id === s.unitId) ?? null;
      const condition = unit ? (sim.conditions.get(unit.id) ?? null) : null;
      const nights = diffDays(s.from, s.to);
      const totals = stayTotals(s.rate, nights, s.adults + s.childrenAges.length, sim.property.profile);
      const mode = resort
        ? i % 4 === 3
          ? 'domestic_flight'
          : i % 5 === 4
            ? 'speedboat'
            : 'seaplane'
        : 'speedboat';
      const hour = 8 + ((i * 7) % 9);
      const minute = ((i * 25) % 60).toString().padStart(2, '0');
      const scheduled = at(sim, bd, `${String(hour).padStart(2, '0')}:${minute}`);
      const delayed = sc === 'transfer_delayed';
      const estimated = delayed
        ? at(sim, bd, `${String(Math.min(hour + 3, 17)).padStart(2, '0')}:${minute}`)
        : scheduled;
      const paymentStatus: ArrivalRow['paymentStatus'] =
        sc === 'payment_pending'
          ? 'pending_verification'
          : sc === 'checked_in'
            ? 'authorized'
            : i % 3 === 0
              ? 'paid'
              : 'guaranteed';
      const requests =
        sc === 'request_open'
          ? ['Baby cot', 'Late dinner on arrival']
          : s.vip
            ? ['Champagne on arrival', 'Floating breakfast day 2']
            : i % 3 === 1
              ? ['Twin beds']
              : [];
      const checks: ReadinessCheck[] = [
        unit
          ? { key: 'unit_assigned', status: 'ok', message: `${unit.number} assigned` }
          : {
              key: 'unit_assigned',
              status: 'blocking',
              message: `No ${s.unitTypeName} assigned — ${Math.max(1, (i % 3) + 2)} inspected and free today`,
            },
        condition === 'inspected' || !unit
          ? {
              key: 'unit_condition',
              status: unit ? 'ok' : 'unknown',
              message: unit ? `${unit.number} inspected` : 'Assign a unit first',
            }
          : condition === 'failed_inspection'
            ? {
                key: 'unit_condition',
                status: 'blocking',
                message: `${unit.number} failed inspection at 09:12 (shower drain) — re-clean assigned to ${attendantFor(sim, unit.id)}`,
              }
            : condition === 'cleaning'
              ? {
                  key: 'unit_condition',
                  status: 'blocking',
                  message: `${unit.number} is being cleaned — ready about 13:20 (estimate)`,
                }
              : {
                  key: 'unit_condition',
                  status: 'blocking',
                  message: `${unit.number} is ${condition}; inspection required`,
                },
        paymentStatus === 'pending_verification'
          ? {
              key: 'guarantee',
              status: 'unknown',
              message: `Deposit charge of ${cur} ${(s.depositMinor / 100).toFixed(2)} is pending verification — check status; do not charge again`,
            }
          : {
              key: 'guarantee',
              status: 'ok',
              message: paymentStatus === 'paid' ? 'Deposit received' : 'Card guarantee on file',
            },
        sc === 'documents_missing'
          ? {
              key: 'documents',
              status: 'blocking',
              message: `Passport details missing for ${s.adults} of ${s.adults} adults (guest register)`,
            }
          : { key: 'documents', status: 'ok', message: 'Passport details received at pre-arrival' },
        delayed
          ? {
              key: 'transfer',
              status: 'attention',
              message: 'Seaplane delayed about 3 h (weather) — dinner and sunset dive flagged',
            }
          : {
              key: 'transfer',
              status: 'ok',
              message: mode === 'seaplane' ? 'Seaplane seats confirmed' : 'Transfer confirmed',
            },
        requests.length && sc === 'request_open'
          ? { key: 'requests', status: 'attention', message: 'Baby cot not yet confirmed by housekeeping' }
          : { key: 'requests', status: 'ok', message: requests.length ? 'Requests prepared' : 'No requests' },
      ];
      const readiness = computeReadiness(checks);
      const paid = paymentStatus === 'paid' ? s.depositMinor : 0;
      return {
        stayId: s.id,
        bookingId: s.bookingId,
        bookingCode: s.bookingCode,
        bookingStatus: 'confirmed',
        stayStatus: s.status,
        guestName: s.guestName,
        vip: s.vip,
        arrival: s.from,
        departure: s.to,
        nights,
        unitTypeName: s.unitTypeName,
        unitId: unit?.id ?? null,
        unitName: unit?.number ?? null,
        unitCondition: condition,
        occupancy: { adults: s.adults, childrenAges: s.childrenAges },
        eta: estimated,
        arrivalDetails: {
          transportMode: mode,
          ...(mode === 'seaplane' ? { carrier: 'Resort seaplane', number: `SP ${10 + i}` } : {}),
          ...(mode === 'domestic_flight'
            ? { carrier: 'Domestic flight + speedboat', number: `Q2 ${120 + i}` }
            : {}),
          ...(mode === 'speedboat' ? { carrier: 'Speedboat transfer', number: `SB ${i + 1}` } : {}),
          inbound: INBOUND[i % INBOUND.length] as string,
          scheduledAt: scheduled,
          estimatedAt: estimated,
          arrivalPoint: 'Velana International Airport (MLE)',
          transferRequested: true,
        },
        paymentStatus,
        balance: money(totals.total - paid, cur),
        requests,
        flags: [...s.flags, ...(s.childrenAges.length ? ['Family'] : [])],
        owner: s.vip || !readiness.ready ? (DESK[i % DESK.length] as string) : null,
        readiness,
        checkInRun:
          sc === 'checked_in'
            ? {
                status: 'completed',
                steps: [
                  {
                    id: 'identity',
                    label: 'Verify identity',
                    status: 'done',
                    detail: 'Passports checked at the jetty',
                  },
                  {
                    id: 'guarantee',
                    label: 'Secure payment',
                    status: 'done',
                    detail: 'Card authorized (not paid)',
                  },
                  { id: 'unit', label: 'Confirm unit', status: 'done' },
                  { id: 'key', label: 'Issue key', status: 'done' },
                ],
              }
            : sc === 'payment_pending'
              ? {
                  status: 'in_progress',
                  steps: [
                    {
                      id: 'identity',
                      label: 'Verify identity',
                      status: 'done',
                      detail: `Passports scanned by ${DESK[0]} at 10:58`,
                    },
                    {
                      id: 'guarantee',
                      label: 'Secure payment',
                      status: 'pending_verification',
                      detail:
                        'Terminal timed out after the charge was sent. Outcome unknown until the provider confirms.',
                    },
                    { id: 'unit', label: 'Confirm unit', status: 'pending' },
                    { id: 'key', label: 'Issue key', status: 'pending' },
                  ],
                }
              : null,
      } satisfies ArrivalRow;
    })
    .sort((a, b) => (a.eta ?? '').localeCompare(b.eta ?? ''))
    .map((row, idx) => ({
      ...row,
      flags: idx === 0 && r.chance(0.5) ? [...row.flags, 'Repeat guest'] : row.flags,
    }));
}

/** The attendant responsible for a unit today (same rule on every board). */
function attendantFor(sim: PropertySimulation, unitId: string): string {
  const i = sim.units.findIndex((u) => u.id === unitId);
  return STAFF[(Math.max(0, i) * 3) % STAFF.length] as string;
}

export function housekeepingFor(sim: PropertySimulation): HousekeepingRow[] {
  const bd = sim.property.businessDate;
  const r = rng(hash(`${sim.property.id}:hk:${bd}`));
  const arrivals = arrivalsFor(sim);
  return sim.units.map((u, i) => {
    const condition = sim.conditions.get(u.id) ?? 'clean';
    const inHouse = sim.stays.find(
      (s) => s.unitId === u.id && s.status === 'in_house' && s.from <= bd && s.to > bd,
    );
    const departing = sim.stays.some((s) => s.unitId === u.id && s.to === bd);
    const arrival = arrivals.find((a) => a.unitId === u.id && a.stayStatus === 'expected');
    const block = sim.blocks.find((b) => b.unitId === u.id && b.from <= bd && bd < b.to);
    const reasons: string[] = [];
    let priority: HousekeepingRow['topPriority'] = null;
    const notReady = condition !== 'inspected';
    if (arrival && notReady) {
      priority = condition === 'failed_inspection' ? 'urgent' : 'high';
      reasons.push(`Arrival today${arrival.eta ? ` (ETA ${arrival.eta.slice(11, 16)})` : ''}`);
      if (arrival.vip) reasons.push('VIP');
    } else if (departing && notReady) {
      priority = 'normal';
      reasons.push('Departure clean');
    } else if (inHouse && condition === 'dirty') {
      priority = 'low';
      reasons.push('Stayover service');
    }
    if (condition === 'failed_inspection') reasons.push('Failed inspection — re-clean');
    const expectedReadyAt =
      notReady && !block
        ? `${bd}T${String(11 + (i % 5)).padStart(2, '0')}:${['10', '25', '40', '55'][i % 4]}:00${offsetFor(sim.property.timezone, bd)}`
        : null;
    return {
      unitId: u.id,
      unitNumber: u.number,
      unitTypeName: u.typeName,
      sectionName: u.section,
      condition,
      occupancy: inHouse ? 'occupied' : 'vacant',
      discrepancy: inHouse && i % 37 === 5 ? 'skip' : !inHouse && i % 53 === 7 ? 'sleep' : 'none',
      dnd: Boolean(inHouse) && r.chance(0.12),
      block: block ? { kind: 'out_of_order', reason: block.label } : null,
      arrival: arrival
        ? {
            stayId: arrival.stayId,
            eta: arrival.eta,
            vip: arrival.vip,
            guestLabel: arrival.guestName.split(' ').at(-1) ?? arrival.guestName,
          }
        : null,
      departureToday: departing,
      topPriority: priority,
      priorityReasons: reasons,
      assigneeName: notReady || inHouse ? attendantFor(sim, u.id) : null,
      expectedReadyAt,
    } satisfies HousekeepingRow;
  });
}

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

const fmtMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 2 }).format(minor / 100);
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

export function previewExtension(
  sim: PropertySimulation,
  stayId: string,
  extraNights: number,
  now: Date,
): StayChangePreview {
  const s = sim.stays.find((x) => x.id === stayId);
  if (!s) throw new Error(`Unknown stay ${stayId}`);
  const cur = sim.property.baseCurrency;
  const persons = s.adults + s.childrenAges.length;
  const nights = diffDays(s.from, s.to);
  const before = stayTotals(s.rate, nights, persons, sim.property.profile);
  const after = stayTotals(s.rate, nights + extraNights, persons, sim.property.profile);
  const unit = sim.units.find((u) => u.id === s.unitId);
  const newTo = addDays(s.to, extraNights);
  const availability = Array.from({ length: extraNights }, (_, i) => {
    const night = addDays(s.to, i);
    const free = freeUnits(sim, s.unitTypeName, night);
    const assignedBusy = sim.stays.some(
      (o) => o.id !== s.id && o.unitId === s.unitId && o.from <= night && night < o.to,
    );
    return {
      label: `${s.unitTypeName} · night of ${night}`,
      before: `${free} free`,
      after: `${Math.max(free - 1, 0)} free${free - 1 < 0 ? ' (oversold)' : ''}`,
      delta: '−1',
      changed: true,
      ...(assignedBusy
        ? { attention: 'danger' as const }
        : free - 1 <= 0
          ? { attention: 'warning' as const }
          : {}),
    };
  });
  const unitConflict = availability.some((a) => 'attention' in a && a.attention === 'danger');
  const paid = s.depositMinor;
  return {
    token: `pv-${s.id}-${extraNights}`,
    stayId: s.id,
    title: `Extend stay of ${s.guestName} by ${extraNights} night${extraNights === 1 ? '' : 's'}`,
    summary: `${unit?.number ?? s.unitTypeName} · departure ${s.to} → ${newTo}. Agreed prices for existing nights are kept; new nights are priced at the stay's rate.`,
    validUntil: new Date(now.getTime() + 10 * 60_000).toISOString(),
    sections: [
      {
        kind: 'availability',
        rows: availability,
        ...(unitConflict
          ? {
              note: `${unit?.number ?? 'The assigned unit'} is booked by another stay on these nights — confirming will require a room move (scenario S03).`,
            }
          : {}),
      },
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
            label: 'Service charge (sample 10%)',
            before: fmtMoney(before.serviceCharge, cur),
            after: fmtMoney(after.serviceCharge, cur),
            delta: fmtDelta(after.serviceCharge - before.serviceCharge, cur),
            changed: true,
          },
          {
            label: 'TGST (sample 17%)',
            before: fmtMoney(before.tgst, cur),
            after: fmtMoney(after.tgst, cur),
            delta: fmtDelta(after.tgst - before.tgst, cur),
            changed: true,
          },
          {
            label: `Green Tax (sample, ${persons} guests)`,
            before: fmtMoney(before.greenTax, cur),
            after: fmtMoney(after.greenTax, cur),
            delta: fmtDelta(after.greenTax - before.greenTax, cur),
            changed: true,
          },
        ],
        note: 'Simulator sample lines. Real taxes and fees come from the rates module’s effective-dated rules with source citations.',
      },
      {
        kind: 'deposits',
        rows: [
          {
            label: 'Deposit held (liability)',
            before: fmtMoney(paid, cur),
            after: fmtMoney(paid, cur),
            changed: false,
          },
        ],
        note: 'No additional deposit required by the agreed terms (simulated policy).',
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

export class SimulatedProblem extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function commitExtension(sim: PropertySimulation, stayId: string, extraNights: number): SimStay {
  const s = sim.stays.find((x) => x.id === stayId);
  if (!s)
    throw new SimulatedProblem(
      'stay_not_found',
      404,
      'This stay no longer exists in the simulation. Reload the timeline.',
    );
  const newTo = addDays(s.to, extraNights);
  const clash = sim.stays.find(
    (o) => o.id !== s.id && o.unitId === s.unitId && o.from < newTo && s.to < o.to,
  );
  if (clash) {
    throw new SimulatedProblem(
      'unit_assignment_conflict',
      409,
      `The assigned unit is booked by ${clash.guestName} from ${clash.from}. Choose a room move or other dates, then preview again. Nothing was changed.`,
    );
  }
  s.to = newTo;
  return s;
}

// ───────────────────────── record views (universal record anatomy, simulated) ─────────────────────────

export interface SimStayDetail {
  stayId: string;
  bookingCode: string;
  guestName: string;
  unitId: string | null;
  unitName: string | null;
  unitTypeName: string;
  from: LocalDate;
  to: LocalDate;
  status: ArrivalRow['stayStatus'];
  adults: number;
  childrenAges: number[];
  vip: boolean;
  nightlyRate: Money;
  arrival: ArrivalRow | null;
  history: Array<{
    at: string;
    action: string;
    actor: { kind: string; label: string };
    reason: string | null;
  }>;
}

export function stayDetail(sim: PropertySimulation, stayId: string): SimStayDetail | null {
  const s = sim.stays.find((x) => x.id === stayId);
  if (!s) return null;
  const unit = sim.units.find((u) => u.id === s.unitId) ?? null;
  const arrival = arrivalsFor(sim).find((a) => a.stayId === stayId) ?? null;
  const tz = sim.property.timezone;
  const booked = addDays(s.from, -30 - (s.bookingCode.charCodeAt(0) % 40));
  const history = [
    {
      at: at(sim, booked, '09:14'),
      action: 'reservations.booking.confirm',
      actor: { kind: 'user', label: 'Reservations agent' },
      reason: null,
    },
    {
      at: at(sim, addDays(booked, 1), '11:02'),
      action: 'payments.paymentRequest.create',
      actor: { kind: 'user', label: 'Reservations agent' },
      reason: 'Deposit 30% per agreed terms',
    },
    {
      at: at(sim, addDays(s.from, -3), '16:40'),
      action: 'reservations.stay.arrivalDetails.update',
      actor: { kind: 'system', label: 'Pre-arrival form' },
      reason: null,
    },
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
    ...(s.status === 'in_house'
      ? [
          {
            at: at(sim, s.from, '11:20'),
            action: 'reservations.stay.checkIn',
            actor: { kind: 'user', label: 'Ahmed (front desk)' },
            reason: null,
          },
        ]
      : []),
  ];
  void tz;
  return {
    stayId: s.id,
    bookingCode: s.bookingCode,
    guestName: s.guestName,
    unitId: unit?.id ?? null,
    unitName: unit?.number ?? null,
    unitTypeName: s.unitTypeName,
    from: s.from,
    to: s.to,
    status: s.status,
    adults: s.adults,
    childrenAges: s.childrenAges,
    vip: s.vip,
    nightlyRate: money(s.rate, sim.property.baseCurrency),
    arrival,
    history,
  };
}

export interface SimUnitDetail {
  row: HousekeepingRow;
  stays: TimelineItemView[];
}

export function unitDetail(sim: PropertySimulation, unitId: string): SimUnitDetail | null {
  const row = housekeepingFor(sim).find((r) => r.unitId === unitId);
  if (!row) return null;
  const bd = sim.property.businessDate;
  const stays = timelineFor(sim, addDays(bd, -3), 21).items.filter((i) => i.unitId === unitId);
  return { row, stays };
}

/** Records needing someone, across modules (My work inbox) — simulated until operations/integration merge. */
export interface SimWorkItem {
  id: string;
  kind: 'exception' | 'task' | 'approval' | 'handover';
  module: string;
  title: string;
  detail: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  department: string;
  assignee: string | null;
  dueAt: string | null;
  record: { type: string; id: string; title: string } | null;
}

export function workItemsFor(sim: PropertySimulation): SimWorkItem[] {
  const bd = sim.property.businessDate;
  const items: SimWorkItem[] = [];
  for (const a of arrivalsFor(sim)) {
    const b = a.readiness.blockingReason;
    if (b && a.stayStatus === 'expected') {
      items.push({
        id: `ex-${a.stayId}`,
        kind: 'exception',
        module:
          b.key === 'unit_condition' ? 'Housekeeping' : b.key === 'guarantee' ? 'Payments' : 'Front desk',
        title: `${a.guestName}: ${b.message.split(' — ')[0]}`,
        detail: b.message,
        priority: b.key === 'unit_condition' || b.key === 'guarantee' ? 'urgent' : 'high',
        department: b.owner ?? 'Front desk',
        assignee: a.owner,
        dueAt: a.eta,
        record: { type: 'stay', id: a.stayId, title: `${a.guestName} · ${a.bookingCode}` },
      });
    }
  }
  for (const r of housekeepingFor(sim)
    .filter((x) => x.topPriority === 'urgent' || x.topPriority === 'high')
    .slice(0, 6)) {
    items.push({
      id: `task-${r.unitId}`,
      kind: 'task',
      module: 'Housekeeping',
      title: `${r.condition === 'failed_inspection' ? 'Re-clean' : 'Clean & inspect'} ${r.unitNumber}`,
      detail: r.priorityReasons.join(' · '),
      priority: r.topPriority ?? 'normal',
      department: 'Housekeeping',
      assignee: r.assigneeName,
      dueAt: r.expectedReadyAt,
      record: { type: 'unit', id: r.unitId, title: r.unitNumber },
    });
  }
  items.push(
    {
      id: 'appr-rate',
      kind: 'approval',
      module: 'Rates',
      title: 'Approve rate override: Water Villa, 3 nights at −15%',
      detail: 'Requested by Reservations agent for a returning honeymoon couple',
      priority: 'normal',
      department: 'Management',
      assignee: null,
      dueAt: at(sim, bd, '17:00'),
      record: null,
    },
    {
      id: 'handover-night',
      kind: 'handover',
      module: 'Front desk',
      title: 'Night shift handover: 2 items to acknowledge',
      detail: 'Late arrival via speedboat after 22:00; minibar charge disputed in Villa 118',
      priority: 'normal',
      department: 'Front desk',
      assignee: null,
      dueAt: at(sim, bd, '08:00'),
      record: null,
    },
  );
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
  return items.sort(
    (a, b) => rank[a.priority] - rank[b.priority] || (a.dueAt ?? '').localeCompare(b.dueAt ?? ''),
  );
}

/** "Today" overview figures (all derived from the same simulation as the boards). */
export interface SimToday {
  businessDate: LocalDate;
  occupancy: {
    occupied: number;
    sellable: number;
    outOfOrder: number;
    lastWeek: { occupied: number; sellable: number };
  };
  arrivals: {
    total: number;
    ready: number;
    checkedIn: number;
    blocked: number;
    attention: number;
    lastWeek: number;
  };
  departures: { total: number; checkedOut: number };
  inHouse: { units: number; guests: number };
  exceptions: { open: number; urgent: number; yesterday: number };
  pendingVerification: { count: number; amount: Money };
  forecast: Array<{
    unitTypeName: string;
    nights: Array<{ date: LocalDate; occupied: number; sellable: number }>;
  }>;
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

export function todayFor(sim: PropertySimulation): SimToday {
  const bd = sim.property.businessDate;
  const arrivals = arrivalsFor(sim);
  const departing = sim.stays.filter((s) => s.to === bd);
  const inHouse = sim.stays.filter(
    (s) => s.from <= bd && bd < s.to && (s.status === 'in_house' || s.from === bd),
  );
  const pending = arrivals.filter((a) => a.paymentStatus === 'pending_verification');
  const work = workItemsFor(sim).filter((w) => w.kind === 'exception');
  const tonight = occupiedOn(sim, bd);
  const lw = occupiedOn(sim, addDays(bd, -7));
  const types = [...new Set(sim.units.map((u) => u.typeName))];
  return {
    businessDate: bd,
    occupancy: { ...tonight, lastWeek: { occupied: lw.occupied, sellable: lw.sellable } },
    arrivals: {
      total: arrivals.length,
      ready: arrivals.filter((a) => a.readiness.ready && a.stayStatus === 'expected').length,
      checkedIn: arrivals.filter((a) => a.stayStatus === 'in_house').length,
      blocked: arrivals.filter((a) => !a.readiness.ready).length,
      attention: arrivals.filter(
        (a) =>
          a.readiness.ready &&
          a.stayStatus === 'expected' &&
          a.readiness.checks.some((c) => c.status === 'attention'),
      ).length,
      lastWeek: sim.stays.filter((s) => s.from === addDays(bd, -7)).length,
    },
    departures: { total: departing.length, checkedOut: departing.filter((_, i) => i % 3 !== 2).length },
    inHouse: {
      units: inHouse.length,
      guests: inHouse.reduce((n, s) => n + s.adults + s.childrenAges.length, 0),
    },
    exceptions: {
      open: work.length + 2,
      urgent: work.filter((w) => w.priority === 'urgent').length,
      yesterday: work.length + 4,
    },
    pendingVerification: {
      count: pending.length + 1,
      amount: money(
        pending.reduce((n, a) => n + Math.round(a.balance.amountMinor * 0.3), 0) + 48_000,
        sim.property.baseCurrency,
      ),
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
