/**
 * Test harness: one migrated database with the REAL providers that exist on main — platform (properties, data
 * authority, authority transitions, trials), inventory (unit types, units, availability ledger), guests (profiles,
 * duplicate scoring), finance (opening deposits through migration suspense), rates (rate plans) and integration's
 * PMS simulator — plus STRICT Postgres-backed fakes for the contracts migration requested and that do not exist yet
 * (reservations' migration import MIG-CR-1, finance's in-house/AR opening balances MIG-CR-3/4, payments' card
 * re-collection MIG-CR-5). The fakes run in the caller's transaction (rollback-consistent), enforce data authority
 * and integrity like a provider must (ADR-0015), and the reservations fake consumes the REAL inventory, so "no double
 * inventory" is proven against the real ledger.
 */
import { randomBytes } from 'node:crypto';
import { type Generated, sourcesFromManifests, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import {
  createFinance,
  type FinanceService,
  financeManifest,
  unavailableFinancePorts,
} from '@portico/finance';
import { createGuestsService, type GuestsService, guestsManifest } from '@portico/guests';
import { integrationManifest, PmsSimulatorHub } from '@portico/integration';
import { createInventoryService, type InventoryService, inventoryManifest } from '@portico/inventory';
import {
  assertExternalEffectAllowed,
  BusinessRuleError,
  type Clock,
  fieldCryptoFromEnv,
  NotFoundError,
  newId,
  type RequestContext,
  systemAuthorizer,
  type TenantEnvironment,
  ValidationError,
} from '@portico/kernel';
import { type PlatformPorts, platform, platformManifest } from '@portico/platform';
import { ratesManifest, ratesService } from '@portico/rates';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import {
  createRehearsalBridge,
  type ImportedBookingView,
  type MigratedBookingInput,
  type MigrationDeps,
  type MigrationPorts,
  migrationManifest,
} from '../src';

export const asSystem = <T extends { authz: unknown }>(tx: T): T => ({ ...tx, authz: systemAuthorizer });
const asMigrationProcess = (tx: TxContext): TxContext => ({
  ...tx,
  actor: { kind: 'system', process: 'migration' },
  authz: systemAuthorizer,
});

// ───────────────────────────── strict fakes for the requested contracts ─────────────────────────────

const FAKE_SCHEMA = `
create schema fake_providers;
create table fake_providers.bookings (
  id uuid primary key, tenant_id uuid not null, property_id uuid not null, source_system text not null,
  source_key text not null, source_version text not null, status text not null, arrival date not null,
  departure date not null, unit_type_id uuid not null, unit_id uuid, guest_profile_id uuid, guest_name text not null,
  terms jsonb not null, version int not null default 1,
  unique (tenant_id, property_id, source_system, source_key));
create table fake_providers.folio_openings (
  tenant_id uuid not null, property_id uuid not null, booking_id uuid not null, folio_ref text not null,
  balance_minor bigint not null, currency text not null, import_ref text not null,
  primary key (tenant_id, booking_id, folio_ref));
create table fake_providers.ar_openings (
  tenant_id uuid not null, property_id uuid not null, account_code text not null, invoice_ref text not null,
  open_minor bigint not null, currency text not null, invoice_date date not null, due_date date,
  primary key (tenant_id, property_id, account_code, invoice_ref));
create table fake_providers.card_requests (
  tenant_id uuid not null, idempotency_key text not null, booking_id uuid not null, status text not null,
  primary key (tenant_id, idempotency_key));
`;

async function createFakeSchema(t: TestDatabase) {
  await sql.raw(FAKE_SCHEMA).execute(t.admin.kysely);
  for (const table of ['bookings', 'folio_openings', 'ar_openings', 'card_requests'])
    await sql.raw(`select core.enable_tenant_isolation('fake_providers.${table}')`).execute(t.admin.kysely);
  await sql.raw(`select core.apply_standard_grants('fake_providers')`).execute(t.admin.kysely);
}

interface FakeDb {
  'fake_providers.bookings': {
    id: string;
    tenant_id: string;
    property_id: string;
    source_system: string;
    source_key: string;
    source_version: string;
    status: string;
    arrival: string;
    departure: string;
    unit_type_id: string;
    unit_id: string | null;
    guest_profile_id: string | null;
    guest_name: string;
    terms: unknown;
    version: Generated<number>;
  };
  'fake_providers.folio_openings': {
    tenant_id: string;
    property_id: string;
    booking_id: string;
    folio_ref: string;
    balance_minor: string | number;
    currency: string;
    import_ref: string;
  };
  'fake_providers.ar_openings': {
    tenant_id: string;
    property_id: string;
    account_code: string;
    invoice_ref: string;
    open_minor: string | number;
    currency: string;
    invoice_date: string;
    due_date: string | null;
  };
  'fake_providers.card_requests': {
    tenant_id: string;
    idempotency_key: string;
    booking_id: string;
    status: string;
  };
}
const fdb = (tx: TxContext) => typed<FakeDb>(tx.db);

const ACTIVE = new Set(['confirmed', 'tentative', 'in_house']);

/** Strict fake of MIG-CR-1 (reservations.importBooking / listImported) on the REAL inventory. */
export class FakeReservations {
  /** Fault injection: refuse the n-th import with an unexpected error (simulated crash), counted per harness. */
  crashOnCall: number | null = null;
  calls = 0;
  constructor(private readonly inventory: InventoryService) {}

  async importBooking(tx: TxContext, input: MigratedBookingInput) {
    this.calls++;
    if (this.crashOnCall !== null && this.calls === this.crashOnCall)
      throw new Error('simulated process crash during the reservations import');
    // Data authority (rule 15): a migration import writes only where Portico may write.
    await platform.assertWritable(tx, input.propertyId, 'reservations');
    const type = await this.inventory.getUnitType(asSystem(tx), input.unitTypeId).catch(() => null);
    if (!type || type.propertyId !== input.propertyId) throw new NotFoundError('unit_type', input.unitTypeId);
    const t = input.terms;
    const taxes = t.taxes.reduce((s, x) => s + x.amountMinor, 0);
    if (t.totalMinor !== (t.taxInclusive ? t.roomTotalMinor : t.roomTotalMinor + taxes))
      throw new ValidationError(
        'terms_inconsistent',
        'The agreed total is not the room total plus the stated taxes.',
      );
    if (t.nightly && t.nightly.reduce((s, n) => s + n.amountMinor, 0) !== t.roomTotalMinor)
      throw new ValidationError('terms_inconsistent', 'Nightly prices do not add up to the room total.');
    const existing = await fdb(tx)
      .selectFrom('fake_providers.bookings')
      .selectAll()
      .where('property_id', '=', input.propertyId)
      .where('source_system', '=', input.sourceSystem)
      .where('source_key', '=', input.sourceKey)
      .forUpdate()
      .executeTakeFirst();
    if (existing?.source_version === input.sourceVersion)
      return { bookingId: existing.id, outcome: 'unchanged' as const, inventoryConflictIds: [] };
    const id = existing?.id ?? newId();
    const ref = { type: 'booking', id };
    if (existing && ACTIVE.has(existing.status)) await this.inventory.release(asSystem(tx), { ref });
    const conflicts: string[] = [];
    if (ACTIVE.has(input.status)) {
      const r = await this.inventory.consume(asSystem(tx), {
        propertyId: input.propertyId,
        unitTypeId: input.unitTypeId,
        nights: { from: input.arrival, to: input.departure },
        quantity: 1,
        ref,
        onShortfall: 'record_conflict',
      });
      conflicts.push(...r.conflictIds);
    }
    const row = {
      status: input.status,
      arrival: input.arrival,
      departure: input.departure,
      unit_type_id: input.unitTypeId,
      unit_id: input.unitId,
      guest_profile_id: input.guestProfileId,
      guest_name: input.guestName,
      source_version: input.sourceVersion,
      terms: JSON.stringify(input.terms),
    };
    if (existing)
      await fdb(tx)
        .updateTable('fake_providers.bookings')
        .set({ ...row, version: sql`version + 1` })
        .where('id', '=', id)
        .execute();
    else
      await fdb(tx)
        .insertInto('fake_providers.bookings')
        .values({
          id,
          tenant_id: tx.tenantId,
          property_id: input.propertyId,
          source_system: input.sourceSystem,
          source_key: input.sourceKey,
          ...row,
        })
        .execute();
    return {
      bookingId: id,
      outcome: existing ? ('updated' as const) : ('created' as const),
      inventoryConflictIds: conflicts,
    };
  }

  async listImported(
    tx: TxContext,
    input: { propertyId: string; sourceSystem: string },
  ): Promise<ImportedBookingView[]> {
    const rows = await fdb(tx)
      .selectFrom('fake_providers.bookings')
      .selectAll()
      .where('property_id', '=', input.propertyId)
      .where('source_system', '=', input.sourceSystem)
      .execute();
    return rows.map((r) => {
      const t = r.terms as MigratedBookingInput['terms'];
      return {
        sourceKey: r.source_key,
        bookingId: r.id,
        status: r.status,
        arrival: r.arrival,
        departure: r.departure,
        unitTypeId: r.unit_type_id,
        currency: t.currency,
        roomTotalMinor: t.roomTotalMinor,
        taxTotalMinor: t.taxes.reduce((s, x) => s + x.amountMinor, 0),
        totalMinor: t.totalMinor,
        nightly: t.nightly,
      };
    });
  }

  async count(tx: TxContext, propertyId: string): Promise<number> {
    const r = await fdb(tx)
      .selectFrom('fake_providers.bookings')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('property_id', '=', propertyId)
      .executeTakeFirst();
    return Number(r?.n ?? 0);
  }
}

/** Strict fake of MIG-CR-3/4 (finance in-house folio and receivables opening balances). */
export const fakeFinanceOpenings = {
  async importOpeningFolioBalances(
    tx: TxContext,
    input: {
      propertyId: string;
      importRef: string;
      items: Array<{ bookingId: string; folioRef: string; balanceMinor: number; currency: string }>;
    },
  ) {
    await platform.assertWritable(tx, input.propertyId, 'accounting');
    const rejected: Array<{ bookingId: string; reason: string }> = [];
    let importedCount = 0;
    for (const it of input.items) {
      const b = await fdb(tx)
        .selectFrom('fake_providers.bookings')
        .select(['property_id', 'status'])
        .where('id', '=', it.bookingId)
        .executeTakeFirst();
      if (!b || b.property_id !== input.propertyId) {
        rejected.push({ bookingId: it.bookingId, reason: 'The booking is not at this property.' });
        continue;
      }
      if (b.status !== 'in_house') {
        rejected.push({
          bookingId: it.bookingId,
          reason: 'Only in-house stays carry an open folio balance.',
        });
        continue;
      }
      const r = await fdb(tx)
        .insertInto('fake_providers.folio_openings')
        .values({
          tenant_id: tx.tenantId,
          property_id: input.propertyId,
          booking_id: it.bookingId,
          folio_ref: it.folioRef,
          balance_minor: it.balanceMinor,
          currency: it.currency,
          import_ref: input.importRef,
        })
        .onConflict((oc) => oc.columns(['tenant_id', 'booking_id', 'folio_ref']).doNothing())
        .executeTakeFirst();
      if (Number(r.numInsertedOrUpdatedRows ?? 0) > 0) importedCount++;
    }
    return { importedCount, rejected };
  },
  async folioOpeningBalances(tx: TxContext, input: { propertyId: string; bookingIds: string[] }) {
    if (input.bookingIds.length === 0) return [];
    const rows = await fdb(tx)
      .selectFrom('fake_providers.folio_openings')
      .selectAll()
      .where('property_id', '=', input.propertyId)
      .where('booking_id', 'in', input.bookingIds)
      .execute();
    return rows.map((r) => ({
      bookingId: r.booking_id,
      folioRef: r.folio_ref,
      balanceMinor: Number(r.balance_minor),
      currency: r.currency,
    }));
  },
  async importOpeningReceivables(
    tx: TxContext,
    input: {
      propertyId: string;
      importRef: string;
      items: Array<{
        accountCode: string;
        invoiceRef: string;
        invoiceDate: string;
        dueDate: string | null;
        openMinor: number;
        currency: string;
      }>;
    },
  ) {
    await platform.assertWritable(tx, input.propertyId, 'accounting');
    let importedCount = 0;
    for (const it of input.items) {
      const r = await fdb(tx)
        .insertInto('fake_providers.ar_openings')
        .values({
          tenant_id: tx.tenantId,
          property_id: input.propertyId,
          account_code: it.accountCode,
          invoice_ref: it.invoiceRef,
          open_minor: it.openMinor,
          currency: it.currency,
          invoice_date: it.invoiceDate,
          due_date: it.dueDate,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'property_id', 'account_code', 'invoice_ref']).doNothing(),
        )
        .executeTakeFirst();
      if (Number(r.numInsertedOrUpdatedRows ?? 0) > 0) importedCount++;
    }
    return { importedCount, rejected: [] };
  },
  async receivableOpenItems(tx: TxContext, input: { propertyId: string }) {
    const rows = await fdb(tx)
      .selectFrom('fake_providers.ar_openings')
      .selectAll()
      .where('property_id', '=', input.propertyId)
      .execute();
    return rows.map((r) => ({
      accountCode: r.account_code,
      invoiceRef: r.invoice_ref,
      openMinor: Number(r.open_minor),
      currency: r.currency,
    }));
  },
};

