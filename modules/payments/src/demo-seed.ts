/**
 * Demo data for payments (DemoSeedStep-compatible: `(tx, org) => Promise<void>`). Demo organizations can never
 * reach a real provider (payment.charge is `simulate` in demo), so every legal entity gets a SIMULATED payment
 * account plus a recorded-only "own terminal" account (Route D — the likely Maldives pilot path).
 */
import { type TxContext, typed } from '@portico/db';
import { newId } from '@portico/kernel';
import type { PaymentsDB } from './tables';

export interface DemoOrgLike {
  properties: Array<{ id: string; legalEntityId: string }>;
}

export async function seedPaymentsDemo(tx: TxContext, org: DemoOrgLike): Promise<void> {
  if (tx.environment === 'live')
    throw new Error('Payments demo data is never created in a live organization.');
  const db = typed<PaymentsDB>(tx.db);
  const legalEntities = [...new Set(org.properties.map((p) => p.legalEntityId))];
  for (const le of legalEntities) {
    const simId = newId();
    await db
      .insertInto('payments.accounts')
      .values({
        id: simId,
        tenant_id: tx.tenantId,
        legal_entity_id: le,
        provider: 'simulator',
        external_account_id: `sim_acct_${simId.replace(/-/g, '')}`,
        display_name: 'Card payments (simulated)',
        capabilities: JSON.stringify([
          'hostedCardEntry',
          'authorize',
          'incrementalAuthorize',
          'capture',
          'partialCapture',
          'multiCapture',
          'void',
          'charge',
          'refund',
          'partialRefund',
          'paymentLinks',
          'webhooks',
          'payoutReports',
          'disputes',
          'lookup',
        ]),
        onboarding_status: 'complete',
        country_code: 'MV',
        currencies: ['USD', 'MVR'],
        statement_descriptor: 'DEMO HOTEL',
        status: 'active',
        status_reason: null,
        application_fee_bps: null,
        simulator_controls: JSON.stringify({}),
      })
      .execute();
    await db
      .insertInto('payments.accounts')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        legal_entity_id: le,
        provider: 'external_terminal',
        external_account_id: null,
        display_name: "Hotel's own bank terminal (recorded)",
        capabilities: JSON.stringify(['recordOnly']),
        onboarding_status: 'not_applicable',
        country_code: 'MV',
        currencies: ['USD', 'MVR'],
        statement_descriptor: null,
        status: 'active',
        status_reason: null,
        application_fee_bps: null,
        simulator_controls: JSON.stringify({}),
      })
      .execute();
    await tx.audit({
      action: 'payments.demo.seed',
      target: { type: 'payment_account', id: simId },
      after: { legalEntityId: le, note: 'Simulated + recorded-only accounts for the demo environment' },
    });
  }
}
