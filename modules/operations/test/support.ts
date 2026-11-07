/**
 * Integration-test harness: real Postgres (RLS on), the real platform module (properties, policies, data
 * authority) and a FAKE inventory port. Reservations/inventory events are written to the real outbox and
 * delivered to operations' consumers through the real dispatcher (drainOutbox).
 */
import { drainOutbox, sourcesFromManifests, type TxContext, withTenantTx } from '@portico/db';
import {
  type Actor,
  type Clock,
  type DateRange,
  type EmitEventInput,
  fixedClock,
  newId,
  type RequestContext,
  systemAuthorizer,
} from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import {
  createOperationsService,
  type InventoryPort,
  type OperationsPorts,
  type OperationsService,
  operationsManifest,
  operationsSubscriptions,
  type PlatformPort,
} from '../src';

export const BUSINESS_DATE = '2026-11-07';
/** 09:00 in the Maldives (UTC+5). */
export const START = '2026-11-07T04:00:00.000Z';

/** Platform port bound to the real platform module (reference reads use system scope, as in composition). */
export function platformPort(): PlatformPort {
  const asSystem = (tx: TxContext): TxContext => ({ ...tx, authz: systemAuthorizer });
  return {
    async getProperty(tx, propertyId) {
      const p = await platform.getProperty(asSystem(tx), propertyId);
      return {
        id: p.id,
        timezone: p.timezone,
        businessDate: p.businessDate,
        checkInTime: p.checkInTime,
        profile: p.profile,
      };
    },
    assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
    async getDataAuthority(tx, propertyId, domain) {
      const a = await platform.getDataAuthority(tx, propertyId, domain);
      return {
        authority: a.authority,
        connectionId: a.connectionId,
        systemName: a.systemName,
        writeMode: a.writeMode,
      };
    },
    async resolvePolicy(tx, propertyId, key) {
      return (await platform.resolvePolicy(tx, propertyId, key, {})).value;
    },
    async listDepartments(tx, propertyId) {
      return (await platform.listDepartments(asSystem(tx), propertyId)).map((d) => ({
        id: d.id,
        kind: d.kind,
      }));
    },
  };
}

/** In-memory inventory: assignments per unit, blocks; records calls. */
export class FakeInventory implements InventoryPort {
  readonly assignments = new Map<string, Array<{ ref: { type: string; id: string }; nights: DateRange }>>();
  readonly blocks = new Map<string, { unitId: string; nights: DateRange; kind: string; released: boolean }>();
  readonly calls: string[] = [];
  units: Array<{ id: string; number: string; unitTypeId: string | null; unitTypeCode: string | null }> = [];

  assign(unitId: string, stayId: string, nights: DateRange) {
    const list = this.assignments.get(unitId) ?? [];
    list.push({ ref: { type: 'stay', id: stayId }, nights });
    this.assignments.set(unitId, list);
  }

  async blockUnit(
    _tx: TxContext,
    input: { unitId: string; nights: DateRange; kind: 'out_of_order' | 'out_of_service'; reason: string },
  ) {
    this.calls.push(`blockUnit:${input.unitId}:${input.kind}`);
    const blockId = newId();
    this.blocks.set(blockId, {
      unitId: input.unitId,
      nights: input.nights,
      kind: input.kind,
      released: false,
    });
    const affected = (this.assignments.get(input.unitId) ?? []).filter(
      (a) => a.nights.from < input.nights.to && input.nights.from < a.nights.to,
    );
    return { blockId, affectedAssignments: affected };
  }

  async releaseBlock(_tx: TxContext, input: { blockId: string }) {
    this.calls.push(`releaseBlock:${input.blockId}`);
    const b = this.blocks.get(input.blockId);
    if (b) b.released = true;
  }

  async listUnits() {
    return this.units.map((u) => ({ ...u, locationPath: null, features: [], active: true }));
  }
}

export interface Harness {
  t: TestDatabase;
  clock: ReturnType<typeof fixedClock>;
  inventory: FakeInventory;
  ports: OperationsPorts;
  ops: OperationsService;
  close(): Promise<void>;
}

export async function startHarness(clockStart: string = START): Promise<Harness> {
  const clock = fixedClock(clockStart);
  const t = await createTestDatabase(sourcesFromManifests([platformManifest, operationsManifest]), {
    clock: clock as Clock,
  });
  // Idle pool clients are terminated when the test database is dropped; that is expected during teardown.
  t.db.pool.on('error', () => {});
  t.admin.pool.on('error', () => {});
  const inventory = new FakeInventory();
  const ports: OperationsPorts = { platform: platformPort(), inventory };
  return {
    t,
    clock,
    inventory,
    ports,
    ops: createOperationsService(ports),
    close: () => t.drop(),
  };
}

export interface Org {
  tenantId: string;
  admin: RequestContext;
  propertyId: string;
  /** Context for a user with the given grants on this organization. */
  as(
    grants: Array<{ permission: string; propertyIds?: string[] | 'all' }>,
    actor?: Partial<Actor>,
  ): RequestContext;
  tx<T>(ctx: RequestContext, fn: (tx: TxContext) => Promise<T>): Promise<T>;
}

