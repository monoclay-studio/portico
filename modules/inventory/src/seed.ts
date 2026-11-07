/**
 * Realistic Maldives demo inventory for the demo seeder (apps/api/src/seed/demo.ts → DEMO_SEED_STEPS).
 * Everything is created through the normal service functions, so permissions, plan limits, data authority and
 * audit apply exactly as for a real hotel. All names are fictitious.
 */
import type { TxContext } from '@portico/db';
import { addDays } from '@portico/kernel';
import type { FeatureInput, UnitKind } from './contracts';
import type { InventoryService } from './service';

interface TypeSpec {
  code: string;
  name: string;
  kind: UnitKind;
  noun?: string;
  base: number;
  adults: number;
  children: number;
  max: number;
  bedding: string;
  sizeSqm: number;
  rank: number;
  features: string[];
  units: Array<{ number: string; building?: string; floor?: string; zone?: string; features?: string[] }>;
}

interface CompositeSpec {
  code: string;
  name: string;
  noun: string;
  base: number;
  adults: number;
  children: number;
  max: number;
  bedding: string;
  sizeSqm: number;
  rank: number;
  features: string[];
  units: Array<{ number: string; name: string; components: string[]; zone?: string }>;
}

interface ProfileSpec {
  features: FeatureInput[];
  types: TypeSpec[];
  composites: CompositeSpec[];
  /** A unit that is out of order from the business date, so the demo shows blocks and explanations. */
  outOfOrder?: { number: string; nights: number; reason: string };
}

const range = (
  prefix: string,
  from: number,
  to: number,
  extra: Omit<TypeSpec['units'][number], 'number'> = {},
) => Array.from({ length: to - from + 1 }, (_, i) => ({ number: `${prefix}${from + i}`, ...extra }));

const GUESTHOUSE: ProfileSpec = {
  features: [
    { code: 'sea_view', name: 'Sea view', category: 'view' },
    { code: 'garden_view', name: 'Garden view', category: 'view' },
    { code: 'balcony', name: 'Balcony', category: 'layout' },
    { code: 'connecting', name: 'Connecting door', category: 'layout' },
    { code: 'accessible', name: 'Step-free access', category: 'accessibility' },
    { code: 'bathtub', name: 'Bathtub', category: 'amenity' },
  ],
  types: [
    {
      code: 'DBL',
      name: 'Deluxe Double Room',
      kind: 'room',
      base: 2,
      adults: 2,
      children: 1,
      max: 3,
      bedding: '1 queen bed',
      sizeSqm: 24,
      rank: 20,
      features: ['balcony'],
      units: [
        ...range('', 101, 103, { floor: '1', features: ['sea_view'] }),
        ...range('', 104, 106, { floor: '1', features: ['garden_view'] }),
      ],
    },
    {
      code: 'TWN',
      name: 'Twin Room',
      kind: 'room',
      base: 2,
      adults: 2,
      children: 0,
      max: 2,
      bedding: '2 single beds',
      sizeSqm: 20,
      rank: 10,
      features: [],
      units: [
        ...range('', 201, 203, { floor: '2' }),
        { number: '204', floor: '2', features: ['accessible'] },
      ],
    },
    {
      code: 'FAM',
      name: 'Family Room',
      kind: 'room',
      base: 3,
      adults: 3,
      children: 2,
      max: 4,
      bedding: '1 queen bed + 2 singles',
      sizeSqm: 32,
      rank: 30,
      features: ['balcony', 'bathtub'],
      units: range('', 301, 302, { floor: '3', features: ['sea_view'] }),
    },
  ],
  composites: [],
  outOfOrder: { number: '203', nights: 2, reason: 'Air-conditioning unit replacement' },
};