// ───────────────────────────── harness ─────────────────────────────

export interface Harness {
  t: TestDatabase;
  deps: MigrationDeps;
  inventory: InventoryService;
  guests: GuestsService;
  finance: FinanceService;
  hub: PmsSimulatorHub;
  reservations: FakeReservations;
  platformPorts: PlatformPorts;
  close(): Promise<void>;
}

export function migrationPorts(h: {
  inventory: InventoryService;
  guests: GuestsService;
  finance: FinanceService;
  rates: ReturnType<typeof ratesService>;
  hub: PmsSimulatorHub;
  reservations: FakeReservations;
  platformPorts: PlatformPorts;
}): Omit<MigrationPorts, 'rehearsal'> {
  return {
    platform: {
      async getProperty(tx, id) {
        const p = await platform.getProperty(asSystem(tx), id);
        return {
          id: p.id,
          name: p.name,
          timezone: p.timezone,
          baseCurrency: p.baseCurrency,
          businessDate: p.businessDate,
          status: p.status,
        };
      },
      getDataAuthority: (tx, propertyId, domain) => platform.getDataAuthority(tx, propertyId, domain),
      async declareExternalAuthority(tx, i) {
        await platform.setDataAuthority(asMigrationProcess(tx), {
          propertyId: i.propertyId,
          domain: i.domain,
          authority: 'external',
          connectionId: i.connectionId,
          systemName: i.systemName,
          writeMode: 'read_only',
          reason: i.reason,
        });
      },
      async planTransition(tx, i) {
        const t = await platform.planAuthorityTransition(asSystem(tx), i.propertyId, {
          changes: i.changes,
          reason: i.reason,
          rollbackCriteria: i.rollbackCriteria,
          freezeMinutes: i.freezeMinutes,
          ...(i.plannedStartAt ? { plannedStartAt: i.plannedStartAt } : {}),
        });
        return {
          id: t.id,
          status: t.status,
          approvalRequired: t.approvalRequired,
          approvedBy: t.approvedBy,
          plannedBy: t.plannedBy,
        };
      },
      async getTransition(tx, propertyId, id) {
        const t = (await platform.listAuthorityTransitions(asSystem(tx), propertyId)).find(
          (x) => x.id === id,
        );
        return t
          ? {
              id: t.id,
              status: t.status,
              approvalRequired: t.approvalRequired,
              approvedBy: t.approvedBy,
              plannedBy: t.plannedBy,
            }
          : null;
      },
      async approveTransition(tx, id, note) {
        const t = await platform.approveAuthorityTransition(asSystem(tx), id, note);
        return {
          id: t.id,
          status: t.status,
          approvalRequired: t.approvalRequired,
          approvedBy: t.approvedBy,
          plannedBy: t.plannedBy,
        };
      },
      async freezeTransition(tx, id) {
        const t = await platform.freezeAuthorityTransition(asSystem(tx), id);
        return {
          id: t.id,
          status: t.status,
          approvalRequired: t.approvalRequired,
          approvedBy: t.approvedBy,
          plannedBy: t.plannedBy,
        };
      },
      async completeTransition(tx, id) {
        const t = await platform.completeAuthorityTransition(asSystem(tx), h.platformPorts, id);
        return {
          id: t.id,
          status: t.status,
          approvalRequired: t.approvalRequired,
          approvedBy: t.approvedBy,
          plannedBy: t.plannedBy,
        };
      },
      async cancelTransition(tx, id, reason) {
        await platform.cancelAuthorityTransition(asSystem(tx), id, reason);
      },
      assertWorkflowInScope: (tx, propertyId, workflow) =>
        platform.assertWorkflowInScope(tx, propertyId, workflow),
      async trialSourceOrganization(tx) {
        const info = await platform.getEnvironmentInfo(asSystem(tx));
        return info.trial
          ? { organizationId: info.trial.sourceOrganizationId, status: info.trial.status }
          : null;
      },
      recordTrialImport: (tx, i) => platform.recordTrialImport(asSystem(tx), i),
    },
    inventory: {
      listUnitTypes: async (tx, propertyId) =>
        (await h.inventory.listUnitTypes(asSystem(tx), propertyId)).map((u) => ({
          id: u.id,
          code: u.code,
          name: u.name,
        })),
      async createUnitType(tx, propertyId, i) {
        const u = await h.inventory.createUnitType(asSystem(tx), propertyId, {
          code: i.code,
          name: i.name,
          kind: 'room',
          baseOccupancy: i.baseOccupancy,
          maxAdults: i.maxOccupancy,
          maxChildren: Math.max(0, i.maxOccupancy - 1),
          maxOccupancy: i.maxOccupancy,
        });
        return { id: u.id };
      },
      listUnits: async (tx, propertyId) =>
        (await h.inventory.listUnits(asSystem(tx), propertyId)).map((u) => ({
          id: u.id,
          number: u.number,
          unitTypeId: u.unitTypeId,
        })),
      async createUnit(tx, propertyId, i) {
        const u = await h.inventory.createUnit(asSystem(tx), propertyId, {
          unitTypeId: i.unitTypeId,
          number: i.number,
          ...(i.name ? { name: i.name } : {}),
          ...(i.inInventoryFrom ? { inInventoryFrom: i.inInventoryFrom } : {}),
        });
        return { id: u.id };
      },
      sold: async (tx, i) =>
        (
          await h.inventory.getAvailability(asSystem(tx), {
            propertyId: i.propertyId,
            range: { from: i.from, to: i.to },
          })
        ).map((c) => ({ unitTypeId: c.unitTypeId, date: c.date, sold: c.sold })),
    },
    rates: {
      listRatePlans: async (tx, propertyId) =>
        (await h.rates.listRatePlans(asSystem(tx), { propertyId })).map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
        })),
    },
    guests: {
      async importProfile(tx, i) {
        const contactPoints = [
          ...(i.email ? [{ kind: 'email' as const, value: i.email, source: 'migration' }] : []),
          ...(i.phone ? [{ kind: 'phone' as const, value: i.phone, source: 'migration' }] : []),
        ];
        const r = await h.guests.resolveProfile(
          asSystem(tx),
          {
            propertyId: i.propertyId,
            familyName: i.familyName,
            ...(i.givenName ? { givenName: i.givenName } : {}),
            ...(i.nationality ? { nationality: i.nationality } : {}),
            ...(i.dateOfBirth ? { dateOfBirth: i.dateOfBirth } : {}),
            ...(contactPoints.length ? { contactPoints } : {}),
            source: { kind: 'migration', ref: `${i.sourceSystem}:${i.sourceKey}`.slice(0, 200) },
          },
          { matchStrategy: 'suggest' },
        );
        return {
          profileId: r.profileId,
          created: r.created,
          possibleDuplicates: r.suggestions.map((s) => ({
            profileId: s.profileId,
            score: s.score,
            band: s.band,
            reasons: s.reasons.map((x) => x.detail),
          })),
        };
      },
      existing: async (tx, i) => [
        ...(await h.guests.visibleProfileIds(asSystem(tx), i.profileIds, { propertyId: i.propertyId })),
      ],
    },
    reservations: {
      importBooking: (tx, i) => h.reservations.importBooking(tx, i),
      listImported: (tx, i) => h.reservations.listImported(tx, i),
    },
    finance: {
      async importOpeningDeposits(tx, i) {
        const r = await h.finance.importOpeningDeposits(asSystem(tx), { ...i, idempotencyKey: i.importRef });
        return {
          status: r.status,
          importedCount: r.importedCount,
          importedTotalMinor: r.importedTotalMinor,
          differenceMinor: r.differenceMinor,
          rejected: r.rejected,
        };
      },
      async depositBalances(tx, i) {
        const out: Array<{ bookingId: string; amountMinor: number; currency: string }> = [];
        for (const id of i.bookingIds) {
          const d = await h.finance.getDeposits(asSystem(tx), id);
          if (d)
            out.push({ bookingId: id, amountMinor: d.balance.amountMinor, currency: d.balance.currency });
        }
        return out;
      },
      async taxAccountKeys(tx, propertyId) {
        const p = await platform.getProperty(asSystem(tx), propertyId);
        return (await h.finance.listAccounts(asSystem(tx), p.legalEntityId))
          .map((a) => a.systemKey ?? '')
          .filter((k) => k.startsWith('tax:') && k !== 'tax:unmapped')
          .map((k) => k.slice(4));
      },
      importOpeningFolioBalances: (tx, i) => fakeFinanceOpenings.importOpeningFolioBalances(tx, i),
      folioOpeningBalances: (tx, i) => fakeFinanceOpenings.folioOpeningBalances(tx, i),
      importOpeningReceivables: (tx, i) => fakeFinanceOpenings.importOpeningReceivables(tx, i),
      receivableOpenItems: (tx, i) => fakeFinanceOpenings.receivableOpenItems(tx, i),
    },
    cards: {
      async request(tx, i) {
        // Environment safety (rule 12): asking a guest for a card is a guest message; simulated outside live.
        const mode = assertExternalEffectAllowed(tx, 'message.guest');
        await fdb(tx)
          .insertInto('fake_providers.card_requests')
          .values({
            tenant_id: tx.tenantId,
            idempotency_key: i.idempotencyKey,
            booking_id: i.bookingId,
            status: mode,
          })
          .onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).doNothing())
          .execute();
        return {
          status: mode === 'live' ? 'requested' : 'simulated',
          reference: `card-request:${i.idempotencyKey}`,
        };
      },
    },
    simulator: {
      async snapshot(tx, accountId) {
        if (tx.environment === 'live')
          throw new BusinessRuleError(
            'simulator_not_in_live',
            'The simulator is never read in a live organization.',
          );
        assertExternalEffectAllowed(tx, 'integration.read');
        const st = await h.hub.run(tx.tenantId, accountId, (a) => a.toState(), { write: false, tx });
        return { accountId, property: st.property, reservations: st.reservations };
      },
    },
  };
}

