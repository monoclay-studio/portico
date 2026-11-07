import { describe, expect, it } from 'vitest';
import {
  allowedManualConditions,
  assertManualConditionChange,
  assessReadiness,
  deriveDiscrepancy,
  meetsRequired,
  type ReadinessInput,
} from './conditions';

const NOW = new Date('2026-11-07T05:00:00Z');
const base: ReadinessInput = {
  now: NOW,
  date: '2026-11-07',
  condition: 'inspected',
  occupancy: 'vacant',
  block: null,
  pendingChange: null,
  lastFailure: null,
  requiredCondition: 'inspected',
  openTasks: [],
  minutesPerCredit: 10,
  inspectionMinutes: 10,
};

describe('manual condition changes', () => {
  it('allows the normal cleaning path and refuses shortcuts to inspected', () => {
    expect(() => assertManualConditionChange('dirty', 'cleaning')).not.toThrow();
    expect(() => assertManualConditionChange('cleaning', 'clean')).not.toThrow();
    expect(() => assertManualConditionChange('dirty', 'clean')).not.toThrow();
    expect(() => assertManualConditionChange('clean', 'inspected')).toThrow(
      /only by recording an inspection/,
    );
    expect(() => assertManualConditionChange('clean', 'failed_inspection')).toThrow(/inspection/);
  });

  it('explains invalid and no-op changes', () => {
    expect(() => assertManualConditionChange('clean', 'clean')).toThrow(/already clean/);
    expect(() => assertManualConditionChange('inspected', 'clean')).toThrow(
      /Allowed next conditions: dirty, cleaning/,
    );
    expect(allowedManualConditions('failed_inspection')).toEqual(['cleaning', 'clean', 'dirty']);
  });
});

describe('occupancy discrepancies (never auto-corrected)', () => {
  it.each([
    ['occupied', 'vacant', 'skip'],
    ['vacant', 'occupied', 'sleep'],
    ['vacant', 'occupied_no_luggage', 'sleep'],
    ['occupied', 'occupied_no_luggage', 'occupied_no_luggage'],
    ['occupied', 'occupied', 'none'],
    ['vacant', 'vacant', 'none'],
  ] as const)('system %s + observed %s → %s', (system, observed, expected) => {
    expect(deriveDiscrepancy(system, observed)).toBe(expected);
  });
  it('no observation → none', () => expect(deriveDiscrepancy('occupied', null)).toBe('none'));
});

describe('readiness', () => {
  it('inspected + vacant + unblocked is ready', () => {
    expect(assessReadiness(base)).toMatchObject({ ready: true, reasons: [], expectedReadyAt: null });
  });

  it('clean is enough when the property requires only clean', () => {
    expect(meetsRequired('clean', 'clean')).toBe(true);
    expect(meetsRequired('clean', 'inspected')).toBe(false);
    expect(assessReadiness({ ...base, condition: 'clean', requiredCondition: 'clean' }).ready).toBe(true);
  });

  it('failed inspection: not ready with the reasons and an ETA from the re-clean queue', () => {
    const r = assessReadiness({
      ...base,
      condition: 'failed_inspection',
      lastFailure: { reasons: ['Bathroom: hair in shower drain'], inspectedAt: NOW },
      openTasks: [
        {
          id: 't1',
          kind: 'reclean',
          status: 'open',
          credits: 2,
          startedAt: null,
          assigneeName: 'Aminath',
          queueAheadCredits: 3,
        },
      ],
    });
    expect(r.ready).toBe(false);
    expect(r.reasons[0]).toMatchObject({ code: 'failed_inspection' });
    expect(r.reasons[0]?.message).toContain('hair in shower drain');
    // 3 credits ahead (30) + re-clean 2 credits (20) + inspection (10) = 60 min
    expect(r.expectedReadyAt?.toISOString()).toBe('2026-11-07T06:00:00.000Z');
    expect(r.estimateBasis.join(' ')).toContain('Aminath');
  });

  it('cleaning in progress: estimate counts the remaining minutes only', () => {
    const r = assessReadiness({
      ...base,
      condition: 'cleaning',
      openTasks: [
        {
          id: 't',
          kind: 'departure_clean',
          status: 'in_progress',
          credits: 4,
          startedAt: new Date(NOW.getTime() - 25 * 60_000),
          assigneeName: 'Ali',
          queueAheadCredits: 0,
        },
      ],
    });
    // 40 min of work, 25 elapsed → 15 left + 10 inspection
    expect(r.expectedReadyAt?.toISOString()).toBe('2026-11-07T05:25:00.000Z');
  });

  it('overrun cleaning still estimates a minimum remaining time (never "already done")', () => {
    const r = assessReadiness({
      ...base,
      condition: 'cleaning',
      requiredCondition: 'clean',
      openTasks: [
        {
          id: 't',
          kind: 'departure_clean',
          status: 'in_progress',
          credits: 2,
          startedAt: new Date(NOW.getTime() - 90 * 60_000),
          assigneeName: null,
          queueAheadCredits: 0,
        },
      ],
    });
    expect(r.expectedReadyAt?.toISOString()).toBe('2026-11-07T05:05:00.000Z');
  });

  it('no task scheduled → honest "no estimate"', () => {
    const r = assessReadiness({ ...base, condition: 'dirty' });
    expect(r.expectedReadyAt).toBeNull();
    expect(r.estimateBasis[0]).toMatch(/no cleaning task/i);
  });

  it('blocks apply only to their nights (half-open)', () => {
    const block = { kind: 'out_of_order' as const, from: '2026-11-05', to: '2026-11-07', reason: 'AC' };
    expect(assessReadiness({ ...base, block }).ready).toBe(true);
    const r = assessReadiness({ ...base, block: { ...block, to: '2026-11-08' } });
    expect(r.ready).toBe(false);
    expect(r.reasons[0]?.code).toBe('out_of_order');
    expect(r.expectedReadyAt).toBeNull();
  });

  it('a "sleep" discrepancy (someone found in a vacant unit) makes it not ready', () => {
    const r = assessReadiness({ ...base, discrepancy: 'sleep' });
    expect(r.ready).toBe(false);
    expect(r.reasons.map((x) => x.code)).toEqual(['reported_occupied']);
  });

  it('house-use blocks are reported as such', () => {
    const r = assessReadiness({
      ...base,
      block: { kind: 'house_use', from: '2026-11-07', to: '2026-11-09', reason: 'Owner stay' },
    });
    expect(r.reasons[0]?.code).toBe('house_use');
  });

  it('occupied unit is not ready and has no estimate', () => {
    const r = assessReadiness({ ...base, occupancy: 'occupied' });
    expect(r.ready).toBe(false);
    expect(r.reasons.map((x) => x.code)).toEqual(['occupied']);
  });

  it('a pending forwarded change is shown but does not by itself make a ready unit not ready', () => {
    const r = assessReadiness({ ...base, pendingChange: { condition: 'dirty' } });
    expect(r.ready).toBe(true);
    expect(r.reasons[0]?.code).toBe('pending_external_confirmation');
  });

  it('clean but awaiting inspection: ETA is the inspection time', () => {
    const r = assessReadiness({ ...base, condition: 'clean' });
    expect(r.reasons[0]?.code).toBe('awaiting_inspection');
    expect(r.expectedReadyAt?.toISOString()).toBe('2026-11-07T05:10:00.000Z');
  });
});
