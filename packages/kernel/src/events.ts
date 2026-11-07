import type { Actor } from './context';

/** Envelope for every domain event written to the outbox. */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  readonly id: string;
  /** `<module>.<aggregate>.<pastTenseVerb>`, e.g. `reservations.stay.checkedIn` */
  readonly type: string;
  readonly tenantId: string;
  readonly propertyId: string | null;
  readonly aggregate: { type: string; id: string };
  /**
   * Version of the aggregate AFTER this change (its `version` column), when the aggregate is versioned. Consumers
   * that derive state from events MUST ignore an event whose aggregateVersion is not greater than the last one they
   * applied for that aggregate — deliveries can be late, retried or reordered.
   */
  readonly aggregateVersion: number | null;
  readonly occurredAt: string; // ISO timestamp
  readonly actor: Actor;
  readonly correlationId: string;
  /** Payload schema version for evolution. */
  readonly version: number;
  readonly payload: TPayload;
}

export interface EmitEventInput<TPayload = Record<string, unknown>> {
  type: string;
  propertyId?: string | null;
  aggregate: { type: string; id: string };
  /** Version of the aggregate after this change, if versioned (strongly recommended for state-changing events). */
  aggregateVersion?: number;
  payload: TPayload;
  version?: number;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

export interface EventSubscription {
  /** Unique, stable consumer name — used for per-consumer deduplication. */
  consumer: string;
  /** Exact event types, or `module.*` prefixes. */
  types: string[];
  handle: EventHandler;
}

/**
 * Helper for consumers: true when `event` is newer than the last applied version for its aggregate.
 * Unversioned events (aggregateVersion null) are always considered new — design those consumers to be idempotent.
 */
export function isNewerThan(
  event: Pick<DomainEvent, 'aggregateVersion'>,
  lastAppliedVersion: number | null | undefined,
): boolean {
  if (event.aggregateVersion === null || event.aggregateVersion === undefined) return true;
  return (
    lastAppliedVersion === null ||
    lastAppliedVersion === undefined ||
    event.aggregateVersion > lastAppliedVersion
  );
}
