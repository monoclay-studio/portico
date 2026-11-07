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
  const created = at(-60);
  const clock = { dueAt: due, createdAt: created, started: true };
  it('nothing fires before the due time; the first step fires exactly at it', () => {
    expect(evaluateEscalation({ now: at(-1), ...clock, path, currentLevel: 0 })).toBeNull();
    const d = evaluateEscalation({ now: at(0), ...clock, path, currentLevel: 0 });
    expect(d).toMatchObject({
      level: 1,
      fired: [{ level: 1, target: 'supervisor', reason: 'overdue' }],
      minutesOverdue: 0,
    });
    expect(d?.next?.toISOString()).toBe(at(30).toISOString());
  });

  it('each step fires once', () => {
    expect(evaluateEscalation({ now: at(29), ...clock, path, currentLevel: 1 })).toBeNull();
    const d = evaluateEscalation({ now: at(30), ...clock, path, currentLevel: 1 });
    expect(d).toMatchObject({ level: 2, fired: [{ target: 'department_head' }], next: null });
    expect(evaluateEscalation({ now: at(500), ...clock, path, currentLevel: 2 })).toBeNull();
  });

  it('after scheduler downtime all overdue steps fire together, in order', () => {
    const d = evaluateEscalation({ now: at(45), ...clock, path, currentLevel: 0 });
    expect(d?.fired.map((f) => f.target)).toEqual(['supervisor', 'department_head']);
    expect(d?.minutesOverdue).toBe(45);
  });

  it('tasks without a due time never escalate for being overdue', () => {
    expect(evaluateEscalation({ now: at(999), ...clock, dueAt: null, path, currentLevel: 0 })).toBeNull();
    expect(nextEscalationAt({ ...clock, dueAt: null }, path, 0)).toBeNull();
  });

  it('acknowledgement steps fire only while the task has not been started', () => {
    const ackPath = [{ from: 'created' as const, afterMinutes: 15, target: 'supervisor' as const }, ...path];
    const notStarted = { dueAt: due, createdAt: created, started: false };
    expect(nextEscalationAt(notStarted, ackPath, 0)?.toISOString()).toBe(at(-45).toISOString());
    const ack = evaluateEscalation({ now: at(-45), ...notStarted, path: ackPath, currentLevel: 0 });
    expect(ack?.fired).toEqual([
      { level: 1, target: 'supervisor', firesAt: at(-45), reason: 'not_acknowledged' },
    ]);
    // Started in time: the acknowledgement step is passed over silently; the overdue clock still runs.
    expect(nextEscalationAt({ ...notStarted, started: true }, ackPath, 0)?.toISOString()).toBe(
      due.toISOString(),
    );
    const skipped = evaluateEscalation({
      now: at(-45),
      ...notStarted,
      started: true,
      path: ackPath,
      currentLevel: 0,
    });
    expect(skipped).toMatchObject({ level: 1, fired: [] });
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
    expect(escalationPathFor(s, 'housekeeping').map((p) => p.from ?? 'due')).toEqual([
      'created',
      'due',
      'due',
    ]);
  });
});

describe('settings merge', () => {
  it('deep-merges objects, replaces arrays, ignores null', () => {
    const s = mergeSettings({
      returnToService: { requireInspection: false },
      autoDueKinds: ['general'],
      credits: null,
    });
    expect(s.returnToService).toEqual({ requireInspection: false, requireCleaning: true });
    expect(s.autoDueKinds).toEqual(['general']);
    expect(s.credits).toEqual(DEFAULT_SETTINGS.credits);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});
