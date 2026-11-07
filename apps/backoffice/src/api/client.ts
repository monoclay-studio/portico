import { isProblemDetails, type ProblemDetails } from '@portico/ui';
import type { z } from 'zod';
import { ApiError, connectionProblem, contractProblem } from './errors';
import { parseVersionTag, versionTag } from './etag';

export interface ApiResult<T> {
  data: T;
  /** Aggregate version from the ETag header (optimistic concurrency, ADR-0009). */
  version: number | undefined;
  correlationId: string;
}

export interface RequestOptions<S extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /** Response schema from the module's contracts.ts. `null` for 204 responses. */
  schema: S | null;
  /** Required for creates and money movement. Reuse the same key for retries of the same intent. */
  idempotencyKey?: string;
  /** Version last seen (from ETag) for updates of versioned aggregates. */
  ifMatch?: number;
  signal?: AbortSignal;
  /** Treat 401 as "wrong credentials" (sign-in form) rather than "session ended". */
  expectUnauthenticated?: boolean;
  /** Give up waiting after this long (default: 20 s for reads, 30 s for writes). */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = { read: 20_000, write: 30_000 } as const;

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  /** Called when an authenticated call returns 401 (session expired or revoked), with the token that was used. */
  onSessionEnded?: (problem: ProblemDetails, tokenUsed: string | null) => void;
  /** Reachability signal for the offline indicator: false on network failure, true on any HTTP answer. */
  onReachability?: (reachable: boolean) => void;
  fetch?: typeof fetch;
  newId?: () => string;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Typed fetch wrapper for the Portico API:
 *  - validates responses with the module's Zod contract (never trusts an unexpected shape);
 *  - turns every failure into an ApiError carrying RFC 9457 problem details;
 *  - sends Idempotency-Key and If-Match when asked, and reads ETag versions;
 *  - sends a client-generated X-Request-Id so even network failures have a reference id;
 *  - gives up after a timeout; a write whose answer never arrived is reported as an UNKNOWN outcome (pending
 *    verification), never as "nothing was sent".
 */
export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const newId = opts.newId ?? (() => crypto.randomUUID());

  async function request<S extends z.ZodType>(o: RequestOptions<S>): Promise<ApiResult<z.infer<S>>> {
    const requestId = newId();
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
      'X-Request-Id': requestId,
    };
    const token = opts.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.idempotencyKey) headers['Idempotency-Key'] = o.idempotencyKey;
    if (o.ifMatch !== undefined) headers['If-Match'] = versionTag(o.ifMatch);

    const method = o.method ?? 'GET';
    const kind = method === 'GET' ? 'read' : 'write';
    const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS[kind];
    // Our own timer (not AbortSignal.timeout) so a caller's abort and our timeout can be told apart.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = o.signal ? AbortSignal.any([o.signal, timeout.signal]) : timeout.signal;
    const failed = (timedOut: boolean) =>
      new ApiError(
        connectionProblem(requestId, { kind, timedOut, idempotent: Boolean(o.idempotencyKey), timeoutMs }),
      );

    let res: Response;
    let text: string;
    try {
      res = await doFetch(`${opts.baseUrl}/v1${o.path}`, {
        method,
        headers,
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        signal,
        credentials: 'same-origin',
      });
      text = await res.text();
    } catch (e) {
      // The caller cancelled (navigation, query replaced): not a failure to show.
      if (o.signal?.aborted) throw e;
      if (timeout.signal.aborted) {
        opts.onReachability?.(false);
        throw failed(true);
      }
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      opts.onReachability?.(false);
      throw failed(false);
    } finally {
      clearTimeout(timer);
    }
    opts.onReachability?.(true);
    const correlationId = res.headers.get('x-request-id') ?? requestId;
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      // A gateway error on a write without a problem body: the request may have reached the API.
      const gatewayOnWrite =
        !isProblemDetails(json) && kind === 'write' && [502, 503, 504].includes(res.status);
      const problem: ProblemDetails = isProblemDetails(json)
        ? json
        : gatewayOnWrite
          ? {
              ...connectionProblem(correlationId, {
                kind,
                timedOut: res.status === 504,
                idempotent: Boolean(o.idempotencyKey),
              }),
              status: res.status,
            }
          : {
              type: 'about:blank',
              title: res.status >= 500 ? 'Portico could not complete this' : 'Portico refused this request',
              status: res.status,
              code: `http_${res.status}`,
              detail:
                res.status >= 500
                  ? kind === 'read'
                    ? 'The server had a problem loading this. Nothing was changed. Try again in a moment.'
                    : 'The server could not complete this request. Check the record to see whether it was saved before trying again.'
                  : 'Check the details and try again. If it keeps happening, quote the reference to support.',
              retryable: res.status >= 500 || res.status === 429,
              correlationId,
              ...(kind === 'read' && res.status >= 500
                ? { safeToRetry: true, retryBasis: 'read' as const }
                : {}),
            };
      if (res.status === 401 && !o.expectUnauthenticated) opts.onSessionEnded?.(problem, token);
      throw new ApiError(problem);
    }

    const version = parseVersionTag(res.headers.get('etag'));
    if (o.schema === null) return { data: undefined as z.infer<S>, version, correlationId };
    const parsed = o.schema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new ApiError(contractProblem(correlationId, o.path, issues));
    }
    return { data: parsed.data, version, correlationId };
  }

  return { request };
}
