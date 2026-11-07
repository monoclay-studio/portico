import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApiClient } from './client';
import { isApiError } from './errors';
import { fingerprintOf, IntentKeys, stableStringify } from './intent';

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: {
          'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
          ...headers,
        },
      }),
  );
}

const client = (
  fetch: ReturnType<typeof mockFetch>,
  extra: Partial<Parameters<typeof createApiClient>[0]> = {},
) =>
  createApiClient({
    baseUrl: '',
    getToken: () => 'pts.t.secret',
    fetch: fetch as unknown as typeof globalThis.fetch,
    newId: () => 'req-0000001',
    ...extra,
  });

const problem = {
  type: 'https://docs.portico.app/errors/version_conflict',
  title: 'Conflict',
  status: 409,
  code: 'version_conflict',
  detail:
    'This property was changed by someone else while you were editing. Review the latest version and apply your change again.',
  retryable: false,
  correlationId: 'srv-123',
  details: { expectedVersion: 1, currentVersion: 2 },
};

describe('API client', () => {
  it('sends auth, Idempotency-Key and If-Match, validates the response and reads the ETag version', async () => {
    const f = mockFetch(200, { id: 'x', n: 1 }, { etag: 'W/"7"', 'x-request-id': 'srv-1' });
    const r = await client(f).request({
      method: 'PATCH',
      path: '/things/x',
      body: { n: 1 },
      ifMatch: 6,
      idempotencyKey: 'k1',
      schema: z.object({ id: z.string(), n: z.number() }),
    });
    expect(r).toEqual({ data: { id: 'x', n: 1 }, version: 7, correlationId: 'srv-1' });
    const init = f.mock.calls[0]?.[1] as RequestInit;
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer pts.t.secret');
    expect(h['If-Match']).toBe('W/"6"');
    expect(h['Idempotency-Key']).toBe('k1');
    expect(h['X-Request-Id']).toBe('req-0000001');
  });

  it('turns problem+json into an ApiError carrying the problem', async () => {
    const e = await client(mockFetch(409, problem))
      .request({ path: '/p', schema: z.unknown() })
      .catch((x: unknown) => x);
    expect(isApiError(e)).toBe(true);
    if (isApiError(e)) {
      expect(e.code).toBe('version_conflict');
      expect(e.problem.details).toEqual({ expectedVersion: 1, currentVersion: 2 });
    }
  });

  it('explains non-problem failures with a reference id; a failed read is safe to repeat', async () => {
    const e1 = await client(mockFetch(503, undefined))
      .request({ path: '/p', schema: z.unknown() })
      .catch((x: unknown) => x);
    expect(isApiError(e1) && e1.problem).toMatchObject({
      status: 503,
      retryable: true,
      safeToRetry: true,
      retryBasis: 'read',
      correlationId: 'req-0000001',
    });
    const broken = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const reach = vi.fn();
    const e2 = await client(broken as never, { onReachability: reach })
      .request({ path: '/p', schema: z.unknown() })
      .catch((x: unknown) => x);
    expect(isApiError(e2) && e2.problem).toMatchObject({
      code: 'network_error',
      retryable: true,
      safeToRetry: true,
      correlationId: 'req-0000001',
    });
    expect(isApiError(e2) && e2.problem.outcome).toBeUndefined();
    expect(reach).toHaveBeenCalledWith(false);
  });

  it('P1-2: a write whose answer never arrived is pending verification — never "nothing was sent"', async () => {
    const broken = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const e = await client(broken as never)
      .request({ method: 'PATCH', path: '/p', body: { a: 1 }, schema: z.unknown(), ifMatch: 3 })
      .catch((x: unknown) => x);
    expect(isApiError(e) && e.problem).toMatchObject({
      code: 'network_error',
      outcome: 'unknown',
      safeToRetry: false,
      retryable: false,
    });
    expect(isApiError(e) && e.problem.detail).toMatch(/could not confirm whether this was saved/);
    expect(isApiError(e) && e.problem.detail).not.toMatch(/nothing was sent/i);
    // With an Idempotency-Key the same request may be repeated: it cannot be applied twice.
    const keyed = await client(broken as never)
      .request({ method: 'POST', path: '/p', body: { a: 1 }, schema: z.unknown(), idempotencyKey: 'k1' })
      .catch((x: unknown) => x);
    expect(isApiError(keyed) && keyed.problem).toMatchObject({
      outcome: 'unknown',
      safeToRetry: true,
      retryBasis: 'idempotency_key',
    });
    // A gateway error without a problem body on a write: the request may have reached the API.
    const gateway = await client(mockFetch(504, undefined))
      .request({ method: 'POST', path: '/p', body: {}, schema: z.unknown() })
      .catch((x: unknown) => x);
    expect(isApiError(gateway) && gateway.problem).toMatchObject({ status: 504, outcome: 'unknown' });
  });

  it('P1-2: gives up after the timeout; a caller abort is not reported as a failure', async () => {
    vi.useFakeTimers();
    try {
      const hanging = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const reach = vi.fn();
      const pending = client(hanging as never, { onReachability: reach })
        .request({ path: '/slow', schema: z.unknown(), timeoutMs: 5000 })
        .catch((x: unknown) => x);
      await vi.advanceTimersByTimeAsync(5001);
      const e = await pending;
      expect(isApiError(e) && e.problem).toMatchObject({ code: 'request_timeout', safeToRetry: true });
      expect(isApiError(e) && e.problem.detail).toMatch(/within 5 seconds/);
      expect(reach).toHaveBeenCalledWith(false);

      const caller = new AbortController();
      const cancelled = client(hanging as never)
        .request({ path: '/slow', schema: z.unknown(), signal: caller.signal })
        .catch((x: unknown) => x);
      caller.abort();
      const c = await cancelled;
      expect(isApiError(c)).toBe(false);
      expect(c).toBeInstanceOf(DOMException);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never trusts an unexpected response shape', async () => {
    const e = await client(mockFetch(200, { id: 5 }))
      .request({ path: '/p', schema: z.object({ id: z.string() }) })
      .catch((x: unknown) => x);
    expect(isApiError(e) && e.code).toBe('contract_mismatch');
  });

  it('ends the session on 401 except on the sign-in call', async () => {
    const ended = vi.fn();
    await client(mockFetch(401, { ...problem, status: 401, code: 'unauthenticated' }), {
      onSessionEnded: ended,
    })
      .request({ path: '/me', schema: z.unknown() })
      .catch(() => {});
    expect(ended).toHaveBeenCalledOnce();
    await client(mockFetch(401, { ...problem, status: 401, code: 'unauthenticated' }), {
      onSessionEnded: ended,
    })
      .request({ method: 'POST', path: '/auth/login', schema: z.unknown(), expectUnauthenticated: true })
      .catch(() => {});
    expect(ended).toHaveBeenCalledOnce();
  });
});

describe('IntentKeys (Idempotency-Key per user intent)', () => {
  it('reuses the key for retries of the same payload, regardless of key order', () => {
    let n = 0;
    const k = new IntentKeys(() => `key-${++n}`);
    expect(k.keyFor({ a: 1, b: { c: 2, d: 3 } })).toBe('key-1');
    expect(k.keyFor({ b: { d: 3, c: 2 }, a: 1 })).toBe('key-1');
  });
  it('uses a new key for a changed payload and after success', () => {
    let n = 0;
    const k = new IntentKeys(() => `key-${++n}`);
    k.keyFor({ name: 'Azure' });
    expect(k.keyFor({ name: 'Azure Atoll' })).toBe('key-2');
    k.settle();
    expect(k.pendingKey).toBeNull();
    expect(k.keyFor({ name: 'Azure Atoll' })).toBe('key-3');
  });
  it('keeps only a hash of the payload (it may hold an initial password)', () => {
    const k = new IntentKeys(() => 'key-1');
    k.keyFor({ email: 'a@b.invalid', password: 'correct horse battery staple' });
    expect(JSON.stringify(k)).not.toContain('correct horse');
    expect(fingerprintOf({ a: 1, b: 2 })).toBe(fingerprintOf({ b: 2, a: 1 }));
    expect(fingerprintOf({ a: 1 })).not.toBe(fingerprintOf({ a: 2 }));
  });
  it('stable stringify sorts object keys but not arrays', () => {
    expect(stableStringify({ b: [2, 1], a: 1 })).toBe('{"a":1,"b":[2,1]}');
  });
});
