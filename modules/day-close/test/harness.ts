/**
 * Integration-test harness for Day Close. REAL providers where they exist on main: platform (business date,
 * policies, data authority, entitlements), rates (sealed agreed terms from real quotes, the posting plan, the
 * Maldives tax pack) and finance (double-entry ledger, postings, allowances, integrity report) with its tax port
 * bound to real rates — the same bindings as apps/api/src/composition.ts. Reservations is a STRICT,
 * Postgres-backed fake (transactional, shared between processes for the SIGKILL test): it serves stays whose terms
 * are real sealed rates terms and records no-shows the way reservations does (penalty from rates' cancellation
 * terms, posted to the stay folio with key `penalty:no_show:{stayId}`). Payments, inventory, operations and
 * integration are small fakes with the providers' shapes and refusal codes.
 */
import { join } from 'node:path';
import { sourcesFromManifests, sql, type TxContext, withTenantTx } from '@portico/db';
import { createFinance, type FinancePorts, type FinanceService, financeManifest, financeProvider } from '@portico/finance';
import { ROLE_TEMPLATES } from '@portico/identity';
import {
  BusinessRuleError,
  type Clock,
  DomainError,
  fixedClock,
  type LocalDate,
  ModuleUnavailableError,
  type Money,
  NotFoundError,
  newId,
  type Occupancy,
  type RequestContext,
  staticAuthorizer,
  systemAuthorizer,
  type TenantEnvironment,
} from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import {
  type Offer,
  type RatesPorts,
  type RatesService,
  ratesManifest,
  ratesService,
  type SeededRates,
  seedResortRates,
  type TermsSnapshot,
} from '@portico/rates';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import {
  createDayCloseService,
  type DayClosePorts,
  type DayCloseService,
  type DueStay,
  dayCloseManifest,
  type ServiceConfig,
  type StayNight,
} from '../src';

export const D = '2026-11-07';
/** 01:00 on 8 Nov in Malé (UTC+5): a typical night-audit moment for business date 7 Nov. */
export const NIGHT = '2026-11-07T20:00:00.000Z';
export const BOOKING_TIME = '2026-11-01T06:00:00.000Z';
/** Test-only seal key (never a production key). */
export const TEST_SEAL_KEY = Buffer.from('day-close-integration-test-seal-key').toString('base64');
export const FIXTURES = join(import.meta.dirname, 'fixtures', 'migrations');

const asSystem = <T extends { authz: unknown }>(tx: T): T => ({ ...tx, authz: systemAuthorizer });

// ───────────────────────────── strict fakes ─────────────────────────────

export class FakePayments {
  pending: Array<{ propertyId: string; type: string; id: string; amountMinor: number; currency: string; since: string }> =
    [];
  /** bookingId → agreed guarantee basis (ADR-0015 Amendment 1). Absent = no agreed guarantee. */
  agreedGuarantee = new Map<string, 'cardholder_supplied' | 'mandate' | 'channel_card'>();
  /** When set, collection is not connected (the composition stub's behaviour). */
  collectionConnected = true;
  housekeepingConnected = false;
  readonly collections: Array<{ stayId: string; amount: Money; key: string }> = [];
}

export class FakeInventory {
  capacityByProperty = new Map<string, number>();
  outOfOrder = 0;
  discrepancies: Array<{ unitTypeId: string; night: LocalDate; sold: number; consumed: number }> = [];
  units = new Map<string, Array<{ id: string; number: string }>>();
}

export class FakeOperations {
  conditions = new Map<string, Array<{ unitId: string; unitNumber: string; condition: string | null; discrepancy: string | null }>>();
}

export class FakeIntegration {
  exceptions: Array<{ propertyId: string; id: string; severity: string; problem: string; nextStep: string; responsibleParty: string; workflow: string | null }> = [];
  exportConnected = false;
  readonly exports: string[] = [];
}

export interface Fakes {
  payments: FakePayments;
  inventory: FakeInventory;
  operations: FakeOperations;
  integration: FakeIntegration;
}

