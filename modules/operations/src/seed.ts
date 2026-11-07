/**
 * Realistic sample data for demos, training and tests (Maldives resort: island zones, beach sections and an
 * overwater jetty; a small local-island guesthouse). Uses the public service API only — every record goes through
 * the same permission, audit and event paths as real usage. Attendants are roster entries with generated user ids
 * (sample staff without sign-in); real rosters reference identity users.
 */
import { sql, type TxContext } from '@portico/db';
import { addDays, newId } from '@portico/kernel';
import type { Attendant, PreventiveScheduleView, Section } from './contracts';
import type { UnitCondition } from './domain/model';
import type { OperationsService } from './service';

interface SeedUnit {
  unitId: string;
  number: string;
  sectionCode: string;
  kind: 'beach' | 'water';
}

const RESORT_LAYOUT = [
  {
    code: 'SUNRISE',
    name: 'Sunrise side (island)',
    kind: 'island_zone' as const,
    parent: undefined,
    sort: 1,
  },
  { code: 'SUNSET', name: 'Sunset side (island)', kind: 'island_zone' as const, parent: undefined, sort: 2 },
  { code: 'LAGOON', name: 'Lagoon (overwater)', kind: 'island_zone' as const, parent: undefined, sort: 3 },
  {
    code: 'SR-N',
    name: 'Sunrise beach north',
    kind: 'section' as const,
    parent: 'SUNRISE',
    sort: 10,
    prefix: 'R1',
    villa: 'beach' as const,
  },
  {
    code: 'SR-S',
    name: 'Sunrise beach south',
    kind: 'section' as const,
    parent: 'SUNRISE',
    sort: 11,
    prefix: 'R2',
    villa: 'beach' as const,
  },
  {
    code: 'SS-N',
    name: 'Sunset beach north',
    kind: 'section' as const,
    parent: 'SUNSET',
    sort: 20,
    prefix: 'S1',
    villa: 'beach' as const,
  },
  {
    code: 'SS-S',
    name: 'Sunset beach south',
    kind: 'section' as const,
    parent: 'SUNSET',
    sort: 21,
    prefix: 'S2',
    villa: 'beach' as const,
  },
  {
    code: 'JETTY-A',
    name: 'Water villa jetty A',
    kind: 'jetty' as const,
    parent: 'LAGOON',
    sort: 30,
    prefix: 'A1',
    villa: 'water' as const,
  },
  {
    code: 'JETTY-B',
    name: 'Water villa jetty B',
    kind: 'jetty' as const,
    parent: 'LAGOON',
    sort: 31,
    prefix: 'B1',
    villa: 'water' as const,
  },
];

const ATTENDANTS = [
  { name: 'Aminath (Sunrise)', sections: ['SR-N', 'SR-S'], capacity: 24 },
  { name: 'Fathimath (Sunset)', sections: ['SS-N', 'SS-S'], capacity: 24 },
  { name: 'Hawwa (Jetty A)', sections: ['JETTY-A'], capacity: 20 },
  { name: 'Mohamed (Jetty B)', sections: ['JETTY-B'], capacity: 20 },
  { name: 'Ali (floater)', sections: [], capacity: 16 },
];

const CHECKLIST_COMMON = [
  { code: 'bathroom', label: 'Bathroom & outdoor shower', critical: true },
  { code: 'bedroom', label: 'Bed, linen & mosquito net', critical: true },
  { code: 'sand', label: 'No sand or salt residue on floors and furniture', critical: true },
  { code: 'ac', label: 'Air-conditioning, lights & fans working', critical: true },
  { code: 'amenities', label: 'Amenities & welcome set', critical: false },
  { code: 'minibar', label: 'Minibar restocked', critical: false },
];

export interface ResortSeedResult {
  sections: Section[];
  units: SeedUnit[];
  attendants: Attendant[];
  assets: Array<{ id: string; code: string; category: string }>;
  preventiveSchedules: PreventiveScheduleView[];
}

