/**
 * HTTP transport for partner webhooks (port). Production uses `fetchWebhookTransport`; tests use a fake that
 * records requests. Responses are never followed across redirects and their bodies are not stored.
 */

export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface WebhookTransport {
  /** Resolves with the HTTP status; rejects on network errors and timeouts. */
  post(req: WebhookRequest): Promise<{ status: number }>;
}

export function fetchWebhookTransport(): WebhookTransport {
  return {
    async post(req) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      try {
        const res = await fetch(req.url, {
          method: 'POST',
          headers: req.headers,
          body: req.body,
          redirect: 'manual',
          signal: controller.signal,
        });
        await res.body?.cancel().catch(() => {});
        return { status: res.status };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
