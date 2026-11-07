/**
 * Real HTTPS transport for hub calls. Hub hosts are code constants (never customer-supplied), so the policy is an
 * exact host allowlist: https only, no redirects followed, a total time budget ending at the call's deadline and a
 * bounded response body. (The SSRF-safe `safeFetch` of the integration module discards response bodies; see
 * FOUNDATION_REQUESTS.md FR-2 for a shared body-returning variant.)
 *
 * Not exercised against Channex in this repository: no Channex key exists here (R4 needs the owner's staging key).
 */
import { type HubHttpRequest, type HubHttpResponse, type HubTransport, HubTransportError } from './hub';

export interface HttpTransportOptions {
  allowedHosts: readonly string[];
  maxBodyBytes?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function fixedHostHttpTransport(opts: HttpTransportOptions): HubTransport {
  const allowed = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));
  const maxBytes = opts.maxBodyBytes ?? 5 * 1024 * 1024;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  return {
    async send(req: HubHttpRequest): Promise<HubHttpResponse> {
      let url: URL;
      try {
        url = new URL(req.url);
      } catch {
        throw new HubTransportError('blocked', 'the address is not a valid URL', false);
      }
      if (url.protocol !== 'https:' || url.username || url.password || url.port) {
        throw new HubTransportError('blocked', 'only plain https on the default port is allowed', false);
      }
      if (!allowed.has(url.hostname.toLowerCase())) {
        throw new HubTransportError('blocked', `host ${url.hostname} is not an allowed hub host`, false);
      }
      const remaining = req.deadline.getTime() - now();
      if (remaining <= 0) throw new HubTransportError('timeout', 'the deadline passed before sending', false);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        const res = await doFetch(url, {
          method: req.method,
          headers: req.headers,
          ...(req.body !== undefined ? { body: req.body } : {}),
          redirect: 'manual',
          signal: controller.signal,
        });
        const reader = res.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
              controller.abort();
              throw new HubTransportError('network', 'the answer was larger than allowed', true);
            }
            chunks.push(value);
          }
        }
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
        return { status: res.status, headers, body: Buffer.concat(chunks).toString('utf8') };
      } catch (err) {
        if (err instanceof HubTransportError) throw err;
        if (controller.signal.aborted)
          throw new HubTransportError('timeout', 'no answer before the deadline', true);
        throw new HubTransportError('network', err instanceof Error ? err.message : 'network error', true);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
