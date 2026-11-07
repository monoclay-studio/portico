import { describe, expect, it } from 'vitest';
import { defaultDueAt, evaluateEscalation, nextEscalationAt, slaState } from './escalation';
import { DEFAULT_SETTINGS, escalationPathFor, mergeSettings } from './settings';

const due = new Date('2026-11-07T05:00:00Z');
const path = [
  { afterMinutes: 0, target: 'supervisor' as const },
  { afterMinutes: 30, target: 'department_head' as const },
];
const at = (min: number) => new Date(due.getTime() + min * 60_000);

describe('escalation timing', () => {
  it('nothing fires before the due time; the first step fires exactly at it', () => {
    expect(evaluateEscalation({ now: at(-1), dueAt: due, path, currentLevel: 0 })).toBeNull();
    const d = evaluateEscalation({ now: at(0), dueAt: due, path, currentLevel: 0 });
    expect(d).toMatchObject({ level: 1, fired: [{ level: 1, target: 'supervisor' }], minutesOverdue: 0 });
    expect(d?.next?.toISOString()).toBe(at(30).toISOString());
  });

  it('each step fires once', () => {
    expect(evaluateEscalation({ now: at(29), dueAt: due, path, currentLevel: 1 })).toBeNull();
    const d = evaluateEscalation({ now: at(30), dueAt: due, path, currentLevel: 1 });
    expect(d).toMatchObject({ level: 2, fired: [{ target: 'department_head' }], next: null });
    expect(evaluateEscalation({ now: at(500), dueAt: due, path, currentLevel: 2 })).toBeNull();
  });

  it('after scheduler downtime all overdue steps fire together, in order', () => {
    const d = evaluateEscalation({ now: at(45), dueAt: due, path, currentLevel: 0 });
    expect(d?.fired.map((f) => f.target)).toEqual(['supervisor', 'department_head']);
    expect(d?.minutesOverdue).toBe(45);
  });

  it('tasks without a due time never escalate', () => {
    expect(evaluateEscalation({ now: at(999), dueAt: null, path, currentLevel: 0 })).toBeNull();
    expect(nextEscalationAt(null, path, 0)).toBeNull();
  });

  it('default due time comes from the priority', () => {
    const created = new Date('2026-11-07T04:00:00Z');
    expect(defaultDueAt(created, 'urgent', DEFAULT_SETTINGS.resolutionMinutes).toISOString()).toBe(
      '2026-11-07T04:15:00.000Z',
    );
    expect(defaultDueAt(created, 'normal', DEFAULT_SETTINGS.resolutionMinutes).toISOString()).toBe(
      '2026-11-07T05:00:00.000Z',
    );
  });

  it('SLA state for display', () => {
    expect(slaState(at(-60), due)).toEqual({ state: 'on_track', minutes: 60 });
    expect(slaState(at(-10), due)).toEqual({ state: 'due_soon', minutes: 10 });
    expect(slaState(at(5), due)).toEqual({ state: 'overdue', minutes: 5 });
    expect(slaState(at(5), null)).toEqual({ state: 'none', minutes: 0 });
  });

  it('per-department paths are configurable and sorted', () => {
    const s = mergeSettings({
      escalation: {
        engineering: [
          { afterMinutes: 60, target: 'general_manager' },
          { afterMinutes: 0, target: 'department_head' },
        ],
      },
    });
    expect(escalationPathFor(s, 'engineering').map((p) => p.target)).toEqual([
      'department_head',
      'general_manager',
    ]);
    expect(escalationPathFor(s, 'housekeeping')).toEqual(DEFAULT_SETTINGS.escalation.default);
  });
});

describe('settings merge', () => {
  it('deep-merges objects, replaces arrays, ignores null', () => {
    const s = mergeSettings({
      returnToService: { requireInspection: false },
      autoDueKinds: ['general'],
      credits: null,
    });
    expect(s.returnToService).toEqual({
      requireWorkOrderCompletion: true,
      requireInspection: false,
      requireCleaning: true,
    });
    expect(s.autoDueKinds).toEqual(['general']);
    expect(s.credits).toEqual(DEFAULT_SETTINGS.credits);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});
