/**
 * Background work. Change capture is event-driven (outbox consumer, below): nothing polls inventory or rates. The
 * only periodic thing is the scheduler tick, which claims organizations whose `next_due_at` has passed (an index
 * that writers pull earlier when they queue work) and runs their due work: process revisions, send ARI within the
 * budget, acknowledge, pull the feed when due, nightly resync, escalate orphans, refresh health. It then stores
 * the next instant anything is due.
 */
import {
  type PorticoDatabase,
  type ScheduledJob,
  sql,
  type TxEventSubscription,
  withTenantTx,
} from '@portico/db';
import {
  type DomainEvent,
  newId,
  type RequestContext,
  systemContext,
  type TenantEnvironment,
} from '@portico/kernel';
import { ARI_KINDS, type AriKind } from '../domain/ari';
import {
  availabilityChangedPayload,
  CONSUMED_EVENTS,
  dataAuthorityChangedPayload,
  guestAnonymizedPayload,
  pricesChangedPayload,
  restrictionsChangedPayload,
} from '../events';
import { markPropertyDirty, publishingConnections } from './ari-dirty';
import { dispatchKind, nextBudgetSlot, publicationBlockedBy } from './ari-dispatch';
import { checkDiscrepancies } from './calendar';
import {
  type ConnectionRow,
  type DistributionDeps,
  db,
  hubBlocker,
  loadConnection,
  settingsOf,
} from './common';
import { onAuthorityChanged, requestResync } from './connections';
import { applyRetention, eraseRevisionGuestData } from './erasure';
import { raiseException } from './exceptions';
import { nextHealthDue, refreshHealth } from './health';
import { dispatchAcks, escalateParked, PARK_ESCALATION_MS, processInbound, pullFeed } from './inbound';

export interface TenantWorkResult {
  processed: number;
  sent: number;
  acked: number;
  pulled: number;
  nextDueAt: string;
  errors: string[];
}

const MAX_SENDS_PER_KIND_PER_TICK = 5;
/** Longest an organization with connections sleeps (re-check of external conditions; feed-pull cadence). */
const CEILING_MS = 15 * 60_000;

async function connectionWork(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  c: ConnectionRow,
  res: TenantWorkResult,
): Promise<void> {
  const health = (tx: Parameters<typeof refreshHealth>[0], conn: ConnectionRow) =>
    refreshHealth(tx, deps, conn).then(() => {});
  // 1. Bookings first: inventory decisions depend on them.
  res.processed += (await processInbound(database, deps, ctx, c.id)).processed;
  // 2. Feed pull (safety net for missed webhooks) and nightly resync when due.
  const now = database.clock.now();
  if (
    (c.status === 'active' || c.status === 'paused') &&
    c.next_feed_pull_at &&
    new Date(c.next_feed_pull_at) <= now
  ) {
    const r = await pullFeed(database, deps, ctx, c.id, 'feed');
    res.pulled += r.stored;
    if (r.stored > 0) res.processed += (await processInbound(database, deps, ctx, c.id)).processed;
  }
  if (c.status === 'active' && c.next_full_sync_at && new Date(c.next_full_sync_at) <= now) {
    await withTenantTx(database, ctx, async (tx) => {
      const conn = await loadConnection(tx, c.id);
      await checkDiscrepancies(tx, deps, conn);
      await requestResync(tx, deps, conn, { trigger: 'nightly' });
      await applyRetention(tx, deps, conn); // guest data past its retention (P2-7), once a day
    });
  }
  // 3. ARI, within the budget (each call is one message; changes keep merging while the budget is spent).
  if (c.status === 'active') {
    for (const kind of ARI_KINDS) {
      for (let i = 0; i < MAX_SENDS_PER_KIND_PER_TICK; i++) {
        const r = await dispatchKind(database, deps, ctx, c.id, kind, health);
        if (!r.sent) break;
        res.sent++;
        if (r.outcome === 'failed_transient') break;
      }
    }
  }
  // 4. Acknowledgements of committed outcomes.
  res.acked += (await dispatchAcks(database, deps, ctx, c.id)).acked;
  // 5. Escalations and health.
  await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, c.id);
    await escalateParked(tx, conn);
    await refreshHealth(tx, deps, conn);
  });
}

