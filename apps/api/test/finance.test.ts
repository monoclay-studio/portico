import { type FinanceService, financeLedgerForPayments, type TaxPort } from '@portico/finance';
import { newId } from '@portico/kernel';
import type { LedgerPort } from '@portico/payments';
import type { RatesService } from '@portico/rates';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ApiHarness, signedInOrg, startApi } from './helpers';

/**
 * Compile-time proof of the orchestrator's bindings (now that rates and payments are on main): rates' provider
 * functions satisfy finance's TaxPort, and finance's adapter satisfies payments' LedgerPort. `pnpm typecheck`
 * fails if either side drifts. (Bound in composition.ts by the orchestrator together with the API tests that
 * assume the stubs.)
 */
export const bindFinanceTax = (rates: RatesService): TaxPort => ({
  computeTaxesDetailed: (tx, input) => rates.computeTaxesDetailed(tx, input),
  getRulePackStatus: (tx, propertyId) => rates.getRulePackStatus(tx, propertyId),
});
export const bindPaymentsLedger = (finance: FinanceService): LedgerPort => financeLedgerForPayments(finance);

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
      taxGroup: 'services',
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

    // The tax engine is not connected in this deployment: a taxable charge fails honestly, nothing is posted.
    const taxed = await o.post('/v1/finance/charges', {
      ...payload,
      chargeCode: 'SPA',
      description: 'Massage',
    });
    expect(taxed.statusCode).toBe(503);
    expect(taxed.headers['content-type']).toContain('application/problem+json');
    expect(taxed.json()).toMatchObject({ code: 'module_not_available', retryable: true });

    const read = await h.app.inject({
      method: 'GET',
      url: `/v1/finance/folios/${folio.json().id}`,
      headers: o.auth,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().balance).toEqual({ amountMinor: 45000, currency: 'USD' });
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

    // Live invoices are blocked while the tax rule pack is not verified (rates not connected yet).
    const inv = await o.post(`/v1/finance/folios/${folio.json().id}/invoices`, {});
    expect(inv.statusCode).toBe(422);
    expect(inv.json().code).toBe('tax_rules_unverified');

    const tb = await h.app.inject({
      method: 'GET',
      url: `/v1/finance/trial-balance?legalEntityId=${o.legalEntityId}`,
      headers: o.auth,
    });
    expect(tb.json()).toMatchObject({ balanced: true, totalDebitMinor: 45000 });
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