const RESORT: ProfileSpec = {
  features: [
    { code: 'beachfront', name: 'Beachfront', category: 'location' },
    { code: 'water_villa', name: 'Over water', category: 'location' },
    { code: 'private_pool', name: 'Private pool', category: 'amenity' },
    { code: 'overwater_hammock', name: 'Overwater hammock', category: 'amenity' },
    { code: 'sunset_side', name: 'Sunset side', category: 'view' },
    { code: 'sunrise_side', name: 'Sunrise side', category: 'view' },
    { code: 'lagoon_access', name: 'Direct lagoon access', category: 'location' },
    { code: 'connecting', name: 'Connecting door', category: 'layout' },
    { code: 'accessible', name: 'Step-free access', category: 'accessibility' },
  ],
  types: [
    {
      code: 'BV',
      name: 'Beach Villa',
      kind: 'villa',
      base: 2,
      adults: 3,
      children: 1,
      max: 3,
      bedding: '1 king bed',
      sizeSqm: 110,
      rank: 10,
      features: ['beachfront'],
      units: [
        ...range('B1', 1, 9, { zone: 'North Beach', features: ['sunrise_side'] }).map((u) => ({
          ...u,
          number: u.number.replace('B1', 'B10'),
        })),
        ...range('B1', 10, 20, { zone: 'North Beach', features: ['sunrise_side'] }),
        ...range('B1', 21, 40, { zone: 'South Beach' }),
      ],
    },
    {
      code: 'BPV',
      name: 'Beach Pool Villa',
      kind: 'villa',
      base: 2,
      adults: 3,
      children: 1,
      max: 3,
      bedding: '1 king bed',
      sizeSqm: 160,
      rank: 20,
      features: ['beachfront', 'private_pool', 'sunset_side'],
      units: [
        ...range('P20', 1, 4, { zone: 'Sunset Beach', features: ['connecting'] }),
        ...range('P20', 5, 9, { zone: 'Sunset Beach' }),
        ...range('P2', 10, 24, { zone: 'Sunset Beach' }),
      ],
    },
    {
      code: 'FBV',
      name: 'Family Beach Villa',
      kind: 'villa',
      base: 4,
      adults: 4,
      children: 3,
      max: 6,
      bedding: '1 king bed + 2 singles + sofa bed',
      sizeSqm: 190,
      rank: 25,
      features: ['beachfront', 'lagoon_access'],
      units: [
        ...range('F30', 1, 9, { zone: 'Family Cove' }),
        { number: 'F310', zone: 'Family Cove', features: ['accessible'] },
      ],
    },
    {
      code: 'WV',
      name: 'Water Villa',
      kind: 'villa',
      base: 2,
      adults: 2,
      children: 1,
      max: 3,
      bedding: '1 king bed',
      sizeSqm: 120,
      rank: 30,
      features: ['water_villa', 'overwater_hammock', 'sunrise_side', 'lagoon_access'],
      units: [
        ...range('W40', 1, 9, { building: 'Jetty A' }),
        ...range('W4', 10, 30, { building: 'Jetty A' }),
      ],
    },
    {
      code: 'OWPV',
      name: 'Sunset Water Villa with Pool',
      kind: 'villa',
      base: 2,
      adults: 2,
      children: 1,
      max: 3,
      bedding: '1 king bed',
      sizeSqm: 175,
      rank: 40,
      features: ['water_villa', 'private_pool', 'sunset_side', 'overwater_hammock'],
      units: [
        ...range('S50', 1, 9, { building: 'Jetty B' }),
        ...range('S5', 10, 16, { building: 'Jetty B' }),
      ],
    },
  ],
  composites: [
    {
      code: 'RES2',
      name: 'Two-Bedroom Beach Pool Residence',
      noun: 'Residence',
      base: 4,
      adults: 4,
      children: 2,
      max: 6,
      bedding: '2 king beds',
      sizeSqm: 320,
      rank: 50,
      features: ['beachfront', 'private_pool', 'sunset_side', 'connecting'],
      units: [
        { number: 'R1', name: 'Residence P201 + P202', components: ['P201', 'P202'], zone: 'Sunset Beach' },
        { number: 'R2', name: 'Residence P203 + P204', components: ['P203', 'P204'], zone: 'Sunset Beach' },
      ],
    },
  ],
  outOfOrder: { number: 'W412', nights: 3, reason: 'Deck boards and ladder repair (Jetty A)' },
};

