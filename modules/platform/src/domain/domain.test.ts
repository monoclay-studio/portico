import { describe, expect, it } from 'vitest';
import {
  type ActivationScopeContent,
  canTransition,
  checklistBlocks,
  decideEffect,
  decideWorkflow,
  requiresApproval,
  validateScope,
} from './activation';
import { approvalRequired, isCarryForwardAllowed, planSection, planSummary, sameJson } from './configuration';
import { authorityCombinationProblem, canMoveTransition, needsSecondApprover } from './data-authority';
import { isOpenAt, validateOpeningHours } from './opening-hours';
import { looksLikeBankData, maxConcurrentShare, sharesOn, validateSharePeriod } from './ownership';

const pilotScope: ActivationScopeContent = {
  effects: [
    { effect: 'integration.read' },
    { effect: 'integration.write', connectionIds: ['c1'], workflows: ['roomStatus.forward'] },
    { effect: 'message.guest', workflows: ['comms.preArrival'] },
  ],
  workflows: ['operations.housekeepingBoard', 'comms.*'],
  modules: ['operations', 'comms'],
  startsOn: '2026-11-10',
  endsOn: '2026-12-08',
  successCriteria: 'room status p95 ≤ 30 s',
  rollbackPlan: 'disable workflows',
};

describe('activation status machine', () => {
  it('allows the documented transitions only', () => {
    expect(canTransition('setup', 'pilot')).toBe(true);
    expect(canTransition('setup', 'active')).toBe(true);
    expect(canTransition('pilot', 'setup')).toBe(true);
    expect(canTransition('pilot', 'active')).toBe(true);
    expect(canTransition('active', 'setup')).toBe(false);
    expect(canTransition('inactive', 'active')).toBe(false);
    expect(requiresApproval('pilot')).toBe(true);
    expect(requiresApproval('setup')).toBe(false);
  });

  it('validates pilot scope documents', () => {
    expect(validateScope('pilot', pilotScope)).toEqual([]);
    expect(
      validateScope('pilot', { ...pilotScope, allEffects: true, workflows: ['*'], endsOn: '2026-11-01' }),
    ).toEqual([
      'A pilot scope must list its effects explicitly; "all effects" is for production.',
      'The pilot ends before it starts.',
      'A pilot must name the workflows that go live, not "all".',
    ]);
    expect(
      validateScope('production', { allEffects: true, effects: [], workflows: ['*'], modules: [] }),
    ).toEqual([]);
    expect(
      validateScope('production', {
        effects: [{ effect: 'message.guest' }, { effect: 'message.guest' }],
        workflows: [],
        modules: [],
      }),
    ).toHaveLength(1);
  });

  it('blocks only on failed blockers', () => {
    expect(checklistBlocks([{ key: 'a', label: 'A', level: 'warning', passed: false }])).toBe(false);
    expect(checklistBlocks([{ key: 'a', label: 'A', level: 'blocker', passed: false }])).toBe(true);
  });
});

describe('activation scope effect decisions (G-04)', () => {
  const base = { mode: 'live' as const, today: '2026-11-15', scope: pilotScope };

  it('never restricts effects the environment already simulates or sandboxes', () => {
    expect(decideEffect({ ...base, status: 'setup', mode: 'simulate', effect: 'payment.charge' })).toEqual({
      allowed: true,
      reason: 'not_live_mode',
    });
  });

  it('setup permits live reads only; inactive likewise', () => {
    expect(decideEffect({ ...base, status: 'setup', effect: 'integration.read' }).allowed).toBe(true);
    expect(decideEffect({ ...base, status: 'setup', effect: 'message.guest' })).toEqual({
      allowed: false,
      reason: 'setup_allows_reads_only',
    });
    expect(decideEffect({ ...base, status: 'inactive', effect: 'payment.charge' }).allowed).toBe(false);
  });

  it('pilot permits exactly the scoped effects, connections, workflows and window', () => {
    const p = { ...base, status: 'pilot' as const };
    expect(decideEffect({ ...p, effect: 'integration.read', connectionId: 'any' }).allowed).toBe(true);
    expect(decideEffect({ ...p, effect: 'payment.charge' })).toEqual({
      allowed: false,
      reason: 'effect_not_in_scope',
    });
    expect(
      decideEffect({ ...p, effect: 'integration.write', connectionId: 'c2', workflow: 'roomStatus.forward' }),
    ).toEqual({
      allowed: false,
      reason: 'connection_not_in_scope',
    });
    expect(
      decideEffect({ ...p, effect: 'integration.write', connectionId: 'c1', workflow: 'rates.push' }),
    ).toEqual({
      allowed: false,
      reason: 'workflow_not_in_scope',
    });
    expect(
      decideEffect({ ...p, effect: 'integration.write', connectionId: 'c1', workflow: 'roomStatus.forward' })
        .allowed,
    ).toBe(true);
    expect(decideEffect({ ...p, effect: 'integration.read', today: '2026-11-09' }).reason).toBe(
      'outside_pilot_window',
    );
    expect(decideEffect({ ...p, effect: 'integration.read', today: '2026-12-08' }).allowed).toBe(true);
    expect(decideEffect({ ...p, effect: 'integration.read', today: '2026-12-09' }).allowed).toBe(false);
    expect(decideEffect({ ...p, scope: null, effect: 'integration.read' }).reason).toBe('no_approved_scope');
  });

  it('active uses the production scope, defaulting to every effect', () => {
    expect(decideEffect({ ...base, status: 'active', scope: null, effect: 'payment.charge' }).allowed).toBe(
      true,
    );
    const restricted = { effects: [{ effect: 'message.guest' as const }], workflows: ['*'], modules: [] };
    expect(
      decideEffect({ ...base, status: 'active', scope: restricted, effect: 'channel.publish' }).allowed,
    ).toBe(false);
  });

  it('workflow decisions follow the same stages', () => {
    const p = { status: 'pilot' as const, scope: pilotScope, today: '2026-11-15' };
    expect(decideWorkflow({ ...p, workflow: 'operations.housekeepingBoard' }).allowed).toBe(true);
    expect(decideWorkflow({ ...p, workflow: 'comms.postStay' }).allowed).toBe(true);
    expect(decideWorkflow({ ...p, workflow: 'reservations.checkIn' }).allowed).toBe(false);
    expect(decideWorkflow({ ...p, status: 'setup', workflow: 'reservations.checkIn' }).allowed).toBe(true);
    expect(
      decideWorkflow({ ...p, status: 'active', scope: null, workflow: 'reservations.checkIn' }).allowed,
    ).toBe(true);
    expect(decideWorkflow({ ...p, status: 'inactive', workflow: 'comms.postStay' }).allowed).toBe(false);
  });
});

