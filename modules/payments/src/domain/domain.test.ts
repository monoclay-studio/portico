import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BREAKER,
  decideAttempt,
  effectiveState,
  INITIAL_BREAKER,
  recordFailure,
  recordSuccess,
} from './circuit-breaker';
import { majorToMinor, parseCsvRecords, parseStatementCsv } from './csv';
import { explainDecline } from './declines';
import { containsLongDigitRun, containsPossiblePan, luhnValid, scrubCardData } from './pci';
import {
  NOT_FOUND_GRACE_MS,
  nextVerificationAt,
  VERIFICATION_STEADY_MS,
  vccIsActive,
  vccRetryDecision,
} from './schedule';
import { matchSettlement, normalizeReference, type RecordedItem } from './settlement';
import {
  authorizationTransition,
  capturableMinor,
  disputeTransition,
  paymentRequestStatusFor,
  paymentTransition,
  refundableMinor,
  refundTransition,
  statusAfterCapture,
} from './states';

describe('authorization state machine (monotonic)', () => {
  it('applies forward transitions', () => {
    expect(authorizationTransition('processing', 'authorized')).toEqual({ kind: 'apply' });
    expect(authorizationTransition('pending_verification', 'authorized')).toEqual({ kind: 'apply' });
    expect(authorizationTransition('authorized', 'partially_captured')).toEqual({ kind: 'apply' });
    expect(authorizationTransition('partially_captured', 'captured')).toEqual({ kind: 'apply' });
    expect(authorizationTransition('authorized', 'voided')).toEqual({ kind: 'apply' });
    expect(authorizationTransition('authorized', 'expired')).toEqual({ kind: 'apply' });
  });
  it('treats late, older states as stale (out-of-order webhooks never move backwards)', () => {
    expect(authorizationTransition('captured', 'authorized')).toEqual({ kind: 'stale' });
    expect(authorizationTransition('authorized', 'pending_verification')).toEqual({ kind: 'stale' });
    expect(authorizationTransition('voided', 'authorized')).toEqual({ kind: 'stale' });
  });
  it('flags contradictions as mismatches', () => {
    expect(authorizationTransition('voided', 'captured').kind).toBe('mismatch');
    expect(authorizationTransition('failed', 'captured').kind).toBe('mismatch');
  });
  it('is a no-op for the same state (duplicate webhook)', () => {
    expect(authorizationTransition('authorized', 'authorized')).toEqual({ kind: 'noop' });
  });
  it('derives status after capture from the remaining hold', () => {
    expect(statusAfterCapture(0)).toBe('captured');
    expect(statusAfterCapture(1)).toBe('partially_captured');
  });
});

describe('payment and refund state machines', () => {
  it('resolves pending verification either way, once', () => {
    expect(paymentTransition('pending_verification', 'succeeded')).toEqual({ kind: 'apply' });
    expect(paymentTransition('pending_verification', 'failed')).toEqual({ kind: 'apply' });
    expect(paymentTransition('succeeded', 'succeeded')).toEqual({ kind: 'noop' });
    expect(paymentTransition('succeeded', 'pending_verification')).toEqual({ kind: 'stale' });
  });
  it('never hides money: failed → succeeded is applied but flagged', () => {
    expect(paymentTransition('failed', 'succeeded').kind).toBe('apply_with_mismatch');
  });
  it('does not silently turn a succeeded payment into a failure', () => {
    expect(paymentTransition('succeeded', 'failed').kind).toBe('mismatch');
  });
  it('recorded payments only move to verified', () => {
    expect(paymentTransition('recorded_unverified', 'recorded_verified')).toEqual({ kind: 'apply' });
    expect(paymentTransition('recorded_verified', 'recorded_unverified')).toEqual({ kind: 'stale' });
  });
  it('a refund failing after success is applied and flagged', () => {
    expect(refundTransition('succeeded', 'failed').kind).toBe('apply_with_mismatch');
    expect(refundTransition('processing', 'succeeded')).toEqual({ kind: 'apply' });
  });
  it('computes refundable and capturable amounts including in-flight reservations', () => {
    expect(refundableMinor({ amountMinor: 1000, refundedMinor: 300, refundReservedMinor: 200 })).toBe(500);
    expect(refundableMinor({ amountMinor: 1000, refundedMinor: 1000, refundReservedMinor: 0 })).toBe(0);
    expect(capturableMinor({ amountMinor: 5000, capturedMinor: 2000, captureReservedMinor: 1000 })).toBe(2000);
  });
  it('dispute transitions are monotonic', () => {
    expect(disputeTransition('opened', 'evidence_required')).toEqual({ kind: 'apply' });
    expect(disputeTransition('won', 'evidence_required')).toEqual({ kind: 'stale' });
    expect(disputeTransition('evidence_submitted', 'accepted').kind).toBe('mismatch');
  });
  it('payment request is paid only from confirmed totals', () => {
    expect(paymentRequestStatusFor('open', 1000, 0)).toBe('open');
    expect(paymentRequestStatusFor('open', 1000, 400)).toBe('partially_paid');
    expect(paymentRequestStatusFor('partially_paid', 1000, 1000)).toBe('paid');
    expect(paymentRequestStatusFor('cancelled', 1000, 1000)).toBe('cancelled');
    expect(paymentRequestStatusFor('expired', 1000, 200)).toBe('expired');
  });
});

