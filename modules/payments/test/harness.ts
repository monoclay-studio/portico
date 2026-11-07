/**
 * Integration test harness: real Postgres (RLS), real platform module, payments with the simulator, and a
 * DB-backed fake finance ledger (transactional and idempotent like the real one, so "exactly one posting" is a
 * real database fact, not an in-memory illusion).
 */
import {
  drainOutbox,
  type PorticoDatabase,
  sourcesFromManifests,
  sql,
  type TxContext,
  withTenantTx,
} from '@portico/db';
import {
  BusinessRuleError,
  fixedClock,
  newId,
  type RequestContext,
  systemAuthorizer,
  systemContext,
  type TenantEnvironment,
} from '@portico/kernel';
import { platform, platformManifest } from '@portico/platform';
import { createTestDatabase, type TestDatabase, testContext } from '@portico/testing';
import {
  createPaymentsModule,
  type HttpClient,
  type LedgerPort,
  type PlatformPort,
  type ProviderSecretsPort,
  paymentsManifest,
  type ReferenceDirectoryPort,
} from '../src';
import { SIMULATOR_SIGNATURE_HEADER } from '../src/providers/simulator';

export const T0 = '2026-11-07T08:00:00.000Z';

export interface LedgerControls {
  failWith: string | null;
  /** Default owner (property + legal entity) of any folio/booking of a tenant (set by setupOrg). */
  defaultOwner: Map<string, { propertyId: string; legalEntityId: string }>;
  /** Explicit owners for specific folio/booking ids (cross-property tests). */
  owners: Map<string, { propertyId: string; legalEntityId: string }>;
  /** Folio ids finance does not know at all. */
  unknown: Set<string>;
  /** Booking ids that were booked directly (not through a channel). */
  directBookings: Set<string>;
}

/**
 * Fake reservations directory (review R2-P2-3: required): a stay or booking belongs to its explicit owner, or to the
 * tenant's default property; ids in `unknown` exist nowhere. Bookings come from the default channel connection unless
 * `directBookings` names them (virtual cards are registered only for channel bookings, review R2-P1-1).
 */
export function fakeReferences(controls: LedgerControls): ReferenceDirectoryPort {
  return {
    async describeReference(tx, ref) {
      if (ref.type !== 'stay' && ref.type !== 'booking') return undefined;
      if (controls.unknown.has(ref.id)) return null;
      const owner = controls.owners.get(ref.id) ?? controls.defaultOwner.get(tx.tenantId);
      if (!owner) return null;
      return ref.type === 'booking'
        ? {
            propertyId: owner.propertyId,
            source: controls.directBookings.has(ref.id) ? 'direct' : 'channel',
            channelConnectionId: controls.directBookings.has(ref.id) ? null : DEFAULT_CHANNEL_CONNECTION,
          }
        : { propertyId: owner.propertyId };
    },
  };
}

/** The channel connection fake channel bookings come from. */
export const DEFAULT_CHANNEL_CONNECTION = '01900000-0000-7000-8000-00000000c0c0';

/**
 * Fake finance: one row per idempotency key (unique), in the caller's transaction; refuses postings whose target
 * belongs to another property/legal entity (the defence-in-depth finance is asked to implement).
 */
