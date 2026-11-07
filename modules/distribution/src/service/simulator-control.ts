/**
 * Controls of the simulated hub (demo, trial, training, sandbox only — never live): create OTA booking revisions
 * and deliver their webhooks (with duplicates, reversed order or notification-only bodies), inject faults and
 * outages, and read the simulated channel calendar and request log (evidence for the rate-limit and final-state
 * assertions).
 */
import type { PorticoDatabase, TxContext } from '@portico/db';
import { withTenantTx } from '@portico/db';
import { BusinessRuleError, type RequestContext, requirePermission, sha256Hex } from '@portico/kernel';
import type { SimBookingInput, SimEndpoint, SimFaultKind, SimState } from '../adapters/channex/simulator';
import { P } from '../manifest';
import { type DistributionDeps, loadConnection } from './common';

async function simConnection(tx: TxContext, connectionId: string) {
  const conn = await loadConnection(tx, connectionId);
  requirePermission(tx, P.simulatorControl);
  if (tx.environment === 'live' || conn.target !== 'simulator') {
    throw new BusinessRuleError(
      'simulator_not_available',
      'This connection uses a real hub: simulator controls are only available for simulated connections outside live organizations.',
    );
  }
  return conn;
}

export async function readSimulator(
  tx: TxContext,
  deps: DistributionDeps,
  connectionId: string,
): Promise<SimState> {
  const conn = await simConnection(tx, connectionId);
  const state = await deps.simulator.read(tx.tenantId, conn.external_property_id, tx);
  // The simulated key and the webhook token are secrets of this connection: never returned.
  return {
    ...state,
    apiKey: '***',
    webhook: state.webhook
      ? {
          ...state.webhook,
          headers: Object.fromEntries(Object.keys(state.webhook.headers).map((k) => [k, '***'])),
        }
      : null,
  };
}

export async function simulateBooking(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  connectionId: string,
  input: SimBookingInput & {
    deliver?: { webhook?: boolean; duplicate?: number; notificationOnly?: boolean; reverse?: boolean };
    idempotencyKey?: string;
  },
): Promise<{
  revisionId: string;
  bookingId: string;
  deliveries: Array<{ revisionId: string; status: number }>;
}> {
  const conn = await withTenantTx(database, ctx, (tx) => simConnection(tx, connectionId));
  const { deliver, idempotencyKey, ...booking } = input;
  // Idempotent: the same key always names the same simulated revision (a retry re-delivers, never re-creates).
  const revisionId = idempotencyKey
    ? `sim-${sha256Hex(`${connectionId}:${idempotencyKey}`).slice(0, 32)}`
    : undefined;
  const rev = await deps.simulator.addRevision(ctx.tenantId, conn.external_property_id, {
    ...booking,
    ...(revisionId ? { revisionId } : {}),
  });
  const deliveries =
    deliver?.webhook === false
      ? []
      : await deps.simulator.deliver(ctx.tenantId, conn.external_property_id, [rev.id], {
          ...(deliver?.duplicate ? { duplicate: deliver.duplicate } : {}),
          ...(deliver?.notificationOnly ? { notificationOnly: true } : {}),
        });
  return { revisionId: rev.id, bookingId: rev.booking_id, deliveries };
}

export async function deliverSimulated(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  connectionId: string,
  revisionIds: string[],
  opts: { duplicate?: number; reverse?: boolean; notificationOnly?: boolean } = {},
) {
  const conn = await withTenantTx(database, ctx, (tx) => simConnection(tx, connectionId));
  return deps.simulator.deliver(ctx.tenantId, conn.external_property_id, revisionIds, opts);
}

export async function injectFault(
  tx: TxContext,
  deps: DistributionDeps,
  connectionId: string,
  input: { endpoint: SimEndpoint | 'any'; kind: SimFaultKind; times: number },
) {
  const conn = await simConnection(tx, connectionId);
  return deps.simulator.run(
    tx.tenantId,
    conn.external_property_id,
    (s) => {
      s.faults.push({ endpoint: input.endpoint, kind: input.kind, remaining: input.times });
      return { faults: s.faults };
    },
    { tx },
  );
}

export async function setOutage(
  tx: TxContext,
  deps: DistributionDeps,
  connectionId: string,
  minutes: number,
) {
  const conn = await simConnection(tx, connectionId);
  return deps.simulator.run(
    tx.tenantId,
    conn.external_property_id,
    (s, now) => {
      s.outageUntil = minutes > 0 ? new Date(now.getTime() + minutes * 60_000).toISOString() : null;
      return { outageUntil: s.outageUntil };
    },
    { tx },
  );
}
