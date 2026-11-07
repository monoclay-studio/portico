import { describe, expect, it } from 'vitest';
import { requirePermission, staticAuthorizer } from './context';
import { localFieldCipher } from './crypto';
import { assertExternalEffectAllowed, effectMode } from './environment';

describe('authorization', () => {
  const authz = staticAuthorizer([
    { permission: 'reservations.booking.create', propertyIds: ['p1'] },
    { permission: 'finance.*', propertyIds: 'all' },
  ]);

  it('scopes property permissions', () => {
    expect(authz.can('reservations.booking.create', { propertyId: 'p1' })).toBe(true);
    expect(authz.can('reservations.booking.create', { propertyId: 'p2' })).toBe(false);
    expect(authz.propertyScope('reservations.booking.create')).toEqual(['p1']);
  });

  it('supports module wildcards', () => {
    expect(authz.can('finance.posting.adjust', { propertyId: 'p9' })).toBe(true);
    expect(authz.can('inventory.unit.update', { propertyId: 'p1' })).toBe(false);
  });

  it('throws a helpful forbidden error', () => {
    expect(() => requirePermission({ authz }, 'inventory.unit.update', { propertyId: 'p1' })).toThrow(
      /permission/,
    );
  });
});

describe('environment safety', () => {
  it('never performs real effects outside live', () => {
    expect(effectMode({ environment: 'demo' }, 'payment.charge')).toBe('simulate');
    expect(effectMode({ environment: 'training' }, 'channel.publish')).toBe('simulate');
    expect(() => assertExternalEffectAllowed({ environment: 'demo' }, 'government.submit')).toThrow(
      /disabled in the demo/,
    );
    expect(assertExternalEffectAllowed({ environment: 'live' }, 'payment.charge')).toBe('live');
    // A trial may read the hotel's real systems but never write to them or touch guests/money.
    expect(effectMode({ environment: 'trial' }, 'integration.read')).toBe('live');
    expect(() => assertExternalEffectAllowed({ environment: 'trial' }, 'integration.write')).toThrow(
      /disabled in the trial/,
    );
    expect(effectMode({ environment: 'trial' }, 'message.guest')).toBe('simulate');
  });
});

describe('field cipher', () => {
  it('round-trips and binds to associated data', () => {
    const c = localFieldCipher(Buffer.from('test-key').toString('base64'));
    const ct = c.encrypt('P1234567', 'guest:abc:passport');
    expect(ct).not.toContain('P1234567');
    expect(c.decrypt(ct, 'guest:abc:passport')).toBe('P1234567');
    expect(() => c.decrypt(ct, 'guest:other:passport')).toThrow();
  });
});
