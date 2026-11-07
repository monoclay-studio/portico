import type { TxContext } from '@portico/db';
import { ModuleUnavailableError, newId } from '@portico/kernel';
import type { BookingDirectoryPort, PayerDirectoryPort, PaymentsPort, TaxPort } from './ports';
import { seedDefaultChargeCodes } from './service/setup';
import { db, ensureChart } from './service/support';

/**
 * Port stubs for wave-1 modules that are being built in parallel (rates, payments). The orchestrator replaces
 * them with real providers at merge. Tax computation fails loudly (nothing is posted with silently missing
 * taxes); collection requests report 'unavailable' so a late charge still posts and is listed as an exception.
 */
export function unavailableFinancePorts(): {
  bookings: BookingDirectoryPort;
  tax: TaxPort;
  payments: PaymentsPort;
  payers: PayerDirectoryPort;
} {
  return {
    // Without reservations no booking is known: deposits are refused (never bound to the first property that pays).
    bookings: {
      async describeBooking() {
        return null;
      },
    },
    // Without a directory, payers referenced only by id keep a placeholder name (live invoices then ask for it).
    payers: {
      async describePayer() {
        return null;
      },
    },
    tax: {
      async computeTaxesDetailed() {
        throw new ModuleUnavailableError('rates (tax engine)', 'computeTaxesDetailed');
      },
      async getRulePackStatus() {
        return { verified: false, note: 'The tax engine (rates module) is not connected.' };
      },
    },
    payments: {
      async requestCollection() {
        return {
          status: 'unavailable',
          detail: 'The payments module is not connected; arrange collection manually.',
        };
      },
    },
  };
}

/**
 * Demo data step (DemoSeedStep-compatible: `(tx, org) => Promise<void>`): chart of accounts per legal entity,
 * default charge codes per property and default invoice / credit-note series. Demo organizations never charge
 * cards or submit to governments (environment safety).
 */
export async function financeDemoSeed(
  tx: TxContext,
  org: { properties: ReadonlyArray<{ id: string; legalEntityId: string }> },
  opts: { functionalCurrency?: string } = {},
): Promise<void> {
  const entities = new Set(org.properties.map((p) => p.legalEntityId));
  for (const le of entities) {
    await ensureChart(tx, le, opts.functionalCurrency ?? 'USD');
    for (const [kind, prefix] of [
      ['invoice', 'INV-'],
      ['credit_note', 'CN-'],
    ] as const) {
      await db(tx)
        .insertInto('finance.fiscal_series')
        .values({ id: newId(), tenant_id: tx.tenantId, legal_entity_id: le, property_id: null, kind, prefix })
        .onConflict((oc) => oc.columns(['tenant_id', 'legal_entity_id', 'kind', 'prefix']).doNothing())
        .execute();
    }
  }
  for (const p of org.properties) await seedDefaultChargeCodes(tx, p.id);
}