/** Postgres-backed reservations stand-in (dcl_fake.stays), strict about property scope and states. */
function fakeReservations(rates: RatesService, finance: FinanceService): DayClosePorts['reservations'] {
  type Row = {
    id: string;
    property_id: string;
    booking_id: string;
    status: string;
    commercial_type: string;
    arrival: string;
    departure: string;
    unit_type_id: string;
    rate_plan_id: string;
    occupancy: Occupancy;
    segments: Array<{ from: LocalDate; to: LocalDate; terms: TermsSnapshot }>;
    eta: string | null;
    transfer: { mode?: string; scheduledAt?: string; estimatedAt?: string };
    no_show: Record<string, unknown> | null;
  };
  const due = (r: Row): DueStay => ({
    stayId: r.id,
    bookingId: r.booking_id,
    propertyId: r.property_id,
    status: r.status,
    arrival: r.arrival,
    departure: r.departure,
    commercialType: r.commercial_type,
    unitId: null,
    eta: r.eta,
    transfer: {
      mode: r.transfer.mode ?? null,
      scheduledAt: r.transfer.scheduledAt ?? null,
      estimatedAt: r.transfer.estimatedAt ?? null,
    },
  });
  return {
    async listInHouseStaysForNight(tx, input) {
      const { rows } = await sql<Row>`select * from dcl_fake.stays
        where property_id = ${input.propertyId} and status = 'in_house'
          and arrival <= ${input.date}::date and departure > ${input.date}::date order by id`.execute(tx.db);
      const out: StayNight[] = [];
      for (const r of rows) {
        const seg = r.segments.find((s) => input.date >= s.from && input.date < s.to);
        if (!seg) continue;
        out.push({
          stayId: r.id,
          bookingId: r.booking_id,
          propertyId: r.property_id,
          night: input.date,
          arrival: r.arrival,
          departure: r.departure,
          commercialType: r.commercial_type as StayNight['commercialType'],
          unitId: null,
          unitTypeId: r.unit_type_id,
          ratePlanId: r.rate_plan_id,
          occupancy: r.occupancy,
          terms: seg.terms,
        });
      }
      return out;
    },
    async listDueArrivals(tx, input) {
      const { rows } = await sql<Row>`select * from dcl_fake.stays where property_id = ${input.propertyId}
        and status = 'expected' and arrival <= ${input.date}::date order by arrival, id`.execute(tx.db);
      return rows.map(due);
    },
    async listDueDepartures(tx, input) {
      const { rows } = await sql<Row>`select * from dcl_fake.stays where property_id = ${input.propertyId}
        and status = 'in_house' and departure <= ${input.date}::date order by departure, id`.execute(tx.db);
      return rows.map(due);
    },
    async markNoShow(tx, input) {
      const { rows } = await sql<Row>`select * from dcl_fake.stays where id = ${input.stayId} for update`.execute(tx.db);
      const r = rows[0];
      if (!r) throw new NotFoundError('stay', input.stayId);
      if (r.property_id !== input.propertyId)
        throw new BusinessRuleError('stay_other_property', 'This stay belongs to another property.');
      if (r.status === 'no_show') {
        const rec = r.no_show as { penalty: Money; penaltyPostingIds: string[] };
        return { stayId: r.id, penalty: rec.penalty, penaltyPostingIds: rec.penaltyPostingIds, replayed: true };
      }
      if (r.status !== 'expected')
        throw new BusinessRuleError('invalid_stay_transition', `A ${r.status} stay cannot become a no-show.`);
      const bd = await platform.getBusinessDate(tx, r.property_id);
      if (bd < r.arrival)
        throw new BusinessRuleError('no_show_too_early', `The guest is due on ${r.arrival}.`);
      const seg = r.segments[0] as { terms: TermsSnapshot };
      const penalty = rates.evaluateCancellationPenalty(seg.terms, tx.now, { event: 'no_show' }).amount;
      let penaltyPostingIds: string[] = [];
      if (penalty.amountMinor > 0 && r.commercial_type === 'standard') {
        const posted = await financeProvider(finance, 'reservations').postCharge(tx, { propertyId: r.property_id }, {
          propertyId: r.property_id,
          target: { type: 'stay', id: r.id },
          chargeCode: 'CXL',
          amount: penalty,
          serviceDate: r.arrival,
          description: 'No-show charge per agreed terms',
          sourceRef: { type: 'stay', id: r.id },
          idempotencyKey: `penalty:no_show:${r.id}`,
          taxMode: 'compute',
          reason: `No-show for arrival ${r.arrival}`,
        });
        penaltyPostingIds = posted.postingIds;
      }
      await sql`update dcl_fake.stays set status = 'no_show', version = version + 1,
        no_show = ${JSON.stringify({ penalty, penaltyPostingIds, key: input.idempotencyKey })}::jsonb
        where id = ${r.id}`.execute(tx.db);
      return { stayId: r.id, penalty, penaltyPostingIds, replayed: false };
    },
  };
}

