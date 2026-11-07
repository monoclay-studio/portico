import { describe, expect, it } from 'vitest';
import { housekeepingPriority } from './priority';
import { suggestAssignments, type WorkloadAttendant, type WorkloadTask } from './workload';

const task = (
  id: string,
  sectionId: string | null,
  credits = 2,
  priorityScore = 10,
  zoneId: string | null = null,
) =>
  ({
    id,
    unitNumber: id,
    sectionId,
    zoneId,
    sectionName: sectionId,
    credits,
    priorityScore,
  }) satisfies WorkloadTask;
const attendant = (
  id: string,
  home: string[],
  capacity = 20,
  extra: Partial<WorkloadAttendant> = {},
): WorkloadAttendant => ({
  id,
  name: id,
  homeSectionIds: home,
  homeZoneIds: [],
  capacity,
  assignedCredits: 0,
  activeSectionIds: [],
  ...extra,
});

describe('workload assignment suggestions', () => {
  it('prefers the home section and explains why', () => {
    const r = suggestAssignments(
      [task('B101', 'B1'), task('JA01', 'JA')],
      [attendant('Aminath', ['B1']), attendant('Hussain', ['JA'])],
    );
    const byTask = Object.fromEntries(r.suggestions.map((s) => [s.taskId, s]));
    expect(byTask.B101?.attendantName).toBe('Aminath');
    expect(byTask.JA01?.attendantName).toBe('Hussain');
    expect(byTask.B101?.explanation[0]).toContain('home section B1');
    expect(byTask.B101?.explanation[1]).toContain('Next best: Hussain');
  });

  it('balances load: overflow goes to the least-loaded colleague, never over capacity while others have room', () => {
    const tasks = ['JA01', 'JA02', 'JA03', 'JA04'].map((id) => task(id, 'JA', 2));
    const r = suggestAssignments(tasks, [
      attendant('Hussain', ['JA'], 6),
      attendant('Aminath', ['B1'], 20, { assignedCredits: 6 }),
      attendant('Fathimath', ['B2'], 20, { assignedCredits: 2 }),
    ]);
    const hussain = r.workload.find((w) => w.attendantName === 'Hussain');
    expect(hussain?.creditsAfter).toBeLessThanOrEqual(6);
    expect(hussain?.suggestedTaskIds).toHaveLength(3);
    const overflow = r.suggestions.find((s) => s.attendantName !== 'Hussain');
    expect(overflow?.attendantName).toBe('Fathimath');
    expect(r.workload.find((w) => w.attendantName === 'Fathimath')?.utilisationPercent).toBe(20);
  });

  it('places higher-priority tasks first (they get the best match)', () => {
    const r = suggestAssignments(
      [task('low', 'B1', 2, 5), task('urgent', 'B1', 2, 90)],
      [attendant('Aminath', ['B1'], 2), attendant('Ali', ['B2'], 20)],
    );
    expect(r.suggestions[0]?.taskId).toBe('urgent');
    expect(r.suggestions[0]?.attendantName).toBe('Aminath');
    expect(r.suggestions[1]?.attendantName).toBe('Ali');
  });

  it('uses island zones and route compactness when no home-section match exists', () => {
    const r = suggestAssignments(
      [task('S1', 'SUNSET-2', 2, 10, 'SUNSET')],
      [attendant('Ali', ['N1'], 20), attendant('Mariyam', ['SUNSET-1'], 20, { homeZoneIds: ['SUNSET'] })],
    );
    expect(r.suggestions[0]?.attendantName).toBe('Mariyam');
    expect(r.suggestions[0]?.explanation[0]).toContain('same zone');
  });

  it('is deterministic and reports when nobody is on duty', () => {
    const tasks = [task('a', null), task('b', null)];
    const team = [attendant('X', []), attendant('Y', [])];
    expect(suggestAssignments(tasks, team)).toEqual(suggestAssignments(tasks, team));
    expect(suggestAssignments(tasks, []).unassigned).toHaveLength(2);
  });
});

describe('housekeeping priority', () => {
  const now = new Date('2026-11-07T05:00:00Z');
  it('arrival due soon, VIP and early check-in raise a departure clean to urgent with reasons', () => {
    const p = housekeepingPriority({
      kind: 'departure_clean',
      now,
      arrival: { expectedAt: new Date('2026-11-07T06:00:00Z'), vip: true, earlyCheckIn: true, today: true },
      departed: true,
      arrivalSoonMinutes: 180,
    });
    expect(p.reasons).toEqual(['arrival_due_soon', 'early_check_in', 'vip', 'guest_departed']);
    expect(p.priority).toBe('urgent');
  });
  it('an arrival later today is normal priority; stayovers stay low unless VIP', () => {
    expect(
      housekeepingPriority({
        kind: 'departure_clean',
        now,
        arrival: {
          expectedAt: new Date('2026-11-07T12:00:00Z'),
          vip: false,
          earlyCheckIn: false,
          today: true,
        },
        arrivalSoonMinutes: 180,
      }),
    ).toMatchObject({ priority: 'normal', reasons: ['arrival_today'] });
    expect(
      housekeepingPriority({ kind: 'stayover', now, arrival: null, arrivalSoonMinutes: 180 }).priority,
    ).toBe('low');
  });
  it('a waiting guest makes a re-clean urgent', () => {
    const p = housekeepingPriority({
      kind: 'reclean',
      now,
      arrival: { expectedAt: now, vip: false, earlyCheckIn: false, today: true, guestWaiting: true },
      arrivalSoonMinutes: 180,
    });
    expect(p.priority).toBe('urgent');
    expect(p.reasons).toContain('guest_waiting');
  });
});