export function fakeLedger(controls: LedgerControls): LedgerPort {
  const ownerOf = (tenantId: string, id: string) =>
    controls.unknown.has(id)
      ? null
      : (controls.owners.get(id) ?? controls.defaultOwner.get(tenantId) ?? null);
  const assertScope = (
    tx: TxContext,
    target: { type: string; id: string } | null,
    scope: { propertyId: string; legalEntityId: string },
  ) => {
    if (!target) return;
    const owner = ownerOf(tx.tenantId, target.id);
    if (owner && (owner.propertyId !== scope.propertyId || owner.legalEntityId !== scope.legalEntityId)) {
      throw new Error(`finance: ${target.type} ${target.id} belongs to another property/legal entity`);
    }
  };
  const post = async (
    tx: TxContext,
    kind: string,
    key: string,
    ref: { type: string; id: string },
    amountMinor: number,
    currency: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (controls.failWith) throw new Error(controls.failWith);
    const id = newId();
    const inserted = await sql<{ id: string }>`
      insert into test_ledger.postings (id, tenant_id, kind, idempotency_key, ref_type, ref_id, amount_minor, currency, extra)
      values (${id}, ${tx.tenantId}, ${kind}, ${key}, ${ref.type}, ${ref.id}, ${amountMinor}, ${currency}, ${JSON.stringify(extra)})
      on conflict (tenant_id, idempotency_key) do nothing returning id`.execute(tx.db);
    if (inserted.rows[0]) return inserted.rows[0].id;
    const existing = await sql<{ id: string }>`
      select id from test_ledger.postings where idempotency_key = ${key}`.execute(tx.db);
    return existing.rows[0]?.id as string;
  };
  return {
    async describeTarget(tx, ref) {
      return ownerOf(tx.tenantId, ref.id);
    },
    // The same predicate the fake uses when posting (review R2-P1-3): unknown → refused; other scope → refused.
    async assertTargetUsable(tx, ref, scope) {
      const owner = ownerOf(tx.tenantId, ref.id);
      if (!owner) {
        throw new BusinessRuleError('ledger_target_unknown', `finance: unknown ${ref.type} ${ref.id}`);
      }
      if (owner.propertyId !== scope.propertyId || owner.legalEntityId !== scope.legalEntityId) {
        throw new BusinessRuleError('scope_mismatch', `finance: ${ref.type} ${ref.id} belongs elsewhere`);
      }
    },
    async markPaymentVerified(tx, i) {
      await post(tx, 'verified', i.idempotencyKey, i.paymentRef, 0, 'XXX', { evidence: i.evidenceRef });
    },
    async recordSettlementFees(tx, i) {
      return {
        journalEntryId: await post(
          tx,
          'fees',
          i.idempotencyKey,
          i.statementRef,
          i.amount.amountMinor,
          i.amount.currency,
          {
            clearing: i.clearing,
          },
        ),
      };
    },
    async recordPayment(tx, i) {
      assertScope(tx, { type: 'folio', id: i.folioId }, i);
      return {
        postingId: await post(
          tx,
          'payment',
          i.idempotencyKey,
          { type: 'folio', id: i.folioId },
          i.amount.amountMinor,
          i.amount.currency,
          {
            method: i.method,
            verification: i.verification,
            paymentRef: i.paymentRef,
            propertyId: i.propertyId,
            legalEntityId: i.legalEntityId,
            clearing: i.clearing,
          },
        ),
      };
    },
    async recordDeposit(tx, i) {
      assertScope(tx, { type: 'booking', id: i.bookingId }, i);
      return {
        postingId: await post(
          tx,
          'deposit',
          i.idempotencyKey,
          { type: 'booking', id: i.bookingId },
          i.amount.amountMinor,
          i.amount.currency,
          {
            method: i.method,
            verification: i.verification,
            paymentRef: i.paymentRef,
            propertyId: i.propertyId,
            legalEntityId: i.legalEntityId,
            clearing: i.clearing,
          },
        ),
      };
    },
    async recordRefund(tx, i) {
      const ref = i.folioId
        ? { type: 'folio', id: i.folioId }
        : { type: 'booking', id: i.bookingId as string };
      assertScope(tx, ref, i);
      return {
        postingId: await post(tx, 'refund', i.idempotencyKey, ref, -i.amount.amountMinor, i.amount.currency, {
          originalPaymentRef: i.originalPaymentRef,
        }),
      };
    },
    async recordPayout(tx, i) {
      return {
        journalEntryId: await post(
          tx,
          'payout',
          i.idempotencyKey,
          { type: 'legal_entity', id: i.legalEntityId },
          i.net.amountMinor,
          i.currency,
          {
            gross: i.gross.amountMinor,
            fees: i.fees.amountMinor,
          },
        ),
      };
    },
    async recordPaymentAdjustment(tx, i) {
      const ref = i.folioId
        ? { type: 'folio', id: i.folioId }
        : { type: 'booking', id: i.bookingId as string };
      assertScope(tx, ref, i);
      return {
        postingId: await post(
          tx,
          'adjustment',
          i.idempotencyKey,
          ref,
          i.amount.amountMinor,
          i.amount.currency,
          { reason: i.reason },
        ),
      };
    },
    async recordDisputeMovement(tx, i) {
      return {
        journalEntryId: await post(
          tx,
          `dispute_${i.kind}`,
          i.idempotencyKey,
          i.paymentRef,
          i.kind === 'debit' ? -i.amount.amountMinor : i.amount.amountMinor,
          i.amount.currency,
        ),
      };
    },
  };
}

