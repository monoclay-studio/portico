import { describe, expect, it } from 'vitest';
import { classifyWorkflow, computeHealth, type HealthInput, type WorkflowHealthInput } from './health';
import {
  checkEndpointUrl,
  invalidPatterns,
  MAX_DELIVERY_ATTEMPTS,
  matchesEventType,
  nextRetryDelay,
  signatureHeader,
  signPayload,
  verifySignature,
} from './webhooks';

const NOW = new Date('2026-11-07T12:00:00Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

function wf(over: Partial<WorkflowHealthInput> = {}): WorkflowHealthInput {
  return {
    workflow: 'reservations',
    sync: 'periodic',
    operations: ['read', 'receive'],
    freshnessTargetSeconds: 120,
    expectedIntervalSeconds: 60,
    feedsSystemOfRecord: true,
    lastSuccessAt: ago(30),
    lastFailureKind: null,
    lastFailureReason: null,
    consecutiveFailures: 0,
    lastMessageLatencySeconds: 5,
    incompleteSince: null,
    incompleteReason: null,
    heldMessages: 0,
    ...over,
  };
}

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    now: NOW,
    state: 'monitoring',
    systemName: 'Lagoon PMS',
    baseProvenance: 'simulated',
    activatedAt: ago(86_400),
    interruptedSince: null,
    interruptionReason: null,
    workflows: [wf()],
    credential: {
      required: true,
      present: true,
      expiresAt: new Date(NOW.getTime() + 90 * 86_400_000),
      rejected: false,
    },
    mappingProblems: { awaitingReview: 0, unmapped: 0 },
    outbound: { queued: 0, pendingVerification: 0, needsRevalidation: 0 },
    openExceptions: [],
    vendorNotices: [],
    ...over,
  };
}

const ctx = { now: NOW, operational: true, paused: false, activatedAt: ago(86_400) };

describe('workflow status against the freshness target', () => {
  it('healthy within T, delayed beyond T, failing beyond 3T for a system-of-record workflow', () => {
    expect(classifyWorkflow(wf({ lastSuccessAt: ago(120) }), ctx).status).toBe('healthy');
    expect(classifyWorkflow(wf({ lastSuccessAt: ago(121) }), ctx).status).toBe('delayed');
    expect(classifyWorkflow(wf({ lastSuccessAt: ago(360) }), ctx).status).toBe('delayed');
    expect(classifyWorkflow(wf({ lastSuccessAt: ago(361) }), ctx).status).toBe('failing');
    expect(classifyWorkflow(wf({ lastSuccessAt: ago(361), feedsSystemOfRecord: false }), ctx).status).toBe(
      'degraded',
    );
  });
  it('partial errors or held messages degrade; the circuit breaker fails', () => {
    expect(classifyWorkflow(wf({ consecutiveFailures: 1 }), ctx).status).toBe('degraded');
    expect(classifyWorkflow(wf({ heldMessages: 2 }), ctx).status).toBe('degraded');
    expect(classifyWorkflow(wf({ consecutiveFailures: 10 }), ctx).status).toBe('failing');
  });
  it('late-arriving messages make data delayed even right after a sync', () => {
    expect(classifyWorkflow(wf({ lastMessageLatencySeconds: 600 }), ctx).status).toBe('delayed');
  });
  it('file workflows have no time expectation', () => {
    expect(classifyWorkflow(wf({ sync: 'file', lastSuccessAt: ago(86_400 * 3) }), ctx).status).toBe(
      'healthy',
    );
  });
  it('unknown before the first exchange; paused when paused', () => {
    expect(classifyWorkflow(wf({ lastSuccessAt: null }), { ...ctx, activatedAt: ago(10) }).status).toBe(
      'unknown',
    );
    expect(classifyWorkflow(wf(), { ...ctx, paused: true }).status).toBe('paused');
  });
});