export async function setupOrg(
  h: Harness,
  opts: { code?: string; profile?: 'resort' | 'guesthouse' } = {},
): Promise<Org> {
  const admin = testContext({ actor: { kind: 'user', userId: newId(), displayName: 'Admin' } });
  await withTenantTx(h.t.db, admin, async (tx) => {
    await platform.provisionOrganization(tx, {
      name: 'Azure Atoll',
      slug: `azure-${admin.tenantId.slice(-12)}`,
      environment: 'live',
      planCode: 'enterprise',
    });
  });
  const propertyId = await withTenantTx(h.t.db, admin, async (tx) => {
    const le = await platform.createLegalEntity(tx, {
      name: 'Azure Atoll',
      legalName: 'Azure Atoll Hospitality Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    });
    const p = await platform.createProperty(tx, {
      code: opts.code ?? 'AZR',
      name: 'Azure Atoll Resort',
      profile: opts.profile ?? 'resort',
      legalEntityId: le.id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: BUSINESS_DATE,
    });
    await platform.createDepartment(tx, {
      propertyId: p.id,
      code: 'HK',
      name: 'Housekeeping',
      kind: 'housekeeping',
    });
    await platform.createDepartment(tx, {
      propertyId: p.id,
      code: 'ENG',
      name: 'Engineering',
      kind: 'engineering',
    });
    return p.id;
  });
  return {
    tenantId: admin.tenantId,
    admin,
    propertyId,
    as(grants, actor) {
      return testContext({
        tenantId: admin.tenantId,
        actor: { kind: 'user', userId: newId(), displayName: 'Staff', ...actor } as Actor,
        grants: grants.map((g) => ({ permission: g.permission, propertyIds: g.propertyIds ?? [propertyId] })),
      });
    },
    tx: (ctx, fn) => withTenantTx(h.t.db, ctx, fn),
  };
}

export const ATTENDANT_GRANTS = [
  'operations.housekeeping.update',
  'operations.task.update',
  'operations.unit.read',
].map((permission) => ({ permission }));

export const SUPERVISOR_GRANTS = [
  'operations.housekeeping.update',
  'operations.housekeeping.assign',
  'operations.housekeeping.inspect',
  'operations.task.manage',
  'operations.task.update',
  'operations.unit.read',
].map((permission) => ({ permission }));

/** Mirror `n` units into operations with sections, returning their ids. */
export async function seedUnits(
  h: Harness,
  org: Org,
  units: Array<{
    number: string;
    sectionCode?: string;
    unitTypeId?: string;
    condition?: 'dirty' | 'inspected';
  }>,
) {
  const ids = units.map(() => newId());
  await org.tx(org.admin, async (tx) => {
    const sections = await h.ops.listSections(tx, org.propertyId);
    const needed = [...new Set(units.map((u) => u.sectionCode).filter((x): x is string => !!x))];
    for (const code of needed) {
      if (!sections.some((s) => s.code === code))
        await h.ops.createSection(tx, org.propertyId, { code, name: `Section ${code}`, kind: 'section' });
    }
    for (const [i, u] of units.entries()) {
      await h.ops.upsertUnits(tx, org.propertyId, {
        units: [
          {
            unitId: ids[i] as string,
            number: u.number,
            sectionCode: u.sectionCode ?? null,
            unitTypeId: u.unitTypeId ?? null,
          },
        ],
        initialCondition: u.condition ?? 'inspected',
      });
    }
  });
  return ids;
}

/** Publish an event as another module would (outbox) and deliver it to operations' consumers. */
export async function publish(h: Harness, org: Org, event: EmitEventInput<Record<string, unknown>>) {
  const ctx = testContext({ tenantId: org.tenantId, actor: { kind: 'system', process: 'reservations' } });
  await withTenantTx(h.t.db, ctx, (tx) =>
    tx.emit({ ...event, propertyId: event.propertyId ?? org.propertyId }),
  );
  await deliver(h);
}

export async function deliver(h: Harness) {
  await drainOutbox(h.t.db, {
    subscriptions: operationsSubscriptions(h.ports),
    environmentOf: async () => 'live',
    maxAttempts: 1,
    onError: (err, d) => {
      throw new Error(`consumer ${d.consumer} failed for ${d.eventId}: ${String(err)}`);
    },
  });
}

/** Read events emitted to the outbox for a tenant (admin connection, test inspection only). */
export async function eventsOf(h: Harness, tenantId: string, type: string) {
  const rows = await h.t.admin.kysely
    .selectFrom('core.outbox')
    .select(['type', 'payload', 'aggregate_id', 'occurred_at'])
    .where('tenant_id', '=', tenantId)
    .where('type', '=', type)
    .orderBy('created_at')
    .execute();
  return rows as Array<{
    type: string;
    payload: Record<string, unknown>;
    aggregate_id: string;
    occurred_at: Date;
  }>;
}
