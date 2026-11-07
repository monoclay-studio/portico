import { describe, expect, it } from 'vitest';
import {
  type AccessScope,
  aggregateSharingConsent,
  documentVisible,
  itemVisible,
  profileVisibility,
  sharingApplies,
  stayVisible,
} from './visibility';

const scope = (over: Partial<AccessScope> = {}): AccessScope => ({
  readAll: false,
  readPropertyIds: ['A'],
  sharedViewing: false,
  sharingRequiresConsent: false,
  ...over,
});

describe('profile visibility', () => {
  it('full when known at one of the user’s properties or org-wide', () => {
    expect(profileVisibility(scope(), ['A', 'B'], 'unknown')).toBe('full');
    expect(profileVisibility(scope({ readAll: true, readPropertyIds: [] }), ['Z'], 'withdrawn')).toBe('full');
  });
  it('none without sharing; shared with sharing unless the guest objected', () => {
    expect(profileVisibility(scope(), ['B'], 'unknown')).toBe('none');
    expect(profileVisibility(scope({ sharedViewing: true }), ['B'], 'unknown')).toBe('shared');
    expect(profileVisibility(scope({ sharedViewing: true }), ['B'], 'withdrawn')).toBe('none');
  });
  it('explicit-consent policy requires a grant', () => {
    const s = scope({ sharedViewing: true, sharingRequiresConsent: true });
    expect(profileVisibility(s, ['B'], 'unknown')).toBe('none');
    expect(profileVisibility(s, ['B'], 'granted')).toBe('shared');
    expect(sharingApplies(s, 'granted')).toBe(true);
  });
  it('a profile known nowhere (data error) is invisible to property staff', () => {
    expect(profileVisibility(scope(), [], 'unknown')).toBe('none');
  });
});

describe('consent aggregation across legal entities', () => {
  it('any objection wins, then any grant', () => {
    expect(aggregateSharingConsent(['granted', 'withdrawn'])).toBe('withdrawn');
    expect(aggregateSharingConsent(['unknown', 'granted'])).toBe('granted');
    expect(aggregateSharingConsent([])).toBe('unknown');
  });
});

describe('item visibility', () => {
  const s = scope({ sharedViewing: true });
  it('property-private items never leave their property', () => {
    expect(itemVisible(s, 'full', { visibility: 'property_private', propertyId: 'A' }, 'unknown')).toBe(true);
    expect(itemVisible(s, 'full', { visibility: 'property_private', propertyId: 'B' }, 'unknown')).toBe(
      false,
    );
    expect(itemVisible(s, 'shared', { visibility: 'property_private', propertyId: 'B' }, 'unknown')).toBe(
      false,
    );
  });
  it('shared items of other properties follow the sharing switch', () => {
    expect(itemVisible(s, 'full', { visibility: 'shared', propertyId: 'B' }, 'unknown')).toBe(true);
    expect(itemVisible(scope(), 'full', { visibility: 'shared', propertyId: 'B' }, 'unknown')).toBe(false);
    expect(itemVisible(scope(), 'full', { visibility: 'shared', propertyId: null }, 'unknown')).toBe(true);
    expect(itemVisible(s, 'full', { visibility: 'shared', propertyId: 'B' }, 'withdrawn')).toBe(false);
  });
  it('department notes: author or readPrivate holders at that property', () => {
    const item = { visibility: 'department' as const, propertyId: 'A' };
    expect(itemVisible(s, 'full', item, 'unknown')).toBe(false);
    expect(itemVisible(s, 'full', { ...item, authoredByActor: true }, 'unknown')).toBe(true);
    expect(itemVisible(s, 'full', item, 'unknown', { readPrivateNotePropertyIds: ['A'] })).toBe(true);
    expect(itemVisible(s, 'full', item, 'unknown', { readPrivateNotePropertyIds: 'all' })).toBe(true);
    expect(itemVisible(s, 'none', item, 'unknown', { readPrivateNotePropertyIds: 'all' })).toBe(false);
  });
  it('documents only at the capturing property in a full view; stays follow sharing', () => {
    expect(documentVisible(s, 'full', 'A')).toBe(true);
    expect(documentVisible(s, 'full', 'B')).toBe(false);
    expect(documentVisible(s, 'shared', 'A')).toBe(false);
    expect(stayVisible(scope(), 'full', 'B', 'unknown')).toBe(false);
    expect(stayVisible(s, 'full', 'B', 'unknown')).toBe(true);
    expect(stayVisible(s, 'none', 'A', 'unknown')).toBe(false);
  });
});
