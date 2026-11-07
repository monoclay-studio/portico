import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

/**
 * Finance through the real composition root: the tax engine is rates (`bindFinanceTax`), payments' LedgerPort is
 * finance (`financeLedgerForPayments`, proven in payments.test.ts) and late-charge collection requests go to
 * payments (`paymentsCollectionsForFinance`).
 */
let h: ApiHarness;
beforeAll(async () => {
  h = await startApi();
});
afterAll(async () => h?.close());

async function setup(name = 'Finance Resort') {
  const org = await signedInOrg(h, name);
  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
    h.app.inject({
      method: 'POST',
      url,
      headers: { ...org.auth, 'idempotency-key': newId(), ...headers },
      payload: payload as object,
    });
  const le = await post('/v1/legal-entities', {
    name: 'Lagoon Resorts',
    legalName: 'Lagoon Resorts Pvt Ltd',
    taxId: 'GST-123',
    countryCode: 'MV',
    baseCurrency: 'USD',
    address: { line1: 'Malé' },
  });
  const prop = await post('/v1/properties', {
    code: `R${newId().slice(-5).toUpperCase()}`,
    name: 'Lagoon Island Resort',
    profile: 'resort',
    legalEntityId: le.json().id,
    countryCode: 'MV',
    timezone: 'Indian/Maldives',
    baseCurrency: 'USD',
    businessDate: '2026-11-07',
  });
  expect(prop.statusCode).toBe(201);
  return { ...org, post, propertyId: prop.json().id as string, legalEntityId: le.json().id as string };
}