describe('data authority rules', () => {
  it('accepts exactly three combinations (G-01, G-07)', () => {
    expect(authorityCombinationProblem({ authority: 'portico', writeMode: 'exclusive' })).toBeNull();
    expect(
      authorityCombinationProblem({ authority: 'external', writeMode: 'read_only', connectionId: 'c' }),
    ).toBeNull();
    expect(
      authorityCombinationProblem({ authority: 'external', writeMode: 'forward', connectionId: 'c' }),
    ).toBeNull();
    expect(
      authorityCombinationProblem({ authority: 'external', writeMode: 'exclusive', connectionId: 'c' })
        ?.message,
    ).toBe('Use read-only or forward for an external system of record.');
    expect(authorityCombinationProblem({ authority: 'external', writeMode: 'forward' })?.code).toBe(
      'connection_required',
    );
    expect(authorityCombinationProblem({ authority: 'portico', writeMode: 'forward' })?.code).toBe(
      'invalid_write_mode',
    );
    expect(
      authorityCombinationProblem({ authority: 'portico', writeMode: 'exclusive', connectionId: 'c' })?.code,
    ).toBe('connection_not_allowed');
  });

  it('transitions move planned → frozen → effective or cancelled only', () => {
    expect(canMoveTransition('planned', 'frozen')).toBe(true);
    expect(canMoveTransition('planned', 'effective')).toBe(false);
    expect(canMoveTransition('frozen', 'effective')).toBe(true);
    expect(canMoveTransition('effective', 'cancelled')).toBe(false);
    expect(needsSecondApprover(['roomStatus'])).toBe(false);
    expect(needsSecondApprover(['roomStatus', 'charges'])).toBe(true);
  });
});