/** Rates' allowance entitlements in Day Close's port shape (the same adapter as the composition root). */
export function allowancesOf(terms: unknown) {
  const t = terms as TermsSnapshot;
  return (t.allowances ?? []).map((a) => ({
    inclusionId: a.inclusionId,
    code: a.code,
    name: a.name,
    kind: a.terms.kind,
    period: a.terms.period,
    eligibleChargeCodes: [...a.terms.eligibleChargeCodes],
    remainderPolicy: a.terms.remainderPolicy,
  }));
}

export function financePortsFor(rates: RatesService): FinancePorts {
  return {
    platform: {
      async getProperty(tx, id) {
        const p = await platform.getProperty(asSystem(tx), id);
        return { id: p.id, name: p.name, legalEntityId: p.legalEntityId, baseCurrency: p.baseCurrency, timezone: p.timezone };
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
        };
      },
      assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
    },
    tax: {
      computeTaxesDetailed: (tx, input) => rates.computeTaxesDetailed(tx, input),
      getRulePackStatus: (tx, propertyId) => rates.getRulePackStatus(tx, propertyId),
    },
    payments: { requestCollection: async () => ({ status: 'unavailable' as const }) },
    payers: { describePayer: async () => null },
  };
}

export function buildPorts(rates: RatesService, finance: FinanceService, fakes: Fakes): DayClosePorts {
  const fp = financeProvider(finance, 'dayClose');
  const legalEntityOf = async (tx: TxContext, propertyId: string) =>
    (await platform.getProperty(asSystem(tx), propertyId)).legalEntityId;
  return {
    platform: {
      async getProperty(tx, propertyId) {
        const p = await platform.getProperty(asSystem(tx), propertyId);
        return {
          id: p.id,
          name: p.name,
          profile: p.profile,
          timezone: p.timezone,
          legalEntityId: p.legalEntityId,
          baseCurrency: p.baseCurrency,
          businessDate: p.businessDate,
        };
      },
      getBusinessDate: (tx, propertyId) => platform.getBusinessDate(tx, propertyId),
      advanceBusinessDate: (tx, i) =>
        platform.advanceBusinessDate(tx, i.propertyId, i.expected, { dayCloseRunId: i.dayCloseRunId }),
      async resolvePolicy(tx, propertyId, key) {
        const r = await platform.resolvePolicy(tx, propertyId, key, null as unknown);
        return { value: r.value, source: r.source };
      },
      setPropertyPolicy: (tx, i) =>
        platform.setPolicy(asSystem(tx), {
          key: i.key,
          scopeType: 'property',
          scopeId: i.propertyId,
          value: i.value,
          reason: i.reason,
        }),
      async getDataAuthority(tx, propertyId, domain) {
        const a = await platform.getDataAuthority(tx, propertyId, domain);
        return { authority: a.authority, systemName: a.systemName };
      },
      hasEntitlement: (tx, feature, propertyId) => platform.hasEntitlement(tx, feature, { propertyId }),
      async listProperties(tx) {
        return (await platform.listProperties(asSystem(tx))).map((p) => ({
          id: p.id,
          name: p.name,
          businessDate: p.businessDate,
          timezone: p.timezone,
        }));
      },
      async listDepartments(tx, propertyId) {
        return (await platform.listDepartments(asSystem(tx), propertyId)).map((d) => ({
          id: d.id,
          kind: d.kind,
          name: d.name,
        }));
      },
    },
    reservations: fakeReservations(rates, finance),
    rates: {
      verifyTerms: (terms) => rates.verifyTerms(terms),
      postingPlan: (terms, stayId) => rates.postingPlan(terms as TermsSnapshot, stayId),
      allowances: allowancesOf,
    },
    finance: {
      async postCharge(tx, scope, input) {
        const r = await fp.postCharge(tx, scope, input);
        return { entryId: r.entryId, postingIds: r.postingIds, folioId: r.folioId, replayed: r.replayed };
      },
      async defaultFolio(tx, scope, stayId) {
        const fs = await fp.listFolios(tx, scope, { owner: { type: 'stay', id: stayId } });
        const f = fs.find((x) => x.isDefault) ?? fs[0];
        return f ? { folioId: f.id } : null;
      },
      async grantAllowance(tx, scope, input) {
        const r = await fp.grantAllowance(tx, scope, input);
        return { instanceId: r.instance.id, entryId: r.entryId, replayed: r.replayed };
      },
      async closeAllowances(tx, scope, input) {
        return { closed: (await fp.closeAllowances(tx, scope, input)).closed.length };
      },
      getUnbalancedItems: (tx, scope, businessDate) => fp.getUnbalancedItems(tx, scope, businessDate),
      async integrityReport(tx, scope) {
        return finance.integrityReport(asSystem(tx), await legalEntityOf(tx, scope.propertyId));
      },
      async trialBalance(tx, scope, input) {
        return finance.trialBalance(asSystem(tx), {
          legalEntityId: await legalEntityOf(tx, scope.propertyId),
          asOf: input.asOf,
        });
      },
      dailyRevenue: (tx, scope, input) =>
        finance.dailyRevenue(asSystem(tx), { propertyId: scope.propertyId, businessDate: input.businessDate }),
    },
    payments: {
      async listUnresolved(_tx, input) {
        return {
          pendingVerification: fakes.payments.pending.filter((p) => p.propertyId === input.propertyId),
          recordedUnverified: 0,
          ledgerPending: 0,
          openExceptions: 0,
        };
      },
      async collectAgreedNoShowFee(tx, input) {
        if (!fakes.payments.collectionConnected) throw new ModuleUnavailableError('payments', 'collectAgreedNoShowFee');
        const basis = fakes.payments.agreedGuarantee.get(input.bookingId);
        if (!basis) {
          return {
            outcome: 'not_agreed' as const,
            paymentId: null,
            reason: 'the booking has no card its cardholder supplied for it and no recorded mandate covering a no-show charge.',
            mode: null,
          };
        }
        fakes.payments.collections.push({ stayId: input.stayId, amount: input.amount, key: input.idempotencyKey });
        return {
          outcome: 'requested' as const,
          paymentId: newId(),
          reason: null,
          mode: tx.environment === 'live' ? 'live' : 'simulate',
        };
      },
      async scheduleDueCollections() {
        if (!fakes.payments.housekeepingConnected)
          throw new ModuleUnavailableError('payments', 'scheduleDueCollections');
        return { renewalsScheduled: 0, vccChargesScheduled: 0 };
      },
    },
    inventory: {
      async getAvailability(_tx, input) {
        return [
          {
            unitTypeId: 'all',
            date: input.date,
            capacity: fakes.inventory.capacityByProperty.get(input.propertyId) ?? 0,
            outOfOrder: fakes.inventory.outOfOrder,
            sold: 0,
            houseUse: 0,
            composite: false,
          },
        ];
      },
      async checkLedgerConsistency() {
        return fakes.inventory.discrepancies;
      },
      async listUnits(_tx, input) {
        return fakes.inventory.units.get(input.propertyId) ?? [];
      },
    },
    operations: {
      async listUnitConditions(_tx, input) {
        return fakes.operations.conditions.get(input.propertyId) ?? [];
      },
    },
    integration: {
      async listOpenExceptions(_tx, input) {
        return fakes.integration.exceptions.filter((e) => e.propertyId === input.propertyId);
      },
      async queueJournalExport(_tx, input) {
        if (!fakes.integration.exportConnected) throw new ModuleUnavailableError('integration', 'queueJournalExport');
        fakes.integration.exports.push(input.idempotencyKey);
        return { status: 'queued' as const, exportId: newId() };
      },
    },
  };
}