export async function startHarness(opts: { clock?: Clock } = {}): Promise<Harness> {
  const t = await createTestDatabase(
    sourcesFromManifests([
      platformManifest,
      inventoryManifest,
      guestsManifest,
      financeManifest,
      ratesManifest,
      integrationManifest,
      migrationManifest,
    ]),
    opts.clock ? { clock: opts.clock } : {},
  );
  await createFakeSchema(t);
  const inventory = createInventoryService({
    platform: {
      getBusinessDate: platform.getBusinessDate,
      getDataAuthority: platform.getDataAuthority,
      assertWritable: platform.assertWritable,
      getLimit: platform.getLimit,
      resolvePolicy: platform.resolvePolicy,
    },
  });
  const guests = createGuestsService({
    platform: {
      assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
      hasEntitlement: (tx, feature) => platform.hasEntitlement(tx, feature),
      resolvePolicy: (tx, propertyId, key, def) => platform.resolvePolicy(tx, propertyId, key, def),
      listPropertyIds: async (tx) => (await platform.listProperties(asSystem(tx))).map((p) => p.id),
      getPropertyCountry: async (tx, id) => (await platform.getProperty(asSystem(tx), id)).countryCode,
      getPropertyLegalEntityId: async (tx, id) =>
        (await platform.getProperty(asSystem(tx), id)).legalEntityId,
      legalEntityExists: (tx, id) =>
        platform.getLegalEntity(tx, id).then(
          () => true,
          () => false,
        ),
      getBusinessDate: (tx, id) => platform.getBusinessDate(tx, id),
    },
    crypto: fieldCryptoFromEnv({}),
  });
  const finance = createFinance({
    platform: {
      getProperty: (tx, id) => platform.getProperty(asSystem(tx), id),
      getBusinessDate: platform.getBusinessDate,
      getLegalEntity: platform.getLegalEntity,
      assertWritable: platform.assertWritable,
    },
    ...unavailableFinancePorts(),
  });
  const rates = ratesService(
    {
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
      resolvePolicy: (tx, propertyId, key, def) => platform.resolvePolicy(tx, propertyId, key, def),
      getBusinessDate: (tx, propertyId) => platform.getBusinessDate(tx, propertyId),
      listUnitTypes: async (tx, propertyId) =>
        (await inventory.listUnitTypes(asSystem(tx), propertyId)).map((u) => ({
          id: u.id,
          code: u.code,
          name: u.name,
        })),
      companyExists: async () => false,
    },
    { termsSealKey: randomBytes(32).toString('base64') },
  );
  const hub = new PmsSimulatorHub(t.db);
  const reservations = new FakeReservations(inventory);
  const platformPorts = {} as PlatformPorts;
  const deps: MigrationDeps = {
    ports: {
      ...migrationPorts({ inventory, guests, finance, rates, hub, reservations, platformPorts }),
      rehearsal: createRehearsalBridge(t.db, () => deps),
    },
  };
  return {
    t,
    deps,
    inventory,
    guests,
    finance,
    hub,
    reservations,
    platformPorts,
    async close() {
      await t.drop();
    },
  };
}

