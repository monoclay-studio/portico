import { describe, expect, it } from 'vitest';
import { type ExplanationFacts, explain, pluralize } from './explain';

const base = (over: Partial<ExplanationFacts> = {}): ExplanationFacts => ({
  typeName: 'Water Villa',
  noun: 'Villa',
  date: '2026-11-12',
  counts: { capacity: 10, outOfOrder: 0, sold: 0, held: 0, overbookingAllowance: 0 },
  available: 10,
  inactiveUnits: 0,
  outOfOrder: [],
  outOfService: [],
  houseUse: [],
  sold: { stays: 0, assignedStays: 0, houseUse: 0, blockAllocations: 0, compositeComponents: 0, imports: 0 },
  holds: [],
  allowances: [],
  conflict: null,
  composite: null,
  ...over,
});

describe('availability explanations', () => {
  it('pluralizes unit nouns', () => {
    expect(pluralize('Villa', 2)).toBe('Villas');
    expect(pluralize('Pitch', 3)).toBe('Pitches');
    expect(pluralize('Bed', 1)).toBe('Bed');
    expect(pluralize('Family Room', 2)).toBe('Family Rooms');
  });

  it('explains a sold-out night term by term', () => {
    const e = explain(
      base({
        counts: { capacity: 10, outOfOrder: 1, sold: 8, held: 1, overbookingAllowance: 0 },
        available: 0,
        outOfOrder: [{ number: '214', reason: 'Roof leak', until: '2026-11-15' }],
        sold: {
          stays: 8,
          assignedStays: 6,
          houseUse: 0,
          blockAllocations: 0,
          compositeComponents: 0,
          imports: 0,
        },
        holds: [{ refLabel: 'quote 0193…', quantity: 1, expiresAt: '2026-11-07T10:30:00.000Z' }],
      }),
    );
    expect(e.status).toBe('sold_out');
    expect(e.formula).toBe('10 capacity − 1 out of order − 8 sold − 1 held + 0 authorized overbooking = 0');
    const text = e.reasons.join('\n');
    expect(text).toContain('Villa 214 — Roof leak (back on 2026-11-15)');
    expect(text).toContain('6 assigned to a villa, 2 not yet assigned');
    expect(text).toContain('held temporarily');
  });

  it('labels authorized overbooking as deliberate and a conflict as needing resolution', () => {
    const authorized = explain(
      base({
        counts: { capacity: 10, outOfOrder: 0, sold: 11, held: 0, overbookingAllowance: 2 },
        available: 1,
        sold: {
          stays: 11,
          assignedStays: 0,
          houseUse: 0,
          blockAllocations: 0,
          compositeComponents: 0,
          imports: 0,
        },
        allowances: [
          { quantity: 2, reason: 'No-show rate 8%', authorizedBy: 'Revenue Manager', kind: 'standing' },
        ],
      }),
    );
    expect(authorized.status).toBe('overbooked');
    expect(authorized.reasons.join(' ')).toMatch(/deliberate, not a conflict/);

    const conflict = explain(
      base({
        counts: { capacity: 10, outOfOrder: 1, sold: 10, held: 0, overbookingAllowance: 0 },
        available: -1,
        sold: {
          stays: 10,
          assignedStays: 10,
          houseUse: 0,
          blockAllocations: 0,
          compositeComponents: 0,
          imports: 0,
        },
        conflict: { shortfall: 1, status: 'open', detectedAt: '2026-11-07T08:00:00.000Z' },
      }),
    );
    expect(conflict.status).toBe('oversold');
    expect(conflict.headline).toMatch(/Oversold by 1/);
    expect(conflict.reasons.join(' ')).toMatch(/relocating, upgrading/);
  });

  it('explains a composite cell with its own formula', () => {
    const e = explain(
      base({
        typeName: 'Two-Bedroom Residence',
        noun: 'Residence',
        counts: { capacity: 2, outOfOrder: 0, sold: 0, held: 0, overbookingAllowance: 0 },
        available: 0,
        composite: {
          available: 0,
          unitLimit: 1,
          componentLimit: 0,
          limitingComponentTypeId: 't',
          totalUnits: 2,
          freeUnits: 1,
          componentNotes: ['Beach Pool Villa has 1 available; each residence needs 2 → 0.'],
        },
      }),
    );
    expect(e.formula).toBe('min(1 free combined units, 0 allowed by component availability) = 0');
    expect(e.reasons.join(' ')).toContain('each residence needs 2');
  });

  it('says when no units exist', () => {
    expect(
      explain(
        base({
          counts: { capacity: 0, outOfOrder: 0, sold: 0, held: 0, overbookingAllowance: 0 },
          available: 0,
        }),
      ).headline,
    ).toMatch(/No villas/);
  });
});
