import { describe, expect, it } from 'vitest';
import { featuresOfGrant, grantableOn, MODULE_PACKS, PLANS, planByCode } from './plans';

describe('plans (docs/product/editions.md)', () => {
  it('never limits staff accounts and keeps property limits per edition', () => {
    for (const p of PLANS) expect(p.limits['limits.users']).toBeUndefined();
    expect(planByCode('essentials')?.limits['limits.properties']).toBe(1);
    expect(planByCode('enterprise')?.limits['limits.properties']).toBeNull();
  });

  it('includes receivables, automation and the public API in Essentials (§7)', () => {
    const ess = planByCode('essentials');
    for (const k of ['finance.receivables', 'comms.automation', 'api.public'])
      expect(ess?.features).toContain(k);
  });

  it('offers the AI assistant only as an add-on, in every plan', () => {
    for (const p of PLANS) {
      expect(p.features).not.toContain('ai.assistant');
      expect(grantableOn(p, 'add_on', 'ai.assistant')).toBe(true);
    }
  });

  it('editions are cumulative and contain no duplicate keys', () => {
    const order = ['essentials', 'professional', 'resort', 'enterprise'];
    for (let i = 1; i < order.length; i++) {
      const lower = planByCode(order[i - 1] as string);
      const higher = planByCode(order[i] as string);
      for (const f of lower?.features ?? []) expect(higher?.features).toContain(f);
    }
    for (const p of PLANS) expect(new Set(p.features).size).toBe(p.features.length);
  });

  it('Connect has no core PMS keys and sells module packs', () => {
    const connect = planByCode('connect');
    expect(connect?.features.some((f) => f.startsWith('core.'))).toBe(false);
    expect(connect?.packs).toHaveLength(MODULE_PACKS.length);
    expect(grantableOn(connect as never, 'pack', 'pack.housekeepingMaintenance')).toBe(true);
    expect(grantableOn(planByCode('resort') as never, 'pack', 'pack.housekeepingMaintenance')).toBe(false);
    expect(featuresOfGrant('pack', 'pack.housekeepingMaintenance')).toContain('core.housekeeping');
    expect(featuresOfGrant('add_on', 'owners.accounting')).toEqual(['owners.accounting']);
    expect(featuresOfGrant('pack', 'pack.unknown')).toEqual([]);
  });
});
