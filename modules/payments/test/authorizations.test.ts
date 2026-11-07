/**
 * Authorizations (holds) are NOT payments: no ledger posting until a capture succeeds; partial captures,
 * increments, release, expiry; decline messages explain recovery; merchant-initiated charges need the guest's
 * agreement.
 */
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMethod, type Harness, type Org, postings, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function authorize(org: Org, methodId: string, amountMinor: number, ref = { type: 'folio', id: newId() }) {
  const svc = h.module.service;
  const s = await org.tx((tx) =>
    svc.tx.authorize(tx, {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor, currency: 'USD' },
      ref,
      initiator: 'customer',
      businessKey: newId(),
    }),
  );
  await svc.settle(org.ctx, { type: 'authorization', id: s.id });
  return svc.view.authorization(org.ctx, s.id);
}

async function capture(org: Org, authorizationId: string, amountMinor?: number) {
  const svc = h.module.service;
  const s = await org.tx((tx) =>
    svc.tx.capture(tx, {
      authorizationId,
      ...(amountMinor ? { amount: { amountMinor, currency: 'USD' } } : {}),
      businessKey: newId(),
    }),
  );
  await svc.settle(org.ctx, { type: 'payment', id: s.id });
  return svc.view.payment(org.ctx, s.id);
}

describe('authorizations', () => {
  it('a hold is never posted; partial captures post exactly what was collected', async () => {
    const org = await setupOrg(h);
    const methodId = await addMethod(h, org);
    const auth = await authorize(org, methodId, 50_000);
    expect(auth.status.authorization).toBe('authorized');
    expect(auth.presentation.explanation).toMatch(/not a payment/);
    expect(auth.expiresAt).toBeTruthy();
    expect(await postings(h, org)).toHaveLength(0);
    expect(auth.allowedActions.filter((a) => a.enabled).map((a) => a.action)).toEqual(
      expect.arrayContaining(['capture', 'increment', 'void']),
    );

    const c1 = await capture(org, auth.id, 20_000);
    expect(c1.status.payment).toBe('succeeded');
    let a = await h.module.service.view.authorization(org.ctx, auth.id);
    expect(a).toMatchObject({ status: { authorization: 'partially_captured' }, capturedMinor: 20_000, capturableMinor: 30_000 });

    await expect(capture(org, auth.id, 40_000)).rejects.toThrow(/can still be collected/);
    await capture(org, auth.id);
    a = await h.module.service.view.authorization(org.ctx, auth.id);
    expect(a.status.authorization).toBe('captured');
    expect(a.allowedActions.find((x) => x.action === 'capture')).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/already been fully collected/),
    });
    const ledger = await postings(h, org, 'payment');
    expect(ledger.map((p) => p.amount_minor).sort()).toEqual([20_000, 30_000]);
  });

  it('increments and releases holds through the provider', async () => {
    const org = await setupOrg(h);
    const methodId = await addMethod(h, org);
    const auth = await authorize(org, methodId, 10_000);
    const svc = h.module.service;
    await org.tx((tx) => svc.tx.increment(tx, { authorizationId: auth.id, additionalAmount: { amountMinor: 5_000, currency: 'USD' } }));
    await svc.settle(org.ctx, { type: 'authorization', id: auth.id });
    let a = await svc.view.authorization(org.ctx, auth.id);
    expect(a.amount.amountMinor).toBe(15_000);
    await org.tx((tx) => svc.tx.void(tx, { authorizationId: auth.id, reason: 'Guest paid cash at checkout' }));
    await svc.settle(org.ctx, { type: 'authorization', id: auth.id });
    a = await svc.view.authorization(org.ctx, auth.id);
    expect(a.status.authorization).toBe('voided');
    expect(a.presentation.label).toMatch(/released/);
    expect(await postings(h, org)).toHaveLength(0);
  });

  it('expires holds after their validity and says so', async () => {
    const org = await setupOrg(h);
    const methodId = await addMethod(h, org);
    const auth = await authorize(org, methodId, 10_000);
    h.clock.advance(8 * 86_400_000);
    const run = await h.module.service.runReconciliation(org.ctx, { propertyId: org.propertyId });
    expect(run.authorizationsExpired).toBe(1);
    const a = await h.module.service.view.authorization(org.ctx, auth.id);
    expect(a.status.authorization).toBe('expired');
    expect(a.presentation.explanation).toMatch(/no longer guarantees payment/);
    await expect(capture(org, auth.id)).rejects.toThrow(/expired/);
  });

  it('declines explain what happened and what to do next', async () => {
    const org = await setupOrg(h);
    const methodId = await addMethod(h, org, 'pm_card_visa_chargeDeclinedInsufficientFunds');
    const a = await authorize(org, methodId, 10_000);
    expect(a.status.authorization).toBe('failed');
    expect(a.decline).toMatchObject({
      code: 'insufficient_funds',
      message: expect.stringMatching(/insufficient funds/),
      recovery: expect.stringMatching(/payment link|cash|another card/),
    });
    const m2 = await addMethod(h, org, 'pm_card_authenticationRequired');
    const p = await h.module.service.chargeNow(org.ctx, {
      propertyId: org.propertyId,
      methodId: m2,
      amount: { amountMinor: 1_000, currency: 'USD' },
      ref: { type: 'folio', id: newId() },
      initiator: 'customer',
      businessKey: newId(),
    });
    expect(p.status.payment).toBe('failed');
    expect(p.decline?.recovery).toMatch(/payment link/);
    expect(p.presentation).toMatchObject({ tone: 'failure', label: expect.stringMatching(/Not paid/) });
  });

  it('merchant-initiated charges require the guest’s agreement on the saved card', async () => {
    const org = await setupOrg(h);
    const methodId = await addMethod(h, org, 'pm_card_visa', false);
    await expect(
      h.module.service.chargeNow(org.ctx, {
        propertyId: org.propertyId,
        methodId,
        amount: { amountMinor: 1_000, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        initiator: 'merchant',
        businessKey: newId(),
      }),
    ).rejects.toThrow(/Send a payment link instead/);
  });

  it('refuses a payment account of another legal entity (merchant of record)', async () => {
    const org = await setupOrg(h);
    const other = await setupOrg(h);
    // Same tenant? No — another organization's account is invisible (RLS) — and within one organization an
    // account of a different legal entity is refused. Create a second legal entity in the same org:
    const { platform } = await import('@portico/platform');
    const le2 = await org.tx((tx) =>
      platform.createLegalEntity(tx, { name: 'Other Co', legalName: 'Other Co Pvt Ltd', countryCode: 'MV', baseCurrency: 'USD' }),
    );
    const acct = await org.tx((tx) =>
      h.module.service.tx.createAccount(tx, {
        legalEntityId: le2.id,
        provider: 'simulator',
        displayName: 'Other entity',
        currencies: ['USD'],
      }),
    );
    await expect(
      org.tx((tx) =>
        h.module.service.tx.createMethod(tx, {
          accountId: acct.id,
          propertyId: org.propertyId,
          kind: 'card',
          providerToken: 'pm_card_visa',
          owner: { type: 'guest_profile', id: newId() },
          mitAgreement: false,
        }),
      ),
    ).rejects.toThrow(/different legal entity/);
    void other;
  });
});
