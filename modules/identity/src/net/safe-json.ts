/**
 * SSRF-safe JSON client for identity providers (OIDC discovery, JWKS, token endpoint). Same approach as
 * integration's `safeFetch` (FOUNDATION_REQUESTS FR-5): https only, DNS name (no IP literals, no internal suffixes),
 * resolved ONCE and every address must be public, socket pinned to the vetted address (no DNS rebinding), TLS
 * verified for the host name, redirects never followed, bounded time and response size.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { LookupFunction } from 'node:net';
import { checkOutboundUrl, OutboundBlockedError, vetAddresses } from './address-policy';

export type Resolver = (hostname: string) => Promise<ReadonlyArray<{ address: string; family: number }>>;
export const systemResolver: Resolver = async (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export const MAX_RESPONSE_BYTES = 1_000_000;

export async function safeJsonRequest(
  raw: string,
  opts: {
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    resolver?: Resolver;
  },
): Promise<{ status: number; body: unknown }> {
  const deadline = Date.now() + opts.timeoutMs;
  const check = checkOutboundUrl(raw);
  if (!check.ok) throw new OutboundBlockedError(check.code, check.reason);
  const addresses = vetAddresses(check.hostname, await (opts.resolver ?? systemResolver)(check.hostname));
  const pinned = addresses[0] as { address: string; family: 4 | 6 };
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (typeof options === 'object' && options && 'all' in options && options.all) {
      (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [
        pinned,
      ]);
    } else {
      (callback as (e: null, a: string, f: number) => void)(null, pinned.address, pinned.family);
    }
  };
  return new Promise((resolve, reject) => {
    const remaining = Math.max(1, deadline - Date.now());
    const req = request(
      {
        host: check.hostname,
        servername: check.hostname,
        port: check.port,
        path: `${check.url.pathname}${check.url.search}`,
        method: opts.method,
        headers: { accept: 'application/json', ...(opts.headers ?? {}) },
        lookup,
        agent: false,
        timeout: remaining,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_RESPONSE_BYTES) req.destroy(new Error('Identity provider response too large'));
          else chunks.push(c);
        });
        res.on('end', () => {
          clearTimeout(total);
          let body: unknown = null;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            body = null;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    const total = setTimeout(
      () => req.destroy(new Error('Identity provider did not answer in time')),
      remaining,
    );
    req.on('timeout', () => req.destroy(new Error('Identity provider did not answer in time')));
    req.on('error', (err) => {
      clearTimeout(total);
      reject(err);
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
