import { describe, expect, it } from 'vitest';
import {
  allowedTaskTransitions,
  assertTaskTransition,
  conditionEffect,
  serviceRequestStatusFor,
  transitionPermissionNeeded,
} from './tasks';

describe('task lifecycle', () => {
  it('supports the normal path and one-tap completion', () => {
    expect(() => assertTaskTransition({ from: 'open', to: 'in_progress', kind: 'general' })).not.toThrow();
    expect(() => assertTaskTransition({ from: 'in_progress', to: 'done', kind: 'general' })).not.toThrow();
    expect(() => assertTaskTransition({ from: 'open', to: 'done', kind: 'departure_clean' })).not.toThrow();
    expect(() => assertTaskTransition({ from: 'done', to: 'verified', kind: 'general' })).not.toThrow();
  });

  it('terminal states are final and say so', () => {
    expect(allowedTaskTransitions('verified')).toEqual([]);
    expect(() => assertTaskTransition({ from: 'cancelled', to: 'open', kind: 'general' })).toThrow(
      /can no longer change/,
    );
  });

  it('blocking, cancelling and reopening need a reason', () => {
    expect(() => assertTaskTransition({ from: 'open', to: 'blocked', kind: 'general' })).toThrow(
      /why the task is blocked/,
    );
    expect(() =>
      assertTaskTransition({ from: 'open', to: 'cancelled', kind: 'general', reason: ' ' }),
    ).toThrow(/reason/);
    expect(() => assertTaskTransition({ from: 'done', to: 'in_progress', kind: 'general' })).toThrow(
      /reopened/,
    );
    expect(() =>
      assertTaskTransition({ from: 'done', to: 'in_progress', kind: 'general', reason: 'mirror smeared' }),
    ).not.toThrow();
  });

  it('blocked tasks must be unblocked before completion', () => {
    expect(() => assertTaskTransition({ from: 'blocked', to: 'done', kind: 'general', reason: 'x' })).toThrow(
      /cannot become done/,
    );
  });

  it('inspection tasks complete only through an inspection result', () => {
    expect(() => assertTaskTransition({ from: 'open', to: 'done', kind: 'inspection' })).toThrow(
      /recording the inspection/,
    );
  });

  it('service request status mirrors its task: fulfilled only when done', () => {
    expect(serviceRequestStatusFor('open')).toBe('open');
    expect(serviceRequestStatusFor('blocked')).toBe('open');
    expect(serviceRequestStatusFor('in_progress')).toBe('in_progress');
    expect(serviceRequestStatusFor('done')).toBe('fulfilled');
    expect(serviceRequestStatusFor('verified')).toBe('fulfilled');
    expect(serviceRequestStatusFor('cancelled')).toBe('cancelled');
  });

  it('cleaning tasks drive the unit condition without downgrading an inspection', () => {
    expect(conditionEffect('departure_clean', 'in_progress', 'dirty')).toBe('cleaning');
    expect(conditionEffect('departure_clean', 'done', 'cleaning')).toBe('clean');
    expect(conditionEffect('reclean', 'done', 'failed_inspection')).toBe('clean');
    expect(conditionEffect('departure_clean', 'done', 'inspected')).toBeNull();
    expect(conditionEffect('stayover', 'done', 'dirty')).toBe('clean');
    expect(conditionEffect('turndown', 'done', 'dirty')).toBeNull();
    expect(conditionEffect('service_request', 'done', 'dirty')).toBeNull();
  });

  it('assignees work their own tasks; verifying/cancelling and others’ tasks need manage', () => {
    expect(transitionPermissionNeeded('done', 'assignee')).toBe('operations.task.update');
    expect(transitionPermissionNeeded('in_progress', 'unassigned')).toBe('operations.task.update');
    expect(transitionPermissionNeeded('blocked', 'unassigned')).toBe('operations.task.manage');
    expect(transitionPermissionNeeded('done', 'other')).toBe('operations.task.manage');
    expect(transitionPermissionNeeded('verified', 'assignee')).toBe('operations.task.manage');
    expect(transitionPermissionNeeded('cancelled', 'assignee')).toBe('operations.task.manage');
  });
});
