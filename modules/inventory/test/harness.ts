import { sourcesFromManifests, type TxContext, withTenantTx } from '@portico/db';
import { type Actor, type EntityRef, newId, type RequestContext, staticAuthorizer } from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import pg from 'pg';
import { createInventoryService, type InventoryService, inventoryManifest, type UnitType } from '../src';

/** The real platform provider bound to inventory's port (platform exists on main). */
export const inventory: InventoryService = createInventoryService({
  platform: {
    getBusinessDate: platform.getBusinessDate,
    getDataAuthority: platform.getDataAuthority,
    assertWritable: platform.assertWritable,
    getLimit: platform.getLimit,
  },
});

export function createInventoryTestDatabase(): Promise<TestDatabase> {
  return createTestDatabase(sourcesFromManifests([platformManifest, inventoryManifest]));
}

export interface PropertyFixture {
  t: TestDatabase;
  ctx: RequestContext;
  tenantId: string;
  propertyId: string;
  /** Run as an all-powerful staff user (setup). */
  run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
  /** Run as a user holding only the given permissions (property-scoped to this property unless 'all'). */
  as<T>(permissions: string[], fn: (tx: TxContext) => Promise<T>, scope?: string[] | 'all'): Promise<T>;
  ctxWith(permissions: string[], scope?: string[] | 'all', actor?: Actor): RequestContext;
}

export async function setupProperty(
  t: TestDatabase,
  opts: { planCode?: string; businessDate?: string; code?: string } = {},
): Promise<PropertyFixture> {
  const ctx = testContext({ actor: { kind: 'user', userId: newId(), displayName: 'Setup Manager' } });
  await withTenantTx(t.db, ctx, (tx) =>
    platform.provisionOrganization(tx, {
      name: 'Test Resort Co',
      slug: `inv-${ctx.tenantId.slice(-12)}`,
      environment: 'live',
      planCode: opts.planCode ?? 'enterprise',
    }),
  );
  const property = await withTenantTx(t.db, ctx, async (tx) => {
    const le = await platform.createLegalEntity(tx, {
      name: 'Test Resort',
      legalName: 'Test Resort Pvt Ltd',
      countryCode: 'MV',
      baseCurrency: 'USD',
    });
    return platform.createProperty(tx, {
      code: opts.code ?? 'TRS',
      name: 'Test Resort',
      profile: 'resort',
      legalEntityId: le.id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: opts.businessDate ?? '2026-11-07',
    });
  });
  const ctxWith = (
    permissions: string[],
    scope: string[] | 'all' = [property.id],
    actor?: Actor,
  ): RequestContext => ({
    ...ctx,
    actor: actor ?? { kind: 'user', userId: newId(), displayName: 'Limited User' },
    authz: staticAuthorizer(permissions.map((permission) => ({ permission, propertyIds: scope }))),
    correlationId: newId(),
  });
  return {
    t,
    ctx,
    tenantId: ctx.tenantId,
    propertyId: property.id,
    run: (fn) => withTenantTx(t.db, ctx, fn),
    as: (permissions, fn, scope) => withTenantTx(t.db, ctxWith(permissions, scope), fn),
    ctxWith,
  };
}

/** Create a unit type with `count` units numbered `${prefix}${i}`. */
export async function unitTypeWithUnits(
  p: PropertyFixture,
  input: {
    code: string;
    name?: string;
    kind?: 'room' | 'villa' | 'suite';
    count: number;
    prefix?: string;
    zone?: string;
  },
): Promise<{ type: UnitType; unitIds: string[]; numbers: string[] }> {
  return p.run(async (tx) => {
    const type = await inventory.createUnitType(tx, p.propertyId, {
      code: input.code,
      name: input.name ?? input.code,
      kind: input.kind ?? 'villa',
      baseOccupancy: 2,
      maxAdults: 2,
      maxChildren: 1,
      maxOccupancy: 3,
    });
    const unitIds: string[] = [];
    const numbers: string[] = [];
    for (let i = 1; i <= input.count; i++) {
      const number = `${input.prefix ?? input.code}${String(i).padStart(2, '0')}`;
      const u = await inventory.createUnit(tx, p.propertyId, {
        unitTypeId: type.id,
        number,
        sortOrder: i,
        ...(input.zone ? { location: { zone: input.zone } } : {}),
      });
      unitIds.push(u.id);
      numbers.push(number);
    }
    return { type, unitIds, numbers };
  });
}

export const stay = (): EntityRef => ({ type: 'stay', id: newId() });

export async function cell(p: PropertyFixture, unitTypeId: string, date: string) {
  const [c] = await p.run((tx) =>
    inventory.getAvailability(tx, {
      propertyId: p.propertyId,
      unitTypeIds: [unitTypeId],
      range: { from: date, to: next(date) },
    }),
  );
  if (!c) throw new Error('no cell');
  return c;
}

export function next(date: string, days = 1): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * INV-I02: for every ledger row, sold = Σ consumption and held = Σ active holds (checked with the superuser
 * connection so it sees every row, after the scenario).
 */
/**
 * Superuser query on the test database through a short-lived client (bypasses RLS — inspection only). A dedicated
 * client avoids TestDatabase.drop() racing the admin pool's idle connections (see FOUNDATION_REQUESTS.md).
 */
export async function adminQuery<R extends pg.QueryResultRow>(
  t: TestDatabase,
  text: string,
  params: unknown[] = [],
): Promise<R[]> {
  const client = new pg.Client({ connectionString: t.adminUrl });
  await client.connect();
  try {
    return (await client.query<R>(text, params)).rows;
  } finally {
    await client.end();
  }
}

/**
 * Close the pools, wait until Postgres has really let go of their backends, then drop the database. Avoids
 * TestDatabase.drop() force-terminating half-closed connections (FOUNDATION_REQUESTS.md #1).
 */
export async function dropTestDatabase(t: TestDatabase | undefined): Promise<void> {
  if (!t) return;
  await t.db.close();
  await t.admin.close();
  for (let i = 0; i < 100; i++) {
    const rows = await adminQuery<{ n: number }>(
      t,
      'select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()',
    );
    if ((rows[0]?.n ?? 0) === 0) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  await t.drop();
}

export async function assertLedgerConsistent(t: TestDatabase): Promise<void> {
  const rows = await adminQuery<{
    unit_type_id: string;
    night: string;
    sold: number;
    consumed: number;
    held: number;
    holds: number;
  }>(
    t,
    `
    select l.unit_type_id, l.night::text as night, l.sold,
           coalesce((select sum(c.quantity) from inventory.consumptions c
                      where c.unit_type_id = l.unit_type_id and c.night = l.night), 0)::int as consumed,
           l.held,
           coalesce((select sum(h.quantity) from inventory.holds h
                      where h.status = 'active' and h.unit_type_id = l.unit_type_id and h.nights @> l.night), 0)::int
         + coalesce((select sum((e->>'quantity')::int) from inventory.holds h, jsonb_array_elements(h.component_quantities) e
                      where h.status = 'active' and (e->>'unitTypeId')::uuid = l.unit_type_id and h.nights @> l.night), 0)::int
           as holds
    from inventory.ledger l`,
  );
  const bad = rows.filter((r) => r.sold !== r.consumed || r.held !== r.holds);
  if (bad.length > 0) throw new Error(`ledger inconsistent: ${JSON.stringify(bad.slice(0, 5))}`);
}