/**
 * The next instant at which some work of this organization can actually PROGRESS (P1-1). Work that waits on a person
 * or on another system contributes nothing: hub work while the key is refused or unverified or the environment /
 * live scope refuses the hub (`hubBlocker`), ARI of a kind another system of record controls
 * (`publicationBlockedBy`), ARI of a paused connection. The transitions that remove those conditions pull the
 * schedule themselves (verify, resume, authority back → resync). Health instants count only while they are in the
 * future (one wake when the oldest change crosses the freshness target, never one per pass). The ceiling (15 min)
 * re-checks conditions that change outside this module (environment, live scope) and is the feed-pull cadence.
 */
export async function nextDue(
  tx: Parameters<typeof refreshHealth>[0],
  deps: DistributionDeps,
  conns: ConnectionRow[],
): Promise<Date> {
  const now = tx.now.getTime();
  const candidates: Date[] = [new Date(now + CEILING_MS)];
  const push = (d: Date | string | null | undefined) => {
    if (d) candidates.push(new Date(d));
  };
  const pushFuture = (d: Date | string | null | undefined) => {
    if (d && new Date(d).getTime() > now) candidates.push(new Date(d));
  };
  for (const c of conns) {
    if (c.status === 'disconnected' || c.status === 'setup') continue;
    const hubBlocked = (await hubBlocker(tx, deps, c)) !== null;
    if (!hubBlocked) push(c.next_feed_pull_at);
    if (c.status === 'active') push(c.next_full_sync_at);
    pushFuture(await nextHealthDue(tx, c));
    if (c.status === 'active' && !hubBlocked) {
      for (const kind of ARI_KINDS) {
        if (await publicationBlockedBy(tx, deps, c, kind)) continue;
        const open = await db(tx)
          .selectFrom('distribution.ari_messages')
          .select(['next_attempt_at', 'lease_until', 'status'])
          .where('connection_id', '=', c.id)
          .where('kind', '=', kind)
          .where('status', 'in', ['queued', 'sending', 'failed_transient'])
          .executeTakeFirst();
        if (open) push(open.status === 'sending' ? open.lease_until : open.next_attempt_at);
        const dirty = await db(tx)
          .selectFrom('distribution.ari_dirty')
          .select(sql<Date | null>`min(first_dirty_at)`.as('at'))
          .where('connection_id', '=', c.id)
          .where('kind', '=', kind)
          .executeTakeFirst();
        if (dirty?.at && !open) push(await nextBudgetSlot(tx, deps, c, kind));
        // Re-evaluate health once, when the oldest unconfirmed change crosses the freshness target.
        if (dirty?.at)
          pushFuture(
            new Date(new Date(dirty.at).getTime() + settingsOf(c).freshnessTargetSeconds * 1000 + 1000),
          );
      }
    }
    // Changes the hub answered in an unrecognised shape stay unconfirmed (P2-3): one health wake at the crossing.
    const unverified = await db(tx)
      .selectFrom('distribution.ari_messages')
      .select(sql<Date | null>`min(oldest_change_at)`.as('at'))
      .where('connection_id', '=', c.id)
      .where('status', '=', 'pending_verification')
      .executeTakeFirst();
    if (unverified?.at)
      pushFuture(
        new Date(new Date(unverified.at).getTime() + settingsOf(c).freshnessTargetSeconds * 1000 + 1000),
      );
    const rp = await db(tx)
      .selectFrom('distribution.revision_processing')
      .select([
        sql<Date | null>`min(next_attempt_at) filter (where state in ('received', 'failed'))`.as('apply'),
        sql<Date | null>`min(ack_next_at) filter (where ack_state in ('pending', 'failed'))`.as('ack'),
        sql<Date | null>`min(ack_lease_until) filter (where ack_state = 'sending')`.as('lease'),
        sql<Date | null>`min(parked_since) filter (where state = 'parked' and park_reason = 'orphan' and escalated_at is null)`.as(
          'parked',
        ),
      ])
      .where('connection_id', '=', c.id)
      .executeTakeFirst();
    push(rp?.apply);
    if (!hubBlocked) {
      push(rp?.ack);
      push(rp?.lease);
    }
    if (rp?.parked) pushFuture(new Date(new Date(rp.parked).getTime() + PARK_ESCALATION_MS));
  }
  const min = Math.min(...candidates.map((d) => d.getTime()));
  return new Date(Math.max(now + 1000, min));
}

