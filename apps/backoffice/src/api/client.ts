import { isProblemDetails, type ProblemDetails } from '@portico/ui';
import type { z } from 'zod';
import { ApiError, contractProblem, offlineProblem } from './errors';
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
}

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
 *  - sends a client-generated X-Request-Id so even network failures have a reference id.
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

    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}/v1${o.path}`, {
        method: o.method ?? 'GET',
        headers,
        ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        ...(o.signal ? { signal: o.signal } : {}),
        credentials: 'same-origin',
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      opts.onReachability?.(false);
      throw new ApiError(offlineProblem(requestId));
    }
    opts.onReachability?.(true);
    const correlationId = res.headers.get('x-request-id') ?? requestId;
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      const problem: ProblemDetails = isProblemDetails(json)
        ? json
        : {
            type: 'about:blank',
            title: res.statusText || 'Request failed',
            status: res.status,
            code: `http_${res.status}`,
            detail:
              res.status >= 500
                ? 'The server could not complete this request. Nothing is assumed to have changed; check the record, then try again.'
                : 'The request was refused. Check the details and try again.',
            retryable: res.status >= 500 || res.status === 429,
            correlationId,
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
