/**
 * Shared harness for the operational proof scenarios (docs/scenarios/README.md) and the cross-module binding tests.
 *
 * Everything runs through the REAL composition root (`compose(database)`): public module services and HTTP. Staff
 * act through service-level request contexts built from the identity role templates (`staff(role)`), so the
 * scenarios do not depend on how users sign in; the ONE place that signs in over HTTP (`signIn`) and the ONE place
 * that changes data authority (`makeExternal`) are below — identity-plus (MFA for sensitive permissions, second
 * approver for authority changes) adapts them here.
 *
 * Sample data follows decision D8 (Maldives): Kandu Atoll Resort (Beach / Water / Sunset Water Villas, Green Tax
 * class $12, resort rate plans BAR / BAR-NR / AI from the rates seed) and Hiyani Guesthouse (Green Tax $6). Taxes
 * use the unverified Maldives rule pack (Q41 defaults).
 */
import { drainOutbox, sourcesFromManifests, sql, type TxContext, withTenantTx } from '@portico/db';
import { financeDemoSeed } from '@portico/finance';
import type { PorticoApp } from '@portico/http';
import { ROLE_TEMPLATES } from '@portico/identity';
import {
  type Clock,
  fixedClock,
  type LocalDate,
  newId,
  type RequestContext,
  staticAuthorizer,
  systemAuthorizer,
  type TenantEnvironment,
} from '@portico/kernel';
import { seedPaymentsDemo } from '@portico/payments';
import { platform } from '@portico/platform';
import { seedResortRates } from '@portico/rates';
import type { Booking, NewBookingInput } from '@portico/reservations';
import { createTestDatabase, type TestDatabase } from '@portico/testing';
import { expect } from 'vitest';
import { buildApp, type Composition, compose, MANIFESTS, provisionOrganization } from '../../src';
import { enrolMfa } from '../helpers';

export interface Scenario {
  t: TestDatabase;
  c: Composition;
  app: PorticoApp;
  clock: ReturnType<typeof fixedClock>;
  /** Deliver every pending domain event to its consumers (the worker's outbox dispatcher). */
  drain(): Promise<void>;
  close(): Promise<void>;
}

const environments = new Map<string, TenantEnvironment>();

/** Start a scenario: a fresh database with every module migrated, the composed services and the HTTP app. */
export async function startScenario(opts: { now?: string } = {}): Promise<Scenario> {
  const clock = fixedClock(opts.now ?? '2027-03-08T09:00:00+05:00');
  const t = await createTestDatabase(sourcesFromManifests(MANIFESTS), { clock: clock as Clock });
  const c = compose(t.db);
  const app = await buildApp({ database: t.db, logger: false, rateLimit: false });
  return {
    t,
    c,
    app,
    clock,
    async drain() {
      await drainOutbox(t.db, {
        subscriptions: c.subscriptions,
        environmentOf: async (tenantId) => environments.get(tenantId) ?? 'live',
        maxAttempts: 1,
        onError: (err) => {
          throw err;
        },
      });
    },
    async close() {
      await app.close();
      await t.drop();
    },
  };
}

export type Role = (typeof ROLE_TEMPLATES)[number]['key'];

export interface PropertyFixture {
  id: string;
  code: string;
  legalEntityId: string;
  businessDate: LocalDate;
  types: Record<string, string>;
  units: Record<string, string>;
  plans: Record<string, string>;
}

export interface ScenarioOrg {
  tenantId: string;
  environment: TenantEnvironment;
  /** All-powerful setup context (a manager doing configuration). */
  setup: RequestContext;
  /** A staff member holding exactly the permissions of an identity role template, at the given properties. */
  staff(role: Role, name: string, propertyIds: readonly string[] | 'all'): RequestContext;
  run<T>(ctx: RequestContext, fn: (tx: TxContext) => Promise<T>): Promise<T>;
  admin: { email: string; password: string };
}

