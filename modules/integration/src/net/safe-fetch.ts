/**
 * `safeFetch` — the only way Portico calls a customer- or partner-supplied URL (webhooks today; connectors, comms and
 * payment callbacks later). Self-contained (Node built-ins only) so it can move to a shared package unchanged.
 *
 *  1. The URL must pass `checkOutboundUrl` (https, DNS name, allowed port).
 *  2. The name is resolved ONCE; if ANY address is not public, nothing is sent.
 *  3. The socket is PINNED to the vetted address (custom `lookup`), so a DNS answer cannot change between the check
 *     and the connection (no rebinding window). TLS still verifies the certificate for the host name (SNI).
 *  4. Redirects are never followed (3xx is returned as a status). Connect + total time are bounded.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { LookupFunction } from 'node:net';
import {
  checkOutboundUrl,
  OutboundBlockedError,
  type OutboundUrlPolicy,
  vetAddresses,
} from './address-policy';

export type Resolver = (hostname: string) => Promise<ReadonlyArray<{ address: string; family: number }>>;

export const systemResolver: Resolver = async (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export interface SafeFetchOptions extends OutboundUrlPolicy {
  method?: 'POST' | 'GET' | 'PUT';
  headers?: Record<string, string>;
  body?: string;
  /** Total time budget (DNS + connect + response headers). */
  timeoutMs: number;
  signal?: AbortSignal;
  resolver?: Resolver;
}

export class OutboundTimeoutError extends Error {
  constructor(message = 'The endpoint did not answer in time.') {
    super(message);
    this.name = 'OutboundTimeoutError';
  }
}

/** Resolve and vet a destination without sending anything (early feedback at configuration time). */
export async function vetDestination(raw: string, opts: OutboundUrlPolicy & { resolver?: Resolver } = {}) {
  const check = checkOutboundUrl(raw, opts);
  if (!check.ok) throw new OutboundBlockedError(check.code, check.reason);
  const addresses = vetAddresses(check.hostname, await (opts.resolver ?? systemResolver)(check.hostname));
  return { ...check, addresses };
}

export async function safeFetch(raw: string, opts: SafeFetchOptions): Promise<{ status: number }> {
  const started = Date.now();
  const deadline = started + opts.timeoutMs;
  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new OutboundTimeoutError('Name resolution timed out.')),
        Math.max(1, deadline - Date.now()),
      );
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  const dest = await withTimeout(vetDestination(raw, opts));
  const pinned = dest.addresses[0] as { address: string; family: 4 | 6 };
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (typeof options === 'object' && options && 'all' in options && options.all) {
      (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [
        pinned,
      ]);
    } else {
      (callback as (e: null, a: string, f: number) => void)(null, pinned.address, pinned.family);
    }
  };
  return new Promise<{ status: number }>((resolve, reject) => {
    const remaining = Math.max(1, deadline - Date.now());
    const req = request(
      {
        host: dest.hostname,
        servername: dest.hostname,
        port: dest.port,
        path: `${dest.url.pathname}${dest.url.search}`,
        method: opts.method ?? 'POST',
        headers: opts.headers,
        lookup,
        agent: false,
        timeout: remaining,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      (res) => {
        clearTimeout(total);
        res.resume(); // the body is never stored
        resolve({ status: res.statusCode ?? 0 });
      },
    );
    const total = setTimeout(() => req.destroy(new OutboundTimeoutError()), remaining);
    req.on('timeout', () => req.destroy(new OutboundTimeoutError()));
    req.on('error', (err) => {
      clearTimeout(total);
      reject(err);
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
