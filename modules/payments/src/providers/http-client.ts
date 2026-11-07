/**
 * Minimal injectable HTTP client for provider adapters. Tests inject recorded/mock responses; production uses
 * `fetchHttpClient`. Transport failures are classified because they mean different things for money:
 *  - `connect`: the request never left (DNS / connection refused) → the provider did NOT act;
 *  - `timeout` / `network`: the request may have arrived → outcome unknown (pending verification).
 */
export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export class HttpTransportError extends Error {
  constructor(
    readonly phase: 'connect' | 'timeout' | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'HttpTransportError';
  }
}

export interface HttpClient {
  send(req: HttpRequest): Promise<HttpResponse>;
}

const CONNECT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

export const fetchHttpClient: HttpClient = {
  async send(req) {
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        ...(req.body !== undefined ? { body: req.body } : {}),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
      return { status: res.status, body: await res.text() };
    } catch (err) {
      const e = err as { name?: string; cause?: { code?: string } };
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new HttpTransportError('timeout', 'The provider did not answer in time.');
      }
      if (e.cause?.code && CONNECT_CODES.has(e.cause.code)) {
        throw new HttpTransportError('connect', `Could not connect to the provider (${e.cause.code}).`);
      }
      throw new HttpTransportError('network', 'The connection to the provider failed.');
    }
  },
};