// ───────────────────────────── organizations ─────────────────────────────

export interface Org {
  tenantId: string;
  environment: TenantEnvironment;
  propertyId: string;
  legalEntityId: string;
  businessDate: string;
  /** All-powerful user (setup); `user(n)` are distinct people with all migration + platform rights. */
  admin: RequestContext;
  user(name: string, grants?: string[]): RequestContext;
  run<T>(fn: (tx: TxContext) => Promise<T>, ctx?: RequestContext): Promise<T>;
}

export const ALL_MIGRATION = [
  'migration.job.read',
  'migration.job.manage',
  'migration.mapping.review',
  'migration.exception.manage',
  'migration.finance.signoff',
  'migration.checklist.complete',
  'migration.staff.accept',
  'migration.cutover.execute',
  'migration.production.authorize',
];

export async function setupOrg(
  h: Harness,
  opts: { environment?: TenantEnvironment; businessDate?: string; liveTenantId?: string; name?: string } = {},
): Promise<Org> {
  const environment = opts.environment ?? 'live';
  const businessDate = opts.businessDate ?? '2026-12-01';
  const admin = testContext({ environment, actor: { kind: 'user', userId: newId(), displayName: 'Admin' } });
  const run = <T>(fn: (tx: TxContext) => Promise<T>, c: RequestContext = admin) =>
    withTenantTx(h.t.db, c, fn);
  await run((tx) =>
    platform.provisionOrganization(tx, {
      id: admin.tenantId,
      name: opts.name ?? 'Coral Nest',
      slug: `org-${admin.tenantId.slice(-12)}`,
      environment,
      planCode: 'enterprise',
      ...(opts.liveTenantId ? { liveTenantId: opts.liveTenantId } : {}),
    }),
  );
  if (environment === 'trial')
    await run((tx) =>
      platform.initTrialLifecycle(
        tx,
        opts.liveTenantId ? { sourceTenantId: opts.liveTenantId } : { prospectName: 'Prospect' },
      ),
    );
  const le = await run((tx) =>
    platform.createLegalEntity(tx, {
      name: 'Coral Nest',
      legalName: 'Coral Nest Guest House Pvt Ltd (fictitious)',
      taxId: '1000555GST501',
      countryCode: 'MV',
      baseCurrency: 'USD',
      address: { line1: 'Maafushi', city: 'Maafushi' },
    }),
  );
  const p = await run((tx) =>
    platform.createProperty(tx, {
      code: `CN${newId().slice(-5).toUpperCase()}`,
      name: 'Coral Nest Guesthouse',
      profile: 'guesthouse',
      legalEntityId: le.id,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      businessDate,
      classification: { 'mv.establishmentType': 'guesthouse' },
    }),
  );
  const users = new Map<string, string>();
  return {
    tenantId: admin.tenantId,
    environment,
    propertyId: p.id,
    legalEntityId: le.id,
    businessDate,
    admin,
    run,
    user(name, grants) {
      const id = users.get(name) ?? newId();
      users.set(name, id);
      const ctx = testContext({
        tenantId: admin.tenantId,
        environment,
        actor: { kind: 'user', userId: id, displayName: name },
        ...(grants ? { grants: grants.map((permission) => ({ permission, propertyIds: [p.id] })) } : {}),
      });
      return ctx;
    },
  };
}

/** A live organization with its linked trial organization (platform trial lifecycle + environment link). */
export async function setupLiveWithTrial(h: Harness, businessDate = '2026-12-01') {
  const live = await setupOrg(h, { environment: 'live', businessDate });
  const trial = await setupOrg(h, {
    environment: 'trial',
    businessDate,
    liveTenantId: live.tenantId,
    name: 'Coral Nest (trial)',
  });
  await live.run((tx) =>
    platform.linkEnvironment(tx, {
      linkedTenantId: trial.tenantId,
      environment: 'trial',
      name: 'Coral Nest trial',
    }),
  );
  return { live, trial };
}
