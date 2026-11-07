import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financeForReservations, fromReservationsTaxLine } from '../src';
import { addProperty, assertLedgerIntegrity, type Harness, setupOrg, startHarness, usd } from './helpers';

/**
 * The FinancePort as the reservations module declares it (bound directly in the composition root), driven with the
 * inputs reservations really sends (modules/reservations/src/service/{bookings,changes,workflows}.ts): payers by
 * profile/company id without names, codes CXL / MISC from finance's default catalogue, billing instructions for
 * ['room','package'] with [arrival, departure) dates, penalties on the stay or the booking.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

describe('reservations → finance port', () => {
  it('opens folios for payers given by id, merges billing instructions, posts penalties and lists folios', async () => {
    const org = await setupOrg(h);
    const port = financeForReservations(h.finance);
    const agent = org.as(['reservations.booking.create']); // no finance permissions of its own
    const bookingId = newId();
    const stayId = newId();
    const profileId = newId();
    const companyId = newId();
    h.payerNames.set(profileId, 'Lena Fischer');
    const stay = { type: 'stay', id: stayId };
    const incidentals = await org.run(
      (tx) =>
        port.openFolio(tx, {
          propertyId: org.propertyId,
          owner: stay,
          payer: { type: 'profile', id: profileId },
          label: 'Incidentals',
        }),
      agent,
    );
    const accommodation = await org.run(
      (tx) =>
        port.openFolio(tx, {
          propertyId: org.propertyId,
          owner: stay,
          payer: { type: 'company', id: companyId },
          label: 'Accommodation',
        }),
      agent,
    );
    const named = await org.run((tx) => h.finance.getFolio(tx, incidentals.folioId));
    expect(named.payer.name).toBe('Lena Fischer');
    expect(named.issues.map((i) => i.code)).not.toContain('payer_name_missing');
    const placeholder = await org.run((tx) => h.finance.getFolio(tx, accommodation.folioId));
    expect(placeholder.payer.name).toBe('Company account');
    expect(placeholder.issues.map((i) => i.code)).toContain('payer_name_missing');

    const instructions = {
      owner: stay,
      rules: [
        {
          destinationFolioId: accommodation.folioId,
          chargeCodeGroups: ['room', 'package'],
          serviceDates: { from: '2026-11-06', to: '2026-11-09' },
          source: 'company_default' as const,
        },
      ],
    };
    const first = await org.run((tx) => port.setBillingRules(tx, instructions), agent);
    const again = await org.run((tx) => port.setBillingRules(tx, instructions), agent);
    expect(again.ruleIds).toEqual(first.ruleIds);
    await expect(
      org.run(
        (tx) =>
          port.setBillingRules(tx, {
            owner: stay,
            rules: [
              { destinationFolioId: accommodation.folioId, chargeCodeGroups: ['rooms'], source: 'manual' },
            ],
          }),
        agent,
      ),
    ).rejects.toMatchObject({ code: 'unknown_charge_group' });

    // Room night (posted by the nightly run) goes to the company; the early-departure penalty (CXL, group
    // 'penalty') stays with the guest; a service date before the business date carries reservations' reason.
    await org.run((tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: stayId },
        chargeCode: 'ROOM',
        amount: usd(20000),
        serviceDate: '2026-11-06',
        description: 'Room night',
        sourceRef: stay,
        idempotencyKey: `room:${stayId}:2026-11-06`,
        reason: 'Nightly posting',
      }),
    );
    const penalty = await org.run(
      (tx) =>
        port.postCharge(tx, {
          propertyId: org.propertyId,
          target: stay,
          chargeCode: 'CXL',
          amount: usd(15000),
          serviceDate: '2026-11-06',
          description: 'Early departure charge per agreed terms (booking B-1)',
          sourceRef: stay,
          idempotencyKey: `penalty:early_departure:${stayId}:2026-11-08`,
          taxMode: 'compute',
          reason: 'Early departure on business date 2026-11-07',
        }),
      agent,
    );
    expect(penalty.folioId).toBe(incidentals.folioId);
    // Late check-out fee (MISC) on the business date.
    await org.run(
      (tx) =>
        port.postCharge(tx, {
          propertyId: org.propertyId,
          target: stay,
          chargeCode: 'MISC',
          amount: usd(5000),
          serviceDate: '2026-11-07',
          description: 'Late check-out at 16:00 (booking B-1)',
          sourceRef: stay,
          idempotencyKey: `fee:${stayId}:late_check_out`,
          taxMode: 'compute',
        }),
      agent,
    );
    await expect(
      org.run(
        (tx) =>
          port.postCharge(tx, {
            propertyId: org.propertyId,
            target: { type: 'unit', id: newId() },
            chargeCode: 'MISC',
            amount: usd(100),
            serviceDate: '2026-11-07',
            description: 'x',
            sourceRef: stay,
            idempotencyKey: `bad:${stayId}`,
          }),
        agent,
      ),
    ).rejects.toMatchObject({ code: 'invalid_charge_target' });

    const folios = await org.run((tx) => port.listFolios(tx, { owner: stay }), agent);
    expect(folios.map((f) => [f.label ?? null, f.payer, f.isDefault, f.status])).toEqual([
      ['Incidentals', { type: 'profile', id: profileId }, true, 'open'],
      ['Accommodation', { type: 'company', id: companyId }, false, 'open'],
    ]);
    const [guestBalance, companyBalance] = folios.map((f) => f.balance.amountMinor);
    expect(companyBalance).toBe(25740);
    expect(guestBalance).toBeGreaterThan(15000 + 5000);
    expect((await org.run((tx) => port.getFolioBalance(tx, incidentals.folioId), agent)).status).toBe('open');

    // Deposit applied at check-in.
    await org.run(
      (tx) =>
        port.recordDeposit(tx, {
          bookingId,
          amount: usd(11700),
          paymentRef: { type: 'payment', id: newId() },
          idempotencyKey: `dep:${bookingId}`,
          propertyId: org.propertyId,
        }),
      agent,
    );
    expect(await org.run((tx) => port.getDepositBalance(tx, { bookingId }), agent)).toEqual(usd(11700));
    expect(
      await org.run((tx) => port.applyDeposits(tx, { bookingId, toFolioId: incidentals.folioId }), agent),
    ).toEqual({ applied: usd(11700) });
    expect(
      await org.run((tx) => port.applyDeposits(tx, { bookingId, toFolioId: incidentals.folioId }), agent),
    ).toBeUndefined();
    await assertLedgerIntegrity(h, org);
  });

  it('opens a booking folio for booking-level fees and asks for the buyer name before a live invoice', async () => {
    const org = await setupOrg(h);
    const port = financeForReservations(h.finance);
    const agent = org.as(['reservations.booking.cancel']);
    const bookingId = newId();
    const booking = { type: 'booking', id: bookingId };
    const posted = await org.run(
      (tx) =>
        port.postCharge(tx, {
          propertyId: org.propertyId,
          target: booking,
          chargeCode: 'CXL',
          amount: usd(30000),
          serviceDate: '2026-11-07',
          description: 'Charge for cancelling 2 nights per agreed cancellation terms (booking B-2)',
          sourceRef: booking,
          idempotencyKey: `penalty:cancellation:${bookingId}`,
          taxMode: 'compute',
          reason: 'Charge for cancelling 2 nights per agreed cancellation terms',
        }),
      agent,
    );
    const [folio] = await org.run((tx) => port.listFolios(tx, { owner: booking }), agent);
    expect(folio?.folioId).toBe(posted.folioId);
    expect(folio?.balance).toEqual(usd(30000));
    await expect(
      org.run((tx) =>
        h.finance.issueInvoice(tx, { folioId: posted.folioId, idempotencyKey: `inv:${bookingId}` }),
      ),
    ).rejects.toMatchObject({ code: 'buyer_name_required' });
    const doc = await org.run((tx) =>
      h.finance.issueInvoice(tx, {
        folioId: posted.folioId,
        idempotencyKey: `inv2:${bookingId}`,
        payerDetails: { name: 'Marco Bellini' },
      }),
    );
    expect(JSON.stringify(doc)).toContain('Marco Bellini');
    const after = await org.run((tx) => h.finance.getFolio(tx, posted.folioId));
    expect(after.payer.name).toBe('Marco Bellini');
    expect(after.issues.map((i) => i.code)).not.toContain('payer_name_missing');
  });

  it('acts only at the property reservations authorized (ADR-0015)', async () => {
    const org = await setupOrg(h);
    const port = financeForReservations(h.finance);
    const sister = await addProperty(h, org);
    const agent = org.as(['reservations.booking.create']);
    const stayId = newId();
    const folio = await org.run(
      (tx) =>
        port.openFolio(tx, {
          propertyId: org.propertyId,
          owner: { type: 'stay', id: stayId },
          payer: { type: 'profile', id: newId() },
        }),
      agent,
    );
    // Authorized at the sister property: the folio of this property is out of reach.
    await expect(
      org.run(
        (tx) =>
          port.postCharge(tx, {
            propertyId: sister.propertyId,
            folioId: folio.folioId,
            chargeCode: 'MISC',
            amount: usd(1000),
            serviceDate: '2026-11-07',
            description: 'x',
            sourceRef: { type: 'stay', id: stayId },
            idempotencyKey: `x:${stayId}`,
          }),
        agent,
      ),
    ).rejects.toMatchObject({ code: 'folio_property_mismatch' });
    await org.run(
      (tx) =>
        port.recordDeposit(tx, {
          bookingId: stayId,
          amount: usd(500),
          paymentRef: { type: 'payment', id: newId() },
          idempotencyKey: `d:${stayId}`,
          propertyId: org.propertyId,
        }),
      agent,
    );
    await expect(
      org.run(
        (tx) =>
          port.applyDeposits(tx, {
            bookingId: stayId,
            toFolioId: folio.folioId,
            propertyId: sister.propertyId,
          }),
        agent,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await org.run((tx) => h.finance.getFolio(tx, folio.folioId))).postings).toHaveLength(0);
  });
});

describe('reservations tax lines', () => {
  it('maps value-based fees to service charge, quantity-based lines to levies and the rest to tax', () => {
    const line = (kind: 'tax' | 'fee', code: string, basis?: 'percentage' | 'per_person_night') =>
      fromReservationsTaxLine({ code, name: code, kind, amount: usd(100), ...(basis ? { basis } : {}) });
    expect(line('fee', 'service_charge', 'percentage').kind).toBe('service_charge');
    expect(line('tax', 'green_tax', 'per_person_night').kind).toBe('fee');
    expect(line('tax', 'tgst').kind).toBe('tax');
    expect(line('tax', 'tgst').ruleVersionId).toBe('provided:tgst');
  });
});
