import { describe, expect, it } from 'vitest';
import {
  canTransition,
  completedStep,
  isOperational,
  JourneyTransitionError,
  nextState,
  progress,
  SETUP_STEPS,
  stateAfterMappingChange,
  stepOfAction,
} from './setup-journey';

describe('setup journey state machine', () => {
  it('walks the nine steps in order', () => {
    let s = nextState('reviewCompatibility', 'selected');
    expect(s).toBe('compatibility_reviewed');
    s = nextState('authorize', s);
    s = nextState('suggestMappings', s);
    s = nextState('resolveIssues', s);
    s = nextState('validate', s);
    s = nextState('preview', s);
    s = nextState('activate', s);
    expect(s).toBe('active');
    s = nextState('confirmMonitoring', s);
    expect(s).toBe('monitoring');
    expect(SETUP_STEPS).toHaveLength(9);
    expect(completedStep('monitoring')).toBe(9);
  });

  it('refuses skipping steps (no activation without a preview)', () => {
    expect(() => nextState('activate', 'validated')).toThrow(JourneyTransitionError);
    expect(() => nextState('validate', 'authorized')).toThrow(JourneyTransitionError);
    expect(canTransition('authorize', 'selected')).toBe(false);
  });

  it('allows repeating a setup step from a later setup state', () => {
    expect(nextState('suggestMappings', 'previewed')).toBe('mappings_suggested');
    expect(nextState('authorize', 'validated')).toBe('authorized');
  });

  it('pauses and resumes to the remembered operational state', () => {
    expect(nextState('pause', 'monitoring')).toBe('paused');
    expect(nextState('resume', 'paused', { resumeState: 'monitoring' })).toBe('monitoring');
    expect(nextState('resume', 'paused', {})).toBe('active');
    expect(() => nextState('resume', 'active')).toThrow();
  });

  it('suspends on a credential problem (error) and recovers', () => {
    expect(nextState('fail', 'active')).toBe('error');
    expect(nextState('recover', 'error', { resumeState: 'monitoring' })).toBe('monitoring');
  });

  it('disconnect is terminal', () => {
    expect(nextState('disconnect', 'paused')).toBe('disconnected');
    expect(canTransition('resume', 'disconnected')).toBe(false);
    expect(canTransition('disconnect', 'disconnected')).toBe(false);
  });

  it('reopen only goes backwards', () => {
    expect(nextState('reopen', 'previewed', { reopenTo: 'mappings_suggested' })).toBe('mappings_suggested');
    expect(() => nextState('reopen', 'mappings_suggested', { reopenTo: 'validated' })).toThrow();
  });

  it('a mapping change invalidates validation and preview', () => {
    expect(stateAfterMappingChange('previewed')).toBe('mappings_suggested');
    expect(stateAfterMappingChange('validated')).toBe('mappings_suggested');
    expect(stateAfterMappingChange('issues_resolved')).toBe('mappings_suggested');
    expect(stateAfterMappingChange('authorized')).toBe('authorized');
    expect(stateAfterMappingChange('active')).toBe('active');
  });

  it('maps actions to steps (0 = lifecycle)', () => {
    expect(stepOfAction('authorize')).toBe(3);
    expect(stepOfAction('activate')).toBe(8);
    expect(stepOfAction('confirmMonitoring')).toBe(9);
    expect(stepOfAction('pause')).toBe(0);
    expect(isOperational('monitoring')).toBe(true);
    expect(isOperational('paused')).toBe(false);
  });

  it('progress preserves who completed each step and when', () => {
    const p = progress('mappings_suggested', null, [
      { step: 1, outcome: 'completed', occurredAt: '2026-11-07T08:00:00.000Z', actorLabel: 'Aisha' },
      { step: 2, outcome: 'completed', occurredAt: '2026-11-07T08:05:00.000Z', actorLabel: 'Aisha' },
      { step: 3, outcome: 'failed', occurredAt: '2026-11-07T08:06:00.000Z', actorLabel: 'Aisha' },
      { step: 3, outcome: 'completed', occurredAt: '2026-11-07T08:09:00.000Z', actorLabel: 'Ibrahim' },
      { step: 4, outcome: 'completed', occurredAt: '2026-11-07T08:15:00.000Z', actorLabel: 'Ibrahim' },
    ]);
    expect(p.currentStep).toBe(5);
    expect(p.steps[2]).toMatchObject({
      status: 'done',
      completedBy: 'Ibrahim',
      completedAt: '2026-11-07T08:09:00.000Z',
    });
    expect(p.steps[4]?.status).toBe('current');
    expect(p.steps[8]?.status).toBe('todo');
  });

  it('a paused connection shows the journey as completed up to its operational state', () => {
    const p = progress('paused', 'monitoring', []);
    expect(p.steps.every((s) => s.status === 'done')).toBe(true);
  });
});
