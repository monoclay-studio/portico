/**
 * HTTP transport for partner webhooks (port). Production uses `safeWebhookTransport` (SSRF-safe `safeFetch`:
 * resolve-and-pin, public addresses only, allowed ports, no redirects, bounded time). Tests use a fake.
 */
import { type Resolver, safeFetch, systemResolver } from '../net/safe-fetch';

export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface WebhookTransport {
  /** Resolves with the HTTP status; rejects on blocked destinations, network errors and timeouts. */
  post(req: WebhookRequest): Promise<{ status: number }>;
}

export function safeWebhookTransport(
  opts: { resolver?: Resolver; allowedPorts?: readonly number[] } = {},
): WebhookTransport {
  return {
    post: (req) =>
      safeFetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: req.body,
        timeoutMs: req.timeoutMs,
        resolver: opts.resolver ?? systemResolver,
        allowedPorts: opts.allowedPorts ?? [443],
      }),
  };
}
