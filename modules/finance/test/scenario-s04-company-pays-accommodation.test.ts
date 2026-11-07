import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLedgerIntegrity, type Harness, openStay, setupOrg, startHarness, usd } from './helpers';

/**
 * S04 — A family books several rooms; a company pays accommodation (room + breakfast, up to USD 300 per night
 * including taxes) and the guests pay the rest and their incidentals. Previews match postings; the company folio
 * is direct-billed to its receivables account; each payer gets their own invoice.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

describe('S04: company pays accommodation, guests pay incidentals', () => {
  it('routes by specificity with a per-night limit, previews before saving, and settles each payer separately', async () => {
    const org = await setupOrg(h);
    const company = 'Maldivian Holidays Ltd';
    const rooms = [await openStay(h, org, { guest: 'Mr Ivanov', company }), await openStay(h, org, { guest: 'Mrs Ivanova', company })];
    const rule = (stay: (typeof rooms)[number]) => ({
      destinationFolioId: stay.companyFolioId as string,
      label: 'Company pays accommodation and breakfast',
      selector: { chargeGroups: ['room' as const], chargeCodes: ['BRKF'] },
      cap: { kind: 'per_night' as const, amountMinor: 30000, currency: 'USD' },
    });

    // Preview "who pays for what" BEFORE saving the rules (proposed rule set), from known gross amounts.
    const room = rooms[0] as (typeof rooms)[number];
    const preview = await org.run((tx) =>
      h.finance.previewRouting(tx, {
        propertyId: org.propertyId,
        owner: { type: 'stay', id: room.stayId },
        proposedRules: [rule(room)],
        charges: [
          { chargeCode: 'ROOM', serviceDate: '2026-11-07', amount: usd(28140), ref: 'room night 1' },
          { chargeCode: 'BRKF', serviceDate: '2026-11-07', amount: usd(3861), ref: 'breakfast' },
          { chargeCode: 'FOOD', serviceDate: '2026-11-07', amount: usd(10296), ref: 'dinner' },
        ],
      }),
    );
    const totals = Object.fromEntries(preview.totalsByFolio.map((t) => [t.folioId, t.total.amountMinor]));
    expect(totals[room.companyFolioId as string]).toBe(30000);
    expect(totals[room.guestFolioId]).toBe(28140 + 3861 + 10296 - 30000);
    expect(preview.lines[1]?.allocations.map((a) => a.explanation)).toEqual([
      expect.stringContaining('limit 30000 USD per night, 1860 remaining'),
      expect.stringContaining('Above the limit'),
    ]);

    // Save the rules; a second rule selecting exactly the same charges is a configuration error (no ranking).
    for (const r of rooms) {
      await org.run((tx) => h.finance.createBillingRule(tx, { propertyId: org.propertyId, owner: { type: 'stay', id: r.stayId }, ...rule(r) }));
    }
    await expect(
      org.run((tx) => h.finance.createBillingRule(tx, { propertyId: org.propertyId, owner: { type: 'stay', id: room.stayId }, ...rule(room), label: 'Duplicate' })),
    ).rejects.toThrow(/selects exactly the same charges/);

    // Post the real charges for both rooms (room with Green Tax for 2 adults, breakfast, dinner, spa).
    const post = (stayId: string, code: string, amount: number, key: string, occupancy?: { adults: number; childrenAges: number[] }) =>
      org.run((tx) =>
        h.finance.postCharge(tx, {
          propertyId: org.propertyId,
          target: { type: 'stay', id: stayId },
          chargeCode: code,
          amount: usd(amount),
          quantity: 1,
          serviceDate: '2026-11-07',
          description: code,
          sourceRef: { type: 'test', id: key },
          idempotencyKey: `${key}:${stayId}`,
          ...(occupancy ? { occupancy } : {}),
        }),
      );
    for (const r of rooms) {
      await post(r.stayId, 'ROOM', 20000, 'room:2026-11-07', { adults: 2, childrenAges: [] });
      await post(r.stayId, 'BRKF', 3000, 'brkf');
      await post(r.stayId, 'FOOD', 8000, 'dinner');
      await post(r.stayId, 'SPA', 12000, 'spa');
    }
    const companyFolio = await org.run((tx) => h.finance.getFolio(tx, room.companyFolioId as string));
    const guestFolio = await org.run((tx) => h.finance.getFolio(tx, room.guestFolioId));
    // Previewed allocation equals the posted reality for the accommodation part.
    expect(companyFolio.balance.amountMinor).toBe(30000);
    // Guest: breakfast overflow (3861 − 1860) + dinner 102.96 + spa 154.44
    expect(guestFolio.balance.amountMinor).toBe(3861 - 1860 + 10296 + 15444);
    expect(guestFolio.postings.filter((p) => p.kind === 'charge').map((p) => p.chargeCode).sort()).toEqual(['BRKF', 'FOOD', 'SPA']);
    // The company folio carries room taxes and Green Tax with the room.
    expect(companyFolio.postings.filter((p) => p.kind === 'tax').map((p) => p.taxName).sort()).toEqual(['Green Tax', 'Service charge 10%', 'Service charge 10%', 'TGST 17%', 'TGST 17%']);

    // Check-out: the company folio is direct-billed (invoice issued automatically), guests pay by card.
    const ar = await org.run((tx) =>
      h.finance.createReceivablesAccount(tx, { legalEntityId: org.legalEntityId, companyId: newId(), kind: 'agency', name: company, currency: 'USD', termsDays: 30, creditLimitMinor: 1_000_000 }),
    );
    for (const r of rooms) {
      const t = await org.run((tx) => h.finance.transferToReceivables(tx, { folioId: r.companyFolioId as string, receivablesAccountId: ar.id, idempotencyKey: `ar:${r.stayId}` }));
      expect(t.amount.amountMinor).toBe(30000);
      const g = await org.run((tx) => h.finance.getFolio(tx, r.guestFolioId));
      await org.run((tx) =>
        h.finance.recordPayment(tx, { folioId: r.guestFolioId, amount: g.balance, paymentRef: { type: 'payment', id: newId() }, method: 'card', provider: 'simulator', idempotencyKey: `pay:${r.stayId}` }),
      );
      await org.run((tx) => h.finance.issueInvoice(tx, { folioId: r.guestFolioId, idempotencyKey: `inv:${r.stayId}` }));
      const settled = await org.run(async (tx) => h.finance.settleFolio(tx, r.guestFolioId, (await h.finance.getFolio(tx, r.guestFolioId)).version));
      expect(settled.status.folio).toBe('settled');
    }
    const companyAfter = await org.run((tx) => h.finance.getFolio(tx, room.companyFolioId as string));
    expect(companyAfter.status).toMatchObject({ folio: 'settled', balance: 'zero', invoicing: 'invoiced' });
    const docs = await org.run((tx) => h.finance.listDocuments(tx, room.companyFolioId as string));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.snapshot).toMatchObject({ title: 'Tax Invoice', buyer: { name: company } });
    const guestDocs = await org.run((tx) => h.finance.listDocuments(tx, room.guestFolioId));
    expect(guestDocs[0]?.snapshot).toMatchObject({ buyer: { name: 'Mr Ivanov' } });
    expect(guestDocs[0]?.total.amountMinor).toBe(guestFolio.balance.amountMinor);

    const account = await org.run((tx) => h.finance.getReceivablesAccount(tx, ar.id));
    expect(account.balance.amountMinor).toBe(60000);
    await assertLedgerIntegrity(h, org);
  });

  it('a more specific nested rule wins over a broader one; partial overlaps are rejected', async () => {
    const org = await setupOrg(h);
    const s = await openStay(h, org, { company: 'Coral Travel' });
    const owner = { type: 'stay' as const, id: s.stayId };
    await org.run((tx) =>
      h.finance.createBillingRule(tx, { propertyId: org.propertyId, owner, destinationFolioId: s.companyFolioId as string, label: 'Company pays all food', selector: { chargeGroups: ['food', 'beverage'] } }),
    );
    // Nested (more specific): breakfast only, back to the guest — allowed; it wins for BRKF.
    await org.run((tx) =>
      h.finance.createBillingRule(tx, { propertyId: org.propertyId, owner, destinationFolioId: s.guestFolioId, label: 'Guest pays breakfast', selector: { chargeCodes: ['BRKF'] } }),
    );
    // Partial overlap: food on weekends + spa — neither inside the other → rejected with explanation.
    await expect(
      org.run((tx) =>
        h.finance.createBillingRule(tx, { propertyId: org.propertyId, owner, destinationFolioId: s.guestFolioId, label: 'Weekend food and spa', selector: { chargeGroups: ['food', 'spa'], daysOfWeek: [5, 6] } }),
      ),
    ).rejects.toThrow(/partly overlaps/);
    const brkf = await org.run((tx) =>
      h.finance.postCharge(tx, { propertyId: org.propertyId, target: owner, chargeCode: 'BRKF', amount: usd(2000), serviceDate: '2026-11-07', description: 'Breakfast', sourceRef: { type: 't', id: '1' }, idempotencyKey: `b:${s.stayId}` }),
    );
    const dinner = await org.run((tx) =>
      h.finance.postCharge(tx, { propertyId: org.propertyId, target: owner, chargeCode: 'FOOD', amount: usd(2000), serviceDate: '2026-11-07', description: 'Dinner', sourceRef: { type: 't', id: '2' }, idempotencyKey: `d:${s.stayId}` }),
    );
    expect(brkf.folioId).toBe(s.guestFolioId);
    expect(dinner.folioId).toBe(s.companyFolioId);
    const rules = await org.run((tx) => h.finance.listBillingRules(tx, owner));
    expect(rules.map((r) => r.description)).toEqual([
      'Coral Travel — accommodation pays food charges, beverage charges; the rest goes to the default folio.',
      'Aisha Ibrahim pays BRKF; the rest goes to the default folio.',
    ]);
  });
});
