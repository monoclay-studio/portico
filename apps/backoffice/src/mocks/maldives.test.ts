import { describe, expect, it } from 'vitest';
import { arrivalRow, housekeepingRow, stayChangePreview, timelineView } from './contracts';
import {
  arrivalsFor,
  commitExtension,
  housekeepingFor,
  previewExtension,
  SimulatedProblem,
  simulateProperty,
  stayTotals,
  timelineFor,
  todayFor,
  workItemsFor,
} from './maldives';
import { computeReadiness } from './readiness';

const resort = {
  id: '01a1b51e-0000-7000-8000-000000000001',
  code: 'AZR',
  name: 'Azure Atoll Resort & Spa, Baa Atoll',
  profile: 'resort',
  businessDate: '2026-11-07',
  timezone: 'Indian/Maldives',
  baseCurrency: 'USD',
};
const NOW = new Date('2026-11-07T03:00:00Z');

describe('readiness rule', () => {
  it('picks the first blocking check in operational order and treats unknown as not ready', () => {
    const r = computeReadiness([
      { key: 'documents', status: 'blocking', message: 'passport' },
      { key: 'unit_condition', status: 'blocking', message: 'dirty' },
      { key: 'requests', status: 'attention', message: 'cot' },
    ]);
    expect(r.ready).toBe(false);
    expect(r.blockingReason).toMatchObject({ key: 'unit_condition', owner: 'Housekeeping' });
    expect(
      computeReadiness([{ key: 'guarantee', status: 'unknown', message: 'pending verification' }]).ready,
    ).toBe(false);
    expect(computeReadiness([{ key: 'requests', status: 'attention', message: 'cot' }]).ready).toBe(true);
  });
});

describe('Maldives simulation', () => {
  const sim = simulateProperty(resort, NOW);

  it('is deterministic per property and business date', () => {
    const again = simulateProperty(resort, NOW);
    expect(arrivalsFor(again)).toEqual(arrivalsFor(sim));
    expect(simulateProperty({ ...resort, businessDate: '2026-11-08' }, NOW).stays).not.toEqual(sim.stays);
  });

  it('produces payloads that satisfy the provisional contracts', () => {
    expect(() => arrivalRow.array().parse(arrivalsFor(sim))).not.toThrow();
    expect(() => housekeepingRow.array().parse(housekeepingFor(sim))).not.toThrow();
    expect(() => timelineView.parse(timelineFor(sim, '2026-11-05', 21))).not.toThrow();
  });

  it('has 120 villas and realistic arrival scenarios (failed inspection, pending verification, delayed seaplane)', () => {
    expect(sim.units).toHaveLength(120);
    const arrivals = arrivalsFor(sim);
    expect(arrivals.length).toBeGreaterThan(8);
    expect(
      arrivals.some(
        (a) =>
          a.readiness.blockingReason?.key === 'unit_condition' && a.unitCondition === 'failed_inspection',
      ),
    ).toBe(true);
    expect(arrivals.some((a) => a.paymentStatus === 'pending_verification' && !a.readiness.ready)).toBe(true);
    expect(arrivals.some((a) => a.arrivalDetails.estimatedAt !== a.arrivalDetails.scheduledAt)).toBe(true);
    expect(
      arrivals.every(
        (a) =>
          a.paymentStatus !== 'paid' ||
          a.readiness.checks.find((c) => c.key === 'guarantee')?.status === 'ok',
      ),
    ).toBe(true);
  });

  it('keeps the three boards consistent (one set of facts)', () => {
    const arrivals = arrivalsFor(sim);
    const hk = housekeepingFor(sim);
    const tl = timelineFor(sim, '2026-11-05', 21);
    for (const a of arrivals.filter((x) => x.unitId)) {
      expect(hk.find((h) => h.unitId === a.unitId)?.condition).toBe(a.unitCondition);
      expect(tl.items.some((i) => i.id === a.stayId && i.from === resort.businessDate)).toBe(true);
    }
    // no two stays overlap on one unit
    for (const u of sim.units) {
      const stays = sim.stays.filter((s) => s.unitId === u.id).sort((x, y) => x.from.localeCompare(y.from));
      for (let i = 1; i < stays.length; i++)
        expect((stays[i] as { from: string }).from >= (stays[i - 1] as { to: string }).to).toBe(true);
    }
  });

  it('computes money in integer minor units, rounding each line once', () => {
    const t = stayTotals(98000, 4, 2, 'resort');
    expect(t).toEqual({ room: 392000, serviceCharge: 39200, tgst: 73304, greenTax: 9600, total: 514104 });
    for (const v of Object.values(t)) expect(Number.isInteger(v)).toBe(true);
  });

  it('previews an extension before committing and refuses one that collides with the next stay', () => {
    const fresh = simulateProperty(resort, NOW);
    const stay =
      fresh.stays.find(
        (s) => s.status === 'in_house' && fresh.stays.some((o) => o.unitId === s.unitId && o.from === s.to),
      ) ?? fresh.stays[0];
    if (!stay) throw new Error('no stay');
    const preview = previewExtension(fresh, stay.id, 2, NOW);
    expect(() => stayChangePreview.parse(preview)).not.toThrow();
    expect(preview.sections.map((s) => s.kind)).toEqual([
      'availability',
      'price',
      'taxes',
      'deposits',
      'balance',
    ]);
    const collides = fresh.stays.some(
      (o) => o.unitId === stay.unitId && o.id !== stay.id && o.from === stay.to,
    );
    if (collides) expect(() => commitExtension(fresh, stay.id, 2)).toThrow(SimulatedProblem);
  });

  it('derives Today and My work from the same simulation', () => {
    const today = todayFor(sim);
    expect(today.arrivals.total).toBe(arrivalsFor(sim).length);
    expect(today.occupancy.occupied).toBeLessThanOrEqual(today.occupancy.sellable);
    expect(today.forecast).toHaveLength(5);
    const work = workItemsFor(sim);
    expect(work[0]?.priority).toBe('urgent');
    expect(work.some((w) => w.kind === 'approval')).toBe(true);
  });

  it('scales down to a 12-room guesthouse', () => {
    const gh = simulateProperty(
      { ...resort, id: 'gh', code: 'CNG', profile: 'guesthouse', name: 'Coral Nest' },
      NOW,
    );
    expect(gh.units).toHaveLength(12);
    expect(() => arrivalRow.array().parse(arrivalsFor(gh))).not.toThrow();
  });
});
