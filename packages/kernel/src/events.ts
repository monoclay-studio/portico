import type { Actor } from './context';

/** Envelope for every domain event written to the outbox. */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  readonly id: string;
  /** `<module>.<aggregate>.<pastTenseVerb>`, e.g. `reservations.stay.checkedIn` */
  readonly type: string;
  readonly tenantId: string;
  readonly propertyId: string | null;
  readonly aggregate: { type: string; id: string };
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