/** The real platform module, bound the way the composition root binds it. */
export const platformPort: PlatformPort = {
  async getProperty(tx, propertyId) {
    const p = await platform.getProperty({ ...tx, authz: systemAuthorizer }, propertyId);
    return { id: p.id, legalEntityId: p.legalEntityId, timezone: p.timezone, baseCurrency: p.baseCurrency };
  },
  async getLegalEntity(tx, id) {
    const le = await platform.getLegalEntity(tx, id);
    return { id: le.id, countryCode: le.countryCode, baseCurrency: le.baseCurrency };
  },
  assertWritable: (tx, propertyId, domain) => platform.assertWritable(tx, propertyId, domain),
  async resolvePolicy(tx, propertyId, key, defaultValue) {
    const r = await platform.resolvePolicy(tx, propertyId, key, defaultValue);
    return { value: r.value };
  },
};

export interface Harness {
  t: TestDatabase;
  db: PorticoDatabase;
  clock: ReturnType<typeof fixedClock>;
  ledger: LedgerControls;
  http: { calls: number; client: HttpClient };
  secrets: { live: string | null; sandbox: string | null; webhookSecret: string };
  module: ReturnType<typeof createPaymentsModule>;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const clock = fixedClock(T0);
  const t = await createTestDatabase(sourcesFromManifests([platformManifest, paymentsManifest]), { clock });
  await sql`create schema test_ledger;
    create table test_ledger.postings (
      id uuid primary key, tenant_id uuid not null, kind text not null, idempotency_key text not null,
      ref_type text not null, ref_id text not null, amount_minor bigint not null, currency char(3) not null,
      extra jsonb not null default '{}', unique (tenant_id, idempotency_key));
    select core.enable_tenant_isolation('test_ledger.postings');
    select core.apply_standard_grants('test_ledger');`.execute(t.admin.kysely);
  const ledger: LedgerControls = {
    failWith: null,
    defaultOwner: new Map(),
    owners: new Map(),
    unknown: new Set(),
    directBookings: new Set(),
  };
  const http = {
    calls: 0,
    client: {
      async send() {
        http.calls++;
        throw new Error('Tests must never reach a real provider.');
      },
    } as HttpClient,
  };
  const secrets = {
    live: null as string | null,
    sandbox: null as string | null,
    webhookSecret: 'whsec_test_harness',
  };
  const secretsPort: ProviderSecretsPort = {
    stripeSecretKey: (mode) => (mode === 'live' ? secrets.live : secrets.sandbox),
    stripeWebhookSecrets: () => [secrets.webhookSecret],
  };
  const module = createPaymentsModule({
    database: t.db,
    ledger: fakeLedger(ledger),
    references: fakeReferences(ledger),
    platform: platformPort,
    secrets: secretsPort,
    simulatorSigningSecret: 'sim-signing-test',
    http: { send: (r) => http.client.send(r) },
  });
  return {
    t,
    db: t.db,
    clock,
    ledger,
    http,
    secrets,
    module,
    async close() {
      await t.drop();
    },
  };
}

export interface Org {
  ctx: RequestContext;
  tenantId: string;
  legalEntityId: string;
  propertyId: string;
  otherPropertyId: string;
  simAccountId: string;
  terminalAccountId: string;
  tx<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
  /** A context with only these grants (property-scoped to the main property unless 'all'). */
  as(permissions: string[], propertyIds?: string[] | 'all'): RequestContext;
}

export async function setupOrg(h: Harness, environment: TenantEnvironment = 'demo'): Promise<Org> {
  const ctx = testContext({ environment });
  await withTenantTx(h.db, ctx, (tx) =>
    platform.provisionOrganization(tx, {
      name: 'Azure Atoll',
      slug: `azure-${ctx.tenantId.slice(-12)}`,
      environment,
      planCode: 'enterprise',
    }),
  );
  const le = await withTenantTx(h.db, ctx, (tx) =>
    platform.createLegalEntity(tx, {
      name: 'Azure Atoll Pvt Ltd',
      legalName: 'Azure Atoll Hospitality Private Limited',
      countryCode: 'MV',
      baseCurrency: 'USD',
    }),
  );
  const mkProperty = (code: string) =>
    withTenantTx(h.db, ctx, (tx) =>
      platform.createProperty(tx, {
        code,
        name: `Resort ${code}`,
        profile: 'resort',
        legalEntityId: le.id,
        countryCode: 'MV',
        timezone: 'Indian/Maldives',
        baseCurrency: 'USD',
        businessDate: '2026-11-07',
      }),
    );
  const p1 = await mkProperty('AZR');
  const p2 = await mkProperty('AZH');
  // Any folio/booking used by a test belongs to the main property unless a test says otherwise.
  h.ledger.defaultOwner.set(ctx.tenantId, { propertyId: p1.id, legalEntityId: le.id });
  const svc = h.module.service;
  const sim =
    environment === 'live'
      ? null
      : await withTenantTx(h.db, ctx, (tx) =>
          svc.tx.createAccount(tx, {
            legalEntityId: le.id,
            provider: 'simulator',
            displayName: 'Simulated cards',
            currencies: ['USD', 'MVR'],
          }),
        );
  const terminal = await withTenantTx(h.db, ctx, (tx) =>
    svc.tx.createAccount(tx, {
      legalEntityId: le.id,
      provider: 'external_terminal',
      externalAccountId: 'BML-TID-0042',
      displayName: 'BML terminal (front desk)',
      currencies: ['USD', 'MVR'],
    }),
  );
  return {
    ctx,
    tenantId: ctx.tenantId,
    legalEntityId: le.id,
    propertyId: p1.id,
    otherPropertyId: p2.id,
    simAccountId: sim?.id ?? '',
    terminalAccountId: terminal.id,
    tx: (fn) => withTenantTx(h.db, ctx, fn),
    as(permissions, propertyIds) {
      return {
        ...testContext({
          tenantId: ctx.tenantId,
          environment,
          grants: permissions.map((p) => ({ permission: p, propertyIds: propertyIds ?? [p1.id] })),
        }),
      };
    },
  };
}

