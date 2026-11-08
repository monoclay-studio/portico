/**
 * Connection health (pure, DST-R13/R14). A channel outage never looks synced: any change the channel has not
 * confirmed within the freshness target makes the connection `degraded`, and failures lasting 30 minutes make it
 * `failing` (urgent).
 */
import { ESCALATE_AFTER_MS } from './delivery';

export type ConnectionHealth =
  | 'connected'
  | 'degraded'
  | 'failing'
  | 'credentials_invalid'
  | 'paused'
  | 'blocked'
  | 'not_active';

export interface HealthFacts {
  status: 'setup' | 'active' | 'paused' | 'disconnected';
  credentialState: 'unverified' | 'valid' | 'invalid';
  /** Data authority makes publication impossible (DST-R15). */
  publicationBlocked: string | null;
  /**
   * No hub call can progress until a person or another system acts (key not verified for this property, the
   * environment or live scope refuses the hub) — P1-1. Refused credentials are `credentialState: 'invalid'`.
   */
  hubRefused: { code: string; message: string } | null;
  /** Oldest change Portico made that the channel has not acknowledged yet (queued or in flight). */
  oldestUnconfirmedChangeAt: Date | null;
  /** Earliest first failure among open ARI messages (null when none is failing). */
  ariFailingSince: Date | null;
  /** Earliest first failure among acknowledgements that are not yet accepted. */
  ackFailingSince: Date | null;
  /** Earliest first failure among revisions Portico could not apply yet. */
  applyFailingSince: Date | null;
  /** Parked revisions older than the 15-minute window. */
  parkedOverdue: number;
  /** A recovery pull found bookings the webhook never delivered, at this instant (inbound gap). */
  inboundGapAt: Date | null;
  now: Date;
  freshnessTargetMs: number;
  /** How long an inbound gap keeps the connection degraded. */
  gapCooldownMs: number;
}

export interface HealthResult {
  health: ConnectionHealth;
  reason: string;
  /** Since when the channel may not reflect Portico (null when connected). */
  staleSince: string | null;
  /** For `blocked`: what blocks — another system of record, or the hub path (decides the next step shown). */
  blockedBy?: 'authority' | 'hub';
}

const age = (d: Date | null, now: Date) => (d ? now.getTime() - d.getTime() : -1);

export function computeHealth(f: HealthFacts): HealthResult {
  const stale = f.oldestUnconfirmedChangeAt ? f.oldestUnconfirmedChangeAt.toISOString() : null;
  if (f.status === 'setup' || f.status === 'disconnected') {
    return { health: 'not_active', reason: 'The connection is not active.', staleSince: null };
  }
  if (f.status === 'paused') {
    return {
      health: 'paused',
      reason: 'Publication is paused: changes are queued and sent when the connection is resumed.',
      staleSince: stale,
    };
  }
  if (f.credentialState === 'invalid') {
    return {
      health: 'credentials_invalid',
      reason:
        'The hub refused the credential: availability and rates are NOT reaching this channel. Bookings already delivered are kept.',
      staleSince: stale ?? f.now.toISOString(),
    };
  }
  if (f.hubRefused) {
    return {
      health: 'blocked',
      reason: `${f.hubRefused.message} Nothing is sent to or acknowledged at the hub.`,
      staleSince: stale ?? f.now.toISOString(),
      blockedBy: 'hub',
    };
  }
  if (f.publicationBlocked) {
    return { health: 'blocked', reason: f.publicationBlocked, staleSince: stale, blockedBy: 'authority' };
  }
  const failingSince = [f.ariFailingSince, f.ackFailingSince, f.applyFailingSince]
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if ((failingSince && age(failingSince, f.now) >= ESCALATE_AFTER_MS) || f.parkedOverdue > 0) {
    return {
      health: 'failing',
      reason:
        f.parkedOverdue > 0
          ? `${f.parkedOverdue} booking revision(s) have waited more than 15 minutes for the booking they change.`
          : 'Exchanges with the hub have failed for more than 30 minutes.',
      staleSince: stale ?? failingSince?.toISOString() ?? f.now.toISOString(),
    };
  }
  // A short failure that a retry fixes within the freshness target does not degrade the connection (no flapping
  // of stop-sell protection on a single 5xx); beyond the target the channel is behind and it does.
  if (failingSince && age(failingSince, f.now) > f.freshnessTargetMs) {
    return {
      health: 'degraded',
      reason: 'Exchanges with the hub are failing and being retried.',
      staleSince: stale ?? failingSince.toISOString(),
    };
  }
  if (f.oldestUnconfirmedChangeAt && age(f.oldestUnconfirmedChangeAt, f.now) > f.freshnessTargetMs) {
    return {
      health: 'degraded',
      reason: `Changes have waited more than ${Math.round(f.freshnessTargetMs / 1000)} seconds for the channel to confirm them.`,
      staleSince: stale,
    };
  }
  if (f.inboundGapAt && age(f.inboundGapAt, f.now) < f.gapCooldownMs) {
    return {
      health: 'degraded',
      reason: 'A recovery pull found bookings the hub never notified: notifications may be missing.',
      staleSince: f.inboundGapAt.toISOString(),
    };
  }
  return {
    health: 'connected',
    reason: 'Changes are reaching the channel within the freshness target.',
    staleSince: null,
  };
}

export const isDegraded = (h: ConnectionHealth) => h === 'degraded' || h === 'failing';
