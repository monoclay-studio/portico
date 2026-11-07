import { describe, expect, it } from 'vitest';
import { delegateAtProperty, requirePermission, staticAuthorizer } from './context';
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

describe('field crypto from env', () => {
  it('refuses missing or development keys in production and keeps index and cipher keys separate', async () => {
    const { fieldCryptoFromEnv } = await import('./crypto');
    expect(() => fieldCryptoFromEnv({ NODE_ENV: 'production' })).toThrow(/must be set in production/);
    const dev = fieldCryptoFromEnv({});
    expect(dev.keySource).toBe('local-dev');
    expect(dev.blindIndex(' P 1234567 ')).toBe(dev.blindIndex('p1234567'));
    const k1 = Buffer.from('a'.repeat(32)).toString('base64');
    const k2 = Buffer.from('b'.repeat(32)).toString('base64');
    expect(() =>
      fieldCryptoFromEnv({ NODE_ENV: 'production', PORTICO_FIELD_KEY: k1, PORTICO_BLIND_INDEX_KEY: k1 }),
    ).toThrow(/distinct/);
    const prod = fieldCryptoFromEnv({
      NODE_ENV: 'production',
      PORTICO_FIELD_KEY: k1,
      PORTICO_BLIND_INDEX_KEY: k2,
    });
    expect(prod.keySource).toBe('env');
    expect(prod.cipher.decrypt(prod.cipher.encrypt('secret', 'aad'), 'aad')).toBe('secret');
  });
});

describe('event ordering helper', () => {
  it('ignores stale or duplicate versions and accepts unversioned events', async () => {
    const { isNewerThan } = await import('./events');
    expect(isNewerThan({ aggregateVersion: 5 }, 4)).toBe(true);
    expect(isNewerThan({ aggregateVersion: 4 }, 4)).toBe(false);
    expect(isNewerThan({ aggregateVersion: 3 }, 4)).toBe(false);
    expect(isNewerThan({ aggregateVersion: null }, 9)).toBe(true);
    expect(isNewerThan({ aggregateVersion: 1 }, null)).toBe(true);
  });
});

describe('staticAuthorizer grant union', () => {
  it('a property-scoped exact grant never shadows a broader wildcard grant', () => {
    const a = staticAuthorizer([
      { permission: 'platform.property.read', propertyIds: ['P1'] },
      { permission: '*', propertyIds: 'all' },
    ]);
    expect(a.can('platform.property.read', { propertyId: 'P2' })).toBe(true);
    expect(a.propertyScope('platform.property.read')).toBe('all');
  });

  it('unions property sets across exact and module wildcard grants', () => {
    const a = staticAuthorizer([
      { permission: 'finance.folio.read', propertyIds: ['P1'] },
      { permission: 'finance.*', propertyIds: ['P2'] },
    ]);
    expect(a.can('finance.folio.read', { propertyId: 'P1' })).toBe(true);
    expect(a.can('finance.folio.read', { propertyId: 'P2' })).toBe(true);
    expect(a.can('finance.folio.read', { propertyId: 'P3' })).toBe(false);
    expect(a.propertyScope('finance.folio.read')).toEqual(['P1', 'P2']);
    expect(a.can('reservations.booking.read')).toBe(false);
  });
});

describe('delegateAtProperty (ADR-0015 provider delegation)', () => {
  it('grants the provider keys at the authorized property only; everything else stays the actor\'s own', () => {
    const ctx = { authz: staticAuthorizer([{ permission: 'reservations.booking.create', propertyIds: ['P1'] }]) };
    const d = delegateAtProperty(ctx, ['inventory.assignment.manage'], 'P1');
    expect(d.authz.can('inventory.assignment.manage', { propertyId: 'P1' })).toBe(true);
    expect(d.authz.can('inventory.assignment.manage', { propertyId: 'P2' })).toBe(false);
    expect(d.authz.can('inventory.assignment.manage')).toBe(false);
    expect(d.authz.can('inventory.overbooking.authorize', { propertyId: 'P1' })).toBe(false);
    expect(d.authz.can('reservations.booking.create', { propertyId: 'P1' })).toBe(true);
    expect(d.authz.propertyScope('inventory.assignment.manage')).toEqual(['P1']);
    expect(ctx.authz.can('inventory.assignment.manage', { propertyId: 'P1' })).toBe(false);
  });
});