/** Provision an organization (identity admin included) in the given environment. */
export async function organization(
  s: Scenario,
  opts: { name?: string; environment?: TenantEnvironment } = {},
): Promise<ScenarioOrg> {
  const environment = opts.environment ?? 'demo';
  // Demo seeding only (ADR-0017 rule 12): a demo organization, a reserved fictitious address.
  const admin = {
    email: `admin-${newId()}@scenarios.portico.invalid`,
    password: 'correct horse battery staple',
  };
  const { tenantId } = await provisionOrganization(s.t.db, {
    name: opts.name ?? 'Azure Isles Group',
    slug: `org-${newId().slice(-12)}`,
    environment,
    planCode: 'enterprise',
    admin: { email: admin.email, displayName: 'Admin', password: admin.password },
  });
  environments.set(tenantId, environment);
  const base = (actor: RequestContext['actor'], authz: RequestContext['authz']): RequestContext => ({
    tenantId,
    environment,
    actor,
    authz,
    correlationId: newId(),
  });
  return {
    tenantId,
    environment,
    admin,
    setup: base({ kind: 'user', userId: newId(), displayName: 'Setup Manager' }, systemAuthorizer),
    staff(role, name, propertyIds) {
      const template = ROLE_TEMPLATES.find((r) => r.key === role);
      if (!template) throw new Error(`unknown role ${role}`);
      return base(
        { kind: 'user', userId: newId(), displayName: name },
        staticAuthorizer(template.permissions.map((permission) => ({ permission, propertyIds }))),
      );
    },
    run: (ctx, fn) => withTenantTx(s.t.db, ctx, fn),
  };
}

interface TypeSpec {
  code: string;
  name: string;
  rank: number;
  maxOccupancy: number;
  units: string[];
}

/** Kandu Atoll Resort (D8), compact: three villa categories with named villas the scenarios refer to. */
export const KANDU_TYPES: TypeSpec[] = [
  { code: 'BV', name: 'Beach Villa', rank: 10, maxOccupancy: 3, units: ['214', '216', '218'] },
  { code: 'WV', name: 'Water Villa', rank: 20, maxOccupancy: 3, units: ['305', '307', '309'] },
  { code: 'OWPV', name: 'Sunset Water Villa with Pool', rank: 30, maxOccupancy: 3, units: ['501', '502'] },
];

/** Hiyani Guesthouse (D8), compact. */
export const HIYANI_TYPES: TypeSpec[] = [
  { code: 'DBL', name: 'Double Room', rank: 10, maxOccupancy: 2, units: ['101', '102', '103'] },
];

/**
 * Create a property with its legal entity, inventory, rates (resort seed: BAR flexible, BAR-NR non-refundable,
 * AI all-inclusive; deposit 30%; guarantee card/deposit/agency), finance setup, a simulated payment account (non-live
 * organizations) and operations' unit mirror.
 */
export async function property(
  s: Scenario,
  org: ScenarioOrg,
  spec: {
    code: string;
    name: string;
    kind: 'resort' | 'guesthouse';
    businessDate: LocalDate;
    types?: TypeSpec[];
    legalEntityId?: string;
  },
): Promise<PropertyFixture> {
  const { rates, inventory, operations } = s.c.services;
  return org.run(org.setup, async (tx) => {
    const legalEntityId =
      spec.legalEntityId ??
      (
        await platform.createLegalEntity(tx, {
          name: spec.name,
          legalName: `${spec.name} Pvt Ltd (fictitious)`,
          countryCode: 'MV',
          baseCurrency: 'USD',
        })
      ).id;
    const p = await platform.createProperty(tx, {
      code: spec.code,
      name: spec.name,
      profile: spec.kind,
      legalEntityId,
      countryCode: 'MV',
      timezone: 'Indian/Maldives',
      baseCurrency: 'USD',
      classification:
        spec.kind === 'resort'
          ? { 'mv.establishmentType': 'resort', 'mv.inhabitedIsland': false, 'mv.registeredRooms': 120 }
          : { 'mv.establishmentType': 'guesthouse', 'mv.inhabitedIsland': true, 'mv.registeredRooms': 12 },
      businessDate: spec.businessDate,
    });
    const types: Record<string, string> = {};
    const units: Record<string, string> = {};
    for (const [i, t] of (spec.types ?? (spec.kind === 'resort' ? KANDU_TYPES : HIYANI_TYPES)).entries()) {
      const type = await inventory.createUnitType(tx, p.id, {
        code: t.code,
        name: t.name,
        kind: spec.kind === 'resort' ? 'villa' : 'room',
        baseOccupancy: 2,
        maxAdults: t.maxOccupancy,
        maxChildren: t.maxOccupancy - 1,
        maxOccupancy: t.maxOccupancy,
        rank: t.rank,
        sortOrder: (i + 1) * 10,
      });
      types[t.code] = type.id;
      for (const number of t.units) {
        units[number] = (await inventory.createUnit(tx, p.id, { unitTypeId: type.id, number })).id;
      }
    }
    const rulesInstalled = await sql<{ n: number }>`select count(*)::int as n from rates.tax_rules`.execute(
      tx.db,
    );
    if ((rulesInstalled.rows[0]?.n ?? 0) === 0) {
      await rates.installTaxTemplate(tx, { template: 'MV', propertyIds: null });
    }
    const seeded = await seedResortRates(rates, tx, {
      propertyId: p.id,
      unitTypes: Object.entries(types).map(([code, id]) => ({ id, code, name: code })),
      from: spec.businessDate,
      days: 120,
    });
    await financeDemoSeed(tx, { properties: [{ id: p.id, legalEntityId }] });
    if (org.environment !== 'live' && !spec.legalEntityId) {
      await seedPaymentsDemo(tx, { properties: [{ id: p.id, legalEntityId }] });
    }
    await operations.syncUnitsFromInventory(tx, p.id);
    return {
      id: p.id,
      code: p.code,
      legalEntityId,
      businessDate: spec.businessDate,
      types,
      units,
      plans: seeded.ratePlans,
    };
  });
}

