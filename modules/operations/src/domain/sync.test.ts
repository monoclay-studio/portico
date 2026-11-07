import { describe, expect, it } from 'vitest';
import { BatchChain, clampClientTime, explainTaskConflict, explainUnitConflict } from './sync';

describe('offline batch chaining', () => {
  it('a later change built on the same base chains onto the version the earlier change produced', () => {
    const chain = new BatchChain();
    expect(chain.resolve('task:1', 3)).toEqual({ kind: 'evaluate', base: 3 });
    chain.record('task:1', { clientMutationId: 'm1', clientBase: 3, outcome: 'applied', resultVersion: 4 });
    expect(chain.resolve('task:1', 3)).toEqual({ kind: 'evaluate', base: 4 });
    chain.record('task:1', { clientMutationId: 'm2', clientBase: 4, outcome: 'applied', resultVersion: 5 });
    expect(chain.resolve('task:1', 3)).toEqual({ kind: 'evaluate', base: 5 });
    // A side effect on the same record (e.g. the unit moved by a task change) chains the same way.
    chain.record('task:1', { clientMutationId: 'm3', clientBase: 5, outcome: 'applied', resultVersion: 6 });
    expect(chain.resolve('task:1', 3)).toEqual({ kind: 'evaluate', base: 6 });
  });

  it('a change built on a rejected change is skipped (it assumed a state that never happened)', () => {
    const chain = new BatchChain();
    chain.record('unit:1', {
      clientMutationId: 'm1',
      clientBase: 7,
      outcome: 'conflict',
      resultVersion: null,
    });
    expect(chain.resolve('unit:1', 7)).toEqual({ kind: 'skip', dependsOn: 'm1' });
    // A change re-based by the device on the current server version is evaluated normally.
    expect(chain.resolve('unit:1', 9)).toEqual({ kind: 'evaluate', base: 9 });
    // Other records are unaffected.
    expect(chain.resolve('unit:2', 7)).toEqual({ kind: 'evaluate', base: 7 });
  });

  it('a device that already knows the produced version evaluates against it', () => {
    const chain = new BatchChain();
    chain.record('task:1', { clientMutationId: 'm1', clientBase: 1, outcome: 'pending', resultVersion: 2 });
    expect(chain.resolve('task:1', 2)).toEqual({ kind: 'evaluate', base: 2 });
  });
});

describe('conflict explanations', () => {
  const change = (field: string, to: string) => ({
    field,
    from: null,
    to,
    by: 'Supervisor Ibrahim',
    at: '10:10',
    version: 5,
  });
  it('reassigned task', () => {
    const r = explainTaskConflict({
      actorUserId: 'me',
      current: { status: 'open', assigneeUserId: 'other', assigneeName: 'Hussain', doneBy: null },
      changes: [change('assignee', 'Hussain')],
    });
    expect(r.code).toBe('task_reassigned');
    expect(r.message).toContain('reassigned to Hussain by Supervisor Ibrahim');
  });
  it('cancelled and already completed tasks', () => {
    expect(
      explainTaskConflict({
        actorUserId: 'me',
        current: { status: 'cancelled', assigneeUserId: 'me', assigneeName: null, doneBy: null },
        changes: [],
      }).code,
    ).toBe('task_cancelled');
    expect(
      explainTaskConflict({
        actorUserId: 'me',
        current: { status: 'done', assigneeUserId: 'me', assigneeName: null, doneBy: 'Ali' },
        changes: [change('status', 'done')],
      }).message,
    ).toContain('already completed by Ali');
  });
  it('unit already inspected by a supervisor wins over an offline attendant update', () => {
    const r = explainUnitConflict({
      current: { condition: 'inspected', blockActive: false, lastInspectionResult: 'passed' },
      changes: [change('condition', 'inspected')],
    });
    expect(r.code).toBe('unit_already_inspected');
    expect(r.message).toContain('inspected and passed by Supervisor Ibrahim');
  });
  it('blocked unit, then generic stale version', () => {
    expect(
      explainUnitConflict({
        current: { condition: 'dirty', blockActive: true, lastInspectionResult: null },
        changes: [],
      }).code,
    ).toBe('unit_blocked');
    expect(
      explainUnitConflict({
        current: { condition: 'dirty', blockActive: false, lastInspectionResult: null },
        changes: [change('dnd', 'true')],
      }).code,
    ).toBe('stale_version');
  });
  it('clamps device clocks running in the future', () => {
    const now = new Date('2026-11-07T05:00:00Z');
    expect(clampClientTime(new Date('2026-11-07T05:04:00Z'), now, 5).toISOString()).toBe(
      '2026-11-07T05:04:00.000Z',
    );
    expect(clampClientTime(new Date('2026-11-07T07:00:00Z'), now, 5).toISOString()).toBe(now.toISOString());
  });
});
