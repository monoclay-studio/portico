/**
 * Distribution health (DST-R13/R14): facts gathered from the queue, the inbound log and the exchange log; the
 * connection's health is recomputed after every outcome and on the scheduler tick; transitions emit
 * `distribution.channel.degraded|restored` and drive stop-sell protection. The banner never says "synced" while
 * anything the channel should know is unconfirmed.
 */
import { sql, type TxContext } from '@portico/db';
import type { HealthView } from '../contracts';
import { budgetUse } from '../domain/budget';
import {
  type ConnectionHealth,
  computeHealth,
  type HealthFacts,
  type HealthResult,
  isDegraded,
} from '../domain/health';
import { countNights } from '../domain/ranges';
import { DISTRIBUTION_EVENTS as E } from '../events';
import { P, RECORD } from '../manifest';
import {
  type ConnectionRow,
  type DistributionDeps,
  db,
  hubBlocker,
  iso,
  loadConnection,
  provenanceOfTarget,
  requireOnConnection,
  settingsOf,
} from './common';
import { completeness } from './mappings';
import { activeProtection, applyProtection, releaseProtection } from './stop-sell';

const PARK_WINDOW_MS = 15 * 60_000;
const minDate = (vals: Array<Date | string | null | undefined>): Date | null => {
  const ds = vals.filter((v): v is Date | string => v !== null && v !== undefined).map((v) => new Date(v));
  return ds.length ? ds.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b)) : null;
};

export async function gatherFacts(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
): Promise<HealthFacts> {
  const s = settingsOf(conn);
  const [dirty, msgs, ack, failed, parked] = await Promise.all([
    db(tx)
      .selectFrom('distribution.ari_dirty')
      .select(sql<Date | null>`min(first_dirty_at)`.as('at'))
      .where('connection_id', '=', conn.id)
      .executeTakeFirst(),
    db(tx)
      .selectFrom('distribution.ari_messages')
      .select([
        sql<Date | null>`min(oldest_change_at)`.as('oldest'),
        sql<Date | null>`min(first_failed_at)`.as('failing'),
      ])
      .where('connection_id', '=', conn.id)
      .where('status', 'in', ['queued', 'sending', 'failed_transient'])
      .executeTakeFirst(),
    db(tx)
      .selectFrom('distribution.revision_processing')
      .select(sql<Date | null>`min(ack_first_failed_at)`.as('at'))
      .where('connection_id', '=', conn.id)
      .where('ack_state', 'in', ['pending', 'sending', 'failed'])
      .executeTakeFirst(),
    db(tx)
      .selectFrom('distribution.revision_processing')
      .select(sql<Date | null>`min(first_failed_at)`.as('at'))
      .where('connection_id', '=', conn.id)
      .where('state', '=', 'failed')
      .executeTakeFirst(),
    db(tx)
      .selectFrom('distribution.revision_processing')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('connection_id', '=', conn.id)
      .where('state', '=', 'parked')
      .where('parked_since', '<=', new Date(tx.now.getTime() - PARK_WINDOW_MS))
      .executeTakeFirst(),
  ]);
  let blocked: string | null = null;
  if (conn.status === 'active') {
    for (const domain of ['availability', 'rates'] as const) {
      const a = await deps.ports.platform.getDataAuthority(tx, conn.property_id, domain);
      if (a.authority === 'external') {
        blocked = `${a.systemName ?? 'Another system'} is the system of record for ${domain}; Portico does not publish it to channels.`;
        break;
      }
    }
  }
  const hub = conn.status === 'active' || conn.status === 'paused' ? await hubBlocker(tx, deps, conn) : null;
  return {
    status: conn.status,
    credentialState: conn.credential_state,
    publicationBlocked: blocked,
    hubRefused: hub && hub.code !== 'credentials_invalid' ? hub : null,
    oldestUnconfirmedChangeAt: minDate([dirty?.at, msgs?.oldest]),
    ariFailingSince: minDate([msgs?.failing]),
    ackFailingSince: minDate([ack?.at]),
    applyFailingSince: minDate([failed?.at]),
    parkedOverdue: parked?.n ?? 0,
    inboundGapAt: conn.inbound_gap_at ? new Date(conn.inbound_gap_at) : null,
    now: tx.now,
    freshnessTargetMs: s.freshnessTargetSeconds * 1000,
    gapCooldownMs: s.stopSellProtection.cooldownMinutes * 60_000,
  };
}

/**
 * Recompute health; on a change, store it and emit degraded/restored. Then apply protection when degraded, or
 * release it after the cool-down of healthy time. Idempotent.
 */
