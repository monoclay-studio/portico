/**
 * Outbound address policy (server-side request forgery protection). Pure: no IO, no Portico imports.
 * COPIED from modules/integration/src/net/address-policy.ts (module boundaries forbid importing it); both copies
 * should move to one shared package (identity FOUNDATION_REQUESTS FR-5).
 *
 * A destination is allowed only when:
 *  - the URL is https, has no credentials, uses an allowed port (443 unless configured) and a DNS host name —
 *    never an IP literal, a trailing-dot name, a single-label (intranet) name or a local/internal suffix;
 *  - EVERY address the name resolves to is a public unicast address. IPv4 embedded in IPv6 (mapped, compatible,
 *    NAT64, 6to4, Teredo) is decoded and checked as IPv4.
 */

export type BlockCode = 'invalid_url' | 'blocked_host' | 'blocked_port' | 'blocked_address';

export interface OutboundUrlPolicy {
  /** Allowed destination ports. Default [443]. */
  allowedPorts?: readonly number[];
}

export type UrlCheck =
  | { ok: true; url: URL; hostname: string; port: number }
  | { ok: false; code: BlockCode; reason: string };

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.corp',
  '.localdomain',
];

/** IPv4 CIDR blocks that are never valid destinations (RFC 6890 special-purpose and private ranges). */
const IPV4_BLOCKED: ReadonlyArray<[string, number, string]> = [
  ['0.0.0.0', 8, 'this network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local / cloud metadata'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.88.99.0', 24, '6to4 relay'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved / broadcast'],
];

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return (
    ((parts[0] as number) * 2 ** 24 +
      (parts[1] as number) * 2 ** 16 +
      (parts[2] as number) * 2 ** 8 +
      (parts[3] as number)) >>>
    0
  );
}

function ipv4Blocked(n: number): string | null {
  for (const [base, bits, label] of IPV4_BLOCKED) {
    const b = ipv4ToInt(base) as number;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((n & mask) >>> 0 === (b & mask) >>> 0) return `${label} address`;
  }
  return null;
}

/** Expand an IPv6 address into 8 numeric hextets (handles "::" and a trailing dotted IPv4). */
export function parseIpv6(raw: string): number[] | null {
  let ip = raw.toLowerCase();
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(':');
  const maybeV4 = ip.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const n = ipv4ToInt(maybeV4);
    if (n === null) return null;
    tail = [n >>> 16, n & 0xffff];
    ip = `${ip.slice(0, lastColon + 1)}0:0`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const parse = (s: string) =>
    s === ''
      ? []
      : s.split(':').map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? Number.parseInt(h, 16) : Number.NaN));
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if ([...head, ...rest].some((x) => Number.isNaN(x))) return null;
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const out = [...head, ...new Array(fill).fill(0), ...rest];
  if (out.length !== 8) return null;
  if (tail.length === 2) {
    out[6] = tail[0] as number;
    out[7] = tail[1] as number;
  }
  return out;
}

function v4FromHextets(a: number, b: number): number {
  return ((a << 16) >>> 0) + b;
}

