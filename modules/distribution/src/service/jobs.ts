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
import { ARI_KINDS } from '../domain/ari';
import {
  availabilityChangedPayload,
  CONSUMED_EVENTS,
  dataAuthorityChangedPayload,
  pricesChangedPayload,
  restrictionsChangedPayload,
} from '../events';
import { markPropertyDirty } from './ari-dirty';
import { dispatchKind, nextBudgetSlot } from './ari-dispatch';
import { checkDiscrepancies } from './calendar';
import { type ConnectionRow, type DistributionDeps, db, loadConnection, settingsOf } from './common';
import { onAuthorityChanged, requestResync } from './connections';
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

async function nextDue(tx: Parameters<typeof refreshHealth>[0], conns: ConnectionRow[]): Promise<Date> {
  const candidates: Date[] = [new Date(tx.now.getTime() + 15 * 60_000)];
  const push = (d: Date | string | null | undefined) => {
    if (d) candidates.push(new Date(d));
  };
  for (const c of conns) {
    if (c.status === 'disconnected' || c.status === 'setup') continue;
    push(c.next_feed_pull_at);
    if (c.status === 'active') push(c.next_full_sync_at);
    push(await nextHealthDue(tx, c));
    if (c.status === 'active') {
      for (const kind of ARI_KINDS) {
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
        if (dirty?.at && !open) push(await nextBudgetSlot(tx, c, kind));
        // Re-evaluate health when the oldest unconfirmed change crosses the freshness target.
        if (dirty?.at)
          push(new Date(new Date(dirty.at).getTime() + settingsOf(c).freshnessTargetSeconds * 1000 + 1000));
      }
    }
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
    push(rp?.ack);
    push(rp?.lease);
    if (rp?.parked) push(new Date(new Date(rp.parked).getTime() + PARK_ESCALATION_MS));
  }
  const min = Math.min(...candidates.map((d) => d.getTime()));
  return new Date(Math.max(tx.now.getTime() + 1000, min));
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
    const at = await nextDue(tx, fresh);
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
 * Change capture (DST-R04): availability and rate events mark the affected cells dirty — never values, so a
 * late, repeated or reordered event can at most cause one redundant send of CURRENT values (idempotent consumer).
 */
export function distributionSubscriptions(deps: DistributionDeps): TxEventSubscription[] {
  return [
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
            if (!p.success) return;
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
            if (!p.success) return;
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
            if (!p.success) return;
            await onAuthorityChanged(tx, deps, p.data.propertyId, p.data.domain);
            return;
          }
        }
      },
    },
  ];
}