const HOTEL: ProfileSpec = {
  features: [
    { code: 'sea_view', name: 'Sea view', category: 'view' },
    { code: 'city_view', name: 'City view', category: 'view' },
    { code: 'balcony', name: 'Balcony', category: 'layout' },
    { code: 'accessible', name: 'Step-free access', category: 'accessibility' },
  ],
  types: [
    {
      code: 'STD',
      name: 'Standard Room',
      kind: 'room',
      base: 2,
      adults: 2,
      children: 1,
      max: 3,
      bedding: '1 queen or 2 singles',
      sizeSqm: 22,
      rank: 10,
      features: ['city_view'],
      units: [2, 3, 4, 5].flatMap((f) =>
        range(`${f}0`, 1, 9, { floor: String(f) }).concat({ number: `${f}10`, floor: String(f) }),
      ),
    },
    {
      code: 'SUP',
      name: 'Superior Sea View Room',
      kind: 'room',
      base: 2,
      adults: 2,
      children: 1,
      max: 3,
      bedding: '1 king bed',
      sizeSqm: 28,
      rank: 20,
      features: ['sea_view', 'balcony'],
      units: [6, 7].flatMap((f) => range(`${f}0`, 1, 8, { floor: String(f) })),
    },
    {
      code: 'JS',
      name: 'Junior Suite',
      kind: 'suite',
      base: 2,
      adults: 3,
      children: 2,
      max: 4,
      bedding: '1 king bed + sofa bed',
      sizeSqm: 42,
      rank: 30,
      features: ['sea_view', 'balcony'],
      units: range('80', 1, 8, { floor: '8' }),
    },
  ],
  composites: [],
};

const APARTMENTS: ProfileSpec = {
  features: [
    { code: 'kitchen', name: 'Full kitchen', category: 'amenity' },
    { code: 'washer', name: 'Washing machine', category: 'amenity' },
    { code: 'sea_view', name: 'Sea view', category: 'view' },
  ],
  types: [
    {
      code: 'STU',
      name: 'Studio Apartment',
      kind: 'apartment',
      base: 2,
      adults: 2,
      children: 0,
      max: 2,
      bedding: '1 queen bed',
      sizeSqm: 35,
      rank: 10,
      features: ['kitchen'],
      units: [...range('A10', 1, 6, { floor: '1' }), ...range('A20', 1, 6, { floor: '2' })],
    },
    {
      code: '1BR',
      name: 'One-Bedroom Apartment',
      kind: 'apartment',
      base: 2,
      adults: 2,
      children: 2,
      max: 4,
      bedding: '1 king bed + sofa bed',
      sizeSqm: 55,
      rank: 20,
      features: ['kitchen', 'washer'],
      units: range('A30', 1, 8, { floor: '3' }),
    },
    {
      code: '2BR',
      name: 'Two-Bedroom Apartment',
      kind: 'apartment',
      base: 4,
      adults: 4,
      children: 2,
      max: 6,
      bedding: '2 king beds',
      sizeSqm: 85,
      rank: 30,
      features: ['kitchen', 'washer', 'sea_view'],
      units: range('A40', 1, 4, { floor: '4' }),
    },
  ],
  composites: [],
};

const PROFILES: Record<string, ProfileSpec> = {
  guesthouse: GUESTHOUSE,
  boutique_hotel: GUESTHOUSE,
  resort: RESORT,
  hotel: HOTEL,
  serviced_apartments: APARTMENTS,
};

export interface SeededInventory {
  unitTypes: number;
  units: number;
  compositeUnits: number;
}