function ipv6Blocked(h: number[]): string | null {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const allZero = (xs: number[]) => xs.every((x) => x === 0);
  if (allZero(h)) return 'unspecified address';
  if (allZero(h.slice(0, 7)) && h7 === 1) return 'loopback address';
  // Embedded IPv4: mapped ::ffff:0:0/96, compatible ::/96, NAT64 64:ff9b::/96 — check the IPv4 part.
  if (allZero([h0, h1, h2, h3, h4]) && h5 === 0xffff) return ipv4Blocked(v4FromHextets(h6, h7)) ?? null;
  if (allZero([h0, h1, h2, h3, h4, h5]))
    return ipv4Blocked(v4FromHextets(h6, h7)) ?? 'IPv4-compatible address';
  if (h0 === 0x64 && h1 === 0xff9b && allZero([h2, h3, h4, h5])) return ipv4Blocked(v4FromHextets(h6, h7));
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 1) return 'local-use NAT64 address';
  if (h0 === 0x2002) return ipv4Blocked(v4FromHextets(h1, h2)) ?? null; // 6to4 embeds the IPv4 in hextets 1-2
  if (h0 === 0x2001 && h1 === 0)
    return ipv4Blocked(v4FromHextets(h6 ^ 0xffff, h7 ^ 0xffff)) ?? 'Teredo address';
  if ((h0 & 0xfe00) === 0xfc00) return 'unique-local address (includes cloud metadata fd00:ec2::254)';
  if ((h0 & 0xffc0) === 0xfe80) return 'link-local address';
  if ((h0 & 0xffc0) === 0xfec0) return 'site-local address';
  if ((h0 & 0xff00) === 0xff00) return 'multicast address';
  if (h0 === 0x100 && allZero([h1, h2, h3])) return 'discard-only address';
  if (h0 === 0x2001 && h1 === 0xdb8) return 'documentation address';
  return null;
}

/** Why an IP address may not be contacted, or null when it is a public unicast address. */
export function ipBlockReason(ip: string): string | null {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return ipv4Blocked(v4);
  const v6 = parseIpv6(ip);
  if (v6) return ipv6Blocked(v6);
  return 'not an IP address';
}

function looksLikeIpLiteral(host: string): boolean {
  if (host.includes(':')) return true;
  if (/^[0-9.]+$/.test(host)) return true; // dotted, decimal or partial IPv4
  if (/^0x[0-9a-f]+$/i.test(host)) return true; // hex integer IPv4
  return false;
}

/** Synchronous URL check (subscription time and before every send). DNS is checked separately. */
export function checkOutboundUrl(raw: string, policy: OutboundUrlPolicy = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: 'invalid_url', reason: 'This is not a valid URL.' };
  }
  if (url.protocol !== 'https:')
    return { ok: false, code: 'invalid_url', reason: 'Endpoints must use https://.' };
  if (url.username || url.password) {
    return {
      ok: false,
      code: 'invalid_url',
      reason: 'Do not put credentials in the URL; use the signing secret.',
    };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (looksLikeIpLiteral(host)) {
    return { ok: false, code: 'blocked_host', reason: 'Use a DNS host name, not an IP address.' };
  }
  if (host.endsWith('.')) {
    return {
      ok: false,
      code: 'blocked_host',
      reason: 'Host names ending with a dot are not accepted; remove the trailing dot.',
    };
  }
  if (!host.includes('.') || host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, code: 'blocked_host', reason: 'Endpoints must be public internet host names.' };
  }
  const port = url.port ? Number(url.port) : 443;
  const allowed = policy.allowedPorts ?? [443];
  if (!allowed.includes(port)) {
    return {
      ok: false,
      code: 'blocked_port',
      reason: `Port ${port} is not allowed; use ${allowed.join(' or ')}.`,
    };
  }
  return { ok: true, url, hostname: host, port };
}

/** Throws unless every resolved address is public. Returns the vetted addresses. */
export function vetAddresses(
  hostname: string,
  addresses: ReadonlyArray<{ address: string; family: number }>,
): ReadonlyArray<{ address: string; family: 4 | 6 }> {
  if (addresses.length === 0)
    throw new OutboundBlockedError('blocked_address', `${hostname} did not resolve to any address.`);
  for (const a of addresses) {
    const why = ipBlockReason(a.address);
    if (why) {
      throw new OutboundBlockedError(
        'blocked_address',
        `${hostname} resolves to a ${why}; Portico only calls public internet addresses.`,
      );
    }
  }
  return addresses.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

export class OutboundBlockedError extends Error {
  constructor(
    readonly code: BlockCode,
    message: string,
  ) {
    super(message);
    this.name = 'OutboundBlockedError';
  }
}