export interface Harness {
  t: TestDatabase;
  clock: ReturnType<typeof fixedClock>;
  rates: RatesService;
  finance: FinanceService;
  fakes: Fakes;
  ports: DayClosePorts;
  service: DayCloseService;
  close(): Promise<void>;
}

export function ratesPortsFor(): RatesPorts {
  return {
    async getProperty(tx, propertyId) {
      const p = await platform.getProperty(asSystem(tx), propertyId);
      return {
        id: p.id,
        countryCode: p.countryCode,
        timezone: p.timezone,
        baseCurrency: p.baseCurrency,
        checkInTime: p.checkInTime,
        classification: p.classification,
      };
    },
    assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
    resolvePolicy: (tx, propertyId, key, defaultValue) => platform.resolvePolicy(tx, propertyId, key, defaultValue),
    getBusinessDate: (tx, propertyId) => platform.getBusinessDate(tx, propertyId),
  };
}

export function harnessSources() {
  return [
    ...sourcesFromManifests([platformManifest, financeManifest, ratesManifest, dayCloseManifest]),
    { module: 'dcl-fake', dir: FIXTURES },
  ];
}

export async function startHarness(config: Partial<ServiceConfig> = {}): Promise<Harness> {
  const clock = fixedClock(BOOKING_TIME);
  const t = await createTestDatabase(harnessSources(), { clock: clock as Clock });
  t.db.pool.on('error', () => {});
  t.admin.pool.on('error', () => {});
  const rates = ratesService(ratesPortsFor(), { termsSealKey: TEST_SEAL_KEY });
  const finance = createFinance(financePortsFor(rates));
  const fakes: Fakes = {
    payments: new FakePayments(),
    inventory: new FakeInventory(),
    operations: new FakeOperations(),
    integration: new FakeIntegration(),
  };
  const ports = buildPorts(rates, finance, fakes);
  const service = createDayCloseService(ports, config);
  return { t, clock, rates, finance, fakes, ports, service, close: () => t.drop() };
}

