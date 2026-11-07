/**
 * Environment safety (ADR-0010, PAY-I06): demo/trial/training can never reach Stripe — even an account
 * configured as Stripe Connect runs on the simulator there; sandbox uses TEST keys only; live refuses simulator
 * accounts; missing credentials never send anything.
 */
import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPaymentsDemo } from '../src';
import { type Harness, setupOrg, standingMandate, startHarness, stripeAccount } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('environment safety', () => {
  it.each(['demo', 'trial', 'training'] as const)(
    '%s: a Stripe Connect account never reaches Stripe',
    async (env) => {
      h.secrets.live = 'sk_live_mustNeverBeUsed';
      h.secrets.sandbox = 'sk_test_mustNeverBeUsed';
      const org = await setupOrg(h, env);
      const svc = h.module.service;
      const stripeId = await stripeAccount(h, org, `acct_${newId().replace(/-/g, '').slice(0, 16)}`);
      const stripe = await org.tx((tx) => svc.tx.getAccount(tx, stripeId));
      expect(stripe.effectiveMode).toBe('simulate');
      // Real-looking tokens are refused where payments are simulated.
      await expect(
        org.tx((tx) =>
          svc.tx.createMethod(tx, {
            accountId: stripe.id,
            propertyId: org.propertyId,
            kind: 'card',
            providerToken: 'pm_1Pq9ZzRealLookingToken',
            owner: { type: 'guest_profile', id: org.payerId },
            mitAgreement: true,
            mandate: standingMandate(org, '2026-11-07T08:00:00.000Z'),
          }),
        ),
      ).rejects.toThrow(/simulator test tokens/);
      const m = await org.tx((tx) =>
        svc.tx.createMethod(tx, {
          accountId: stripe.id,
          propertyId: org.propertyId,
          kind: 'card',
          providerToken: 'pm_card_visa',
          owner: { type: 'guest_profile', id: org.payerId },
          mitAgreement: true,
          mandate: standingMandate(org, '2026-11-07T08:00:00.000Z'),
        }),
      );
      const p = await svc.chargeNow(org.ctx, {
        propertyId: org.propertyId,
        methodId: m.id,
        amount: { amountMinor: 1_000, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        businessKey: newId(),
      });
      expect(p).toMatchObject({
        status: { payment: 'succeeded' },
        mode: 'simulate',
        provenance: 'simulated',
      });
      expect(p.presentation.label).toMatch(/simulated — no real money/);
      expect(h.http.calls).toBe(0);
      h.secrets.live = null;
      h.secrets.sandbox = null;
    },
  );

  it('sandbox: Stripe without TEST keys sends nothing and says why', async () => {
    const org = await setupOrg(h, 'sandbox');
    const svc = h.module.service;
    const stripeId = await stripeAccount(h, org, 'acct_1SandboxHotel');
    const stripe = await org.tx((tx) => svc.tx.getAccount(tx, stripeId));
    expect(stripe.effectiveMode).toBe('sandbox');
    const m = await org.tx((tx) =>
      svc.tx.createMethod(tx, {
        accountId: stripe.id,
        propertyId: org.propertyId,
        kind: 'card',
        providerToken: 'pm_card_visa',
        owner: { type: 'guest_profile', id: org.payerId },
        mitAgreement: true,
        mandate: standingMandate(org, '2026-11-07T08:00:00.000Z'),
      }),
    );
    const charge = () =>
      svc.chargeNow(org.ctx, {
        propertyId: org.propertyId,
        methodId: m.id,
        amount: { amountMinor: 1_000, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        businessKey: newId(),
      });
    // No keys at all → provider_not_configured; nothing sent.
    const p1 = await charge();
    expect(p1.decline?.code).toBe('provider_not_configured');
    // A LIVE key offered to the sandbox environment is refused before any request.
    h.secrets.sandbox = 'sk_live_wrongMode';
    const p2 = await charge();
    expect(p2.decline?.code).toBe('stripe_key_mode_mismatch');
    expect(h.http.calls).toBe(0);
    // With a TEST key the adapter is used (our HTTP spy refuses to reach the network) → unknown, pending.
    h.secrets.sandbox = 'sk_test_ok';
    const p3 = await charge();
    expect(p3.status.payment).toBe('pending_verification');
    expect(h.http.calls).toBe(1);
    h.secrets.sandbox = null;
    h.http.calls = 0;
  });

  it('live: simulator accounts cannot be created, and an injected one is refused at execution', async () => {
    const org = await setupOrg(h, 'live');
    const svc = h.module.service;
    await expect(
      org.tx((tx) =>
        svc.tx.createAccount(tx, {
          legalEntityId: org.legalEntityId,
          provider: 'simulator',
          displayName: 'x',
          currencies: ['USD'],
        }),
      ),
    ).rejects.toThrow(/only available in demo, trial, training and sandbox/);
    // Bypass the service (as a buggy migration might) — execution still refuses.
    const id = newId();
    await sql`insert into payments.accounts (id, tenant_id, legal_entity_id, provider, external_account_id, display_name,
      capabilities, currencies, status) values (${id}, ${org.tenantId}, ${org.legalEntityId}, 'simulator', ${`sim_acct_${id}`},
      'Injected', '["charge"]', '{USD}', 'active')`.execute(h.t.admin.kysely);
    await expect(
      org.tx((tx) =>
        svc.tx.createMethod(tx, {
          accountId: id,
          propertyId: org.propertyId,
          kind: 'card',
          providerToken: 'pm_card_visa',
          owner: { type: 'guest_profile', id: org.payerId },
          mitAgreement: true,
          mandate: standingMandate(org, '2026-11-07T08:00:00.000Z'),
        }),
      ),
    ).resolves.toBeTruthy();
    const methods = await sql<{
      id: string;
    }>`select id from payments.payment_methods where account_id = ${id}`.execute(h.t.admin.kysely);
    await expect(
      svc.chargeNow(org.ctx, {
        propertyId: org.propertyId,
        methodId: methods.rows[0]?.id as string,
        amount: { amountMinor: 1_000, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        businessKey: newId(),
      }),
    ).rejects.toThrow(/cannot be used in the live environment/);
    expect(h.http.calls).toBe(0);
  });

  it('simulator controls are refused for accounts that are not simulated', async () => {
    const org = await setupOrg(h, 'sandbox');
    await expect(
      org.tx((tx) =>
        h.module.service.tx.setSimulatorControls(tx, org.terminalAccountId, { outage: 'refuse' }),
      ),
    ).rejects.toThrow(/Simulator controls only apply/);
  });

  it('demo seed: simulated + recorded-only accounts per legal entity; never in live', async () => {
    const org = await setupOrg(h, 'demo');
    await org.tx((tx) =>
      seedPaymentsDemo(tx, { properties: [{ id: org.propertyId, legalEntityId: org.legalEntityId }] }),
    );
    const accounts = await org.tx((tx) => h.module.service.tx.listAccounts(tx, org.legalEntityId));
    expect(accounts.filter((a) => a.displayName.includes('simulated'))).toEqual([
      expect.objectContaining({ provider: 'simulator', effectiveMode: 'simulate', status: 'active' }),
    ]);
    expect(accounts.some((a) => a.provider === 'external_terminal' && a.effectiveMode === 'recorded')).toBe(
      true,
    );
    const live = await setupOrg(h, 'live');
    await expect(
      live.tx((tx) =>
        seedPaymentsDemo(tx, { properties: [{ id: live.propertyId, legalEntityId: live.legalEntityId }] }),
      ),
    ).rejects.toThrow(/never created in a live organization/);
  });
});