describe('finance HTTP API', () => {
  it('opens a folio, posts a charge idempotently, reads with ETag, and explains refusals', async () => {
    const o = await setup();
    const code = await o.post('/v1/finance/charge-codes', {
      propertyId: o.propertyId,
      code: 'TRANSFER',
      name: 'Speedboat transfer',
      group: 'transfer',
      taxGroup: null,
    });
    expect(code.statusCode).toBe(201);
    expect(code.headers.etag).toBe('W/"1"');
    await o.post('/v1/finance/charge-codes', {
      propertyId: o.propertyId,
      code: 'SPA',
      name: 'Spa',
      group: 'spa',
      taxGroup: 'spa',
    });
    const stayId = newId();
    const folio = await o.post('/v1/finance/folios', {
      propertyId: o.propertyId,
      owner: { type: 'stay', id: stayId },
      payer: { type: 'guest', name: 'Nadia Rasheed' },
    });
    expect(folio.statusCode).toBe(201);
    expect(folio.json()).toMatchObject({
      isDefault: true,
      status: { folio: 'open', balance: 'zero' },
      attachedTo: { type: 'stay', id: stayId },
    });

    const key = newId();
    const payload = {
      propertyId: o.propertyId,
      target: { type: 'stay', id: stayId },
      chargeCode: 'TRANSFER',
      amount: { amountMinor: 45000, currency: 'USD' },
      description: 'Speedboat to Malé',
    };
    const first = await o.post('/v1/finance/charges', payload, { 'idempotency-key': key });
    expect(first.statusCode).toBe(201);
    const retry = await o.post('/v1/finance/charges', payload, { 'idempotency-key': key });
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json().entryId).toBe(first.json().entryId);
    const missingKey = await h.app.inject({
      method: 'POST',
      url: '/v1/finance/charges',
      headers: o.auth,
      payload,
    });
    expect(missingKey.json().code).toBe('idempotency_key_required');

    // finance ↔ rates (bindFinanceTax): a taxable charge is taxed by the rates engine with the installed rule pack
    // (Maldives, unverified): TGST 17% on a spa treatment (the service charge applies to rooms and F&B only).
    const install = await o.post('/v1/tax-templates/install', { template: 'MV' });
    expect(install.statusCode).toBe(200);
    const taxed = await o.post('/v1/finance/charges', {
      ...payload,
      chargeCode: 'SPA',
      amount: { amountMinor: 10000, currency: 'USD' },
      description: 'Massage',
    });
    expect(taxed.statusCode).toBe(201);
    const taxedFolio = await h.app.inject({
      method: 'GET',
      url: `/v1/finance/folios/${folio.json().id}`,
      headers: o.auth,
    });
    // 100.00 + TGST 17.00 = 117.00; with the transfer (no tax category) 450.00 → 567.00.
    expect(taxedFolio.json().balance).toEqual({ amountMinor: 56700, currency: 'USD' });

    const read = await h.app.inject({
      method: 'GET',
      url: `/v1/finance/folios/${folio.json().id}`,
      headers: o.auth,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().balance).toEqual({ amountMinor: 56700, currency: 'USD' });
    expect(read.json().allowedActions.map((a: { action: string }) => a.action)).toContain('issueInvoice');
    const etag = read.headers.etag as string;
    const settle = await h.app.inject({
      method: 'POST',
      url: `/v1/finance/folios/${folio.json().id}/settle`,
      headers: { ...o.auth, 'if-match': etag },
    });
    expect(settle.statusCode).toBe(422);
    expect(settle.json()).toMatchObject({ code: 'folio_balance_not_zero' });
    expect(settle.json().detail).toMatch(/Collect a payment/);

    // Live invoices are blocked while the rates rule pack is not adviser-verified (RAT-R26 via getRulePackStatus).
    const inv = await o.post(`/v1/finance/folios/${folio.json().id}/invoices`, {});
    expect(inv.statusCode).toBe(422);
    expect(inv.json().code).toBe('tax_rules_unverified');

    const tb = await h.app.inject({
      method: 'GET',
      url: `/v1/finance/trial-balance?legalEntityId=${o.legalEntityId}`,
      headers: o.auth,
    });
    expect(tb.json()).toMatchObject({ balanced: true, totalDebitMinor: 56700 });
    const search = await h.app.inject({ method: 'GET', url: '/v1/search?q=Nadia', headers: o.auth });
    expect(search.json().items.map((i: { type: string }) => i.type)).toContain('folio');
    const history = await h.app.inject({
      method: 'GET',
      url: `/v1/records/folio/${folio.json().id}/history`,
      headers: o.auth,
    });
    expect(history.statusCode).toBe(200);

    // Another organization cannot see the folio.
    const other = await setup('Other Hotel');
    const peek = await h.app.inject({
      method: 'GET',
      url: `/v1/finance/folios/${folio.json().id}`,
      headers: other.auth,
    });
    expect(peek.statusCode).toBe(404);
  });

  it('rejects a conflicting billing rule with a plain-language explanation', async () => {
    const o = await setup('Rules Resort');
    await o.post('/v1/finance/charge-codes', {
      propertyId: o.propertyId,
      code: 'ROOM',
      name: 'Room',
      group: 'room',
      taxGroup: null,
    });
    const stayId = newId();
    const guest = await o.post('/v1/finance/folios', {
      propertyId: o.propertyId,
      owner: { type: 'stay', id: stayId },
      payer: { type: 'guest', name: 'Guest' },
    });
    const company = await o.post('/v1/finance/folios', {
      propertyId: o.propertyId,
      owner: { type: 'stay', id: stayId },
      payer: { type: 'company', name: 'Acme' },
    });
    const rule = {
      propertyId: o.propertyId,
      owner: { type: 'stay', id: stayId },
      destinationFolioId: company.json().id,
      label: 'Acme pays rooms',
      selector: { chargeGroups: ['room'] },
    };
    expect((await o.post('/v1/finance/billing-rules', rule)).statusCode).toBe(201);
    const dup = await o.post('/v1/finance/billing-rules', {
      ...rule,
      label: 'Again',
      destinationFolioId: guest.json().id,
    });
    expect(dup.statusCode).toBe(422);
    expect(dup.json()).toMatchObject({ code: 'billing_rule_conflict' });
    const preview = await h.app.inject({
      method: 'POST',
      url: '/v1/finance/billing-rules/preview',
      headers: o.auth,
      payload: {
        propertyId: o.propertyId,
        owner: { type: 'stay', id: stayId },
        charges: [
          { chargeCode: 'ROOM', serviceDate: '2026-11-07', amount: { amountMinor: 10000, currency: 'USD' } },
        ],
      },
    });
    expect(preview.json().totalsByFolio).toEqual([
      { folioId: company.json().id, folioName: 'Acme', total: { amountMinor: 10000, currency: 'USD' } },
    ]);
  });
});