// ───────────────────────────── organizations, stays ─────────────────────────────

const NIGHT_AUDITOR = ROLE_TEMPLATES.find((r) => r.key === 'night_auditor')?.permissions ?? [];

export interface Org {
  tenantId: string;
  propertyId: string;
  legalEntityId: string;
  admin: RequestContext;
  /** A person with the night-auditor role template at this property. */
  auditor: RequestContext;
  unitTypes: Array<{ id: string; code: string; name: string }>;
  seeded: SeededRates;
  run<T>(fn: (tx: TxContext) => Promise<T>, ctx?: RequestContext): Promise<T>;
  as(permissions: readonly string[], propertyIds?: string[] | 'all', name?: string): RequestContext;
}

export async function setupOrg(
  h: Harness,
  opts: { environment?: TenantEnvironment; code?: string; capacity?: number; businessDate?: LocalDate } = {},
): Promise<Org> {
  const environment = opts.environment ?? 'live';
  const admin = testContext({ environment, actor: { kind: 'user', userId: newId(), displayName: 'Admin' } });
  const run = <T>(fn: (tx: TxContext) => Promise<T>, ctx: RequestContext = admin) => withTenantTx(h.t.db, ctx, fn);
  await run((tx) =>
    platform.provisionOrganization(tx, {
      name: 'Kandu Atoll',
      slug: `kandu-${admin.tenantId.slice(-12)}`,
      environment,
      planCode: 'enterprise',
    }),
  );
  const le = await run((tx) =>
    platform.createLegalEntity(tx, {
      name: 'Kandu Atoll',
      legalName: 'Kandu Atoll Resorts Private Limited',
      taxId: '1000555GST501',
      countryCode: 'MV',
      baseCurrency: 'USD',
      address: { line1: 'Boduthakurufaanu Magu', city: 'Malé' },
    }),
  );
  const property = await run((tx) =>
    platform.createProperty(tx, {
      code: opts.code ?? `K${newId().slice(-6).toUpperCase()}`,
      name: 'Kandu Atoll Resort',
      profile: 'resort',
      legalEntityId: le.id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate: opts.businessDate ?? D,
      classification: { 'mv.establishmentType': 'resort', 'mv.inhabitedIsland': false, 'mv.registeredRooms': 120 },
    }),
  );
  const propertyId = property.id;
  await run(async (tx) => {
    for (const [code, name, kind] of [
      ['FO', 'Front office', 'front_office'],
      ['FIN', 'Finance', 'finance'],
      ['HK', 'Housekeeping', 'housekeeping'],
    ] as const)
      await platform.createDepartment(tx, { propertyId, code, name, kind });
    await h.finance.seedDefaultChargeCodes(tx, propertyId);
    for (const c of [
      { code: 'FB_BREAKFAST', name: 'Breakfast (package)', group: 'food', taxGroup: 'food_beverage' },
      { code: 'FB_ALLINCLUSIVE', name: 'All-inclusive board', group: 'food', taxGroup: 'food_beverage' },
      {
        code: 'FB_ALACARTE',
        name: 'À la carte dining',
        group: 'food',
        taxGroup: 'food_beverage',
        allowanceTags: ['dining'],
      },
      { code: 'ALLOWANCE_DINING', name: 'Dining credit', group: 'allowance', taxGroup: 'food_beverage' },
      { code: 'TRANSFER_SEAPLANE', name: 'Seaplane transfer', group: 'transfer', taxGroup: 'transfer' },
      { code: 'ACTIVITY_EXCURSION', name: 'Excursion', group: 'activity', taxGroup: 'activity' },
    ] as const)
      await h.finance.createChargeCode(tx, { propertyId, ...c } as Parameters<FinanceService['createChargeCode']>[1]);
  });
  const unitTypes = [
    { id: newId(), code: 'BV', name: 'Beach Villa' },
    { id: newId(), code: 'WV', name: 'Water Villa' },
  ];
  const seeded = await run(async (tx) => {
    await h.rates.installTaxTemplate(tx, { template: 'MV' });
    return seedResortRates(h.rates, tx, { propertyId, unitTypes, from: '2026-10-01', days: 400 });
  });
  h.fakes.inventory.capacityByProperty.set(propertyId, opts.capacity ?? 120);
  const as = (permissions: readonly string[], propertyIds: string[] | 'all' = [propertyId], name = 'Staff') => ({
    ...admin,
    actor: { kind: 'user' as const, userId: newId(), displayName: name },
    authz: staticAuthorizer(permissions.map((permission) => ({ permission, propertyIds }))),
    correlationId: newId(),
  });
  return {
    tenantId: admin.tenantId,
    propertyId,
    legalEntityId: le.id,
    admin,
    auditor: as(NIGHT_AUDITOR, [propertyId], 'Night Auditor'),
    unitTypes,
    seeded,
    run,
    as,
  };
}

