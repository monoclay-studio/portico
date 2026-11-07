import { describe, expect, it } from 'vitest';
import {
  decideFields,
  followMergeChain,
  MERGEABLE_FIELDS,
  newerConsentWins,
  planFieldRestore,
  type ScalarRecord,
  suggestPostMergeOwner,
} from './merge';

const rec = (over: Partial<ScalarRecord>): ScalarRecord =>
  ({ ...Object.fromEntries(MERGEABLE_FIELDS.map((f) => [f, null])), ...over }) as ScalarRecord;

describe('field decisions', () => {
  it('keeps the survivor, fills gaps from the merged profile, never downgrades VIP', () => {
    const d = decideFields(
      rec({ family_name: 'Ali', nationality: 'AE', vip_level: 'vip1' }),
      rec({ family_name: 'Ali', nationality: 'SA', date_of_birth: '1992-11-20', vip_level: 'vip3' }),
    );
    const by = Object.fromEntries(d.map((x) => [x.field, x]));
    expect(by.nationality).toMatchObject({
      chosen: 'survivor',
      value: 'AE',
      changes: false,
      rule: 'survivor_has_value',
    });
    expect(by.date_of_birth).toMatchObject({
      chosen: 'merged',
      value: '1992-11-20',
      changes: true,
      rule: 'fill_empty',
    });
    expect(by.vip_level).toMatchObject({ chosen: 'merged', value: 'vip3' });
    expect(by.family_name).toMatchObject({ rule: 'identical', changes: false });
  });
  it('explicit choices win', () => {
    const d = decideFields(rec({ nationality: 'AE' }), rec({ nationality: 'SA' }), { nationality: 'merged' });
    expect(d.find((x) => x.field === 'nationality')).toMatchObject({
      value: 'SA',
      rule: 'explicit',
      changes: true,
    });
  });
  it('restores only fields untouched since the merge', () => {
    const d = decideFields(
      rec({ nationality: null, language: null }),
      rec({ nationality: 'SA', language: 'ar' }),
    );
    const plan = planFieldRestore(d, rec({ nationality: 'SA', language: 'en' }));
    expect(plan.restore).toEqual([{ field: 'nationality', value: null }]);
    expect(plan.conflicts).toEqual([{ field: 'language', mergeValue: 'ar', currentValue: 'en' }]);
  });
});

describe('merge chains', () => {
  const rows: Record<string, { status: string; mergedInto: string | null }> = {
    a: { status: 'merged', mergedInto: 'b' },
    b: { status: 'merged', mergedInto: 'c' },
    c: { status: 'active', mergedInto: null },
    x: { status: 'merged', mergedInto: 'y' },
    y: { status: 'merged', mergedInto: 'x' },
  };
  it('follows to the active survivor', () => {
    expect(followMergeChain('a', (id) => rows[id])).toEqual({ id: 'c', path: ['a', 'b', 'c'] });
    expect(followMergeChain('c', (id) => rows[id])).toEqual({ id: 'c', path: ['c'] });
  });
  it('refuses cycles and over-long chains', () => {
    expect(() => followMergeChain('x', (id) => rows[id])).toThrow(/cycle/);
    expect(() => followMergeChain('a', (id) => rows[id], 1)).toThrow(/more than 1 links/);
    expect(() => followMergeChain('x', (id) => rows[id])).toThrow(
      expect.objectContaining({ code: 'merge_chain_corrupt' }),
    );
  });
});

describe('consents and post-merge suggestions', () => {
  it('the most recent statement wins', () => {
    expect(
      newerConsentWins({ changedAt: new Date('2026-01-01') }, { changedAt: new Date('2026-02-01') }),
    ).toBe('merged');
    expect(
      newerConsentWins({ changedAt: new Date('2026-03-01') }, { changedAt: new Date('2026-02-01') }),
    ).toBe('survivor');
  });
  it('suggests the restored profile only on an identifier', () => {
    const merged = { id: 'm', contactValues: ['+966507654321'] };
    expect(suggestPostMergeOwner({ requestedProfileId: 'm' }, merged).owner).toBe('restored');
    expect(suggestPostMergeOwner({ normalizedContact: '+966507654321' }, merged).owner).toBe('restored');
    expect(suggestPostMergeOwner({ requestedProfileId: 's' }, merged).owner).toBe('survivor');
    expect(suggestPostMergeOwner({}, merged).owner).toBe('survivor');
    expect(suggestPostMergeOwner({ documentHash: 'h1' }, { ...merged, documentHashes: ['h1'] }).owner).toBe(
      'restored',
    );
  });
});
