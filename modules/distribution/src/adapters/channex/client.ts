/**
 * Channex adapter (HubAdapter over a HubTransport). Knows nothing about the wire format beyond `wire.ts`.
 * The base URL follows the call's mode: live → production, sandbox → Channex staging, simulate → the simulator.
 */
import { classifyHttp, type HubFailure } from '../../domain/delivery';
import {
  type AriResult,
  type FeedItem,
  type HubAdapter,
  type HubCallContext,
  HubError,
  type HubHttpResponse,
  type HubTransport,
  HubTransportError,
} from '../hub';
import {
  availabilityBody,
  bookingsSinceQuery,
  CHANNEX_AUTH_HEADER,
  CHANNEX_BASE_PATH,
  CHANNEX_HOSTS,
  errorText,
  feedQuery,
  PATHS,
  parseAriSuccess,
  parseBookings,
  parseFeed,
  parseSingleRevision,
  parseWebhook,
  restrictionsBody,
  toHubRevision,
  WireParseError,
  webhookRegistration,
} from './wire';

/** Host used for simulator calls (never resolvable; the simulator transport answers them). */
export const SIMULATOR_HOST = 'channex.simulator.invalid';

export function baseUrl(mode: HubCallContext['mode']): string {
  const host =
    mode === 'live' ? CHANNEX_HOSTS.production : mode === 'sandbox' ? CHANNEX_HOSTS.staging : SIMULATOR_HOST;
  return `https://${host}${CHANNEX_BASE_PATH}`;
}

export interface ChannexAdapterDeps {
  /** Real HTTPS transport (fixed Channex hosts only). */
  http: HubTransport;
  /** Simulator transport for an organization's simulated hub property. */
  simulator(tenantId: string, externalPropertyId: string): HubTransport;
}

function retryAfter(res: HubHttpResponse): number | null {
  const v = res.headers['retry-after'];
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 3600) : null;
}

function failureFromResponse(res: HubHttpResponse, what: string): HubFailure {
  const cls = classifyHttp(res.status);
  const text = errorText(res.body);
  const message =
    cls === 'rate_limited'
      ? `Channex is limiting requests (HTTP 429) for ${what}; Portico waits and merges the changes into the next request.`
      : cls === 'auth'
        ? `Channex refused the API key (HTTP ${res.status}) for ${what}. Check or replace the key in the connection.`
        : cls === 'transient'
          ? `Channex could not process ${what} right now (HTTP ${res.status}); Portico retries automatically.`
          : `Channex refused ${what} (HTTP ${res.status}): ${text}`;
  return {
    class: cls,
    message,
    httpStatus: res.status,
    retryAfterSeconds: retryAfter(res),
    outcomeUnknown: false,
    detail: { body: text },
  };
}

