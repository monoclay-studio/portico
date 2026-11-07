/** Who is performing an action. Every audit record and event carries one. */
export type Actor =
  | { kind: 'user'; userId: string; displayName?: string; sessionId?: string; impersonatedBy?: string }
  | { kind: 'api_client'; clientId: string; displayName?: string }
  | { kind: 'system'; process: string }
  | { kind: 'guest'; guestProfileId?: string; bookingId?: string };

/** Request-scoped context: identity + tenant + tracing. Created by the HTTP/worker layer. */
export interface RequestContext {
  readonly tenantId: string;
  readonly actor: Actor;
  readonly correlationId: string;
  /** IP / user agent for audit. Never used for authorization. */
  readonly origin?: { ip?: string; userAgent?: string };
}

export function actorLabel(actor: Actor): string {
  switch (actor.kind) {
    case 'user':
      return actor.displayName ?? `user:${actor.userId}`;
    case 'api_client':
      return actor.displayName ?? `api:${actor.clientId}`;
    case 'system':
      return `system:${actor.process}`;
    case 'guest':
      return 'guest';
  }
}

export function actorId(actor: Actor): string {
  switch (actor.kind) {
    case 'user':
      return actor.userId;
    case 'api_client':
      return actor.clientId;
    case 'system':
      return actor.process;
    case 'guest':
      return actor.guestProfileId ?? actor.bookingId ?? 'anonymous';
  }
}
