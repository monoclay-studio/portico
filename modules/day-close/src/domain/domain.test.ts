import { BusinessRuleError, DomainError, ModuleUnavailableError } from '@portico/kernel';
import { describe, expect, it } from 'vitest';
import { STEP_KEYS } from '../contracts';
import { LeaseLostError, toFailure } from './errors';
import {
  classify,
  DEFAULT_BLOCKING_CODES,
  defaultPolicy,
  effectiveBlockingCodes,
  INTEGRITY_CODES,
  policyProblems,
  resolvePolicyValue,
} from './policy';
import { itemKey, summarize, transferDelayed } from './readiness';
import { earliestStart, nextRetryAt, RETRY_DELAY_MS, scheduledInstant } from './schedule';
import { computeKpis } from './statistics';
import { assertRunTransition, cancellable, canTransition, firstIncompleteStep, progressLine } from './steps';

const steps = (statuses: Record<string, string>) =>
  STEP_KEYS.map((key) => ({ key, status: (statuses[key] ?? 'pending') as 'pending' }));

describe('run state machine', () => {
  it('resumes at the first step that is neither completed nor skipped', () => {
    expect(firstIncompleteStep(steps({}))).toBe('preflight');
    expect(
      firstIncompleteStep(
        steps({ preflight: 'completed', no_shows: 'skipped', room_and_package_postings: 'failed' }),
      ),
    ).toBe('room_and_package_postings');
    expect(
      firstIncompleteStep(
        steps({ preflight: 'completed', no_shows: 'completed', room_and_package_postings: 'running' }),
      ),
    ).toBe('room_and_package_postings');
    expect(firstIncompleteStep(steps(Object.fromEntries(STEP_KEYS.map((k) => [k, 'completed']))))).toBeNull();
  });

  it('allows only the specified run transitions; completed and cancelled are final', () => {
    expect(canTransition('preflight', 'blocked')).toBe(true);
    expect(canTransition('blocked', 'preflight')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
    expect(canTransition('failed', 'running')).toBe(true);
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('cancelled', 'preflight')).toBe(false);
    expect(canTransition('running', 'cancelled')).toBe(false);
    expect(() => assertRunTransition('completed', 'failed')).toThrow(BusinessRuleError);
  });

  it('cancels only while nothing was posted', () => {
    expect(cancellable('blocked', steps({}), 0)).toEqual({ ok: true });
    expect(cancellable('preflight', steps({ preflight: 'completed' }), 0)).toEqual({ ok: true });
    expect(cancellable('failed', steps({ preflight: 'completed', no_shows: 'completed' }), 0).ok).toBe(false);
    expect(cancellable('blocked', steps({}), 1).ok).toBe(false);
    expect(cancellable('running', steps({}), 0).ok).toBe(false);
    expect(cancellable('completed', steps({}), 0).ok).toBe(false);
  });

  it('says what a step did in one line ("88 of 112 stay-nights posted, 24 remaining")', () => {
    expect(
      progressLine({
        key: 'room_and_package_postings',
        status: 'failed',
        total: 112,
        done: 88,
        failed: 0,
        skipped: 0,
      }),
    ).toBe('Room postings: 88 of 112 stay-nights posted, 24 remaining');
    expect(
      progressLine({ key: 'no_shows', status: 'completed', total: 3, done: 2, failed: 0, skipped: 1 }),
    ).toBe('No-shows: 2 of 3 arrivals done, 1 skipped');
    expect(
      progressLine({ key: 'integrity', status: 'failed', total: null, done: 0, failed: 0, skipped: 0 }),
    ).toBe('Books balance: failed');
    expect(
      progressLine({
        key: 'payments_housekeeping',
        status: 'skipped',
        total: null,
        done: 0,
        failed: 0,
        skipped: 0,
      }),
    ).toBe('Payments housekeeping: skipped');
  });
});