/** Kandu Atoll Resort with business date `businessDate` (default 8 Mar 2027). */
export function kandu(s: Scenario, org: ScenarioOrg, businessDate: LocalDate = '2027-03-08') {
  return property(s, org, { code: 'KAN', name: 'Kandu Atoll Resort', kind: 'resort', businessDate });
}

/** Hiyani Guesthouse (its own legal entity unless given). */
export function hiyani(s: Scenario, org: ScenarioOrg, businessDate: LocalDate = '2027-03-08') {
  return property(s, org, { code: 'HIY', name: 'Hiyani Guesthouse', kind: 'guesthouse', businessDate });
}

/** A confirmed-booking input for one stay at a property (BAR, 2 adults, one primary occupant). */
export function bookingInput(
  p: PropertyFixture,
  stay: {
    type?: string;
    plan?: string;
    arrival: LocalDate;
    departure: LocalDate;
    guest?: { firstName: string; lastName: string };
    /** An existing guest profile (booker and primary occupant), e.g. the owner of the guarantee card. */
    guestProfileId?: string;
    unit?: string;
    adults?: number;
    childrenAges?: number[];
  },
  overrides: Partial<NewBookingInput> = {},
): NewBookingInput {
  const guest = stay.guest ?? { firstName: 'Elena', lastName: 'Ivanova' };
  const known = stay.guestProfileId ? { profileId: stay.guestProfileId } : {};
  return {
    propertyId: p.id,
    intent: 'confirm',
    booker: {
      kind: 'profile',
      ...known,
      profile: { ...guest, email: `${guest.lastName.toLowerCase()}-${newId()}@example.ru` },
    },
    source: 'direct_email',
    externalRefs: {},
    marketSegment: 'leisure',
    guarantee: { kind: 'none' },
    specialRequests: [],
    tags: [],
    stays: [
      {
        unitTypeId: p.types[stay.type ?? 'BV'] as string,
        ratePlanId: p.plans[stay.plan ?? 'BAR'] as string,
        arrival: stay.arrival,
        departure: stay.departure,
        occupancy: { adults: stay.adults ?? 2, childrenAges: stay.childrenAges ?? [] },
        commercialType: 'standard',
        occupants: [{ ...known, profile: { ...guest }, kind: 'adult', primary: true }],
        requests: [],
        ...(stay.unit ? { unitId: p.units[stay.unit] as string } : {}),
      },
    ],
    ...overrides,
  };
}

/** Narrow a reservations result that may be a forwarded change (connected mode). */
export function applied<T extends object>(v: T | { forwarded: true }): T {
  if ('forwarded' in v && v.forwarded === true) throw new Error('unexpected forwarded result');
  return v as T;
}

/**
 * Make an external system authoritative for a data domain at a property (ADR-0014). The single place that changes
 * data authority in scenarios (identity-plus will require an authority transition with a second approver).
 */