/** Create the demo catalog for one property (idempotent per property: skips when unit types already exist). */
export async function seedPropertyInventory(
  inventory: InventoryService,
  tx: TxContext,
  property: { id: string; profile: string },
  opts: { businessDate?: string } = {},
): Promise<SeededInventory> {
  const spec = PROFILES[property.profile];
  const result: SeededInventory = { unitTypes: 0, units: 0, compositeUnits: 0 };
  if (!spec) return result;
  if ((await inventory.listUnitTypes(tx, property.id, { includeArchived: true })).length > 0) return result;
  for (const f of spec.features) await inventory.createFeature(tx, property.id, f);
  const unitIds = new Map<string, string>();
  for (const [i, t] of spec.types.entries()) {
    const type = await inventory.createUnitType(tx, property.id, {
      code: t.code,
      name: t.name,
      kind: t.kind,
      ...(t.noun ? { noun: t.noun } : {}),
      baseOccupancy: t.base,
      maxAdults: t.adults,
      maxChildren: t.children,
      maxOccupancy: t.max,
      bedding: t.bedding,
      sizeSqm: t.sizeSqm,
      rank: t.rank,
      sortOrder: (i + 1) * 10,
      features: t.features,
    });
    result.unitTypes++;
    for (const [j, u] of t.units.entries()) {
      const created = await inventory.createUnit(tx, property.id, {
        unitTypeId: type.id,
        number: u.number,
        location: { building: u.building ?? null, floor: u.floor ?? null, zone: u.zone ?? null },
        features: [...t.features, ...(u.features ?? [])],
        sortOrder: j + 1,
        ...(opts.businessDate ? { inInventoryFrom: opts.businessDate } : {}),
      });
      unitIds.set(u.number, created.id);
      result.units++;
    }
  }
  for (const [i, c] of spec.composites.entries()) {
    const type = await inventory.createUnitType(tx, property.id, {
      code: c.code,
      name: c.name,
      kind: 'villa',
      noun: c.noun,
      baseOccupancy: c.base,
      maxAdults: c.adults,
      maxChildren: c.children,
      maxOccupancy: c.max,
      bedding: c.bedding,
      sizeSqm: c.sizeSqm,
      rank: c.rank,
      sortOrder: (spec.types.length + i + 1) * 10,
      isComposite: true,
      features: c.features,
    });
    result.unitTypes++;
    for (const [j, u] of c.units.entries()) {
      await inventory.createCompositeUnit(tx, property.id, {
        unitTypeId: type.id,
        number: u.number,
        name: u.name,
        location: { zone: u.zone ?? null },
        features: c.features,
        sortOrder: j + 1,
        componentUnitIds: u.components.map((n) => unitIds.get(n) as string),
        ...(opts.businessDate ? { inInventoryFrom: opts.businessDate } : {}),
      });
      result.compositeUnits++;
    }
  }
  if (spec.outOfOrder && opts.businessDate) {
    const unitId = unitIds.get(spec.outOfOrder.number);
    if (unitId) {
      await inventory.blockUnit(tx, {
        unitId,
        nights: { from: opts.businessDate, to: addDays(opts.businessDate, spec.outOfOrder.nights) },
        kind: 'out_of_order',
        reason: spec.outOfOrder.reason,
      });
    }
  }
  return result;
}

/** DemoSeedStep-compatible `(tx, org) => Promise<void>`: demo inventory for every demo property by profile. */
export function createInventoryDemoSeed(
  inventory: InventoryService,
  opts: { businessDate?: (tx: TxContext, propertyId: string) => Promise<string> } = {},
): (tx: TxContext, org: { properties: ReadonlyArray<{ id: string; profile: string }> }) => Promise<void> {
  return async (tx, org) => {
    for (const p of org.properties) {
      const businessDate = opts.businessDate ? await opts.businessDate(tx, p.id) : undefined;
      await seedPropertyInventory(inventory, tx, p, businessDate ? { businessDate } : {});
    }
  };
}