/** Seed a resort's housekeeping & maintenance setup. `tx` must carry configure/maintenance permissions. */
export async function seedResortOperations(
  tx: TxContext,
  ops: OperationsService,
  opts: {
    propertyId: string;
    villasPerSection?: number;
    initialCondition?: UnitCondition;
    businessDate?: string;
  },
): Promise<ResortSeedResult> {
  const { propertyId } = opts;
  const perSection = opts.villasPerSection ?? 6;
  const sections: Section[] = [];
  for (const s of RESORT_LAYOUT) {
    sections.push(
      await ops.createSection(tx, propertyId, {
        code: s.code,
        name: s.name,
        kind: s.kind,
        ...(s.parent ? { parentCode: s.parent } : {}),
        sortOrder: s.sort,
      }),
    );
  }
  const units: SeedUnit[] = [];
  for (const s of RESORT_LAYOUT) {
    if (!('prefix' in s) || !s.prefix) continue;
    for (let i = 1; i <= perSection; i++) {
      units.push({
        unitId: newId(),
        number: `${s.prefix}${String(i).padStart(2, '0')}`,
        sectionCode: s.code,
        kind: s.villa,
      });
    }
  }
  await ops.upsertUnits(tx, propertyId, {
    units: units.map((u) => ({
      unitId: u.unitId,
      number: u.number,
      unitTypeCode: u.kind === 'water' ? 'WATER-VILLA' : 'BEACH-VILLA',
      sectionCode: u.sectionCode,
      locationPath: `${u.sectionCode} / ${u.number}`,
      features: u.kind === 'water' ? ['water_villa', 'overwater_hammock'] : ['beachfront', 'private_pool'],
    })),
    initialCondition: opts.initialCondition ?? 'dirty',
  });
  const attendants: Attendant[] = [];
  for (const a of ATTENDANTS) {
    attendants.push(
      await ops.upsertAttendant(tx, propertyId, {
        userId: newId(),
        displayName: a.name,
        homeSectionCodes: a.sections,
        dailyCreditCapacity: a.capacity,
      }),
    );
  }
  await ops.createChecklistTemplate(tx, propertyId, {
    code: 'beach-villa',
    name: 'Beach villa — pre-arrival',
    purpose: 'unit',
    items: [...CHECKLIST_COMMON, { code: 'pool', label: 'Plunge pool clean & chlorinated', critical: true }],
  });
  await ops.createChecklistTemplate(tx, propertyId, {
    code: 'water-villa',
    name: 'Water villa — pre-arrival',
    purpose: 'unit',
    items: [
      ...CHECKLIST_COMMON,
      { code: 'deck', label: 'Deck, hammock & lagoon ladder secure', critical: true },
      { code: 'glass-floor', label: 'Glass floor panel clean', critical: false },
    ],
  });

  // Asset register: AC units in every villa, lagoon ladders on water villas, plant equipment, public areas.
  const assets: ResortSeedResult['assets'] = [];
  for (const u of units) {
    const ac = await ops.createAsset(tx, propertyId, {
      kind: 'equipment',
      code: `AC-${u.number}`,
      name: `Split AC · ${u.number}`,
      category: 'ac_unit',
      unitId: u.unitId,
      sectionCode: u.sectionCode,
      manufacturer: 'Sample manufacturer',
    });
    assets.push({ id: ac.id, code: ac.code, category: ac.category });
    if (u.kind === 'water') {
      const ladder = await ops.createAsset(tx, propertyId, {
        kind: 'equipment',
        code: `LADDER-${u.number}`,
        name: `Lagoon ladder · ${u.number}`,
        category: 'ladder',
        unitId: u.unitId,
        sectionCode: u.sectionCode,
      });
      assets.push({ id: ladder.id, code: ladder.code, category: ladder.category });
    }
  }
  for (const p of [
    { kind: 'public_area' as const, code: 'JETTY-MAIN', name: 'Arrival jetty', category: 'jetty' },
    { kind: 'public_area' as const, code: 'POOL-MAIN', name: 'Infinity pool', category: 'pool' },
    { kind: 'equipment' as const, code: 'GEN-1', name: 'Diesel generator 1', category: 'generator' },
    {
      kind: 'equipment' as const,
      code: 'DESAL-1',
      name: 'Desalination plant (RO)',
      category: 'desalination',
    },
  ]) {
    const a = await ops.createAsset(tx, propertyId, p);
    assets.push({ id: a.id, code: a.code, category: a.category });
  }
  const today = opts.businessDate ?? '2026-11-07';
  const preventiveSchedules = [
    await ops.createPreventiveSchedule(tx, propertyId, {
      code: 'AC-SERVICE-90D',
      title: 'AC servicing (filters, coil clean, gas check)',
      assetCategory: 'ac_unit',
      faultCategory: 'hvac',
      urgency: 'normal',
      intervalUnit: 'day',
      intervalCount: 90,
      firstDueOn: addDays(today, 14),
      leadDays: 7,
    }),
    await ops.createPreventiveSchedule(tx, propertyId, {
      code: 'LADDER-INSPECT-30D',
      title: 'Water villa ladder inspection (corrosion, fixings, non-slip treads)',
      assetCategory: 'ladder',
      faultCategory: 'structural',
      urgency: 'high',
      intervalUnit: 'day',
      intervalCount: 30,
      firstDueOn: addDays(today, 3),
      leadDays: 2,
    }),
    await ops.createPreventiveSchedule(tx, propertyId, {
      code: 'GEN-WEEKLY',
      title: 'Generator weekly run test and oil check',
      assetId: assets.find((a) => a.code === 'GEN-1')?.id ?? '',
      faultCategory: 'power',
      urgency: 'normal',
      intervalUnit: 'week',
      intervalCount: 1,
      firstDueOn: addDays(today, 1),
      leadDays: 0,
    }),
  ];
  return { sections, units, attendants, assets, preventiveSchedules };
}