describe('policy', () => {
  it('fails closed: an unreadable policy applies the defaults and is reported, never "nothing blocks"', () => {
    const r = resolvePolicyValue({ blockingCodes: 'everything', surprise: true }, 'property');
    expect(r.valid).toBe(false);
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.policy).toEqual(defaultPolicy());
  });

  it('never lets an integrity code be demoted or overridden', () => {
    const p = { ...defaultPolicy(), warningCodes: ['entry_unbalanced'] };
    expect(policyProblems(p)).toHaveLength(1);
    for (const code of INTEGRITY_CODES) {
      expect(classify({ code, severity: 'warning' }, p, true)).toEqual({
        blocking: true,
        overridable: false,
      });
    }
    expect(resolvePolicyValue(p, 'property').valid).toBe(false);
  });

  it('decides blocking per code; an override clears a blocking item', () => {
    const p = defaultPolicy();
    expect(classify({ code: 'departure_not_checked_out', severity: 'warning' }, p, false)).toEqual({
      blocking: true,
      overridable: true,
    });
    expect(classify({ code: 'departure_not_checked_out', severity: 'warning' }, p, true)).toEqual({
      blocking: false,
      overridable: true,
    });
    expect(classify({ code: 'payment_pending_verification', severity: 'warning' }, p, false).blocking).toBe(
      false,
    );
    const strict = { ...p, blockingCodes: ['payment_pending_verification'] };
    expect(
      classify({ code: 'payment_pending_verification', severity: 'warning' }, strict, false).blocking,
    ).toBe(true);
    const lenient = { ...p, warningCodes: ['departure_not_checked_out'] };
    expect(
      classify({ code: 'departure_not_checked_out', severity: 'blocking' }, lenient, false).blocking,
    ).toBe(false);
  });

  it('makes arrivals block only when no-shows are decided by hand', () => {
    expect(effectiveBlockingCodes(defaultPolicy())).not.toContain('arrival_not_checked_in');
    const decide = { ...defaultPolicy(), noShow: { ...defaultPolicy().noShow, mode: 'decide' as const } };
    expect(effectiveBlockingCodes(decide)).toContain('arrival_not_checked_in');
    for (const c of DEFAULT_BLOCKING_CODES) expect(effectiveBlockingCodes(defaultPolicy())).toContain(c);
  });
});

describe('readiness rules', () => {
  const now = new Date('2026-11-07T18:00:00Z');
  it('treats an arrival as transfer-delayed when its estimate is later than scheduled or still ahead', () => {
    expect(
      transferDelayed(
        { scheduledAt: '2026-11-07T10:00:00Z', estimatedAt: '2026-11-07T13:30:00Z' },
        null,
        now,
      ),
    ).toBe(true);
    expect(transferDelayed({ scheduledAt: null, estimatedAt: '2026-11-07T18:30:00Z' }, null, now)).toBe(true);
    expect(
      transferDelayed(
        { scheduledAt: '2026-11-07T10:00:00Z', estimatedAt: '2026-11-07T10:00:00Z' },
        null,
        now,
      ),
    ).toBe(false);
    expect(transferDelayed({ scheduledAt: null, estimatedAt: null }, '2026-11-07T19:00:00Z', now)).toBe(true);
    expect(transferDelayed({ scheduledAt: null, estimatedAt: null }, '14:00', now)).toBe(false);
    expect(transferDelayed({ scheduledAt: null, estimatedAt: 'not a date' }, null, now)).toBe(false);
  });

  it('keys items stably by source, code and record', () => {
    expect(itemKey('reservations', 'departure_not_checked_out', { type: 'stay', id: 'x' })).toBe(
      'reservations:departure_not_checked_out:stay:x',
    );
    expect(itemKey('finance', 'suspense_balance', null)).toBe('finance:suspense_balance:-');
  });

  it('summarizes for the auditor in one sentence', () => {
    expect(summarize({ blocking: 0, warning: 0, info: 0 }, 0)).toBe('Ready to close: nothing open.');
    expect(summarize({ blocking: 0, warning: 3, info: 1 }, 0)).toBe('Ready to close: 3 warnings.');
    expect(summarize({ blocking: 2, warning: 1, info: 0 }, 1)).toBe(
      '2 things to settle before today can close, 1 warning. 1 check could not run (shown below).',
    );
  });
});