export async function refreshHealth(
  tx: TxContext,
  deps: DistributionDeps,
  connIn: ConnectionRow,
): Promise<HealthResult> {
  const conn = await loadConnection(tx, connIn.id, { forUpdate: true });
  const result = computeHealth(await gatherFacts(tx, deps, conn));
  const previous = conn.health as ConnectionHealth;
  let changedAt = conn.health_changed_at ? new Date(conn.health_changed_at) : null;
  if (previous !== result.health || conn.health_reason !== result.reason) {
    const healthChanged = previous !== result.health;
    if (healthChanged) changedAt = tx.now;
    await db(tx)
      .updateTable('distribution.connections')
      .set({
        health: result.health,
        health_reason: result.reason,
        ...(healthChanged ? { health_changed_at: tx.now } : {}),
      })
      .where('id', '=', conn.id)
      .execute();
    if (
      healthChanged &&
      (isDegraded(result.health) || result.health === 'credentials_invalid' || result.health === 'blocked')
    ) {
      await tx.emit({
        type: E.channelDegraded,
        propertyId: conn.property_id,
        aggregate: { type: RECORD.connection, id: conn.id },
        payload: {
          connectionId: conn.id,
          propertyId: conn.property_id,
          health: result.health,
          previous,
          reason: result.reason,
        },
      });
    } else if (healthChanged && result.health === 'connected') {
      await tx.emit({
        type: E.channelRestored,
        propertyId: conn.property_id,
        aggregate: { type: RECORD.connection, id: conn.id },
        payload: {
          connectionId: conn.id,
          propertyId: conn.property_id,
          health: result.health,
          previous,
          reason: result.reason,
        },
      });
    }
  }
  if (conn.status === 'active') {
    const protection = settingsOf(conn).stopSellProtection;
    const active = await activeProtection(tx, conn.id);
    if (protection.enabled && isDegraded(result.health) && !active) {
      await applyProtection(tx, deps, conn, result.reason);
    } else if (active && !protection.enabled) {
      await releaseProtection(tx, deps, conn, 'Stop-sell protection was switched off for this connection.');
    } else if (
      active &&
      result.health === 'connected' &&
      changedAt &&
      tx.now.getTime() - changedAt.getTime() >= protection.cooldownMinutes * 60_000
    ) {
      await releaseProtection(
        tx,
        deps,
        conn,
        `The connection has been healthy for ${protection.cooldownMinutes} minutes; every unit is published again.`,
      );
    }
  }
  return result;
}

/** When the next health-driven action is due (protection release after the cool-down). */
export async function nextHealthDue(tx: TxContext, conn: ConnectionRow): Promise<Date | null> {
  const active = await activeProtection(tx, conn.id);
  if (!active || conn.health !== 'connected' || !conn.health_changed_at) return null;
  return new Date(
    new Date(conn.health_changed_at).getTime() + settingsOf(conn).stopSellProtection.cooldownMinutes * 60_000,
  );
}

function banner(conn: ConnectionRow, r: HealthResult, pendingNights: number): HealthView['banner'] {
  if (r.health === 'connected' || r.health === 'not_active') return null;
  const since = r.staleSince ? ` since ${r.staleSince}` : '';
  const urgent = r.health === 'failing' || r.health === 'credentials_invalid';
  const nextStep: Record<ConnectionHealth, string> = {
    connected: '',
    not_active: '',
    degraded:
      'Portico retries automatically; the last units are protected on this channel while it is behind.',
    failing: 'Check the hub status and the exception list; consider closing more inventory on this channel.',
    credentials_invalid: 'Replace the hub API key in the connection and verify it.',
    paused: 'Resume the connection to publish the queued changes.',
    blocked:
      r.blockedBy === 'hub'
        ? conn.credential_state === 'unverified'
          ? 'Verify the hub API key in the connection; queued changes and acknowledgements are sent once it is verified.'
          : 'Contact Monoclay support: this connection is not allowed to reach the hub in this environment.'
        : 'Publish from the system of record, or make Portico the system of record again.',
  };
  return {
    severity: urgent ? 'urgent' : 'warning',
    message: `${conn.name}: availability and rates on this channel are NOT confirmed${since} (${pendingNights} unit-type night(s) waiting). ${r.reason} Channel bookings may also arrive late.`,
    staleSince: r.staleSince,
    nextStep: nextStep[r.health],
  };
}