export interface StayOptions {
  arrival: LocalDate;
  departure: LocalDate;
  status?: 'expected' | 'in_house';
  plan?: 'BAR' | 'AI' | 'BAR-NR';
  occupancy?: Occupancy;
  unitType?: 'BV' | 'WV';
  commercialType?: 'standard' | 'complimentary' | 'house_use';
  transfer?: { mode?: string; scheduledAt?: string; estimatedAt?: string };
  /** Replace the terms (e.g. tampered terms for EC-DCL-015). */
  mutateTerms?: (t: TermsSnapshot) => TermsSnapshot;
}

/** Quote real sealed terms with rates, open the stay folio in finance, and store the stay in the fake. */
export async function addStay(h: Harness, org: Org, o: StayOptions) {
  const stayId = newId();
  const bookingId = newId();
  const unitType = org.unitTypes.find((u) => u.code === (o.unitType ?? 'BV')) ?? org.unitTypes[0];
  const occupancy = o.occupancy ?? { adults: 2, childrenAges: [] };
  const planId = org.seeded.ratePlans[o.plan ?? 'BAR'] as string;
  const quoted = await org.run((tx) =>
    h.rates.quoteDetailed(tx, {
      propertyId: org.propertyId,
      nights: { from: o.arrival, to: o.departure },
      occupancy,
      ratePlanIds: [planId],
      unitTypeIds: [unitType?.id as string],
      bookingDate: '2026-10-15',
    }),
  );
  const offer = quoted.offers[0] as Offer;
  if (!offer?.bookable) throw new Error(`no bookable offer for ${o.plan ?? 'BAR'} ${o.arrival}–${o.departure}`);
  const terms = o.mutateTerms ? o.mutateTerms(offer.terms) : offer.terms;
  await org.run(async (tx) => {
    await h.finance.openFolio(tx, {
      propertyId: org.propertyId,
      owner: { type: 'stay', id: stayId },
      payer: { type: 'guest', id: newId(), name: 'Guest' },
    });
    await sql`insert into dcl_fake.stays (id, tenant_id, property_id, booking_id, status, commercial_type, arrival,
      departure, unit_type_id, rate_plan_id, occupancy, segments, transfer)
      values (${stayId}, ${org.tenantId}, ${org.propertyId}, ${bookingId}, ${o.status ?? 'in_house'},
        ${o.commercialType ?? 'standard'}, ${o.arrival}, ${o.departure}, ${unitType?.id}, ${planId},
        ${JSON.stringify(occupancy)}::jsonb,
        ${JSON.stringify([{ from: o.arrival, to: o.departure, terms }])}::jsonb,
        ${JSON.stringify(o.transfer ?? {})}::jsonb)`.execute(tx.db);
  });
  return { stayId, bookingId, terms, offer };
}

