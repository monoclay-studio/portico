import { describe, expect, it } from 'vitest';
import { checkReturnToService, evaluateInspection } from './inspection';

const template = [
  { code: 'bath', label: 'Bathroom', critical: true },
  { code: 'deck', label: 'Deck & ladder', critical: true },
  { code: 'minibar', label: 'Minibar restocked', critical: false },
];

describe('inspection evaluation', () => {
  it('passes when every item passes', () => {
    const r = evaluateInspection({
      template,
      items: template.map((t) => ({ code: t.code, result: 'pass' as const })),
      maxMinorFailures: 0,
    });
    expect(r).toMatchObject({ result: 'passed', failures: [] });
  });

  it('a critical failure fails with a readable reason', () => {
    const r = evaluateInspection({
      template,
      items: [
        { code: 'bath', result: 'fail', note: 'hair in shower drain', photoRefs: ['obj://insp/1.jpg'] },
        { code: 'deck', result: 'pass' },
        { code: 'minibar', result: 'na' },
      ],
      maxMinorFailures: 2,
    });
    expect(r.result).toBe('failed');
    expect(r.reasons).toEqual(['Bathroom: hair in shower drain']);
    expect(r.failures[0]?.photoRefs).toEqual(['obj://insp/1.jpg']);
  });

  it('minor failures are tolerated up to the configured limit', () => {
    const items = [
      { code: 'bath', result: 'pass' as const },
      { code: 'deck', result: 'pass' as const },
      { code: 'minibar', result: 'fail' as const },
    ];
    expect(evaluateInspection({ template, items, maxMinorFailures: 1 }).result).toBe('passed');
    expect(evaluateInspection({ template, items, maxMinorFailures: 0 }).result).toBe('failed');
  });

  it('never passes an incomplete checklist and rejects unknown or duplicate items', () => {
    expect(() =>
      evaluateInspection({ template, items: [{ code: 'bath', result: 'pass' }], maxMinorFailures: 0 }),
    ).toThrow(/Missing: Deck & ladder, Minibar restocked/);
    expect(() =>
      evaluateInspection({ template, items: [{ code: 'pool', result: 'pass' }], maxMinorFailures: 0 }),
    ).toThrow(/not on the checklist: pool/);
    expect(() =>
      evaluateInspection({
        template: null,
        items: [
          { code: 'x', result: 'pass' },
          { code: 'x', result: 'fail' },
        ],
        maxMinorFailures: 0,
      }),
    ).toThrow(/answered twice/);
  });

  it('without a checklist, free-text reasons fail the inspection and no reasons pass it', () => {
    expect(evaluateInspection({ template: null, items: [], maxMinorFailures: 0 }).result).toBe('passed');
    const r = evaluateInspection({
      template: null,
      items: [],
      adHocFailureReasons: ['Sand on bed'],
      maxMinorFailures: 0,
    });
    expect(r).toMatchObject({ result: 'failed', reasons: ['Sand on bed'] });
  });
});

describe('return to service policy', () => {
  const completed = new Date('2026-11-07T08:00:00Z');
  const policy = { requireInspection: true };
  it('requires completion and a passed inspection after completion', () => {
    expect(
      checkReturnToService({
        policy,
        workOrderCompletedAt: null,
        lastPassedInspectionAt: null,
        blockActive: true,
      }).missing.map((m) => m.code),
    ).toEqual(['work_order_not_completed', 'inspection_not_passed']);
    // An inspection BEFORE the repair does not count.
    expect(
      checkReturnToService({
        policy,
        workOrderCompletedAt: completed,
        lastPassedInspectionAt: new Date('2026-11-07T07:00:00Z'),
        blockActive: true,
      }).allowed,
    ).toBe(false);
    expect(
      checkReturnToService({
        policy,
        workOrderCompletedAt: completed,
        lastPassedInspectionAt: new Date('2026-11-07T09:00:00Z'),
        blockActive: true,
      }).allowed,
    ).toBe(true);
  });
  it('completion is always required, even when the policy drops the inspection', () => {
    expect(
      checkReturnToService({
        policy: { requireInspection: false },
        workOrderCompletedAt: null,
        lastPassedInspectionAt: null,
        blockActive: true,
      }).missing.map((m) => m.code),
    ).toEqual(['work_order_not_completed']);
  });
  it('honours a property policy without inspection, and refuses when nothing is blocked', () => {
    const relaxed = { requireInspection: false };
    expect(
      checkReturnToService({
        policy: relaxed,
        workOrderCompletedAt: completed,
        lastPassedInspectionAt: null,
        blockActive: true,
      }).allowed,
    ).toBe(true);
    expect(
      checkReturnToService({
        policy: relaxed,
        workOrderCompletedAt: completed,
        lastPassedInspectionAt: null,
        blockActive: false,
      }).missing[0]?.code,
    ).toBe('no_active_block');
  });
});