export function channexAdapter(deps: ChannexAdapterDeps): HubAdapter {
  const transportFor = (ctx: HubCallContext) =>
    ctx.mode === 'simulate' ? deps.simulator(ctx.tenantId, ctx.externalPropertyId) : deps.http;

  async function call(
    ctx: HubCallContext,
    method: 'GET' | 'POST',
    pathAndQuery: string,
    what: string,
    body?: unknown,
  ): Promise<HubHttpResponse> {
    const headers: Record<string, string> = {
      [CHANNEX_AUTH_HEADER]: ctx.apiKey,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: HubHttpResponse;
    try {
      res = await transportFor(ctx).send({
        method,
        url: `${baseUrl(ctx.mode)}${pathAndQuery}`,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        deadline: ctx.deadline,
      });
    } catch (err) {
      if (err instanceof HubTransportError) {
        throw new HubError({
          class: err.kind === 'blocked' ? 'payload' : 'transient',
          message:
            err.kind === 'timeout'
              ? `Channex did not answer ${what} in time; Portico retries (the change may already be applied — re-sending the same values is harmless).`
              : err.kind === 'blocked'
                ? `Portico refused to call ${what}: ${err.message}`
                : `Channex could not be reached for ${what}; Portico retries automatically.`,
          httpStatus: null,
          retryAfterSeconds: null,
          outcomeUnknown: err.requestSent,
        });
      }
      throw err;
    }
    if (res.status < 200 || res.status > 299) throw new HubError(failureFromResponse(res, what));
    return res;
  }

  const unreadable = (what: string, err: unknown): HubError =>
    new HubError({
      class: 'transient',
      message: `Channex answered ${what} with content Portico could not read; Portico retries and records the answer.`,
      httpStatus: 200,
      retryAfterSeconds: null,
      outcomeUnknown: false,
      detail: { issues: err instanceof WireParseError ? err.issues : [String(err)] },
    });

  function toItem(id: string, attributes: unknown): FeedItem {
    try {
      return { ok: true, revision: toHubRevision(id, attributes) };
    } catch (err) {
      return {
        ok: false,
        revisionId: id,
        issues: err instanceof WireParseError ? err.issues : [String(err)],
      };
    }
  }

  async function ari(ctx: HubCallContext, path: string, body: unknown, what: string): Promise<AriResult> {
    const res = await call(ctx, 'POST', path, what, body);
    const parsed = parseAriSuccess(res.body);
    return {
      httpStatus: res.status,
      taskIds: parsed.taskIds,
      refused: parsed.refused,
      unrecognizedAnswer: parsed.unrecognized,
    };
  }

  return {
    hub: 'channex',
    async testCredentials(ctx) {
      const res = await call(ctx, 'GET', PATHS.property(ctx.externalPropertyId), 'the property check');
      try {
        const j = JSON.parse(res.body) as { data?: { attributes?: { title?: unknown } } };
        const title = j.data?.attributes?.title;
        return { propertyName: typeof title === 'string' ? title : null };
      } catch {
        return { propertyName: null };
      }
    },
    async registerWebhook(ctx, input) {
      await call(
        ctx,
        'POST',
        PATHS.webhooks,
        'the booking notification setup',
        webhookRegistration({ externalPropertyId: ctx.externalPropertyId, ...input }),
      );
    },
    pushAvailability: (ctx, runs) =>
      ari(ctx, PATHS.availability, availabilityBody(ctx.externalPropertyId, runs), 'the availability update'),
    pushRestrictions: (ctx, runs) =>
      ari(
        ctx,
        PATHS.restrictions,
        restrictionsBody(ctx.externalPropertyId, runs),
        'the rates and restrictions update',
      ),
    async fetchFeed(ctx, opts) {
      const items: FeedItem[] = [];
      const maxPages = opts?.maxPages ?? 20;
      for (let page = 1; page <= maxPages; page++) {
        const res = await call(
          ctx,
          'GET',
          `${PATHS.feed}?${feedQuery(ctx.externalPropertyId, page)}`,
          'the revision feed',
        );
        let feed: ReturnType<typeof parseFeed>;
        try {
          feed = parseFeed(res.body);
        } catch (err) {
          throw unreadable('the revision feed', err);
        }
        for (const it of feed.items) items.push(toItem(it.id, it.attributes));
        const limit = feed.limit ?? feed.items.length;
        if (feed.items.length === 0 || limit === 0 || feed.items.length < limit) break;
        if (feed.total !== null && page * limit >= feed.total) break;
      }
      return items;
    },
    async fetchRevision(ctx, revisionId) {
      try {
        const res = await call(ctx, 'GET', PATHS.revision(revisionId), 'the booking revision');
        let one: ReturnType<typeof parseSingleRevision>;
        try {
          one = parseSingleRevision(res.body);
        } catch (err) {
          throw unreadable('the booking revision', err);
        }
        return toItem(one.id, one.attributes);
      } catch (err) {
        if (err instanceof HubError && err.failure.httpStatus === 404) return null;
        throw err;
      }
    },
    async acknowledge(ctx, revisionId) {
      const res = await call(ctx, 'POST', PATHS.ack(revisionId), 'the booking acknowledgement');
      return { httpStatus: res.status };
    },
    async listBookingsSince(ctx, since, opts) {
      const out: Array<{ bookingId: string; latestRevisionId: string | null }> = [];
      const maxPages = opts?.maxPages ?? 20;
      for (let page = 1; page <= maxPages; page++) {
        const res = await call(
          ctx,
          'GET',
          `${PATHS.bookings}?${bookingsSinceQuery(ctx.externalPropertyId, since, page)}`,
          'the booking list',
        );
        let list: ReturnType<typeof parseBookings>;
        try {
          list = parseBookings(res.body);
        } catch (err) {
          throw unreadable('the booking list', err);
        }
        out.push(...list.items);
        const limit = list.limit ?? list.items.length;
        if (list.items.length === 0 || limit === 0 || list.items.length < limit) break;
        if (list.total !== null && page * limit >= list.total) break;
      }
      return out;
    },
    parseWebhook,
  };
}
