import { describe, expect, it } from 'vitest';
import { checkOutboundUrl, ipBlockReason, OutboundBlockedError, vetAddresses } from './address-policy';
import { safeJsonRequest } from './safe-json';

describe('outbound address policy (identity providers, P2-2)', () => {
  it('accepts only https DNS names on 443', () => {
    expect(checkOutboundUrl('https://login.microsoftonline.com/x/v2.0').ok).toBe(true);
    for (const bad of [
      'http://idp.lagoon.mv',
      'https://10.0.0.5',
      'https://[::1]',
      'https://localhost',
      'https://idp.internal',
      'https://intranet',
      'https://idp.lagoon.mv:8443',
      'https://user:pw@idp.lagoon.mv',
    ])
      expect(checkOutboundUrl(bad).ok).toBe(false);
  });

  it('refuses private, loopback, link-local (cloud metadata) and embedded-IPv4 addresses', () => {
    for (const ip of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '::1',
      'fd00:ec2::254',
      '::ffff:10.0.0.1',
    ])
      expect(ipBlockReason(ip)).not.toBeNull();
    expect(ipBlockReason('20.190.128.1')).toBeNull();
    expect(() => vetAddresses('idp.lagoon.mv', [{ address: '169.254.169.254', family: 4 }])).toThrow(
      OutboundBlockedError,
    );
  });

  it('never connects when the name resolves to an internal address (no socket is opened)', async () => {
    await expect(
      safeJsonRequest('https://idp.lagoon.mv/.well-known/openid-configuration', {
        method: 'GET',
        timeoutMs: 1000,
        resolver: async () => [
          { address: '20.190.128.1', family: 4 },
          { address: '10.0.0.7', family: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(OutboundBlockedError);
  });
});
