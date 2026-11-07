/**
 * S04 (Day Close part) — a company pays accommodation, guests pay incidentals. The stay's billing rule sends room
 * charges (and the taxes and levies that travel with them, incl. Green Tax) to the company folio; package breakfast
 * stays on the guest's folio. Day Close posts the nights with `target: stay` and finance's billing rules decide the
 * folio — exactly as previewed — once per night.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addStay,
  assertBooksBalance,
  D,
  entriesByKey,
  type Harness,
  nightAudit,
  setupOrg,
  startHarness,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('S04: company pays accommodation, guests pay incidentals — nightly postings follow the billing rules', () => {
  it('posts the room night to the company folio and breakfast to the guest folio, as previewed, once', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, {
      arrival: '2026-11-06',
      departure: '2026-11-09',
      occupancy: { adults: 2, childrenAges: [6] },
    });
    const { company, guest } = await org.run(async (tx) => {
      const company = await h.finance.openFolio(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: s.stayId },
        payer: { type: 'company', id: s.bookingId, name: 'Seabridge Engineering' },
        label: 'accommodation',
      });
      await h.finance.createBillingRule(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: s.stayId },
        destinationFolioId: company.folioId,
        label: 'Company pays accommodation (incl. room taxes and Green Tax)',
        selector: { chargeGroups: ['room'] },
      });
      const folios = await h.finance.listFolios(tx, { owner: { type: 'stay', id: s.stayId } });
      return { company, guest: folios.find((f) => f.isDefault) };
    });
    const preview = await org.run((tx) =>
      h.finance.previewRouting(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: s.stayId },
        charges: [
          {
            chargeCode: 'ROOM',
            serviceDate: D,
            amount: { amountMinor: 100_000, currency: 'USD' },
            ref: 'room',
          },
          {
            chargeCode: 'FB_BREAKFAST',
            serviceDate: D,
            amount: { amountMinor: 10_000, currency: 'USD' },
            ref: 'bf',
          },
        ],
      }),
    );
    const previewed = new Map(preview.lines.map((l) => [l.chargeCode, l.allocations.map((a) => a.folioId)]));
    expect(previewed.get('ROOM')).toEqual([company.folioId]);
    expect(previewed.get('FB_BREAKFAST')).toEqual([guest?.id]);
    const run = await h.service.startRun(h.t.db, nightAudit(h, org), { propertyId: org.propertyId });
    expect(run.runStatus).toBe('completed');
    const companyFolio = await org.run((tx) => h.finance.getFolio(tx, company.folioId));
    const guestFolio = await org.run((tx) => h.finance.getFolio(tx, guest?.id as string));
    const charges = (f: typeof companyFolio) =>
      [...new Set(f.postings.filter((p) => p.kind === 'charge').map((p) => p.chargeCode))].sort();
    expect(charges(companyFolio)).toEqual(['ROOM']);
    expect(charges(guestFolio)).toEqual(['FB_BREAKFAST']);
    // Green Tax for 3 persons travels with the room night to the company.
    const green = companyFolio.postings.filter((p) => p.kind === 'tax' && /green/i.test(p.taxName ?? ''));
    expect(green.reduce((a, p) => a + p.amount.amountMinor, 0)).toBe(3 * 1_200);
    expect(await entriesByKey(h, org.tenantId, `room:${s.stayId}`)).toEqual([
      { idempotency_key: `room:${s.stayId}:${D}`, n: 1 },
    ]);
    await assertBooksBalance(h, org);
  });
});
