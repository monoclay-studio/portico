import { describe, expect, it } from 'vitest';
import { planHousekeepingDay } from './day-plan';
import { assertDisposalAllowed, assertLostFoundTransition, retentionUntil } from './lost-found';
import { addMonths, advance, dueOccurrences } from './preventive';

describe('housekeeping day plan', () => {
  const units = [
    { id: 'u1', number: '101', condition: 'dirty' as const, occupancy: 'occupied' as const, blocked: false },
    { id: 'u2', number: '102', condition: 'clean' as const, occupancy: 'vacant' as const, blocked: false },
    { id: 'u3', number: '103', condition: 'dirty' as const, occupancy: 'vacant' as const, blocked: false },
    { id: 'u4', number: '104', condition: 'dirty' as const, occupancy: 'vacant' as const, blocked: true },
    {
      id: 'u5',
      number: '105',
      condition: 'inspected' as const,
      occupancy: 'occupied' as const,
      blocked: false,
    },
  ];
  const stays = [
    { id: 's1', unitId: 'u1', arrival: '2026-11-04', departure: '2026-11-07', status: 'in_house' as const },
    { id: 's2', unitId: 'u2', arrival: '2026-11-07', departure: '2026-11-09', status: 'expected' as const },
    { id: 's5', unitId: 'u5', arrival: '2026-11-05', departure: '2026-11-10', status: 'in_house' as const },
  ];
  it('plans departures, stayovers, vacant cleans and arrival inspections — never for blocked units', () => {
    const plan = planHousekeepingDay({
      date: '2026-11-07',
      units,
      stays,
      turndownEnabled: false,
      requireInspection: true,
    });
    expect(plan.map((p) => `${p.kind}:${p.unitId}`).sort()).toEqual([
      'departure_clean:u1',
      'inspection:u2',
      'stayover:u5',
      'vacant_clean:u3',
    ]);
    expect(plan.find((p) => p.kind === 'departure_clean')?.dedupeKey).toBe('departure_clean:s1');
  });
  it('adds turndowns for tonight’s in-house and arriving stays when enabled', () => {
    const plan = planHousekeepingDay({
      date: '2026-11-07',
      units,
      stays,
      turndownEnabled: true,
      requireInspection: false,
    });
    expect(
      plan
        .filter((p) => p.kind === 'turndown')
        .map((p) => p.unitId)
        .sort(),
    ).toEqual(['u2', 'u5']);
    expect(plan.some((p) => p.kind === 'inspection')).toBe(false);
  });
});

describe('preventive schedules', () => {
  it('adds months clamping to the end of the month (leap years too)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(advance('2026-11-07', 'week', 2)).toBe('2026-11-21');
  });
  it('generates due occurrences with lead days and reports missed ones beyond the cap', () => {
    expect(
      dueOccurrences({ nextDueOn: '2026-11-10', unit: 'month', count: 3, asOf: '2026-11-07', leadDays: 0 }),
    ).toEqual({
      occurrences: [],
      nextDueOn: '2026-11-10',
      skipped: 0,
    });
    expect(
      dueOccurrences({ nextDueOn: '2026-11-10', unit: 'month', count: 3, asOf: '2026-11-07', leadDays: 3 }),
    ).toEqual({
      occurrences: ['2026-11-10'],
      nextDueOn: '2027-02-10',
      skipped: 0,
    });
    const behind = dueOccurrences({
      nextDueOn: '2026-10-01',
      unit: 'day',
      count: 1,
      asOf: '2026-10-20',
      leadDays: 0,
      cap: 5,
    });
    expect(behind.occurrences).toHaveLength(5);
    expect(behind.skipped).toBe(15);
    expect(behind.nextDueOn).toBe('2026-10-21');
  });
});

describe('lost & found', () => {
  it('follows stored → matched → released and records are final', () => {
    expect(() => assertLostFoundTransition('stored', 'matched')).not.toThrow();
    expect(() => assertLostFoundTransition('matched', 'released')).not.toThrow();
    expect(() => assertLostFoundTransition('released', 'stored')).toThrow(/final/);
  });
  it('retention is longer for high-value items and early disposal needs a reason', () => {
    const policy = { retentionDays: 90, highValueRetentionDays: 180 };
    expect(retentionUntil('2026-11-07', false, policy)).toBe('2027-02-05');
    expect(retentionUntil('2026-11-07', true, policy)).toBe('2027-05-06');
    expect(() => assertDisposalAllowed('2026-12-01', '2027-02-05', undefined)).toThrow(
      /kept until 2027-02-05/,
    );
    expect(() => assertDisposalAllowed('2026-12-01', '2027-02-05', 'perishable food')).not.toThrow();
    expect(() => assertDisposalAllowed('2027-02-05', '2027-02-05', undefined)).not.toThrow();
  });
});