describe('decline explanations', () => {
  it('explains the problem and the recovery', () => {
    const d = explainDecline('insufficient_funds');
    expect(d.message).toMatch(/insufficient funds/);
    expect(d.recovery).toMatch(/another card|payment link/);
    expect(d.category).toBe('soft');
  });
  it('never accuses the guest on fraud-related declines', () => {
    for (const code of ['stolen_card', 'lost_card', 'fraudulent', 'pickup_card']) {
      const d = explainDecline(code);
      expect(d.category).toBe('fraud_suspected');
      expect(d.message.toLowerCase()).not.toMatch(/stolen|fraud|lost/);
      expect(d.recovery).toMatch(/Do not retry/);
    }
  });
  it('points 3-D Secure declines to a payment link', () => {
    expect(explainDecline('authentication_required').recovery).toMatch(/payment link/);
  });
  it('falls back for unknown codes and normalizes case', () => {
    expect(explainDecline('SOMETHING_NEW').category).toBe('hard');
    expect(explainDecline('Insufficient_Funds').code).toBe('insufficient_funds');
    expect(explainDecline(undefined).code).toBe('generic_decline');
  });
  it('says nothing was charged when the provider is unavailable', () => {
    expect(explainDecline('provider_unavailable').message).toMatch(/Nothing was charged/);
  });
});

describe('circuit breaker', () => {
  const t0 = new Date('2026-11-07T10:00:00Z');
  it('opens after the threshold of consecutive failures and blocks until cool-down', () => {
    let s = INITIAL_BREAKER;
    for (let i = 0; i < DEFAULT_BREAKER.failureThreshold - 1; i++) s = recordFailure(s, t0, 'timeout');
    expect(s.state).toBe('closed');
    s = recordFailure(s, t0, 'timeout');
    expect(s.state).toBe('open');
    const blocked = decideAttempt(s, new Date(t0.getTime() + 1000));
    expect(blocked.allowed).toBe(false);
    expect(effectiveState(s, new Date(t0.getTime() + 1000))).toBe('open');
  });
  it('lets exactly one probe through after cool-down', () => {
    let s = INITIAL_BREAKER;
    for (let i = 0; i < 3; i++) s = recordFailure(s, t0, 'down');
    const later = new Date(t0.getTime() + DEFAULT_BREAKER.cooldownMs);
    expect(effectiveState(s, later)).toBe('half_open');
    const probe = decideAttempt(s, later);
    expect(probe).toMatchObject({ allowed: true, probe: true });
    if (!probe.allowed) throw new Error('unreachable');
    const second = decideAttempt(probe.next, later);
    expect(second.allowed).toBe(false);
  });
  it('closes on probe success and re-opens on probe failure', () => {
    let s = INITIAL_BREAKER;
    for (let i = 0; i < 3; i++) s = recordFailure(s, t0, 'down');
    const later = new Date(t0.getTime() + DEFAULT_BREAKER.cooldownMs);
    const probe = decideAttempt(s, later);
    if (!probe.allowed) throw new Error('unreachable');
    expect(recordSuccess(probe.next, later)).toMatchObject({ state: 'closed', consecutiveFailures: 0 });
    expect(recordFailure(probe.next, later, 'still down').state).toBe('open');
  });
  it('a success resets the failure count', () => {
    let s = recordFailure(INITIAL_BREAKER, t0, 'x');
    s = recordFailure(s, t0, 'x');
    s = recordSuccess(s, t0);
    s = recordFailure(s, t0, 'x');
    expect(s.state).toBe('closed');
  });
});