export async function makeExternal(
  _s: Scenario,
  org: ScenarioOrg,
  propertyId: string,
  domain:
    | 'reservations'
    | 'availability'
    | 'rates'
    | 'guestProfiles'
    | 'charges'
    | 'payments'
    | 'roomStatus'
    | 'maintenance'
    | 'accounting',
  writeMode: 'read_only' | 'forward' = 'read_only',
): Promise<void> {
  // Identity-plus / platform enterprise (G-02): moving a domain's system of record is an authority transition —
  // planned by one person, approved by another, frozen, then made effective. Scenarios use the real flow.
  // Re-review #3 R3-P3-4: real people with real roles, and the composition's platform ports (its transition guard).
  const planner = org.staff('org_admin', 'Planner', [propertyId]);
  const approver = org.staff('org_admin', 'Approver', [propertyId]);
  const plan = await org.run(planner, (tx) =>
    platform.planAuthorityTransition(tx, propertyId, {
      changes: [
        { domain, authority: 'external', connectionId: newId(), systemName: 'Legacy PMS', writeMode },
      ],
      reason: 'Scenario: the hotel keeps its existing system of record for this domain',
      freezeMinutes: 5,
    }),
  );
  if (plan.approvalRequired) {
    await org.run(approver, (tx) => platform.approveAuthorityTransition(tx, plan.id, 'scenario setup'));
  }
  await org.run(planner, (tx) => platform.freezeAuthorityTransition(tx, plan.id));
  await org.run(planner, (tx) => platform.completeAuthorityTransition(tx, _s.c.platformPorts, plan.id));
}

const sessions = new Map<string, Record<string, string>>();

/**
 * Sign in over HTTP — the single place scenarios use password sign-in. Identity-plus: sensitive (⚑) permissions need
 * MFA, so the administrator enrols an authenticator once (codes from the scenario clock) and the session is reused.
 */
export async function signIn(s: Scenario, org: ScenarioOrg): Promise<Record<string, string>> {
  const cached = sessions.get(org.tenantId);
  if (cached) return cached;
  const res = await s.app.inject({ method: 'POST', url: '/v1/auth/login', payload: org.admin });
  const body = res.json();
  if (body.status !== 'signed_in') throw new Error(`login failed: ${res.body}`);
  const auth = { authorization: `Bearer ${body.token}` };
  await enrolMfa(s.app, auth, org.admin.password, s.clock.now());
  sessions.set(org.tenantId, auth);
  return auth;
}

// ───────────────────────────── global consistency checks (scenarios README) ─────────────────────────────

/**
 * The global consistency checks every scenario ends with: INV-I02 (ledger = Σ consumption + holds), INV-I03 (no
 * oversold cell without an open conflict), RES-I02 (active stays consume exactly their nights; cancelled stays
 * hold nothing), every deposit belongs to a booking of its property, FIN-I02/FIN-I14 (trial balance zero; control accounts = Σ sub-ledgers), no duplicate idempotency
 * effects, and an audit row for every consequential command named in `auditActions`.
 */