describe('computeHealth', () => {
  it('healthy connection: no urgent items; data labeled simulated with its age (G-05)', () => {
    const h = computeHealth(input());
    expect(h.overall).toBe('healthy');
    expect(h.urgent).toEqual([]);
    expect(h.workflows[0]).toMatchObject({
      dataProvenance: 'simulated',
      ageSeconds: 30,
      freshnessTargetSeconds: 120,
      exchangeLabel: 'Updated every 60 seconds',
    });
  });
  it('INT-I08: never healthy beyond the target; data labeled delayed', () => {
    const h = computeHealth(input({ workflows: [wf({ lastSuccessAt: ago(200) })] }));
    expect(h.overall).toBe('degraded');
    expect(h.workflows[0]).toMatchObject({ status: 'delayed', dataProvenance: 'delayed', ageSeconds: 200 });
  });
  it('a detected gap labels the data incomplete until reconciled', () => {
    const h = computeHealth(
      input({ workflows: [wf({ incompleteSince: ago(60), incompleteReason: 'missed revision' })] }),
    );
    expect(h.workflows[0]?.dataProvenance).toBe('incomplete');
    expect(h.urgent.map((s) => s.code)).toContain('workflow_incomplete');
    expect(h.recoveryActions).toContain('Reconcile now');
  });
  it('outage: urgent problem separated from routine information, vendor responsible', () => {
    const h = computeHealth(
      input({
        workflows: [wf({ consecutiveFailures: 3, lastFailureKind: 'outage', lastFailureReason: 'HTTP 503' })],
        interruptedSince: ago(300),
        interruptionReason: 'HTTP 503',
        mappingProblems: { awaitingReview: 1, unmapped: 0 },
      }),
    );
    expect(h.overall).toBe('degraded');
    expect(h.urgent.map((s) => s.code)).toEqual(
      expect.arrayContaining(['workflow_degraded', 'connection_interrupted']),
    );
    expect(h.urgent.find((s) => s.code === 'workflow_degraded')?.responsibleParty).toBe('vendor');
    expect(h.routine.map((s) => s.code)).toEqual(['mappings_need_review']);
  });
  it('all system-of-record workflows failing → down', () => {
    expect(
      computeHealth(input({ workflows: [wf({ lastSuccessAt: ago(4000), consecutiveFailures: 12 })] }))
        .overall,
    ).toBe('down');
  });
  it('credential expiry: routine within 30 days, urgent within a day, down when expired', () => {
    const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
    const in20 = computeHealth(
      input({ credential: { required: true, present: true, expiresAt: at(20), rejected: false } }),
    );
    expect(in20.credentialStatus).toBe('expiring');
    expect(in20.routine.map((s) => s.code)).toContain('credential_expiring');
    expect(in20.overall).toBe('healthy');
    const in12h = computeHealth(
      input({ credential: { required: true, present: true, expiresAt: at(0.5), rejected: false } }),
    );
    expect(in12h.urgent.map((s) => s.code)).toContain('credential_expiring');
    const expired = computeHealth(
      input({ credential: { required: true, present: true, expiresAt: at(-1), rejected: false } }),
    );
    expect(expired.overall).toBe('down');
    expect(expired.credentialStatus).toBe('invalid');
  });
  it('held money actions after reconnection are urgent', () => {
    const h = computeHealth(input({ outbound: { queued: 0, pendingVerification: 1, needsRevalidation: 2 } }));
    expect(h.urgent.map((s) => s.code)).toEqual(
      expect.arrayContaining(['actions_need_revalidation', 'actions_pending_verification']),
    );
  });
  it('vendor notices become urgent within a week of their deadline', () => {
    const h = computeHealth(
      input({
        vendorNotices: [
          {
            title: 'API v1 retires',
            requiredAction: 'Upgrade',
            dueDate: '2026-11-10',
            responsibleParty: 'monoclay',
          },
          {
            title: 'New TLS root',
            requiredAction: 'Nothing',
            dueDate: '2027-03-01',
            responsibleParty: 'vendor',
          },
        ],
      }),
    );
    expect(h.urgent.map((s) => s.title)).toContain('API v1 retires');
    expect(h.routine.map((s) => s.title)).toContain('New TLS root');
  });
  it('paused and setup states', () => {
    expect(computeHealth(input({ state: 'paused' })).overall).toBe('paused');
    expect(computeHealth(input({ state: 'mappings_suggested' })).overall).toBe('not_monitored');
    expect(
      computeHealth(
        input({
          state: 'error',
          credential: { required: true, present: true, expiresAt: null, rejected: true },
        }),
      ).overall,
    ).toBe('down');
  });
});

describe('webhook signatures and retries', () => {
  const secret = 'whsec_test_secret_value';
  const body = JSON.stringify({ id: 'e1', type: 'reservations.booking.confirmed' });
  it('verifies a valid signature and rejects tampering, wrong secret and old timestamps', () => {
    const header = signPayload(secret, 1_800_000_000, body);
    expect(verifySignature(secret, header, body, 1_800_000_010)).toEqual({ valid: true });
    expect(verifySignature(secret, header, `${body} `, 1_800_000_010)).toMatchObject({
      valid: false,
      reason: 'signature mismatch',
    });
    expect(verifySignature('other', header, body, 1_800_000_010)).toMatchObject({ valid: false });
    expect(verifySignature(secret, header, body, 1_800_000_000 + 301)).toMatchObject({
      valid: false,
      reason: 'timestamp outside tolerance',
    });
    expect(verifySignature(secret, undefined, body, 1)).toMatchObject({ valid: false });
    expect(verifySignature(secret, 'garbage', body, 1)).toMatchObject({
      valid: false,
      reason: 'malformed signature header',
    });
  });
  it('during rotation both secrets verify the same delivery', () => {
    const header = signatureHeader(['new_secret', 'old_secret'], 1_800_000_000, body);
    expect(header.split(',').filter((p) => p.startsWith('v1='))).toHaveLength(2);
    expect(verifySignature('new_secret', header, body, 1_800_000_000).valid).toBe(true);
    expect(verifySignature('old_secret', header, body, 1_800_000_000).valid).toBe(true);
  });
  it('retries on the schedule, then dead', () => {
    expect(nextRetryDelay(1)).toBe(60);
    expect(nextRetryDelay(7)).toBe(43_200);
    expect(nextRetryDelay(MAX_DELIVERY_ATTEMPTS)).toBeNull();
  });
  it('event patterns and the public catalogue', () => {
    expect(matchesEventType('reservations.*', 'reservations.booking.confirmed')).toBe(true);
    expect(matchesEventType('reservations.booking.confirmed', 'reservations.booking.cancelled')).toBe(false);
    expect(invalidPatterns(['reservations.*', 'finance.ledger.*', 'integration.inbound.applied'])).toEqual([
      'finance.ledger.*',
      'integration.inbound.applied',
    ]);
  });
  it('rejects endpoints that are not public https', () => {
    expect(checkEndpointUrl('https://partner.example.com/hooks')).toEqual({ ok: true });
    for (const bad of [
      'http://partner.example.com',
      'https://localhost/x',
      'https://10.0.0.5/x',
      'https://169.254.169.254/latest',
      'https://192.168.1.2',
      'https://[::1]/',
      'https://user:pw@x.com',
      'not a url',
      'https://svc.internal/x',
    ]) {
      expect(checkEndpointUrl(bad).ok).toBe(false);
    }
  });
});
