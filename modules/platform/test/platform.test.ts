import { sourcesFromManifests, withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platform, platformManifest } from '../src';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase(sourcesFromManifests([platformManifest]));
});
afterAll(async () => t?.drop());

async function setupOrg(planCode = 'enterprise') {
  const ctx = testContext();
  await withTenantTx(t.db, ctx, async (tx) => {
    await platform.provisionOrganization(tx, {
      name: 'Azure Isles',
      slug: `azure-${ctx.tenantId.slice(-12)}`,
      environment: 'live',
      planCode,
    });
  });
  const le = await withTenantTx(t.db, ctx, (tx) =>
    platform.createLegalEntity(tx, {
      name: 'Azure Isles Pvt Ltd',
      legalName: 'Azure Isles Private Limited',
      countryCode: 'MV',
      baseCurrency: 'USD',
    }),
  );
  const mk = (code: string, extra: Partial<Parameters<typeof platform.createProperty>[1]> = {}) =>
    withTenantTx(t.db, ctx, (tx) =>
      platform.createProperty(tx, {
        code,
        name: `Property ${code}`,
        profile: 'resort',
        legalEntityId: le.id,
        countryCode: 'MV',
        timezone: 'Indian/Maldives',
        baseCurrency: 'USD',
        businessDate: '2026-11-07',
        classification: { 'mv.establishmentType': 'resort' },
        ...extra,
      }),
    );
  return { ctx, le, mk };
}

describe('properties', () => {
  it('creates properties scoped to the organization and enforces plan limits', async () => {
    const { mk } = await setupOrg('essentials');
    const p = await mk('AZR');
    expect(p.businessDate).toBe('2026-11-07');
    await expect(mk('AZR2')).rejects.toThrow(/plan allows 1 property/);
  });

  it('rejects invalid time zones with a helpful message', async () => {
    const { mk } = await setupOrg();
    await expect(mk('BAD', { timezone: 'Mars/Olympus' })).rejects.toThrow(/IANA name/);
  });

  it('detects concurrent edits with versions', async () => {
    const { ctx, mk } = await setupOrg();
    const p = await mk('VER');
    await withTenantTx(t.db, ctx, (tx) =>
      platform.updateProperty(tx, p.id, p.version, { name: 'Renamed by A' }),
    );
    await expect(
      withTenantTx(t.db, ctx, (tx) => platform.updateProperty(tx, p.id, p.version, { name: 'Renamed by B' })),
    ).rejects.toThrow(/changed by someone else/);
  });

  it('only lists properties the user may read', async () => {
    const { ctx, mk } = await setupOrg();
    const a = await mk('PA');
    await mk('PB');
    const limited = {
      ...ctx,
      authz: testContext({ grants: [{ permission: 'platform.property.read', propertyIds: [a.id] }] }).authz,
    };
    const visible = await withTenantTx(t.db, limited, (tx) => platform.listProperties(tx));
    expect(visible.map((p) => p.id)).toEqual([a.id]);
  });
});

describe('business date', () => {
  it('advances exactly one day and refuses a duplicate advance', async () => {
    const { ctx, mk } = await setupOrg();
    const p = await mk('BD');
    const next = await withTenantTx(t.db, ctx, (tx) => platform.advanceBusinessDate(tx, p.id, '2026-11-07'));
    expect(next).toBe('2026-11-08');
    await expect(
      withTenantTx(t.db, ctx, (tx) => platform.advanceBusinessDate(tx, p.id, '2026-11-07')),
    ).rejects.toThrow(/already have been advanced/);
  });
});

