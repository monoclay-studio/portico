/**
 * The channel-hub port: what distribution needs from a hub (Channex first). Adapters speak HTTP through a
 * `HubTransport`; the real transport and the simulator are interchangeable, so the same adapter code runs against
 * the simulator, Channex staging (R4) and production.
 */
import type { FailureClass, HubFailure } from '../domain/delivery';
import type { HubRevision } from '../domain/revisions';
import type { AvailabilityRun, RestrictionRun, WebhookNotice } from './channex/wire';

/** Where a call goes, decided by `assertExternalEffectAllowed('channel.publish')` at the moment of the call. */
export type HubMode = 'live' | 'sandbox' | 'simulate';

export interface HubCallContext {
  tenantId: string;
  mode: HubMode;
  apiKey: string;
  externalPropertyId: string;
  /** The adapter stops waiting at this instant and reports an unknown outcome. */
  deadline: Date;
}

export interface HubHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  deadline: Date;
}

export interface HubHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export class HubTransportError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'blocked',
    message: string,
    /** True when the request may have reached the hub (its outcome is unknown). */
    readonly requestSent: boolean,
  ) {
    super(message);
    this.name = 'HubTransportError';
  }
}

export interface HubTransport {
  send(req: HubHttpRequest): Promise<HubHttpResponse>;
}

/** A classified hub failure (drives retries, exceptions and health). */
export class HubError extends Error {
  constructor(readonly failure: HubFailure) {
    super(failure.message);
    this.name = 'HubError';
  }
  get class(): FailureClass {
    return this.failure.class;
  }
}

export interface AriResult {
  httpStatus: number;
  taskIds: string[];
  /** Values the hub refused (index into the values sent, in order). */
  refused: Array<{ index: number; message: string }>;
  /**
   * The 2xx answer did not positively confirm acceptance in the expected shape (P2-3): the message is recorded as
   * PENDING VERIFICATION (cells keep their previous channel state), never as accepted.
   */
  unrecognizedAnswer: boolean;
  /** Why the answer was not recognised (for the exception; no hub content). */
  unrecognizedWhy?: string | null;
}

export type FeedItem =
  | { ok: true; revision: HubRevision }
  | { ok: false; revisionId: string; issues: string[] };

export interface HubAdapter {
  readonly hub: 'channex';
  /** A harmless read proving the key can see the property. */
  testCredentials(ctx: HubCallContext): Promise<{ propertyName: string | null }>;
  /** Ask the hub to notify Portico of booking revisions, sending `token` back in a header. */
  registerWebhook(ctx: HubCallContext, input: { callbackUrl: string; token: string }): Promise<void>;
  pushAvailability(ctx: HubCallContext, runs: readonly AvailabilityRun[]): Promise<AriResult>;
  pushRestrictions(ctx: HubCallContext, runs: readonly RestrictionRun[]): Promise<AriResult>;
  /** Revisions the hub still holds as NOT acknowledged (recovery pull). */
  fetchFeed(ctx: HubCallContext, opts?: { maxPages?: number }): Promise<FeedItem[]>;
  fetchRevision(ctx: HubCallContext, revisionId: string): Promise<FeedItem | null>;
  /**
   * `refusedAgain`: the hub refused with an answer that, on a REPEATED acknowledgement, may mean "already
   * acknowledged" (unverified); the caller decides with what it already holds.
   */
  acknowledge(
    ctx: HubCallContext,
    revisionId: string,
  ): Promise<{ httpStatus: number; refusedAgain?: boolean }>;
  /** Bookings created or changed since `since` (reconciliation "re-request since T"). */
  listBookingsSince(
    ctx: HubCallContext,
    since: string,
    opts?: { maxPages?: number },
  ): Promise<{
    bookings: Array<{ bookingId: string; latestRevisionId: string | null }>;
    /** More pages remained beyond the page cap: the list is partial (P3-2). */
    truncated: boolean;
  }>;
  parseWebhook(rawBody: string): WebhookNotice;
}