export async function getHealth(
  tx: TxContext,
  deps: DistributionDeps,
  connectionId: string,
): Promise<HealthView> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.channelRead);
  const facts = await gatherFacts(tx, deps, conn);
  const r = computeHealth(facts);
  const s = settingsOf(conn);
  const [dirty, open, budgets, errors, revs, exc, disc, protection, mapping] = await Promise.all([
    db(tx)
      .selectFrom('distribution.ari_dirty')
      .select(['ranges', 'merged_deltas'])
      .where('connection_id', '=', conn.id)
      .execute(),
    db(tx)
      .selectFrom('distribution.ari_messages')
      .select(['id', 'kind', 'status', 'attempts', 'next_attempt_at', 'cell_count'])
      .where('connection_id', '=', conn.id)
      .where('status', 'in', ['queued', 'sending', 'failed_transient'])
      .execute(),
    db(tx).selectFrom('distribution.ari_budget').selectAll().where('connection_id', '=', conn.id).execute(),
    db(tx)
      .selectFrom('distribution.exchange_log')
      .select([
        sql<number>`count(*)::int`.as('calls'),
        sql<number>`count(*) filter (where outcome not in ('accepted', 'acked', 'pulled', 'ok'))::int`.as(
          'failures',
        ),
      ])
      .where('connection_id', '=', conn.id)
      .where('direction', '=', 'outbound')
      .where('occurred_at', '>=', new Date(tx.now.getTime() - 86_400_000))
      .executeTakeFirst(),
    db(tx)
      .selectFrom('distribution.revision_processing')
      .select([
        sql<number>`count(*) filter (where state = 'parked')::int`.as('parked'),
        sql<number>`count(*) filter (where state = 'failed')::int`.as('failed'),
        sql<number>`count(*) filter (where ack_state in ('pending', 'sending', 'failed'))::int`.as(
          'awaiting',
        ),
        sql<Date | null>`min(processed_at) filter (where ack_state in ('pending', 'sending', 'failed'))`.as(
          'oldestUnacked',
        ),
      ])
      .where('connection_id', '=', conn.id)
      .executeTakeFirst(),
    db(tx)
      .selectFrom('distribution.exceptions')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('connection_id', '=', conn.id)
      .where('status', '=', 'open')
      .executeTakeFirst(),
    db(tx)
      .selectFrom('distribution.discrepancies')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('connection_id', '=', conn.id)
      .where('status', 'in', ['open', 'investigating'])
      .executeTakeFirst(),
    activeProtection(tx, conn.id),
    completeness(tx, deps, conn).catch(() => null),
  ]);
  const dirtyNights = dirty.reduce(
    (n, d) => n + countNights(d.ranges as Array<{ from: string; to: string }>),
    0,
  );
  const pendingNights = dirtyNights + open.reduce((n, m) => n + m.cell_count, 0);
  const budget: HealthView['budget'] = {};
  for (const kind of ['availability', 'restrictions'] as const) {
    const b = budgets.find((x) => x.kind === kind);
    budget[kind] = budgetUse(
      {
        sends: (b?.sends ?? []).map((d) => new Date(d)),
        pausedUntil: b?.paused_until ? new Date(b.paused_until) : null,
      },
      tx.now,
      kind === 'availability' ? s.availabilityPerMinute : s.restrictionsPerMinute,
    );
  }
  return {
    connectionId: conn.id,
    propertyId: conn.property_id,
    health: r.health,
    reason: r.reason,
    staleSince: r.staleSince,
    provenance: provenanceOfTarget(conn.target),
    lastSuccessfulPushAt: iso(conn.last_push_at),
    lastReservationReceivedAt: iso(conn.last_revision_at),
    oldestUnconfirmedChangeAt: iso(facts.oldestUnconfirmedChangeAt),
    oldestUnacknowledgedRevisionAt: iso(revs?.oldestUnacked ?? null),
    queue: {
      dirtyProducts: dirty.length,
      dirtyNights,
      mergedDeltas: dirty.reduce((n, d) => n + d.merged_deltas, 0),
      openMessages: open.map((m) => ({
        id: m.id,
        kind: m.kind,
        status: m.status,
        attempts: m.attempts,
        nextAttemptAt: iso(m.next_attempt_at),
        cells: m.cell_count,
      })),
    },
    budget,
    errors24h: { calls: errors?.calls ?? 0, failures: errors?.failures ?? 0 },
    mapping: mapping
      ? { mapped: mapping.mapped, total: mapping.total, complete: mapping.complete }
      : { mapped: 0, total: 0, complete: false },
    revisions: { parked: revs?.parked ?? 0, failed: revs?.failed ?? 0, awaitingAck: revs?.awaiting ?? 0 },
    openExceptions: exc?.n ?? 0,
    openDiscrepancies: disc?.n ?? 0,
    protection: protection
      ? { id: protection.id, since: iso(protection.created_at) as string, threshold: protection.threshold }
      : null,
    banner: banner(conn, r, pendingNights),
  };
}

/** Property banner (DST-R14): every connection of the property that is not connected. */
export async function propertyHealth(
  tx: TxContext,
  deps: DistributionDeps,
  propertyId: string,
): Promise<HealthView[]> {
  const conns = await db(tx)
    .selectFrom('distribution.connections')
    .select(['id', 'property_id'])
    .where('property_id', '=', propertyId)
    .where('status', '<>', 'disconnected')
    .execute();
  const out: HealthView[] = [];
  for (const c of conns) {
    requireOnConnection(tx, c, P.channelRead);
    out.push(await getHealth(tx, deps, c.id));
  }
  return out;
}
