/** The demo seed produces realistic multinational guests, a DMC, a corporate account and a review queue. */
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoGuests } from '../src';
import { setupOrg, startDb } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('demo seed', () => {
  it('seeds source-market guests, companies and exactly the intended duplicate suggestion', async () => {
    const org = await setupOrg(t, { properties: 3 });
    await org.sys((tx) =>
      seedDemoGuests(tx, org.svc, {
        tenantId: org.tenantId,
        properties: org.properties.map((id, i) => ({ id, code: `P${i}`, legalEntityId: org.legalEntityId })),
      }),
    );
    const nationalities = await t.admin.kysely
      .selectFrom('guests.profiles')
      .select('nationality')
      .distinct()
      .where('tenant_id', '=', org.tenantId)
      .execute();
    expect(nationalities.map((n) => n.nationality)).toEqual(
      expect.arrayContaining(['CN', 'RU', 'IN', 'GB', 'DE', 'IT', 'US', 'AE', 'SA', 'QA']),
    );
    const companies = await org.sys((tx) => org.svc.listCompanies(tx, {}));
    expect(companies.map((c) => c.kind).sort()).toEqual(['agency', 'company']);
    const queue = await org.sys((tx) => org.svc.listDuplicates(tx, { status: 'open' }));
    const names = await Promise.all(
      queue.map(async (d) => (await org.sys((tx) => org.svc.getProfile(tx, d.profileAId))).familyName),
    );
    expect(names).toEqual([expect.stringMatching(/Mansoori/)]);
    const petrov = await org.sys((tx) => org.svc.searchProfiles(tx, { q: 'Петров', kind: 'auto', limit: 5 }));
    expect(petrov.items[0]).toMatchObject({ displayName: 'Ivan Petrov', vipLevel: 'vip1' });
  });
});
