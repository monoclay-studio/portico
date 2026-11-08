/**
 * Booking-revision webhook receiver (public endpoint). The URL carries an unguessable endpoint id that routes to
 * one organization and connection (SECURITY DEFINER lookup, no tenant data exposed); the request is authenticated
 * by a pluggable verifier, then the revision is stored durably BEFORE answering 200.
 *
 * Channex's own webhook authentication mechanism is UNVERIFIED (no signature is documented in the excerpts we
 * could read; `headers` exists for authentication). Default verifier `header_secret`: the shared token Portico
 * generated is configured in the webhook's `headers` and compared in constant time (only its SHA-256 is stored).
 * `hmac_sha256` (t=…,v1=HMAC(secret, "t.body"), ±300 s) is available for a signing proxy or a future hub signature.
 */
import { createHmac } from 'node:crypto';
import { type PorticoDatabase, sql, type TxContext, withTenantTx } from '@portico/db';
import { constantTimeEqual, newId, sha256Hex, systemContext, type TenantEnvironment } from '@portico/kernel';
import { WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TOKEN_HEADER, WireParseError } from '../adapters/channex/wire';
import {
  type ConnectionRow,
  type DistributionDeps,
  db,
  loadConnection,
  scheduleTenant,
  settingsOf,
} from './common';
import { raiseException } from './exceptions';
import { logDelivery, PropertyMismatchError, storeRevision } from './inbound';

export interface WebhookRequest {
  endpointId: string;
  headers: Record<string, string | undefined>;
  rawBody: string;
}

export interface WebhookAnswer {
  status: number;
  body: Record<string, unknown>;
}

const SIGNATURE_TOLERANCE_S = 300;

export interface WebhookVerifier {
  verify(tx: TxContext, deps: DistributionDeps, conn: ConnectionRow, req: WebhookRequest): Promise<boolean>;
}

export const headerSecretVerifier: WebhookVerifier = {
  async verify(_tx, _deps, conn, req) {
    const token = req.headers[WEBHOOK_TOKEN_HEADER];
    if (!token || token.length > 512) return false;
    return constantTimeEqual(sha256Hex(token), conn.webhook_secret_hash);
  },
};

export function signBody(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export const hmacVerifier: WebhookVerifier = {
  async verify(tx, deps, conn, req) {
    const header = req.headers[WEBHOOK_SIGNATURE_HEADER];
    if (!header || header.length > 1024) return false;
    const parts = Object.fromEntries(
      header.split(',').map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      }),
    );
    const t = Number(parts.t);
    if (!Number.isInteger(t) || Math.abs(tx.now.getTime() / 1000 - t) > SIGNATURE_TOLERANCE_S) return false;
    const secret = await deps.ports.secrets.get(tx, conn.webhook_secret_ref);
    return typeof parts.v1 === 'string' && constantTimeEqual(signBody(secret, t, req.rawBody), parts.v1);
  },
};

const VERIFIERS: Record<ConnectionRow['webhook_verifier'], WebhookVerifier> = {
  header_secret: headerSecretVerifier,
  hmac_sha256: hmacVerifier,
};

/** Route, authenticate, parse and durably store one webhook delivery. Never throws for sender errors. */
export async function receiveWebhook(
  database: PorticoDatabase,
  deps: DistributionDeps,
  req: WebhookRequest,
): Promise<WebhookAnswer> {
  if (!/^[0-9a-f-]{36}$/i.test(req.endpointId)) return { status: 404, body: { error: 'not_found' } };
  const { rows } = await sql<{ tenant_id: string; connection_id: string; environment: TenantEnvironment }>`
    select * from distribution.route_webhook(${req.endpointId}::uuid)`.execute(database.kysely);
  const route = rows[0];
  if (!route) return { status: 404, body: { error: 'not_found' } };
  const ctx = systemContext(route.tenant_id, 'distribution-webhook', route.environment, newId());
  return withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, route.connection_id);
    if (!(await VERIFIERS[conn.webhook_verifier].verify(tx, deps, conn, req))) {
      await logDelivery(tx, { connectionId: conn.id, via: 'webhook', outcome: 'unauthenticated' });
      return { status: 401, body: { error: 'unauthenticated' } };
    }
    let notice: ReturnType<typeof deps.hub.parseWebhook>;
    try {
      notice = deps.hub.parseWebhook(req.rawBody);
    } catch (err) {
      const issues = err instanceof WireParseError ? err.issues.slice(0, 5) : [];
      await logDelivery(tx, {
        connectionId: conn.id,
        via: 'webhook',
        outcome: 'unparseable',
        detail: { issues },
      });
      // The revision is still at the hub (unacknowledged): pull it now instead.
      await db(tx)
        .updateTable('distribution.connections')
        .set({ next_feed_pull_at: tx.now })
        .where('id', '=', conn.id)
        .execute();
      await scheduleTenant(tx, tx.now);
      await raiseException(tx, {
        connectionId: conn.id,
        propertyId: conn.property_id,
        code: 'webhook_unreadable',
        dedupeKey: 'webhook_unreadable',
        severity: 'routine',
        problem: `A notification from the hub could not be read (${issues.join('; ') || 'not JSON'}).`,
        businessImpact: 'None: Portico pulls unacknowledged revisions from the hub instead.',
        responsibleParty: 'monoclay',
        nextStep: 'Monoclay support checks the notification format.',
      });
      return { status: 400, body: { error: 'unparseable' } };
    }
    if (notice.externalPropertyId !== conn.external_property_id) {
      await logDelivery(tx, {
        connectionId: conn.id,
        via: 'webhook',
        outcome: 'property_mismatch',
        detail: { event: notice.event },
      });
      return { status: 422, body: { error: 'property_mismatch' } };
    }
    if (!notice.isBookingEvent) {
      await logDelivery(tx, {
        connectionId: conn.id,
        via: 'webhook',
        outcome: 'notification',
        detail: { event: notice.event },
      });
      return { status: 200, body: { received: true, ignored: notice.event } };
    }
    if (notice.revision && settingsOf(conn).webhookPayload === 'store') {
      try {
        const r = await storeRevision(tx, conn, notice.revision, 'webhook');
        return { status: 200, body: { received: true, outcome: r.outcome } };
      } catch (err) {
        if (err instanceof PropertyMismatchError)
          return { status: 422, body: { error: 'property_mismatch' } };
        throw err;
      }
    }
    // Notification without the revision (send_data = false): pull what the hub holds unacknowledged.
    await logDelivery(tx, {
      connectionId: conn.id,
      via: 'webhook',
      outcome: 'notification',
      detail: { event: notice.event, revisionId: notice.revisionId },
    });
    await db(tx)
      .updateTable('distribution.connections')
      .set({ next_feed_pull_at: tx.now })
      .where('id', '=', conn.id)
      .execute();
    await scheduleTenant(tx, tx.now);
    return { status: 200, body: { received: true, outcome: 'pull_scheduled' } };
  });
}

/** Endpoint id from a callback URL (`…/v1/distribution/webhooks/channex/<endpointId>`). */
export function endpointIdFromUrl(url: string): string | null {
  const m = /\/webhooks\/channex\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(url);
  return m ? (m[1] as string) : null;
}

export function webhookUrl(deps: DistributionDeps, endpointId: string): string {
  return `${deps.config.publicApiBaseUrl.replace(/\/+$/, '')}/v1/distribution/webhooks/channex/${endpointId}`;
}
