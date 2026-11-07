import { frontDeskRow } from '@portico/reservations/contracts';
import { describe, expect, it } from 'vitest';
import { isApiError } from '../../api/errors';
import { board, deskList, READINESS_KEYS } from '../contracts';
import { composeDeskRows, deskState } from '../front-desk';
import type { PropertyContext } from '../property';
import { bindWorkspaceSources } from '../sources';
import { createSimulatedSources } from './adapter';
import {
  boardFor,
  deskListFor,
  overviewFor,
  simulateProperty,
  stayRecord,
  stayTotals,
  workItemsFor,
} from './maldives';

const resort: PropertyContext = {
  id: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  code: 'AZR',
  name: 'Azure Atoll Resort',
  profile: 'resort',
  businessDate: '2026-11-07',
  timezone: 'Indian/Maldives',
  baseCurrency: 'USD',
};
const guesthouse: PropertyContext = {
  ...resort,
  id: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  code: 'CNG',
  profile: 'guesthouse',
};
const NOW = new Date('2026-11-07T06:30:00Z'); // 11:30 in the Maldives
const sim = (p = resort) => simulateProperty(p, NOW);

describe('simulated payloads satisfy the REAL module contracts (P1-6 contract compatibility)', () => {
  for (const p of [resort, guesthouse]) {
    it(`${p.profile}: desk lists parse with reservations' schema, the board with operations' schema`, () => {
      const s = sim(p);
      for (const kind of ['arrivals', 'departures', 'in-house'] as const)
        expect(() => deskList.parse(deskListFor(s, kind))).not.toThrow();
      expect(() => board.parse(boardFor(s))).not.toThrow();
    });
  }

  it('uses only the readiness keys reservations composes, and readiness only for expected stays', () => {
    const s = sim();
    for (const kind of ['arrivals', 'departures', 'in-house'] as const) {
      for (const r of deskListFor(s, kind).items) {
        if (r.stayStatus !== 'expected') expect(r.readiness).toBeNull();
        for (const c of r.readiness?.checks ?? []) expect(READINESS_KEYS).toContain(c.key);
        if (r.eta) expect(r.eta).toMatch(/^\d{2}:\d{2}$/);
      }
    }
  });
});

describe('the view model tolerates what real payloads may send (nullable readiness, HH:MM eta, no board)', () => {
  it('composes rows from a reservations-shaped fixture without operations', () => {
    const fixture = deskList.parse({
      date: '2026-11-07',
      businessDate: '2026-11-07',
      counts: { total: 2 },
      items: [
        frontDeskRow.parse({
          stayId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01',
          bookingId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02',
          bookingCode: 'K7P2M9QX',
          bookingStatus: 'confirmed',
          stayStatus: 'in_house',
          guestName: null,
          arrival: '2026-11-07',
          departure: '2026-11-10',
          unitTypeId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a03',
          unitId: null,
          unitName: null,
          eta: '09:40',
          occupancy: { adults: 2 },
          flags: ['arriving_today', 'something_new'],
          readiness: null,
          balance: null,
          checkInRun: { status: 'completed', remaining: [] },
        }),
        frontDeskRow.parse({
          stayId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a04',
          bookingId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a05',
          bookingCode: 'ZZ9QX2PL',
          bookingStatus: 'confirmed',
          stayStatus: 'expected',
          guestName: 'Wei Zhang',
          arrival: '2026-11-07',
          departure: '2026-11-09',
          unitTypeId: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a03',
          unitId: null,
          unitName: null,
          eta: null,
          occupancy: { adults: 1 },
          flags: [],
          readiness: {
            ready: false,
            checks: [{ key: 'a_future_check', status: 'unknown', message: 'Not known yet.' }],
            blockingReason: { key: 'a_future_check', message: 'Not known yet.' },
          },
          balance: { amountMinor: 0, currency: 'USD' },
          checkInRun: null,
        }),
      ],
    });
    const rows = composeDeskRows(fixture, null);
    expect(rows[0]?.nights).toBe(3);
    expect(deskState(rows[0] as never)).toBe('checked_in'); // never "ready" for an in-house stay
    expect(rows[0]?.secured).toBeNull();
    expect(rows[1]?.blocker).toMatchObject({ key: 'a_future_check', status: 'unknown' });
    expect(rows[1]?.unitCondition).toBeNull();
  });
});

