import { sourcesFromManifests, type TxContext, withTenantTx } from '@portico/db';
import { Decimal, type Money, money, newId, type RequestContext, systemAuthorizer } from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import {
  type CollectionRequest,
  createFinance,
  type FinancePorts,
  type FinanceService,
  financeManifest,
  type TaxChargeLine,
  type TaxComputation,
  type TaxLine,
} from '../src';

export interface Harness {
  t: TestDatabase;
  finance: FinanceService;
  ports: FinancePorts;
  collections: CollectionRequest[];
  tax: FakeTax;
}

/** Deterministic fake of the rates tax engine with Maldives-like rules (data in the fake, not in finance). */
export class FakeTax {
  verified = true;
  /** TGST rate by service date (time-of-supply tests change it). */
  tgstRate: (date: string) => string = () => '17';
  greenTaxMinor = 1200;
  calls = 0;

  compute(
    line: TaxChargeLine,
    occupancy?: { adults: number; childrenAges: readonly number[] },
  ): { net: Money; taxes: TaxLine[] } {
    this.calls++;
    const cur = line.amount.currency;
    const tgst = new Decimal(this.tgstRate(line.serviceDate)).div(100);
    const sc = new Decimal('0.10');
    const withSc =
      ['accommodation', 'food_beverage', 'services'].includes(line.taxGroup) &&
      line.chargeGroup !== 'deposit';
    const mk = (
      name: string,
      kind: TaxLine['kind'],
      accountKey: string,
      amount: number,
      rate: string,
      extra: Partial<TaxLine> = {},
    ): TaxLine => ({
      lineId: line.lineId,
      ruleId: `rule-${accountKey}`,
      ruleVersionId: `rule-${accountKey}-v${accountKey === 'tgst' ? this.tgstRate(line.serviceDate) : '1'}`,
      name,
      kind,
      accountKey,
      rate,
      base: line.amount,
      amount: money(amount, cur),
      ...extra,
    });
    const factor = (withSc ? new Decimal(1).plus(sc) : new Decimal(1)).mul(new Decimal(1).plus(tgst));
    let net: number;
    if (line.priceMode === 'inclusive') {
      net = new Decimal(line.amount.amountMinor)
        .div(factor)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toNumber();
    } else {
      net = line.amount.amountMinor;
    }
    const taxes: TaxLine[] = [];
    const scAmt = withSc ? new Decimal(net).mul(sc).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber() : 0;
    if (withSc) taxes.push(mk('Service charge 10%', 'service_charge', 'service_charge', scAmt, '10%'));
    const tgstAmt = new Decimal(net + scAmt).mul(tgst).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    taxes.push(
      mk(
        `TGST ${this.tgstRate(line.serviceDate)}%`,
        'tax',
        'tgst',
        tgstAmt,
        `${this.tgstRate(line.serviceDate)}%`,
      ),
    );
    if (line.priceMode === 'inclusive')
      net = line.amount.amountMinor - taxes.reduce((s, t) => s + t.amount.amountMinor, 0);
    if (line.chargeGroup === 'room' && occupancy) {
      const exempt = occupancy.childrenAges.filter((a) => a < 2).length;
      const guests = occupancy.adults + occupancy.childrenAges.length - exempt;
      const days = line.quantity;
      taxes.push(
        mk('Green Tax', 'fee', 'green_tax', guests * days * this.greenTaxMinor, 'USD 12 per guest-day', {
          units: guests * days,
          exemptUnits: exempt * days,
          rateCategory: 'mv.green_tax.12usd',
        }),
      );
    }
    return { net: money(net, cur), taxes };
  }
}

export async function startHarness(): Promise<Harness> {
  const t = await createTestDatabase(sourcesFromManifests([platformManifest, financeManifest]));
  // Teardown race in the shared harness: pool.end() resolves before clients finish closing, then the forced
  // DROP DATABASE terminates them and the orphaned client emits an unhandled 'error' (FOUNDATION_REQUESTS.md).
  for (const pool of [t.db.pool, t.admin.pool]) pool.on('connect', (client) => client.on('error', () => {}));
  const collections: CollectionRequest[] = [];
  const tax = new FakeTax();
  const asSystem = (tx: TxContext): TxContext => ({ ...tx, authz: systemAuthorizer });
  const ports: FinancePorts = {
    platform: {
      async getProperty(tx, id) {
        const p = await platform.getProperty(asSystem(tx), id);
        return {
          id: p.id,
          name: p.name,
          legalEntityId: p.legalEntityId,
          baseCurrency: p.baseCurrency,
          timezone: p.timezone,
        };
      },
      getBusinessDate: (tx, id) => platform.getBusinessDate(tx, id),
      async getLegalEntity(tx, id) {
        const le = await platform.getLegalEntity(tx, id);
        return {
          id: le.id,
          name: le.name,
          legalName: le.legalName,
          ...(le.taxId ? { taxId: le.taxId } : {}),
          countryCode: le.countryCode,
          baseCurrency: le.baseCurrency,
          ...(le.address ? { address: le.address } : {}),
        };
      },
      assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
    },
    tax: {
      async computeTaxes(_tx, input): Promise<TaxComputation> {
        return { lines: input.lines.map((l) => ({ lineId: l.lineId, ...tax.compute(l, input.occupancy) })) };
      },
      async getRulePackStatus() {
        return { verified: tax.verified, ...(tax.verified ? {} : { note: 'unverified pack (test)' }) };
      },
    },
    payments: {
      async requestCollection(_tx, input) {
        collections.push(input);
        return { status: 'requested' };
      },
    },
  };
  return { t, finance: createFinance(ports), ports, collections, tax };
}

