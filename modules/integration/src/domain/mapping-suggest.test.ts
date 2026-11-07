import { describe, expect, it } from 'vitest';
import {
  AUTO_CONFIRM_THRESHOLD,
  diceSimilarity,
  type InternalCandidate,
  nameSimilarity,
  normalizeTokens,
  statusCandidates,
  suggestMappings,
} from './mapping-suggest';

const unitTypes: InternalCandidate[] = [
  { id: 'ut-bv', code: 'BV', name: 'Beach Villa', attributes: { maxOccupancy: 3 } },
  { id: 'ut-wv', code: 'WV', name: 'Water Villa', attributes: { maxOccupancy: 2 } },
  { id: 'ut-dbv', code: 'DBV', name: 'Deluxe Beach Villa', attributes: { maxOccupancy: 3 } },
  { id: 'ut-dwv', code: 'DWV', name: 'Deluxe Water Villa', attributes: { maxOccupancy: 3 } },
];

describe('normalization and similarity', () => {
  it('expands hospitality abbreviations and strips accents/punctuation', () => {
    expect(normalizeTokens('DLX K w/ Ocn View')).toEqual(['deluxe', 'k', 'ocean', 'view']);
    expect(normalizeTokens('Café & Bar')).toEqual(['cafe', 'bar']);
    expect(normalizeTokens('')).toEqual([]);
  });
  it('dice similarity bounds', () => {
    expect(diceSimilarity('villa', 'villa')).toBe(1);
    expect(diceSimilarity('a', 'b')).toBe(0);
    expect(diceSimilarity('beachvilla', 'watervilla')).toBeGreaterThan(0.3);
  });
  it('abbreviated codes resemble their names', () => {
    expect(nameSimilarity('DLX', 'Deluxe')).toBe(1);
    expect(nameSimilarity('Beach Villa', 'Garden Room')).toBeLessThan(0.35);
  });
});

describe('suggestMappings', () => {
  it('auto-confirms exact code matches of non-financial kinds and explains why', () => {
    const [s] = suggestMappings(
      [{ kind: 'unitType', externalId: 'BV', label: 'Beach Villa', attributes: { maxOccupancy: 3 } }],
      unitTypes,
    );
    expect(s).toMatchObject({
      internalId: 'ut-bv',
      status: 'confirmed',
      autoConfirmed: true,
      requiresReview: false,
    });
    expect(s?.confidence).toBeGreaterThanOrEqual(AUTO_CONFIRM_THRESHOLD);
    expect(s?.reasons.map((r) => r.code)).toContain('code_exact');
    expect(s?.reasons.map((r) => r.code)).toContain('attribute_match');
  });

  it('flags an ambiguous mapping for mandatory review, naming both candidates', () => {
    const [s] = suggestMappings(
      [{ kind: 'unitType', externalId: 'DV', label: 'Deluxe Villa', attributes: { maxOccupancy: 3 } }],
      unitTypes,
    );
    expect(s?.status).toBe('suggested');
    expect(s?.requiresReview).toBe(true);
    expect(s?.reviewReason).toMatch(/Ambiguous/);
    expect(s?.reviewReason).toMatch(/Deluxe Beach Villa/);
    expect(s?.reviewReason).toMatch(/Deluxe Water Villa/);
    expect(s?.alternatives.length).toBeGreaterThan(0);
  });

  it('always requires review for financially significant kinds, even at high confidence (CL-02)', () => {
    const [s] = suggestMappings(
      [{ kind: 'chargeCode', externalId: 'RM', label: 'Room' }],
      [{ id: 'cc-room', code: 'RM', name: 'Room' }],
    );
    expect(s?.confidence).toBeGreaterThan(0.95);
    expect(s?.financiallySignificant).toBe(true);
    expect(s?.requiresReview).toBe(true);
    expect(s?.autoConfirmed).toBe(false);
    expect(s?.reviewReason).toMatch(/Financially significant/);
  });

  it('never guesses: no candidate above the minimum leaves it unmapped for a person', () => {
    const [s] = suggestMappings(
      [{ kind: 'unitType', externalId: 'TENT', label: 'Glamping Tent' }],
      unitTypes,
    );
    expect(s).toMatchObject({ status: 'unmapped', internalId: null, requiresReview: true });
    const [none] = suggestMappings([{ kind: 'unitType', externalId: 'X', label: 'X' }], []);
    expect(none?.reasons[0]?.message).toMatch(/no unit type records/);
  });

  it('two external records pointing at the same one-to-one target both need review', () => {
    const res = suggestMappings(
      [
        { kind: 'unitType', externalId: 'BV', label: 'Beach Villa' },
        { kind: 'unitType', externalId: 'BV2', label: 'Beach Villa' },
      ],
      unitTypes,
    );
    expect(res.every((r) => r.requiresReview)).toBe(true);
    expect(res[0]?.reasons.map((r) => r.code)).toContain('duplicate_target');
  });

  it('many-to-one is allowed for statuses (several codes mean "dirty")', () => {
    const res = suggestMappings(
      [
        { kind: 'status', externalId: 'roomStatus:VD', code: 'VD', label: 'Vacant Dirty' },
        { kind: 'status', externalId: 'roomStatus:OD', code: 'OD', label: 'Occupied Dirty' },
        { kind: 'status', externalId: 'roomStatus:INS', code: 'INS', label: 'Inspected' },
        { kind: 'status', externalId: 'roomStatus:OOO', code: 'OOO', label: 'Out of Order' },
      ],
      statusCandidates('roomStatus'),
    );
    expect(res.map((r) => r.internalId)).toEqual(['dirty', 'dirty', 'inspected', 'out_of_order']);
    expect(res.every((r) => r.autoConfirmed)).toBe(true);
  });

  it('uses the mapped unit type as a structural hint for units', () => {
    const units: InternalCandidate[] = [
      { id: 'u-101-bv', code: '101', name: 'Villa 101', attributes: { unitTypeId: 'ut-bv' } },
      { id: 'u-101-wv', code: '101W', name: 'Villa 101 Water', attributes: { unitTypeId: 'ut-wv' } },
    ];
    const [s] = suggestMappings(
      [
        {
          kind: 'unit',
          externalId: 'LGN-101',
          code: '101',
          label: 'Room 101',
          attributes: { unitTypeExternalId: 'BV' },
        },
      ],
      units,
      { unitTypeMap: new Map([['BV', 'ut-bv']]) },
    );
    expect(s?.internalId).toBe('u-101-bv');
    expect(s?.reasons.map((r) => r.code)).toContain('same_unit_type');
  });

  it('penalises a currency mismatch on rate plans', () => {
    const [s] = suggestMappings(
      [
        {
          kind: 'ratePlan',
          externalId: 'BAR',
          label: 'Best Available Rate',
          attributes: { currency: 'EUR' },
        },
      ],
      [{ id: 'rp-bar', code: 'BAR', name: 'Best Available Rate', attributes: { currency: 'USD' } }],
    );
    expect(s?.reasons.map((r) => r.code)).toContain('currency_differs');
    expect(s?.confidence).toBeLessThan(0.8);
  });

  it('marks a target already used by a confirmed mapping', () => {
    const [s] = suggestMappings([{ kind: 'unitType', externalId: 'BVX', label: 'Beach Villa' }], unitTypes, {
      taken: new Map([['ut-bv', 'BV']]),
    });
    expect(s?.requiresReview).toBe(true);
    expect(s?.reasons.map((r) => r.code)).toContain('already_mapped');
  });
});