export async function assertGlobalConsistency(
  s: Scenario,
  org: ScenarioOrg,
  opts: { auditActions?: string[] } = {},
): Promise<void> {
  const { inventory, finance } = s.c.services;
  const tenant = org.tenantId;
  await org.run(org.setup, async (tx) => {
    expect(await inventory.checkLedgerConsistency(tx, { fromNight: '2000-01-01', report: false })).toEqual(
      [],
    );
  });
  const q = async <R>(text: ReturnType<typeof sql<R>>) => (await text.execute(s.t.admin.kysely)).rows;
  // INV-I03
  const oversold = await q(sql<{ night: string }>`
    select l.night::text as night from inventory.ledger l
     where l.tenant_id = ${tenant}
       and l.sold + l.held + l.out_of_order > l.capacity + l.overbooking_allowance
       and not exists (select 1 from inventory.conflicts c where c.tenant_id = l.tenant_id
                        and c.unit_type_id = l.unit_type_id and c.night = l.night and c.status <> 'resolved')`);
  expect(oversold).toEqual([]);
  // RES-I02: every night of every segment of an active stay of a consuming booking is consumed exactly once, with
  // the segment's unit type; cancelled stays hold no inventory.
  const missing = await q(sql<{ stay_id: string; night: string }>`
    select st.id as stay_id, n::date::text as night
      from reservations.stays st
      join reservations.bookings b on b.id = st.booking_id
      join reservations.stay_segments g on g.stay_id = st.id
      cross join lateral generate_series(lower(g.nights), upper(g.nights) - 1, interval '1 day') n
     where st.tenant_id = ${tenant} and st.status in ('expected', 'in_house')
       and b.status in ('tentative', 'confirmed')
       and (select coalesce(sum(c.quantity), 0) from inventory.consumptions c
             where c.ref_type = 'stay' and c.ref_id = st.id and c.night = n::date
               and c.unit_type_id = g.unit_type_id) <> 1`);
  expect(missing).toEqual([]);
  const leaked = await q(sql<{ stay_id: string }>`
    select st.id as stay_id from reservations.stays st
     where st.tenant_id = ${tenant} and st.status = 'cancelled'
       and exists (select 1 from inventory.consumptions c where c.ref_type = 'stay' and c.ref_id = st.id)`);
  expect(leaked).toEqual([]);
  // Cross-module (review §7): every booking deposit finance holds belongs to a reservations booking of the SAME
  // property — a deposit at another property's legal entity, or for a booking that exists nowhere, is a defect.
  const strayDeposits = await q(sql<{ booking_id: string }>`
    select d.booking_id from finance.deposit_accounts d
      left join reservations.bookings b on b.id = d.booking_id
     where d.tenant_id = ${tenant} and (b.id is null or b.property_id <> d.property_id)`);
  expect(strayDeposits).toEqual([]);
  // FIN-I02 / FIN-I14 per legal entity.
  const entities = await q(
    sql<{ id: string }>`select id from platform.legal_entities where tenant_id = ${tenant}`,
  );
  for (const le of entities) {
    const report = await org.run(org.setup, (tx) => finance.integrityReport(tx, le.id));
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
  }
  // No duplicate effects of one idempotency key.
  expect(
    await q(sql<{
      k: string;
    }>`select idempotency_key as k from finance.journal_entries where tenant_id = ${tenant}
                               group by legal_entity_id, idempotency_key having count(*) > 1`),
  ).toEqual([]);
  expect(
    await q(
      sql<{
        id: string;
      }>`select id from payments.provider_operations where tenant_id = ${tenant} and attempts > 1`,
    ),
  ).toEqual([]);
  // Audit trail for every consequential command of the scenario.
  if (opts.auditActions?.length) {
    const present = await q(sql<{ action: string }>`
      select distinct action from core.audit_log where tenant_id = ${tenant}`);
    const actions = new Set(present.map((r) => r.action));
    expect(opts.auditActions.filter((a) => !actions.has(a))).toEqual([]);
  }
}

/**
 * A simulated card on file (payments, tokens only) at a property of a non-live organization, owned by `owner`
 * (default: a guest profile of its own — fine for desk charges; a GUARANTEE card must belong to the booking's guest,
 * booker or payer, review P1-2: use `guestWithCard`). Saved by staff with the cardholder's recorded card-on-file
 * agreement for this hotel company (fix sweep SW-PAY-4: every staff use of a stored card is merchant-initiated and
 * needs it). The agreement names no booking, so the card is never a booking's AGREED guarantee by itself (ADR-0015
 * Amendment 1): a user with payments.payment.collect chooses it, or `mandateFor` names the bookings it covers.
 */
export async function cardOnFile(
  s: Scenario,
  org: ScenarioOrg,
  propertyId: string,
  legalEntityId: string,
  token = 'pm_card_visa',
  owner: { type: 'guest_profile' | 'company' | 'agency' | 'booking'; id: string } = {
    type: 'guest_profile',
    id: newId(),
  },
  opts: {
    mandate?: boolean;
    mandateFor?: string[];
    purposes?: Array<'guarantee' | 'deposit' | 'balance' | 'incidentals' | 'no_show'>;
  } = {},
) {
  const p = s.c.services.payments;
  return org.run(org.setup, async (tx) => {
    const account = (await p.tx.listAccounts(tx, legalEntityId)).find((a) => a.provider === 'simulator');
    if (!account) throw new Error('no simulated payment account');
    const mandate = opts.mandate !== false;
    return p.tx.createMethod(tx, {
      accountId: account.id,
      propertyId,
      kind: 'card',
      providerToken: token,
      brand: 'visa',
      last4: '4242',
      owner,
      mitAgreement: mandate,
      ...(mandate
        ? {
            mandate: {
              termsVersion: 'card-on-file-2027-01',
              acceptedAt: tx.now.toISOString(),
              channel: 'front_desk',
              scope: {
                legalEntityId,
                purposes:
                  opts.purposes ?? (['guarantee', 'deposit', 'balance', 'incidentals', 'no_show'] as const),
                ...(opts.mandateFor ? { bookingIds: opts.mandateFor } : {}),
              },
            },
          }
        : {}),
    });
  });
}

