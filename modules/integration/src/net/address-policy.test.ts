import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { checkOutboundUrl, ipBlockReason, parseIpv6 } from './address-policy';
import { safeFetch } from './safe-fetch';

describe('ipBlockReason', () => {
  it.each([
    ['127.0.0.1'],
    ['10.0.0.1'],
    ['100.64.0.1'],
    ['169.254.169.254'],
    ['172.16.5.4'],
    ['192.168.1.1'],
    ['0.0.0.0'],
    ['224.0.0.1'],
    ['255.255.255.255'],
    ['198.18.0.1'],
    ['::'],
    ['::1'],
    ['::ffff:127.0.0.1'],
    ['::ffff:7f00:1'],
    ['::ffff:169.254.169.254'],
    ['::ffff:10.0.0.1'],
    ['::127.0.0.1'],
    ['64:ff9b::a9fe:a9fe'], // NAT64 → 169.254.169.254
    ['64:ff9b:1::1'],
    ['2002:a9fe:a9fe::1'], // 6to4 → 169.254.169.254
    ['2001:0:4136:e378:8000:63bf:80ff:fffe'], // Teredo → 127.0.0.1
    ['fe80::1'],
    ['fe90::1'],
    ['febf::1'],
    ['fec0::1'],
    ['fc00::1'],
    ['fd00:ec2::254'], // AWS metadata over IPv6
    ['ff02::1'],
    ['100::1'],
    ['2001:db8::1'],
  ])('blocks %s', (ip) => {
    expect(ipBlockReason(ip)).not.toBeNull();
  });
  it.each([
    ['93.184.216.34'],
    ['8.8.8.8'],
    ['2606:4700:4700::1111'],
    ['::ffff:93.184.216.34'],
    ['2002:5db8:d822::1'],
  ])('allows public %s', (ip) => {
    expect(ipBlockReason(ip)).toBeNull();
  });
  it('parses IPv6 forms', () => {
    expect(parseIpv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(parseIpv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIpv6('1::2::3')).toBeNull();
  });
});

describe('checkOutboundUrl (subscription time and before every send)', () => {
  it.each([
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:169.254.169.254]/',
    'https://[::ffff:10.0.0.1]/',
    'https://[64:ff9b::a9fe:a9fe]/',
    'https://[fe90::1]/',
    'https://[fec0::1]/',
    'https://[::1]/',
    'https://127.0.0.1/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://127.1/',
    'https://localhost/',
    'https://localhost./',
    'https://partner.example.com./hooks',
    'https://intranet/',
    'https://svc.internal/x',
    'https://printer.local/',
    'https://partner.example.com:6379/',
    'https://partner.example.com:8443/',
    'http://partner.example.com/',
    'https://user:pw@partner.example.com/',
    'not a url',
  ])('rejects %s', (url) => {
    expect(checkOutboundUrl(url).ok).toBe(false);
  });
  it('accepts a public https host name on 443, and configured extra ports', () => {
    expect(checkOutboundUrl('https://partner.example.com/hooks')).toMatchObject({ ok: true, port: 443 });
    expect(checkOutboundUrl('https://partner.example.com:8443/', { allowedPorts: [443, 8443] }).ok).toBe(
      true,
    );
  });
});

describe('safeFetch never connects to a blocked destination', () => {
  it('a name resolving to loopback, mapped and trailing-dot URLs make zero connections', async () => {
    let connections = 0;
    const server = createServer((sock) => {
      connections++;
      sock.destroy();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const attempts = [
      // attacker DNS / rebinding: a public-looking name that resolves to loopback
      safeFetch(`https://hooks.attacker.example.com:${port}/`, {
        timeoutMs: 2000,
        allowedPorts: [port],
        resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      }),
      // one public and one private answer: still refused (every address must be public)
      safeFetch(`https://mixed.example.com:${port}/`, {
        timeoutMs: 2000,
        allowedPorts: [port],
        resolver: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '::ffff:127.0.0.1', family: 6 },
        ],
      }),
      safeFetch(`https://[::ffff:127.0.0.1]:${port}/`, { timeoutMs: 2000, allowedPorts: [port] }),
      safeFetch(`https://localhost.:${port}/`, { timeoutMs: 2000, allowedPorts: [port] }),
      safeFetch(`https://[::ffff:7f00:1]:${port}/`, { timeoutMs: 2000, allowedPorts: [port] }),
      safeFetch(`https://partner.example.com:${port}/`, { timeoutMs: 2000 }), // port not allowed
    ];
    const results = await Promise.allSettled(attempts);
    await new Promise((r) => setTimeout(r, 100));
    server.close();
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(connections).toBe(0);
  });
});