describe('policies (scenario 16: central change vs local overrides)', () => {
  it('previews affected properties and keeps local overrides', async () => {
    const { ctx, mk } = await setupOrg();
    const brand = await withTenantTx(t.db, ctx, (tx) =>
      platform.createBrand(tx, { code: 'AZ', name: 'Azure' }),
    );
    const a = await mk('PA', { brandId: brand.id });
    const b = await mk('PB', { brandId: brand.id });
    const key = 'reservations.cancellationDeadlineHours';
    await withTenantTx(t.db, ctx, (tx) =>
      platform.setPolicy(tx, {
        key,
        scopeType: 'organization',
        scopeId: ctx.tenantId,
        value: 48,
        reason: 'standard',
      }),
    );
    await withTenantTx(t.db, ctx, (tx) =>
      platform.setPolicy(tx, {
        key,
        scopeType: 'property',
        scopeId: b.id,
        value: 72,
        reason: 'island access',
      }),
    );

    const preview = await withTenantTx(t.db, ctx, (tx) =>
      platform.previewPolicyChange(tx, {
        key,
        scopeType: 'brand',
        scopeId: brand.id,
        value: 24,
        defaultValue: 48,
      }),
    );
    expect(preview.affected.map((x) => x.propertyId)).toEqual([a.id]);
    expect(preview.unaffectedDueToOverride.map((x) => x.propertyId)).toEqual([b.id]);

    await withTenantTx(t.db, ctx, (tx) =>
      platform.setPolicy(tx, {
        key,
        scopeType: 'brand',
        scopeId: brand.id,
        value: 24,
        reason: 'brand standard',
      }),
    );
    const ra = await withTenantTx(t.db, ctx, (tx) => platform.resolvePolicy(tx, a.id, key, 48));
    const rb = await withTenantTx(t.db, ctx, (tx) => platform.resolvePolicy(tx, b.id, key, 48));
    expect(ra).toMatchObject({ value: 24, source: 'brand' });
    expect(rb).toMatchObject({ value: 72, source: 'property', isLocalOverride: true });
  });
});

describe('isolation (scenario 17)', () => {
  it('another organization cannot see properties even by id', async () => {
    const { mk } = await setupOrg();
    const p = await mk('ISO');
    const other = testContext({ tenantId: newId() });
    await expect(withTenantTx(t.db, other, (tx) => platform.getProperty(tx, p.id))).rejects.toThrow(
      /not found or you do not have access/,
    );
  });
});

describe('data authority (adoption paths)', () => {
  it('defaults to Portico, and blocks or forwards writes when an external system is the system of record', async () => {
    const { ctx, mk } = await setupOrg();
    const p = await mk('DA');
    expect(await withTenantTx(t.db, ctx, (tx) => platform.assertWritable(tx, p.id, 'reservations'))).toBe(
      'portico',
    );
    const connectionId = newId();
    await withTenantTx(t.db, ctx, (tx) =>
      platform.setDataAuthority(tx, {
        propertyId: p.id,
        domain: 'reservations',
        authority: 'external',
        connectionId,
        systemName: 'Legacy PMS',
        writeMode: 'read_only',
        reason: 'connect-alongside trial',
      }),
    );
    await expect(
      withTenantTx(t.db, ctx, (tx) => platform.assertWritable(tx, p.id, 'reservations')),
    ).rejects.toThrow(/Legacy PMS is the system of record/);
    await withTenantTx(t.db, ctx, (tx) =>
      platform.setDataAuthority(tx, {
        propertyId: p.id,
        domain: 'roomStatus',
        authority: 'external',
        connectionId,
        systemName: 'Legacy PMS',
        writeMode: 'forward',
        reason: 'housekeeping module replaces HK, PMS keeps status',
      }),
    );
    expect(await withTenantTx(t.db, ctx, (tx) => platform.assertWritable(tx, p.id, 'roomStatus'))).toBe(
      'forward',
    );
  });
});

describe('permission catalog', () => {
  it('registers every permission the platform service checks', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/service.ts', import.meta.url), 'utf8');
    const checked = new Set([...src.matchAll(/requirePermission\(tx, '([^']+)'/g)].map((m) => m[1]));
    const registered = new Set(platformManifest.permissions.map((p) => p.key));
    expect([...checked].filter((k) => !registered.has(k as string))).toEqual([]);
  });
});