describe('verification and VCC schedules', () => {
  const now = new Date('2026-11-07T10:00:00Z');
  it('backs off 10s, 30s, 2m, 10m, 1h then every 6h', () => {
    expect(nextVerificationAt(0, now).getTime() - now.getTime()).toBe(10_000);
    expect(nextVerificationAt(4, now).getTime() - now.getTime()).toBe(3_600_000);
    expect(nextVerificationAt(9, now).getTime() - now.getTime()).toBe(VERIFICATION_STEADY_MS);
    expect(NOT_FOUND_GRACE_MS).toBeGreaterThan(60_000);
  });
  it('charges a VCC from its activation date only (property-local dates)', () => {
    expect(vccIsActive('2026-11-08', '2026-11-07')).toBe(false);
    expect(vccIsActive('2026-11-08', '2026-11-08')).toBe(true);
  });
  it('retries funding delays on a schedule and gives up after the last attempt or on expiry', () => {
    const r1 = vccRetryDecision({ attempts: 1, now, expiresOn: null, todayLocal: '2026-11-07', retryable: true });
    expect(r1).toEqual({ kind: 'retry', at: new Date(now.getTime() + 6 * 3_600_000) });
    expect(vccRetryDecision({ attempts: 6, now, expiresOn: null, todayLocal: '2026-11-07', retryable: true }).kind).toBe(
      'give_up',
    );
    expect(
      vccRetryDecision({ attempts: 1, now, expiresOn: '2026-11-07', todayLocal: '2026-11-07', retryable: true }).kind,
    ).toBe('give_up');
    expect(vccRetryDecision({ attempts: 1, now, expiresOn: null, todayLocal: '2026-11-07', retryable: false }).kind).toBe(
      'give_up',
    );
  });
});

describe('card data guards', () => {
  it('recognizes Luhn-valid card-number shapes (test PANs only)', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('4242424242424241')).toBe(false);
    expect(containsPossiblePan('4242 4242 4242 4242')).toBe(true);
    expect(containsPossiblePan('card 4000-0566-5566-5556 ok')).toBe(true);
    expect(containsPossiblePan('pm_1PqXyZ2eZvKYlo2C')).toBe(false);
    expect(containsPossiblePan('sim_card_visa_approve')).toBe(false);
    expect(containsLongDigitRun('123456789012')).toBe(true);
    expect(containsLongDigitRun('acct_1234')).toBe(false);
  });
  it('scrubs card-data fields and PAN-shaped strings from stored payloads', () => {
    const out = scrubCardData({
      id: 'evt_1',
      data: { card: { number: '4242424242424242', cvc: '123', last4: '4242' }, note: 'x 4242424242424242' },
    }) as { data: { card: Record<string, string>; note: string } };
    expect(out.data.card.number).toBe('[removed]');
    expect(out.data.card.cvc).toBe('[removed]');
    expect(out.data.card.last4).toBe('4242');
    expect(out.data.note).toMatch(/removed/);
  });
});

describe('statement CSV parsing', () => {
  it('parses quoted fields and converts major units exactly', () => {
    expect(parseCsvRecords('a,"b,c","d""e"\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'd"e'],
      ['1', '2', '3'],
    ]);
    expect(majorToMinor('840.00', 'USD')).toBe(84000);
    expect(majorToMinor('0.1', 'USD')).toBe(10);
    expect(majorToMinor('-12.5', 'USD')).toBe(-1250);
    expect(majorToMinor('1000', 'JPY')).toBe(1000);
    expect(majorToMinor('1.234', 'KWD')).toBe(1234);
    expect(() => majorToMinor('1.005', 'USD')).toThrow(/decimal places/);
    expect(() => majorToMinor('abc', 'USD')).toThrow(/not a valid amount/);
  });
  it('parses a statement and normalizes refunds to negative amounts', () => {
    const lines = parseStatementCsv(
      'Date,Amount,Currency,Reference,Approval Code,Last4,Type\n2026-11-07,840.00,USD,R1,A1,4242,sale\n2026-11-07,20.00,usd,R2,,,refund\n',
    );
    expect(lines).toEqual([
      expect.objectContaining({ lineNo: 1, amountMinor: 84000, approvalCode: 'A1', cardLast4: '4242' }),
      expect.objectContaining({ lineNo: 2, amountMinor: -2000, currency: 'USD' }),
    ]);
  });
  it('explains malformed files', () => {
    expect(() => parseStatementCsv('date,amount\n2026-11-07,1.00\n')).toThrow(/no "currency" column/);
    expect(() => parseStatementCsv('date,amount,currency\n07/11/2026,1.00,USD\n')).toThrow(/YYYY-MM-DD/);
    expect(() => parseStatementCsv('date,amount,currency,last4\n2026-11-07,1.00,USD,4242424242424242\n')).toThrow(
      /Never put full card numbers/,
    );
    expect(() => parseStatementCsv('date,amount,currency\n')).toThrow(/no lines/);
  });
});