describe('ownership shares', () => {
  it('computes the highest concurrent total over overlapping periods', () => {
    const existing = [
      { shareBps: 5000, effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' },
      { shareBps: 3000, effectiveFrom: '2026-03-01', effectiveTo: null },
    ];
    expect(
      maxConcurrentShare(existing, { shareBps: 2000, effectiveFrom: '2026-01-01', effectiveTo: null }),
    ).toEqual({
      maxBps: 10_000,
      onDate: '2026-03-01',
    });
    expect(
      maxConcurrentShare(existing, { shareBps: 2500, effectiveFrom: '2026-07-01', effectiveTo: null }).maxBps,
    ).toBe(5500);
    // Adjacent periods (half-open) never overlap.
    expect(
      maxConcurrentShare(existing, { shareBps: 5000, effectiveFrom: '2025-01-01', effectiveTo: '2026-01-01' })
        .maxBps,
    ).toBe(5000);
  });

  it('validates shares and finds shares on a date', () => {
    expect(
      validateSharePeriod({ shareBps: 0, effectiveFrom: '2026-01-01', effectiveTo: null }),
    ).not.toBeNull();
    expect(
      validateSharePeriod({ shareBps: 10_001, effectiveFrom: '2026-01-01', effectiveTo: null }),
    ).not.toBeNull();
    expect(
      validateSharePeriod({ shareBps: 2.5, effectiveFrom: '2026-01-01', effectiveTo: null }),
    ).not.toBeNull();
    expect(
      validateSharePeriod({ shareBps: 100, effectiveFrom: '2026-01-01', effectiveTo: '2026-01-01' }),
    ).not.toBeNull();
    expect(validateSharePeriod({ shareBps: 100, effectiveFrom: '2026-01-01', effectiveTo: null })).toBeNull();
    const periods = [{ shareBps: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-02-01' }];
    expect(sharesOn(periods, '2026-01-31')).toHaveLength(1);
    expect(sharesOn(periods, '2026-02-01')).toHaveLength(0);
  });

  it('refuses bank data in payout hints', () => {
    expect(looksLikeBankData('BML ••••1234')).toBe(false);
    expect(looksLikeBankData('7730000123456')).toBe(true);
    expect(looksLikeBankData('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(looksLikeBankData('finance:payout-account:owner-17')).toBe(false);
  });
});

describe('opening hours', () => {
  it('handles intervals crossing midnight and the week boundary', () => {
    const bar = [
      { day: 5 as const, opens: '18:00', closes: '01:00' },
      { day: 7 as const, opens: '20:00', closes: '02:00' },
    ];
    expect(validateOpeningHours(bar)).toEqual([]);
    expect(isOpenAt(bar, 5, '23:59')).toBe(true);
    expect(isOpenAt(bar, 6, '00:30')).toBe(true);
    expect(isOpenAt(bar, 6, '01:00')).toBe(false);
    expect(isOpenAt(bar, 1, '01:59')).toBe(true); // Sunday night into Monday
    expect(isOpenAt(bar, 1, '02:00')).toBe(false);
  });

  it('rejects malformed and overlapping intervals', () => {
    expect(validateOpeningHours([{ day: 1, opens: '7:00', closes: '10:00' }])).toHaveLength(1);
    expect(validateOpeningHours([{ day: 1, opens: '10:00', closes: '10:00' }])).toHaveLength(1);
    expect(
      validateOpeningHours([
        { day: 1, opens: '07:00', closes: '11:00' },
        { day: 1, opens: '10:30', closes: '14:00' },
      ]),
    ).toHaveLength(1);
    expect(validateOpeningHours([{ day: 1, opens: '00:00', closes: '24:00' }])).toEqual([]);
  });
});

describe('configuration plans', () => {
  const current = new Map<string, Record<string, unknown>>([
    ['BAR', { name: 'Sunset Bar', kind: 'bar', acceptsRoomCharge: true }],
    ['SPA', { name: 'Island Spa', kind: 'spa', acceptsRoomCharge: false, localOnly: 1 }],
  ]);
  const source = [
    { key: 'BAR', value: { name: 'Sunset Bar', kind: 'bar', acceptsRoomCharge: true } },
    { key: 'SPA', value: { name: 'Island Spa', kind: 'spa', acceptsRoomCharge: true } },
    { key: 'DIVE', value: { name: 'Dive Centre', kind: 'dive_center' } },
    { key: 'CAFE', value: { name: 'Cafe', kind: 'cafe' } },
  ];

  it('preserves local differences by default and reports conflicts', () => {
    const plan = planSection({
      section: 'platform.outlets',
      source,
      current,
      mode: 'preserve_local',
      conflicts: new Map([['CAFE', 'Legal entity "Other Ltd" does not exist in this organization.']]),
    });
    expect(plan.items.map((i) => [i.key, i.action])).toEqual([
      ['BAR', 'unchanged'],
      ['SPA', 'local_preserved'],
      ['DIVE', 'create'],
      ['CAFE', 'conflict'],
    ]);
    expect(planSummary([{ propertyId: 'p', sections: [plan] }])).toEqual({
      properties: 1,
      create: 1,
      update: 0,
      unchanged: 1,
      localPreserved: 1,
      conflicts: 1,
    });
  });

  it('overwrites included fields only, keeping property-specific extras', () => {
    const plan = planSection({ section: 's', source, current, mode: 'overwrite' });
    const spa = plan.items.find((i) => i.key === 'SPA');
    expect(spa?.action).toBe('update');
    expect(spa?.after).toEqual({ name: 'Island Spa', kind: 'spa', acceptsRoomCharge: true, localOnly: 1 });
  });

  it('compares JSON independent of key order and never carries operational data forward', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(isCarryForwardAllowed('platform.outlets', true)).toBe(true);
    expect(isCarryForwardAllowed('reservations.bookings', true)).toBe(false);
    expect(isCarryForwardAllowed('identity.credentials', true)).toBe(false);
    expect(isCarryForwardAllowed('platform.policies', false)).toBe(false);
  });

  it('requires a separate approver according to policy', () => {
    expect(approvalRequired('portfolio_changes', 1, false)).toBe(false);
    expect(approvalRequired('portfolio_changes', 2, false)).toBe(true);
    expect(approvalRequired('portfolio_changes', 1, true)).toBe(true);
    expect(approvalRequired('all_changes', 1, false)).toBe(true);
    expect(approvalRequired('off', 9, true)).toBe(false);
  });
});
