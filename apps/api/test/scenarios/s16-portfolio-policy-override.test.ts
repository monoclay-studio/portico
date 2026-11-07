/**
 * S16 — A group administrator changes a policy some properties have overridden: the preview names which properties
 * change and which keep a local override; resolved values and sources are correct after the change.
 */
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertGlobalConsistency,
  hiyani,
  kandu,
  organization,
  property,
  type Scenario,
  startScenario,
} from './harness';

let s: Scenario;
beforeAll(async () => {
  s = await startScenario();
});
afterAll(async () => s?.close());

const KEY = 'reservations.checkIn.requiredCondition';

describe('S16 — portfolio policy with local overrides', () => {
  it('the director previews the org change: A changes, B and C keep their local overrides', async () => {
    const org = await organization(s, { name: 'Azure Isles Group' });
    const a = await kandu(s, org);
    const b = await hiyani(s, org);
    const c = await property(s, org, {
      code: 'MAA',
      name: 'Maafushi Beach Hotel',
      kind: 'guesthouse',
      businessDate: '2027-03-08',
    });
    const tenantId = org.tenantId;
    const director = org.staff('org_admin', 'Group director', 'all');
    await org.run(director, async (tx) => {
      await platform.setPolicy(tx, {
        key: KEY,
        scopeType: 'organization',
        scopeId: tenantId,
        value: 'clean',
        reason: 'Group standard',
      });
      await platform.setPolicy(tx, {
        key: KEY,
        scopeType: 'property',
        scopeId: b.id,
        value: 'inspected',
        reason: 'VIP island',
      });
      await platform.setPolicy(tx, {
        key: KEY,
        scopeType: 'property',
        scopeId: c.id,
        value: 'clean',
        reason: 'Small hotel',
      });
    });
    const preview = await org.run(director, (tx) =>
      platform.previewPolicyChange(tx, {
        key: KEY,
        scopeType: 'organization',
        scopeId: tenantId,
        value: 'inspected',
        defaultValue: 'inspected',
      }),
    );
    expect(preview.affected.filter((x) => x.changes).map((x) => x.propertyId)).toEqual([a.id]);
    expect(preview.unaffectedDueToOverride.map((x) => x.propertyId).sort()).toEqual([b.id, c.id].sort());
    await org.run(director, (tx) =>
      platform.setPolicy(tx, {
        key: KEY,
        scopeType: 'organization',
        scopeId: tenantId,
        value: 'inspected',
        reason: 'Raise the standard',
      }),
    );
    const resolved = await org.run(director, async (tx) =>
      Promise.all([a, b, c].map((p) => platform.resolvePolicy(tx, p.id, KEY, 'inspected'))),
    );
    expect(resolved.map((r) => [r.value, r.source])).toEqual([
      ['inspected', 'organization'],
      ['inspected', 'property'],
      ['clean', 'property'],
    ]);
    // A property manager of C cannot change the organization value.
    const managerC = org.staff('general_manager', 'Manager C', [c.id]);
    await expect(
      org.run(managerC, (tx) =>
        platform.setPolicy(tx, {
          key: KEY,
          scopeType: 'organization',
          scopeId: tenantId,
          value: 'clean',
          reason: 'x',
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await assertGlobalConsistency(s, org);
  });

  it.todo(
    'the director locks the policy and marks C exempt with a reason (policy locks and exemptions not built in platform)',
  );
});