/** A guest profile (guests) and a card on file it owns — the guest's guarantee card. */
export async function guestWithCard(
  s: Scenario,
  org: ScenarioOrg,
  p: PropertyFixture,
  guest: { firstName: string; lastName: string } = { firstName: 'Elena', lastName: 'Ivanova' },
  token = 'pm_card_visa',
): Promise<{ profileId: string; card: Awaited<ReturnType<typeof cardOnFile>> }> {
  const { profileId } = await org.run(org.setup, (tx) =>
    s.c.services.guests.resolveProfile(
      tx,
      { propertyId: p.id, givenName: guest.firstName, familyName: guest.lastName },
      { matchStrategy: 'create_new' },
    ),
  );
  const card = await cardOnFile(s, org, p.id, p.legalEntityId, token, {
    type: 'guest_profile',
    id: profileId,
  });
  return { profileId, card };
}

/**
 * The cardholder confirms, in guest self-service, that their saved card covers this booking (ADR-0015 Amendment 3,
 * re-review #4 R4-P1-1): the card's agreement then NAMES the booking, with evidence and the booking's stays as they are
 * now. Only the cardholder can do this — no staff context can.
 */
export async function cardholderConfirms(
  s: Scenario,
  org: ScenarioOrg,
  methodId: string,
  bookingId: string,
): Promise<void> {
  const m = (
    await sql<{ owner_type: string; owner_id: string }>`
      select owner_type, owner_id from payments.payment_methods where id = ${methodId}`.execute(
      s.t.admin.kysely,
    )
  ).rows[0];
  if (!m) throw new Error(`no saved card ${methodId}`);
  const cardholder: RequestContext = {
    tenantId: org.tenantId,
    environment: org.environment,
    actor:
      m.owner_type === 'booking'
        ? { kind: 'guest', bookingId: m.owner_id }
        : { kind: 'guest', guestProfileId: m.owner_id },
    authz: staticAuthorizer([]),
    correlationId: newId(),
  };
  await org.run(cardholder, (tx) =>
    s.c.services.payments.tx.confirmCardForBooking(tx, { methodId, bookingId }),
  );
}

/**
 * A booking secured by its guest's saved card, made the way it happens for real (R4-P1-1): the booking is created, its
 * cardholder confirms the card for it (self-service), then `ctx` records the card as the booking's guarantee. A card a
 * standing agreement merely belongs to the guest of never secures a booking by itself.
 */
export async function bookWithCard(
  s: Scenario,
  org: ScenarioOrg,
  ctx: RequestContext,
  input: NewBookingInput,
): Promise<Booking> {
  const { reservations } = s.c.services;
  const guarantee = input.guarantee;
  const created = applied<Booking>(
    await org.run(ctx, (tx) => reservations.createBooking(tx, { ...input, guarantee: { kind: 'none' } })),
  );
  if (!guarantee?.paymentMethodId) return created;
  await cardholderConfirms(s, org, guarantee.paymentMethodId, created.id);
  return applied<Booking>(
    await org.run(ctx, (tx) =>
      reservations.patchBooking(tx, {
        bookingId: created.id,
        expectedVersion: created.version,
        patch: { guarantee },
      }),
    ),
  );
}

/** Housekeeping cleans a unit and the supervisor inspects it (operations), so check-in readiness passes. */
export async function readyUnit(
  s: Scenario,
  org: ScenarioOrg,
  propertyId: string,
  unitId: string,
): Promise<void> {
  const ops = s.c.services.operations;
  const supervisor = org.staff('housekeeping_supervisor', 'Mariyam', [propertyId]);
  await org.run(supervisor, async (tx) => {
    const unit = await ops.getUnit(tx, unitId);
    if (unit.condition !== 'clean') {
      await ops.setCondition(tx, unitId, { condition: 'clean' }, { expectedVersion: unit.version });
    }
    await ops.recordInspection(tx, unitId, { items: [] });
  });
}