/** Check a stay in (the fake's state change, as reservations' check-in would). */
export async function checkIn(org: Org, stayId: string) {
  await org.run((tx) => sql`update dcl_fake.stays set status = 'in_house' where id = ${stayId}`.execute(tx.db));
}
export async function checkOut(org: Org, stayId: string) {
  await org.run((tx) => sql`update dcl_fake.stays set status = 'checked_out' where id = ${stayId}`.execute(tx.db));
}
export async function extendStay(org: Org, stayId: string, departure: LocalDate) {
  await org.run((tx) =>
    sql`update dcl_fake.stays set departure = ${departure}::date where id = ${stayId}`.execute(tx.db),
  );
}

// ───────────────────────────── assertions over stored state (admin connection) ─────────────────────────────

/** Journal entries per idempotency key for a tenant (finance's ledger; the DCL-I01 ground truth). */
export async function entriesByKey(h: Harness, tenantId: string, prefix: string) {
  const { rows } = await sql<{ idempotency_key: string; n: number }>`
    select idempotency_key, count(*)::int as n from finance.journal_entries
     where tenant_id = ${tenantId} and idempotency_key like ${`${prefix}%`}
     group by idempotency_key`.execute(h.t.admin.kysely);
  return rows;
}

export async function assertBooksBalance(h: Harness, org: Org) {
  const report = await org.run((tx) => h.finance.integrityReport(tx, org.legalEntityId));
  const failed = report.checks.filter((c) => !c.ok);
  if (failed.length) throw new Error(`ledger integrity failed: ${JSON.stringify(failed)}`);
  return report;
}

export async function businessDate(org: Org) {
  return org.run((tx) => platform.getBusinessDate(tx, org.propertyId));
}

export function nightAudit(h: Harness, org: Org) {
  h.clock.set(NIGHT);
  return org.auditor;
}

export { DomainError };