/** All due distribution work of one organization (in its own context and environment). */
export async function runTenantWork(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
): Promise<TenantWorkResult> {
  const res: TenantWorkResult = { processed: 0, sent: 0, acked: 0, pulled: 0, nextDueAt: '', errors: [] };
  const conns = await withTenantTx(database, ctx, (tx) =>
    db(tx)
      .selectFrom('distribution.connections')
      .selectAll()
      .where('status', 'in', ['active', 'paused'])
      .execute(),
  );
  for (const c of conns) {
    try {
      await connectionWork(database, deps, ctx, c, res);
    } catch (err) {
      res.errors.push(`${c.id}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    }
  }
  const next = await withTenantTx(database, ctx, async (tx) => {
    await sql`select 1 from distribution.tenant_schedule where tenant_id = ${tx.tenantId}::uuid for update`.execute(
      tx.db,
    );
    const fresh = await db(tx)
      .selectFrom('distribution.connections')
      .selectAll()
      .where('status', 'in', ['active', 'paused'])
      .execute();
    const at = await nextDue(tx, deps, fresh);
    await sql`insert into distribution.tenant_schedule (tenant_id, next_due_at, lease_until)
              values (${tx.tenantId}::uuid, ${at}, null)
              on conflict (tenant_id) do update set next_due_at = excluded.next_due_at, lease_until = null`.execute(
      tx.db,
    );
    return at;
  });
  res.nextDueAt = next.toISOString();
  return res;
}

/** Scheduled job (apps/worker): wakes organizations whose distribution work is due. */
export function distributionJobs(
  deps: DistributionDeps,
  opts: { batch?: number; intervalSeconds?: number; onError?: (tenantId: string, err: unknown) => void } = {},
): ScheduledJob[] {
  return [
    {
      name: 'distribution.dueWork',
      intervalSeconds: opts.intervalSeconds ?? 2,
      leaseSeconds: 300,
      async run(database) {
        const { rows } = await sql<{ tenant_id: string; environment: TenantEnvironment | null }>`
          select * from distribution.claim_due_tenants(${database.clock.now()}, ${opts.batch ?? 20}, 300)`.execute(
          database.kysely,
        );
        for (const r of rows) {
          if (!r.environment) continue;
          try {
            const result = await runTenantWork(
              database,
              deps,
              systemContext(r.tenant_id, 'distribution-scheduler', r.environment, newId()),
            );
            for (const e of result.errors) opts.onError?.(r.tenant_id, new Error(e));
          } catch (err) {
            opts.onError?.(r.tenant_id, err);
          }
        }
      },
    },
  ];
}

/**
 * A change event Portico cannot read is never dropped silently (P2-8, AP-35/43): every publishing connection of the
 * property gets an urgent exception (Monoclay: a producer changed its event format) and is marked fully dirty for
 * the kind — values are read at send time, so a full resync publishes the current truth whatever the event said. A
 * property with no publishing connection raises nothing. Without even a property, the delivery fails (retried,
 * then dead-lettered in the outbox, visible to operations).
 */
async function unreadableChange(
  tx: Parameters<TxEventSubscription['handle']>[0],
  deps: DistributionDeps,
  event: DomainEvent,
  kinds: AriKind[],
  error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> },
): Promise<void> {
  const raw = event.payload as { propertyId?: unknown } | null;
  const propertyId = event.propertyId ?? (raw && typeof raw.propertyId === 'string' ? raw.propertyId : null);
  const issues = error.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '(payload)'}: ${i.message}`)
    .join('; ');
  if (!propertyId)
    throw new Error(`Unreadable ${event.type} event ${event.id} without a property (${issues}).`);
  for (const conn of await publishingConnections(tx, propertyId)) {
    await raiseException(tx, {
      connectionId: conn.id,
      propertyId,
      code: 'change_event_unreadable',
      dedupeKey: `change_event_unreadable:${event.type}`,
      severity: 'urgent',
      problem: `A ${event.type} change could not be read (${issues}); Portico cannot tell which nights changed.`,
      businessImpact:
        'Portico re-sends every night of this connection for the affected kind instead (current values), so the channel catches up; until then it may be behind.',
      responsibleParty: 'monoclay',
      nextStep: 'Monoclay support checks the event format of the module that produced it.',
      refs: [{ type: 'event', id: event.id }],
    });
    await requestResync(tx, deps, conn, { trigger: 'on_demand', kinds });
  }
}

/**
 * Change capture (DST-R04): availability and rate events mark the affected cells dirty — never values, so a
 * late, repeated or reordered event can at most cause one redundant send of CURRENT values (idempotent consumer).
 */
export function distributionSubscriptions(deps: DistributionDeps): TxEventSubscription[] {
  const erasure = deps.ports.guestErasure;
  return [
    // P2-7: a guest's anonymization reaches the stored revisions of their channel bookings — only when the lookup
    // port is bound (FR-7); unbound, no subscription exists (README "Guest data": staff action and retention).
    ...(erasure
      ? [
          {
            consumer: 'distribution.guest.erasure',
            types: [CONSUMED_EVENTS.guestAnonymized],
            async handle(tx: Parameters<TxEventSubscription['handle']>[0], event: DomainEvent) {
              const p = guestAnonymizedPayload.safeParse(event.payload);
              if (!p.success)
                throw new Error(`Unreadable ${event.type} event ${event.id}: erasure not applied.`);
              const bookings = await erasure.channelBookingsOfGuests(tx, {
                profileIds: [p.data.profileId, ...p.data.alsoAnonymized],
              });
              const byConnection = new Map<string, string[]>();
              for (const b of bookings)
                byConnection.set(b.connectionId, [...(byConnection.get(b.connectionId) ?? []), b.externalId]);
              for (const [connectionId, channelBookingIds] of byConnection)
                await eraseRevisionGuestData(tx, deps, connectionId, {
                  channelBookingIds,
                  reason: `Guest profile anonymized (privacy request ${p.data.privacyRequestId}).`,
                });
            },
          } satisfies TxEventSubscription,
        ]
      : []),
    {
      consumer: 'distribution.ari.capture',
      types: [
        CONSUMED_EVENTS.availabilityChanged,
        CONSUMED_EVENTS.pricesChanged,
        CONSUMED_EVENTS.restrictionsChanged,
        CONSUMED_EVENTS.dataAuthorityChanged,
      ],
      async handle(tx, event: DomainEvent) {
        switch (event.type) {
          case CONSUMED_EVENTS.availabilityChanged: {
            const p = availabilityChangedPayload.safeParse(event.payload);
            if (!p.success) return unreadableChange(tx, deps, event, ['availability'], p.error);
            await markPropertyDirty(tx, deps, {
              propertyId: p.data.propertyId,
              kind: 'availability',
              unitTypeIds: [p.data.unitTypeId],
              ratePlanIds: [],
              ranges: [p.data.range],
            });
            return;
          }
          case CONSUMED_EVENTS.pricesChanged:
          case CONSUMED_EVENTS.restrictionsChanged: {
            const schema =
              event.type === CONSUMED_EVENTS.pricesChanged
                ? pricesChangedPayload
                : restrictionsChangedPayload;
            const p = schema.safeParse(event.payload);
            if (!p.success) return unreadableChange(tx, deps, event, ['restrictions'], p.error);
            await markPropertyDirty(tx, deps, {
              propertyId: p.data.propertyId,
              kind: 'restrictions',
              unitTypeIds: p.data.unitTypeIds,
              ratePlanIds: p.data.ratePlanIds,
              ranges: p.data.ranges,
            });
            return;
          }
          case CONSUMED_EVENTS.dataAuthorityChanged: {
            const p = dataAuthorityChangedPayload.safeParse(event.payload);
            // Authority decides whether Portico may publish at all: re-check both kinds (publication re-reads the
            // authority at every send, so a full resync is safe either way).
            if (!p.success)
              return unreadableChange(tx, deps, event, ['availability', 'restrictions'], p.error);
            await onAuthorityChanged(tx, deps, p.data.propertyId, p.data.domain);
            return;
          }
        }
      },
    },
  ];
}