describe('sample data never contradicts itself (SR P2-1, blackbox §11)', () => {
  it('never says Paid while money is owed (FD-03)', () => {
    const s = sim();
    for (const st of s.stays) {
      const rec = stayRecord(s, st.id);
      if (rec?.paymentStatus === 'paid') expect(rec.balance?.amountMinor).toBe(0);
    }
  });

  it('desk counts equal the rows they count; Today figures carry no adjustments', () => {
    const s = sim();
    const a = deskListFor(s, 'arrivals');
    expect(a.counts.ready).toBe(a.items.filter((r) => r.readiness?.ready).length);
    const pending = s.stays.filter((x) => x.payment === 'pending_verification' && x.status !== 'departed');
    expect(overviewFor(s).pendingVerification.count).toBe(pending.length);
  });

  it('history is never in the future', () => {
    const s = sim();
    for (const st of s.stays.slice(0, 200))
      for (const h of stayRecord(s, st.id)?.history ?? [])
        expect(Date.parse(h.at)).toBeLessThanOrEqual(NOW.getTime());
  });

  it('guest names are unique on the day’s lists, and attendants are never front-desk staff', () => {
    const s = sim();
    const names = ['arrivals', 'in-house', 'departures'].flatMap((k) =>
      deskListFor(s, k as 'arrivals').items.map((r) => r.stayId + r.guestName),
    );
    const today = [...new Set(names)].map((n) => n.slice(36));
    expect(new Set(today).size).toBe(today.length);
    const assignees = boardFor(s).rows.flatMap((r) => r.openTasks.map((t) => t.assigneeName));
    expect(assignees).not.toContain('Aishath');
  });

  it('is deterministic per property code and business date (fresh databases show the same day)', () => {
    const a = deskListFor(simulateProperty(resort, NOW), 'arrivals').items.map((r) => r.guestName);
    const b = deskListFor(
      simulateProperty({ ...resort, id: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aff' }, NOW),
      'arrivals',
    ).items.map((r) => r.guestName);
    expect(b).toEqual(a);
  });

  it('a guesthouse sees only its own rooms in My work (no resort villas)', () => {
    const text = JSON.stringify(workItemsFor(sim(guesthouse)));
    expect(text).not.toMatch(/Villa/);
  });

  it('stay totals are integer minor units rounded once per line', () => {
    const tt = stayTotals(98000, 3, 2, 'resort');
    expect(tt).toEqual({ room: 294000, serviceCharge: 29400, tgst: 54978, greenTax: 7200, total: 385578 });
  });
});

describe('sources and bindings', () => {
  it('never binds the simulator in a live organization (fails closed)', () => {
    for (const env of ['live', undefined, null, '']) {
      const b = bindWorkspaceSources(env);
      expect(Object.keys(b.sources)).toHaveLength(0);
      expect(Object.values(b.modes).every((m) => m === 'not_connected')).toBe(true);
    }
    expect(bindWorkspaceSources('demo').modes.frontDesk).toBe('simulated');
    expect(bindWorkspaceSources('training').sources.frontDesk).toBeDefined();
  });

  it('maps simulator failures to problem+json, like the API', async () => {
    const sources = createSimulatedSources({ latencyMs: 0, now: () => NOW });
    const e = await sources.stayChanges
      .commitExtension(resort, { previewToken: 'x', stayId: 'no-such-stay', nights: 1, idempotencyKey: 'k' })
      .catch((x: unknown) => x);
    expect(isApiError(e) && e.problem).toMatchObject({ status: 404, code: 'stay_not_found' });
    const list = await sources.frontDesk.list(resort, 'arrivals');
    expect(list.provenance.kind).toBe('simulated');
  });
});