describe('settlement matching (Route D reconciliation)', () => {
  const item = (o: Partial<RecordedItem> & { id: string }): RecordedItem => ({
    kind: 'payment',
    currency: 'USD',
    amountMinor: 10000,
    reference: null,
    cardLast4: null,
    day: '2026-11-07',
    alreadyVerified: false,
    ...o,
  });
  const line = (o: Partial<Parameters<typeof matchSettlement>[0]['lines'][number]> & { lineNo: number }) => ({
    day: '2026-11-07',
    currency: 'USD',
    amountMinor: 10000,
    reference: null,
    approvalCode: null,
    cardLast4: null,
    ...o,
  });
  const period = { from: '2026-11-07', to: '2026-11-07' };

  it('normalizes references', () => {
    expect(normalizeReference(' ab-12 3 ')).toBe('AB123');
    expect(normalizeReference('')).toBeNull();
  });

  it('matches by approval code and verifies the record', () => {
    const r = matchSettlement({
      items: [item({ id: 'p1', reference: 'APP123' })],
      lines: [line({ lineNo: 1, approvalCode: 'app-123' })],
      period,
    });
    expect(r.lines[0]).toMatchObject({ status: 'matched', basis: 'reference', itemId: 'p1' });
    expect(r.verifiedItemIds).toEqual(['p1']);
    expect(r.issues).toEqual([]);
  });

  it('flags an amount mismatch on the same reference (never silently corrects)', () => {
    const r = matchSettlement({
      items: [item({ id: 'p1', reference: 'R1', amountMinor: 10000 })],
      lines: [line({ lineNo: 1, reference: 'R1', amountMinor: 9000 })],
      period,
    });
    expect(r.lines[0]).toMatchObject({ status: 'amount_mismatch', itemId: 'p1', differenceMinor: 1000 });
    expect(r.verifiedItemIds).toEqual([]);
    expect(r.issues.map((i) => i.kind)).toEqual(['amount_mismatch']);
  });

  it('falls back to amount + date + last4 when there is no reference, only if unique', () => {
    const unique = matchSettlement({
      items: [item({ id: 'p1', cardLast4: '4242' }), item({ id: 'p2', amountMinor: 5000 })],
      lines: [line({ lineNo: 1, cardLast4: '4242' })],
      period,
    });
    expect(unique.lines[0]).toMatchObject({ status: 'matched', basis: 'amount_date', itemId: 'p1' });
    const ambiguous = matchSettlement({
      items: [item({ id: 'p1' }), item({ id: 'p2' })],
      lines: [line({ lineNo: 1 })],
      period,
    });
    expect(ambiguous.lines[0]?.status).toBe('ambiguous');
    expect(ambiguous.issues.map((i) => i.kind)).toContain('ambiguous_match');
  });

  it('reports statement lines missing in Portico and records missing in the statement', () => {
    const r = matchSettlement({
      items: [item({ id: 'p1', reference: 'R1' }), item({ id: 'p-old', reference: 'R0', day: '2026-11-01' })],
      lines: [line({ lineNo: 1, reference: 'R9', amountMinor: 777 })],
      period,
    });
    const kinds = r.issues.map((i) => `${i.kind}:${i.itemId ?? i.lineNo}`);
    expect(kinds).toContain('unrecorded_in_portico:1');
    expect(kinds).toContain('missing_in_statement:p1');
    expect(kinds).not.toContain('missing_in_statement:p-old'); // outside the statement period
  });

  it('detects duplicate statement lines and duplicate recordings', () => {
    const r = matchSettlement({
      items: [item({ id: 'p1', reference: 'R1' }), item({ id: 'p2', reference: 'R1' })],
      lines: [line({ lineNo: 1, reference: 'R1' }), line({ lineNo: 2, reference: 'R1' })],
      period,
    });
    const kinds = r.issues.map((i) => i.kind);
    expect(kinds).toContain('duplicate_recorded');
    expect(kinds).toContain('duplicate_in_statement');
    expect(r.verifiedItemIds).toHaveLength(1);
  });

  it('never matches a record twice across statements', () => {
    const r = matchSettlement({
      items: [item({ id: 'p1', reference: 'R1', alreadyVerified: true })],
      lines: [line({ lineNo: 1, reference: 'R1' })],
      period,
    });
    expect(r.lines[0]?.status).toBe('duplicate');
    expect(r.verifiedItemIds).toEqual([]);
  });

  it('matches refunds (negative lines) only against refunds', () => {
    const r = matchSettlement({
      items: [
        item({ id: 'p1', reference: 'R1' }),
        item({ id: 'rf1', kind: 'refund', reference: 'R1', amountMinor: -2000 }),
      ],
      lines: [line({ lineNo: 1, reference: 'R1', amountMinor: -2000 })],
      period,
    });
    expect(r.lines[0]).toMatchObject({ status: 'matched', itemId: 'rf1', itemKind: 'refund' });
  });
});
