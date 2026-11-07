import { BusinessRuleError, NotFoundError, VersionConflictError } from '@portico/kernel';
import { describe, expect, it } from 'vitest';
import { toProblem } from '../src';

describe('problem details', () => {
  it('maps domain errors to RFC 9457 with stable codes and recovery guidance', () => {
    const p = toProblem(new VersionConflictError('stay', 's1', 3, 4), 'req-1');
    expect(p).toMatchObject({
      status: 409,
      code: 'version_conflict',
      correlationId: 'req-1',
      retryable: false,
    });
    expect(p.detail).toMatch(/Review the latest version/);
    expect(toProblem(new NotFoundError('booking', 'b1'), 'r').status).toBe(404);
    expect(
      toProblem(new BusinessRuleError('unit_not_ready', 'Room 204 is not inspected yet.'), 'r'),
    ).toMatchObject({ status: 422, code: 'unit_not_ready' });
  });

  it('never leaks internals for unexpected errors', () => {
    const p = toProblem(new Error('connection string postgres://secret@db'), 'req-9');
    expect(p.status).toBe(500);
    expect(p.detail).not.toContain('postgres://');
    expect(p.detail).toContain('req-9');
  });
});

describe('client IP handling', () => {
  it('ignores X-Forwarded-For unless the connecting proxy is explicitly trusted', async () => {
    const { createServer } = await import('../src');
    const auth = { authenticate: async () => null };
    const mod = {
      name: 't',
      routes: (app: import('../src').PorticoApp) => {
        app.get('/ip', { config: { public: true } }, async (req) => ({ ip: req.ip }));
      },
    };
    const plain = await createServer({
      authenticator: auth,
      modules: [mod],
      logger: false,
      rateLimit: false,
      openApi: false,
    });
    const spoof = await plain.inject({
      method: 'GET',
      url: '/v1/ip',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(spoof.json().ip).not.toBe('203.0.113.9');
    const behindAlb = await createServer({
      authenticator: auth,
      modules: [mod],
      logger: false,
      rateLimit: false,
      openApi: false,
      // inject() connects from 127.0.0.1 — stands in for the ALB's VPC address.
      trustedProxies: ['127.0.0.0/8'],
    });
    const viaAlb = await behindAlb.inject({
      method: 'GET',
      url: '/v1/ip',
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(viaAlb.json().ip).toBe('203.0.113.9');
    // A client-supplied X-Forwarded-For is prepended; the ALB appends the real address. Only the last hop counts.
    const spoofViaAlb = await behindAlb.inject({
      method: 'GET',
      url: '/v1/ip',
      headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' },
    });
    expect(spoofViaAlb.json().ip).toBe('203.0.113.9');
    await plain.close();
    await behindAlb.close();
  });
});
