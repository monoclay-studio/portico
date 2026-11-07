/**
 * Outbound command policy (adoption brief §8: "Reconnecting a service must not blindly replay actions that could
 * charge a guest twice or reopen sold inventory"; CLAUDE.md §5: uncertain outcomes are pending verification).
 *
 * Effect classes:
 *  - money: posts or moves money in the external system (charges, payments, refunds, invoices, journals).
 *  - inventory: consumes or changes inventory / reservations (creations, modifications, availability decreases).
 *  - inventory_reopen: releases inventory (cancellations, availability increases, block releases).
 *  - standard: state-setting only (room status, profile fields) — coalesced to the latest on reconnection.
 * Undeclared operations fail closed (see `effectOf`).
 *
 * Rules:
 *  1. Commands are sent only while the connection is operational (active / monitoring) and not paused.
 *  2. An unknown outcome (timeout, dropped connection) → pending_verification. Never resent blindly: the vendor is
 *     asked first (lookup by idempotency key). Found → acknowledged. Not found → standard commands are resent
 *     with the SAME idempotency key; money / inventory_reopen commands need a person's revalidation.
 *  3. While the connection is interrupted (paused, outage, credential problem), money / inventory_reopen commands
 *     are not sent. When it reconnects, every such command enqueued before the reconnection that is not yet
 *     acknowledged is held as needs_revalidation: the situation may have changed while the systems were apart.
 *  4. A definite refusal (vendor validation error) → rejected, with an exception; never retried automatically.
 *  5. Short failures that were definitely not processed (vendor unavailable, rate limited) are retried with
 *     backoff using the same idempotency key, until the connection counts as interrupted.
 * Pure logic — no IO.
 */
import type { EffectClass } from '../contracts';

export type CommandStatus =
  | 'queued'
  | 'sending'
  | 'acknowledged'
  | 'rejected'
  | 'pending_verification'
  | 'needs_revalidation'
  | 'cancelled'
  | 'superseded'
  | 'exported';

export type SendFailureKind = 'outage' | 'rate_limited' | 'auth' | 'timeout' | 'rejected' | 'invalid';

export const RISKY_CLASSES: ReadonlySet<EffectClass> = new Set<EffectClass>([
  'money',
  'inventory',
  'inventory_reopen',
]);

export function isRisky(effect: EffectClass): boolean {
  return RISKY_CLASSES.has(effect);
}

const RANK: Record<EffectClass, number> = { standard: 0, inventory: 1, inventory_reopen: 2, money: 3 };
/** The stricter of two classes (the connector's declaration wins over a caller's weaker hint). */
export function stricterEffect(a: EffectClass, b: EffectClass | undefined): EffectClass {
  if (!b) return a;
  return RANK[b] > RANK[a] ? b : a;
}

const MONEY_DOMAINS = new Set(['charges', 'payments', 'accounting']);

/**
 * Effect class of an outbound operation. FAILS CLOSED (INT-R19): an operation the connector did not declare is
 * treated as money-moving for money domains and as inventory-changing otherwise, until the connector declares it.
 */
export function effectOf(
  declared: Partial<Record<string, EffectClass>>,
  operation: string,
  dataDomain: string | null,
): EffectClass {
  const d = declared[operation];
  if (d) return d;
  return dataDomain !== null && MONEY_DOMAINS.has(dataDomain) ? 'money' : 'inventory';
}

/** Consecutive failures after which a connection counts as interrupted. */
export const INTERRUPTION_THRESHOLD = 3;

export interface CommandSnapshot {
  status: CommandStatus;
  effectClass: EffectClass;
  enqueuedAt: Date;
  attempts: number;
}

/** Rule 3: on reconnection, which unfinished commands must wait for a person's decision. */
export function mustRevalidateOnReconnect(cmd: CommandSnapshot, reconnectedAt: Date): boolean {
  if (!isRisky(cmd.effectClass)) return false;
  if (cmd.status !== 'queued' && cmd.status !== 'pending_verification' && cmd.status !== 'sending')
    return false;
  return cmd.enqueuedAt.getTime() <= reconnectedAt.getTime();
}

export type SendGate =
  | { send: true; verifyFirst: boolean }
  | { send: false; hold: 'needs_revalidation' | 'wait'; reason: string };

/** Rules 1 and 3: may this command be sent now? */
export function sendGate(
  cmd: CommandSnapshot & { verifyBeforeSend: boolean },
  connection: { operational: boolean; interrupted: boolean },
): SendGate {
  if (!connection.operational) {
    return {
      send: false,
      hold: 'wait',
      reason: 'The connection is not active (paused, disconnected or in error).',
    };
  }
  if (connection.interrupted && isRisky(cmd.effectClass)) {
    return {
      send: false,
      hold: 'wait',
      reason:
        'The connection is interrupted; money and inventory actions wait until it is back and revalidated.',
    };
  }
  return { send: true, verifyFirst: cmd.verifyBeforeSend || cmd.status === 'pending_verification' };
}

export type FailureOutcome =
  | { status: 'queued'; retryInSeconds: number }
  | { status: 'pending_verification' }
  | { status: 'rejected' };

/** Rules 2, 4 and 5: what a failed send means for the command. */
export function outcomeOfFailure(kind: SendFailureKind, attempts: number): FailureOutcome {
  switch (kind) {
    case 'timeout':
      return { status: 'pending_verification' };
    case 'rejected':
    case 'invalid':
      return { status: 'rejected' };
    case 'outage':
    case 'rate_limited':
    case 'auth':
      return { status: 'queued', retryInSeconds: backoffSeconds(attempts) };
  }
}

/** Rule 2: after a lookup found nothing for an uncertain command. */
export function afterNegativeLookup(effect: EffectClass): 'resend' | 'needs_revalidation' {
  return isRisky(effect) ? 'needs_revalidation' : 'resend';
}

/**
 * Backoff (connection lifecycle spec §8.2, pattern from research 03 §4.3): 5 s, 10 s, 20 s, 40 s, then every 60 s
 * for about 30 minutes, then every 5 minutes.
 */
export function backoffSeconds(attempts: number): number {
  if (attempts <= 0) return 5;
  if (attempts <= 4) return 5 * 2 ** (attempts - 1);
  if (attempts <= 34) return 60;
  return 300;
}

/**
 * Class S on reconnection (spec §9): for state-setting commands only the newest per business key is sent; older
 * queued ones are superseded (CL-06: "only the current state is sent, not the queue").
 * Returns the ids to supersede.
 */
export function supersededStateCommands(
  commands: ReadonlyArray<{
    id: string;
    effectClass: EffectClass;
    businessKey: string | null;
    enqueuedAt: Date;
    status: CommandStatus;
  }>,
): string[] {
  const newest = new Map<string, { id: string; at: number }>();
  for (const c of commands) {
    if (c.effectClass !== 'standard' || !c.businessKey || c.status !== 'queued') continue;
    const prev = newest.get(c.businessKey);
    const at = c.enqueuedAt.getTime();
    if (!prev || at > prev.at || (at === prev.at && c.id > prev.id))
      newest.set(c.businessKey, { id: c.id, at });
  }
  return commands
    .filter(
      (c) =>
        c.effectClass === 'standard' &&
        c.businessKey !== null &&
        c.status === 'queued' &&
        newest.get(c.businessKey)?.id !== c.id,
    )
    .map((c) => c.id);
}

/** Money commands older than this are flagged as stale when they come up for revalidation (spec §9). */
export const MONEY_STALENESS_HOURS = 24;
