import { describe, expect, it } from 'vitest';
import { blockingSteps, canConfirm, initialSteps, nextStep, recordStep, summarize } from './workflow';

const at = '2026-12-10T10:00:00.000Z';

describe('resumable workflows (RES-R24..R27)', () => {
  it('creates check-in steps with confirm always mandatory', () => {
    const steps = initialSteps('check_in', ['deposits', 'confirm']);
    expect(steps.map((s) => s.key)).toEqual([
      'registration',
      'unit',
      'guarantee',
      'deposits',
      'access',
      'confirm',
    ]);
    expect(steps.find((s) => s.key === 'deposits')?.mandatory).toBe(false);
    expect(steps.find((s) => s.key === 'confirm')?.mandatory).toBe(true);
    expect(steps.filter((s) => s.external).map((s) => s.key)).toEqual(['guarantee', 'access']);
  });

  it('records outcomes and never repeats a done step', () => {
    let steps = initialSteps('check_in');
    steps = recordStep(steps, 'registration', { status: 'done', at });
    expect(() => recordStep(steps, 'registration', { status: 'done', at })).toThrow(/already done/);
    steps = recordStep(steps, 'guarantee', { status: 'pending', idempotencyKey: 'k1', at });
    steps = recordStep(steps, 'guarantee', { status: 'pending', at });
    expect(steps.find((s) => s.key === 'guarantee')).toMatchObject({ attempts: 2, idempotencyKey: 'k1' });
    steps = recordStep(steps, 'unit', { status: 'failed', message: 'dirty', at });
    steps = recordStep(steps, 'unit', { status: 'done', at });
    expect(steps.find((s) => s.key === 'unit')?.status).toBe('done');
  });

  it('says exactly what succeeded and what remains', () => {
    let steps = initialSteps('check_in');
    steps = recordStep(steps, 'registration', { status: 'done', at });
    steps = recordStep(steps, 'unit', { status: 'done', at });
    steps = recordStep(steps, 'guarantee', { status: 'pending', idempotencyKey: 'k', at });
    expect(summarize(steps)).toEqual({
      succeeded: ['registration', 'unit'],
      remaining: ['guarantee', 'deposits', 'access', 'confirm'],
      failed: [],
      pendingExternal: ['guarantee'],
    });
    expect(nextStep(steps)?.key).toBe('guarantee');
    expect(canConfirm(steps)).toBe(false);
    expect(blockingSteps(steps).map((s) => s.key)).toEqual(['guarantee', 'deposits', 'access']);
  });

  it('allows confirmation once every other step is done or skipped', () => {
    let steps = initialSteps('check_out');
    for (const k of ['charges', 'settle'] as const) steps = recordStep(steps, k, { status: 'done', at });
    steps = recordStep(steps, 'access', {
      status: 'skipped',
      skipped: { by: 'GM', reason: 'no key system' },
      at,
    });
    expect(canConfirm(steps)).toBe(true);
  });
});