export interface Org {
  ctx: RequestContext;
  tenantId: string;
  legalEntityId: string;
  propertyId: string;
  run<T>(fn: (tx: TxContext) => Promise<T>, ctx?: RequestContext): Promise<T>;
  /** A user context with only the given grants (property-scoped to this property unless 'all'). */
  as(grants: string[], scope?: string[] | 'all'): RequestContext;
}

export async function setupOrg(
  h: Harness,
  opts: { businessDate?: string; currency?: string; country?: string; environment?: 'live' | 'demo' } = {},
): Promise<Org> {
  const ctx = testContext({ environment: opts.environment ?? 'live' });
  const run = <T>(fn: (tx: TxContext) => Promise<T>, c: RequestContext = ctx) => withTenantTx(h.t.db, c, fn);
  await run((tx) =>
    platform.provisionOrganization(tx, {
      name: 'Azure Isles',
      slug: `azure-${ctx.tenantId.slice(-12)}`,
      environment: opts.environment ?? 'live',
      planCode: 'enterprise',
    }),
  );
  const le = await run((tx) =>
    platform.createLegalEntity(tx, {
      name: 'Azure Isles',
      legalName: 'Azure Isles Private Limited',
      taxId: '1000123GST501',
      countryCode: opts.country ?? 'MV',
      baseCurrency: opts.currency ?? 'USD',
      address: { line1: 'Boduthakurufaanu Magu', city: 'Malé' },
    }),
  );
  const p = await run((tx) =>
    platform.createProperty(tx, {
      code: `P${newId().slice(-6).toUpperCase()}`,
      name: 'Azure Atoll Resort',
      profile: 'resort',
      legalEntityId: le.id,
      countryCode: opts.country ?? 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: opts.currency ?? 'USD',
      businessDate: opts.businessDate ?? '2026-11-07',
      classification: { 'mv.establishmentType': 'resort' },
    }),
  );
  await run((tx) => h.finance.seedDefaultChargeCodes(tx, p.id));
  return {
    ctx,
    tenantId: ctx.tenantId,
    legalEntityId: le.id,
    propertyId: p.id,
    run,
    as(grants, scope) {
      return {
        ...ctx,
        actor: { kind: 'user', userId: newId(), displayName: 'Limited User' },
        authz: testContext({
          grants: grants.map((permission) => ({ permission, propertyIds: scope ?? [p.id] })),
        }).authz,
      };
    },
  };
}

export const usd = (amountMinor: number) => money(amountMinor, 'USD');

export async function advanceBusinessDate(org: Org, from: string): Promise<string> {
  return org.run((tx) => platform.advanceBusinessDate(tx, org.propertyId, from));
}

/** Open a stay folio for a guest (default) and optionally a company folio on the same stay. */
export async function openStay(h: Harness, org: Org, opts: { guest?: string; company?: string } = {}) {
  const stayId = newId();
  const guest = await org.run((tx) =>
    h.finance.openFolio(tx, {
      propertyId: org.propertyId,
      owner: { type: 'stay', id: stayId },
      payer: { type: 'guest', id: newId(), name: opts.guest ?? 'Aisha Ibrahim' },
    }),
  );
  const company = opts.company
    ? await org.run((tx) =>
        h.finance.openFolio(tx, {
          propertyId: org.propertyId,
          owner: { type: 'stay', id: stayId },
          payer: { type: 'company', id: newId(), name: opts.company as string },
          label: 'accommodation',
        }),
      )
    : null;
  return { stayId, guestFolioId: guest.folioId, companyFolioId: company?.folioId ?? null };
}

/** Assert the ledger-wide invariants: trial balance balanced and every control account equals its sub-ledger. */
export async function assertLedgerIntegrity(h: Harness, org: Org): Promise<void> {
  const report = await org.run((tx) => h.finance.integrityReport(tx, org.legalEntityId));
  const failed = report.checks.filter((c) => !c.ok);
  if (failed.length) throw new Error(`Ledger integrity failed: ${JSON.stringify(failed)}`);
}
