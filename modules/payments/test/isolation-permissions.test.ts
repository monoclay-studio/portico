/**
 * Isolation and permissions (scenario 17 for payments): another organization can never read or move money on
 * our records, even with ids; users without the permission or property scope are refused; card data is
 * refused at every boundary and the schema has nowhere to store it (PAY-I05).
 */
import { sql, withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paymentMethodInput, recordPaymentInput } from '../src';
import { paymentsSearch } from '../src/search';
import { addMethod, type Harness, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('tenant isolation', () => {
  it('another organization cannot read, refund, capture or search our payments by id', async () => {
    const victim = await setupOrg(h);
    const attacker = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, victim);
    const p = await svc.chargeNow(victim.ctx, {
      propertyId: victim.propertyId,
      methodId,
      amount: { amountMinor: 10_000, currency: 'USD' },
      ref: { type: 'folio', id: newId() },
      initiator: 'customer',
      businessKey: newId(),
    });
    await expect(svc.view.payment(attacker.ctx, p.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      attacker.tx((tx) =>
        svc.tx.refund(tx, {
          paymentId: p.id,
          amount: { amountMinor: 10_000, currency: 'USD' },
          reason: 'x',
          businessKey: newId(),
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(attacker.tx((tx) => svc.tx.getMethod(tx, methodId))).rejects.toMatchObject({ status: 404 });
    // Using the victim's method id in the attacker's org is impossible (RLS hides it).
    await expect(
      svc.chargeNow(attacker.ctx, {
        propertyId: attacker.propertyId,
        methodId,
        amount: { amountMinor: 1, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        initiator: 'customer',
        businessKey: newId(),
      }),
    ).rejects.toMatchObject({ status: 404 });
    const hits = await attacker.tx((tx) => paymentsSearch.search(tx, '4242', { limit: 10 }));
    expect(hits).toEqual([]);
    const own = await victim.tx((tx) => paymentsSearch.search(tx, '4242 100.00', { limit: 10 }));
    expect(own.map((x) => x.id)).toEqual([p.id]);
    expect(own[0]).toMatchObject({
      type: 'payment',
      status: { payment: 'succeeded' },
      matched: 'card last 4 + amount',
    });
  });
});

describe('permissions and property scope', () => {
  it('refuses actions without the permission and outside the property scope', async () => {
    const org = await setupOrg(h);
    const svc = h.module.service;
    const methodId = await addMethod(h, org);
    const base = {
      propertyId: org.propertyId,
      methodId,
      amount: { amountMinor: 5_000, currency: 'USD' },
      ref: { type: 'folio' as const, id: newId() },
      initiator: 'customer' as const,
    };
    // Front desk: collect, but not refund.
    const desk = org.as([
      'payments.payment.collect',
      'payments.paymentRequest.create',
      'platform.property.read',
    ]);
    const paid = await svc.chargeNow(desk, { ...base, businessKey: newId() });
    expect(paid.status.payment).toBe('succeeded');
    expect(paid.allowedActions.find((a) => a.action === 'refund')).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/payments\.payment\.refund/),
    });
    await expect(
      withTenantTx(h.db, desk, (tx) =>
        svc.tx.refund(tx, {
          paymentId: paid.id,
          amount: { amountMinor: 100, currency: 'USD' },
          reason: 'x',
          businessKey: newId(),
        }),
      ),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    // Scoped to the OTHER property: cannot collect here or read this payment.
    const elsewhere = org.as(['payments.payment.collect', 'payments.payment.read'], [org.otherPropertyId]);
    await expect(svc.chargeNow(elsewhere, { ...base, businessKey: newId() })).rejects.toMatchObject({
      status: 403,
    });
    await expect(svc.view.payment(elsewhere, paid.id)).rejects.toMatchObject({ status: 403 });
    // Read-only staff see it but cannot collect.
    const reader = org.as(['payments.payment.read']);
    expect((await svc.view.payment(reader, paid.id)).id).toBe(paid.id);
    await expect(svc.chargeNow(reader, { ...base, businessKey: newId() })).rejects.toMatchObject({
      status: 403,
    });
    // Account management is organization-level and sensitive.
    await expect(
      withTenantTx(h.db, desk, (tx) =>
        svc.tx.createAccount(tx, {
          legalEntityId: org.legalEntityId,
          provider: 'external_terminal',
          displayName: 'x',
          currencies: ['USD'],
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    // Data authority: when another system owns payments here, Portico refuses to collect and explains.
    await h.t.admin.kysely.transaction().execute(async (trx) => {
      await sql`insert into platform.data_authority (id, tenant_id, property_id, domain, authority, connection_id, system_name,
        write_mode, effective_from, updated_by, reason)
        values (${newId()}, ${org.tenantId}, ${org.propertyId}, 'payments', 'external', ${newId()}, 'Legacy PMS', 'read_only',
        now(), 'test', 'connected mode')`.execute(trx);
    });
    await expect(svc.chargeNow(org.ctx, { ...base, businessKey: newId() })).rejects.toMatchObject({
      code: 'external_system_of_record',
    });
  });
});

describe('card data never enters Portico (PAY-I05)', () => {
  it('rejects card numbers and verification codes at the API boundary', () => {
    const base = {
      accountId: newId(),
      propertyId: newId(),
      kind: 'card',
      owner: { type: 'guest_profile', id: newId() },
      mitAgreement: false,
    };
    expect(paymentMethodInput.safeParse({ ...base, providerToken: '4242 4242 4242 4242' }).success).toBe(
      false,
    );
    expect(
      paymentMethodInput.safeParse({ ...base, providerToken: 'pm_card_visa', cardNumber: '4242424242424242' })
        .success,
    ).toBe(false);
    expect(paymentMethodInput.safeParse({ ...base, providerToken: 'pm_card_visa', cvc: '123' }).success).toBe(
      false,
    );
    expect(
      paymentMethodInput.safeParse({
        ...base,
        providerToken: 'pm_card_visa',
        holderName: 'A 4000056655665556',
      }).success,
    ).toBe(false);
    expect(paymentMethodInput.safeParse({ ...base, providerToken: 'pm_card_visa' }).success).toBe(true);
    expect(
      recordPaymentInput.safeParse({
        propertyId: newId(),
        method: 'external_terminal',
        amount: { amountMinor: 1, currency: 'USD' },
        ref: { type: 'folio', id: newId() },
        reference: '4111111111111111',
        receivedAt: new Date(0).toISOString(),
      }).success,
    ).toBe(false);
  });

  it('the database refuses PAN-shaped tokens and has no column that could hold card data', async () => {
    const org = await setupOrg(h);
    await expect(
      sql`insert into payments.payment_methods (id, tenant_id, account_id, property_id, kind, provider_token, owner_type, owner_id)
        values (${newId()}, ${org.tenantId}, ${org.simAccountId}, ${org.propertyId}, 'card', '4242 4242 4242 4242', 'guest_profile', ${newId()})`.execute(
        h.t.admin.kysely,
      ),
    ).rejects.toThrow(/check constraint/);
    const { rows } = await sql<{ table_name: string; column_name: string }>`
      select table_name, column_name from information_schema.columns where table_schema = 'payments'`.execute(
      h.t.admin.kysely,
    );
    const forbidden = rows.filter((r) =>
      /(^pan$|card_?number|^number$|cvc|cvv|security_code|track)/i.test(r.column_name),
    );
    expect(forbidden).toEqual([]);
  });

  it('audit history never contains provider tokens', async () => {
    const org = await setupOrg(h);
    await addMethod(h, org, 'pm_card_mastercard');
    const { rows } = await sql<{ after: unknown }>`
      select after from core.audit_log where tenant_id = ${org.tenantId} and action = 'payments.method.create'`.execute(
      h.t.admin.kysely,
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.after)).not.toContain('pm_card_mastercard');
  });
});
