import { describe, expect, it } from 'vitest';
import { type CandidateFacts, compareUnitNumbers, rankCandidates } from './ranking';

const unit = (number: string, over: Partial<CandidateFacts> = {}): CandidateFacts => ({
  unitId: `id-${number}`,
  number,
  sortOrder: 0,
  features: [],
  exclusions: [],
  isComponent: false,
  currentForRef: false,
  ...over,
});

describe('assignable unit ranking', () => {
  it('orders unit numbers naturally', () => {
    expect(['10', '2', 'A10', 'A2'].sort(compareUnitNumbers)).toEqual(['2', '10', 'A2', 'A10']);
  });

  it('puts assignable units first and explains why others are excluded', () => {
    const ranked = rankCandidates(
      [unit('101', { exclusions: [{ code: 'assigned', message: 'Assigned to stay X.' }] }), unit('102')],
      { compositeStay: false },
    );
    expect(ranked.map((r) => [r.facts.number, r.assignable])).toEqual([
      ['102', true],
      ['101', false],
    ]);
    expect(ranked[1]?.ranking[0]).toContain('Assigned to stay X');
  });

  it('ranks components of combinable units after standalone units for ordinary stays (INV-R08)', () => {
    const ranked = rankCandidates([unit('201', { isComponent: true }), unit('305')], {
      compositeStay: false,
    });
    expect(ranked.map((r) => r.facts.number)).toEqual(['305', '201']);
    expect(ranked[1]?.ranking.join(' ')).toMatch(/combinable/);
  });

  it('prefers the unit the stay already occupies, then requested features', () => {
    const ranked = rankCandidates(
      [
        unit('1', { features: ['sea_view'] }),
        unit('2', { features: ['sea_view', 'private_pool'] }),
        unit('3', { currentForRef: true }),
      ],
      { requestedFeatures: ['sea_view', 'private_pool'], compositeStay: false },
    );
    expect(ranked.map((r) => r.facts.number)).toEqual(['3', '2', '1']);
    expect(ranked[1]).toMatchObject({ matchedFeatures: ['sea_view', 'private_pool'], missingFeatures: [] });
    expect(ranked[2]?.missingFeatures).toEqual(['private_pool']);
  });

  it('falls back to sort order and number for equal scores', () => {
    const ranked = rankCandidates([unit('10', { sortOrder: 1 }), unit('9', { sortOrder: 1 }), unit('50')], {
      compositeStay: true,
    });
    expect(ranked.map((r) => r.facts.number)).toEqual(['50', '9', '10']);
  });

  it('keeps accessible units for guests who need them (PAR-INV-005)', () => {
    const ranked = rankCandidates(
      [unit('101', { features: ['accessible'] }), unit('102'), unit('103', { isComponent: true })],
      {
        compositeStay: false,
      },
    );
    expect(ranked.map((r) => r.facts.number)).toEqual(['102', '103', '101']);
    expect(ranked[2]?.ranking.join(' ')).toMatch(/kept for guests who need it \(accessible\)/);
    const asked = rankCandidates([unit('101', { features: ['accessible'] }), unit('102')], {
      requestedFeatures: ['accessible'],
      compositeStay: false,
    });
    expect(asked[0]?.facts.number).toBe('101');
  });
});