export async function addMethod(
  h: Harness,
  org: Org,
  token = 'pm_card_visa',
  mitAgreement = true,
  ownerId: string = newId(),
): Promise<string> {
  const m = await org.tx((tx) =>
    h.module.service.tx.createMethod(tx, {
      accountId: org.simAccountId,
      propertyId: org.propertyId,
      kind: 'card',
      providerToken: token,
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
      holderName: 'Aisha Ibrahim',
      owner: { type: 'guest_profile', id: ownerId },
      entryChannel: 'hosted_entry',
      mitAgreement,
      ...(mitAgreement
        ? {
            mandate: {
              termsVersion: 'T-2026-1',
              acceptedAt: h.clock.now().toISOString(),
              channel: 'booking_engine',
            },
          }
        : {}),
    }),
  );
  return m.id;
}

/**
 * A Stripe Connect account as it exists after Portico-initiated onboarding: linked by a (test) Monoclay operator
 * and, optionally, activated as Stripe would report it (test setup only — tenants can never self-activate).
 */
export async function stripeAccount(
  h: Harness,
  org: Org,
  externalAccountId: string,
  activate = true,
): Promise<string> {
  const svc = h.module.service;
  const a = await org.tx((tx) =>
    svc.tx.createAccount(tx, {
      legalEntityId: org.legalEntityId,
      provider: 'stripe_connect',
      displayName: 'Hotel Stripe',
      currencies: ['USD'],
    }),
  );
  await withTenantTx(h.db, systemContext(org.tenantId, 'operator:test', org.ctx.environment, newId()), (tx) =>
    svc.operator.linkProviderAccount(tx, { accountId: a.id, externalAccountId, verifiedBy: 'test-operator' }),
  );
  if (activate) {
    await sql`update payments.accounts set status = 'active', onboarding_status = 'complete', status_reason = null
      where id = ${a.id}`.execute(h.t.admin.kysely);
  }
  return a.id;
}

export async function setControls(h: Harness, org: Org, controls: Record<string, unknown>): Promise<void> {
  await org.tx((tx) => h.module.service.tx.setSimulatorControls(tx, org.simAccountId, controls));
}

export async function postings(h: Harness, org: Org, kind?: string) {
  const { rows } = await sql<{
    kind: string;
    amount_minor: number;
    idempotency_key: string;
    ref_id: string;
    extra: Record<string, unknown>;
  }>`
    select kind, amount_minor, idempotency_key, ref_id, extra from test_ledger.postings
     where tenant_id = ${org.tenantId} ${kind ? sql`and kind = ${kind}` : sql``}
     order by idempotency_key`.execute(h.t.admin.kysely);
  return rows;
}

export async function deliverWebhooks(h: Harness, org: Org) {
  return h.module.service.deliverSimulatorWebhooks(org.ctx, org.simAccountId);
}

/** Process outbox events with the payments consumers (worker behaviour). */
export async function drain(h: Harness): Promise<void> {
  await drainOutbox(h.db, {
    subscriptions: h.module.subscriptions,
    environmentOf: async (tenantId) => {
      const { rows } = await sql<{
        e: TenantEnvironment;
      }>`select platform.tenant_environment(${tenantId}::uuid) as e`.execute(h.db.kysely);
      return rows[0]?.e ?? 'demo';
    },
  });
}

export { SIMULATOR_SIGNATURE_HEADER };