describe('statistics', () => {
  it('computes occupancy, ADR and RevPAR exactly, excluding complimentary and house use', () => {
    const k = computeKpis(
      { capacity: 120, outOfOrder: 4, sold: 87, complimentary: 2, houseUse: 1 },
      8_700_050,
    );
    expect(k.available).toBe(115);
    expect(k.occupancyPercent).toBe('75.65');
    expect(k.adrMinor).toBe(100_001); // 8,700,050 / 87 = 100,000.57 → 100,001 (half up, once)
    expect(k.revparMinor).toBe(75_653); // 8,700,050 / 115 = 75,652.6 → 75,653
  });

  it('handles empty and fully closed hotels without dividing by zero', () => {
    expect(computeKpis({ capacity: 0, outOfOrder: 0, sold: 0, complimentary: 0, houseUse: 0 }, 0)).toEqual({
      available: 0,
      occupancyPercent: '0.00',
      adrMinor: 0,
      revparMinor: 0,
    });
    expect(
      computeKpis({ capacity: 10, outOfOrder: 12, sold: 0, complimentary: 0, houseUse: 0 }, 0).available,
    ).toBe(0);
    expect(
      computeKpis({ capacity: 10, outOfOrder: 0, sold: 10, complimentary: 0, houseUse: 0 }, 1)
        .occupancyPercent,
    ).toBe('100.00');
  });
});

describe('schedule', () => {
  it('puts morning times after midnight and evening times on the business date', () => {
    expect(scheduledInstant('2026-11-07', '02:00', 'Indian/Maldives').toISOString()).toBe(
      '2026-11-07T21:00:00.000Z',
    );
    expect(scheduledInstant('2026-11-07', '23:30', 'Indian/Maldives').toISOString()).toBe(
      '2026-11-07T18:30:00.000Z',
    );
    expect(earliestStart('2026-11-07', null, 'Indian/Maldives')).toBeNull();
  });

  it('starts at the next valid local minute on a spring-forward night (EC-DCL-024)', () => {
    // Europe/London jumps 01:00 → 02:00 on 2027-03-28; 01:30 does not exist that night.
    const t = scheduledInstant('2027-03-27', '01:30', 'Europe/London');
    expect(t.toISOString()).toBe('2027-03-28T01:00:00.000Z'); // 02:00 BST
    // The business date logic is unaffected: the same rule on a normal night.
    expect(scheduledInstant('2027-03-20', '01:30', 'Europe/London').toISOString()).toBe(
      '2027-03-21T01:30:00.000Z',
    );
  });

  it('retries transient failures three times five minutes apart and never integrity failures', () => {
    const now = new Date('2026-11-07T21:00:00Z');
    expect(nextRetryAt(now, 0, { retryable: true })?.getTime()).toBe(now.getTime() + RETRY_DELAY_MS);
    expect(nextRetryAt(now, 2, { retryable: true })).not.toBeNull();
    expect(nextRetryAt(now, 3, { retryable: true })).toBeNull();
    expect(nextRetryAt(now, 0, { retryable: false })).toBeNull();
    expect(nextRetryAt(now, 0, { retryable: true, integrity: true })).toBeNull();
  });
});

describe('failure records', () => {
  it('keeps stable codes, treats unavailable modules and unknown errors as retryable', () => {
    expect(toFailure(new ModuleUnavailableError('finance', 'postCharge'))).toMatchObject({
      code: 'module_not_available',
      retryable: true,
    });
    expect(toFailure(new BusinessRuleError('terms_seal_invalid', 'x'))).toMatchObject({
      code: 'terms_seal_invalid',
      retryable: false,
    });
    expect(toFailure(new Error('boom'))).toMatchObject({ code: 'unexpected_error', retryable: true });
    expect(toFailure(Object.assign(new Error('gone'), { code: '57P01' }))).toMatchObject({
      code: 'database_unavailable',
      retryable: true,
    });
    expect(toFailure(Object.assign(new Error('rule'), { code: 'P0001' }))).toMatchObject({
      code: 'invariant_violation',
      retryable: false,
    });
    expect(new LeaseLostError('r')).toBeInstanceOf(DomainError);
  });
});
