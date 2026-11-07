import { describe, expect, it } from 'vitest';
import { composeReadiness, conditionMeets, paymentSecured, type ReadinessInput } from './readiness';

const ready: ReadinessInput = {
  assignedUnitId: 'u1',
  unitName: 'Villa 214',
  unitCondition: 'inspected',
  requiredCondition: 'inspected',
  guaranteeKind: 'card',
  guaranteeRequired: true,
  paymentStatus: 'authorized',
  registrationComplete: true,
  openRequests: 0,
};

describe('arrival readiness (brief §6, vision 07:30)', () => {
  it('is ready only when every distinct fact is ok', () => {
    expect(composeReadiness(ready)).toMatchObject({ ready: true, blockingReason: null });
  });

  it('surfaces exactly one blocking reason, in the order the desk clears them', () => {
    const r = composeReadiness({ ...ready, assignedUnitId: null, paymentStatus: 'none', openRequests: 2 });
    expect(r.ready).toBe(false);
    expect(r.blockingReason).toEqual({ key: 'unit_assigned', message: 'No unit assigned yet.' });
    expect(
      composeReadiness({ ...ready, unitCondition: 'failed_inspection' }).blockingReason?.message,
    ).toMatch(/Villa 214 failed inspection/);
    expect(composeReadiness({ ...ready, unitCondition: 'clean' }).blockingReason?.message).toMatch(
      /needs to be inspected/,
    );
    expect(
      composeReadiness({ ...ready, paymentStatus: 'pending_verification' }).blockingReason?.message,
    ).toMatch(/pending verification — do not take payment again/);
    expect(composeReadiness({ ...ready, openRequests: 1 }).blockingReason).toEqual({
      key: 'requests',
      message: '1 request not yet prepared.',
    });
  });

  it('treats unknown facts as not ready, never as fine', () => {
    expect(composeReadiness({ ...ready, unitCondition: 'unknown' }).blockingReason?.key).toBe('unit_ready');
    expect(composeReadiness({ ...ready, paymentStatus: 'unknown' }).ready).toBe(false);
  });

  it('an authorization secures a stay but is labelled as not charged', () => {
    expect(
      paymentSecured({ guaranteeKind: 'card', guaranteeRequired: true, paymentStatus: 'authorized' }).message,
    ).toMatch(/not yet charged/);
    expect(
      paymentSecured({ guaranteeKind: 'company', guaranteeRequired: true, paymentStatus: 'none' }).status,
    ).toBe('ok');
    expect(
      paymentSecured({ guaranteeKind: 'none', guaranteeRequired: false, paymentStatus: 'none' }).status,
    ).toBe('ok');
  });

  it('ranks unit conditions', () => {
    expect(conditionMeets('inspected', 'clean')).toBe(true);
    expect(conditionMeets('clean', 'inspected')).toBe(false);
    expect(conditionMeets('failed_inspection', 'dirty')).toBe(false);
  });
});
