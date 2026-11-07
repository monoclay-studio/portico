import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApiClient } from './client';
import { isApiError } from './errors';
import { IntentKeys, stableStringify } from './intent';

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

  it('explains non-problem failures and network failures with a reference id', async () => {
    const e1 = await client(mockFetch(503, undefined))
      .request({ path: '/p', schema: z.unknown() })
      .catch((x: unknown) => x);
    expect(isApiError(e1) && e1.problem).toMatchObject({
      status: 503,
      retryable: true,
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
      correlationId: 'req-0000001',
    });
    expect(reach).toHaveBeenCalledWith(false);
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
  it('stable stringify sorts object keys but not arrays', () => {
    expect(stableStringify({ b: [2, 1], a: 1 })).toBe('{"a":1,"b":[2,1]}');
  });
});