/** A local-island guesthouse: one floor, a handful of rooms, the owner's family does housekeeping. */
export async function seedGuesthouseOperations(
  tx: TxContext,
  ops: OperationsService,
  opts: { propertyId: string; rooms?: number },
) {
  const section = await ops.createSection(tx, opts.propertyId, {
    code: 'MAIN',
    name: 'Main building',
    kind: 'building',
  });
  const units = Array.from({ length: opts.rooms ?? 12 }, (_, i) => ({
    unitId: newId(),
    number: String(101 + i),
    sectionCode: 'MAIN',
  }));
  await ops.upsertUnits(tx, opts.propertyId, { units, initialCondition: 'clean' });
  const attendants = [
    await ops.upsertAttendant(tx, opts.propertyId, {
      userId: newId(),
      displayName: 'Shiyama (owner family)',
      homeSectionCodes: ['MAIN'],
      dailyCreditCapacity: 20,
    }),
  ];
  return { sections: [section], units, attendants };
}

/** Structural type of apps/api's DemoOrganization (kept local: modules never import the API app). */
export interface DemoOrgLike {
  tenantId: string;
  properties: Array<{ id: string; profile: string }>;
}

/**
 * Demo seed step (DemoSeedStep-compatible: `{ name, run(tx, org) }`). Registered by the composition root with
 * the composed operations service. If inventory already mirrored units they are synchronised first.
 */
export function createOperationsDemoSeed(ops: OperationsService) {
  return {
    name: 'operations',
    async run(tx: TxContext, org: DemoOrgLike): Promise<void> {
      for (const p of org.properties) {
        let mirrored = 0;
        await sql`savepoint operations_demo_sync`.execute(tx.db);
        try {
          mirrored = (await ops.syncUnitsFromInventory(tx, p.id)).created;
        } catch {
          // Inventory not available in this deployment: fall back to operations' own sample units.
          await sql`rollback to savepoint operations_demo_sync`.execute(tx.db);
          mirrored = 0;
        }
        if (mirrored > 0) continue;
        if (p.profile === 'resort') await seedResortOperations(tx, ops, { propertyId: p.id });
        else
          await seedGuesthouseOperations(tx, ops, {
            propertyId: p.id,
            rooms: p.profile === 'guesthouse' ? 12 : 24,
          });
      }
    },
  };
}
