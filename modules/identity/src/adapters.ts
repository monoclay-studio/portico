import { type PorticoDatabase, sql, type TxContext, typed } from '@portico/db';
import { assertExternalEffectAllowed, type FieldCipher, NotFoundError, newId } from '@portico/kernel';
import { safeJsonRequest } from './net/safe-json';
import type { GeoIpResolver, Notifier, OidcHttpClient, SecretStore } from './ports';
import type { IdentityDB } from './tables';

/**
 * Default adapters for identity's infrastructure ports. Production replacements are noted per adapter; none of
 * these talks to a real third party except `fetchOidcHttp` (the organization's own identity provider).
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

/**
 * SecretStore backed by field-encrypted rows in the organization's own tenant (`identity.secret_values`). AAD binds
 * each ciphertext to its organization and reference. Production: AWS Secrets Manager or KMS-envelope cipher.
 */
export function fieldEncryptedSecretStore(cipher: FieldCipher): SecretStore {
  return {
    async put(tx, input) {
      const ref = `sec_${input.name}_${newId()}`;
      await db(tx)
        .insertInto('identity.secret_values')
        .values({
          tenant_id: tx.tenantId,
          ref,
          ciphertext: cipher.encrypt(input.value, `${tx.tenantId}:${ref}`),
        })
        .execute();
      return { ref };
    },
    async get(tx, ref) {
      const row = await db(tx)
        .selectFrom('identity.secret_values')
        .select('ciphertext')
        .where('ref', '=', ref)
        .executeTakeFirst();
      if (!row) throw new NotFoundError('secret', ref);
      return cipher.decrypt(row.ciphertext, `${tx.tenantId}:${ref}`);
    },
    async delete(tx, ref) {
      await db(tx).deleteFrom('identity.secret_values').where('ref', '=', ref).execute();
    },
  };
}

/**
 * Staff notifier honouring environment safety (ADR-0010) and ADR-0017 §3: credential links reach only the person.
 *  - non-live: the message is deposited in the operator/developer mailbox (`identity.dev_mailbox`, link
 *    field-encrypted) and NEVER returned to the caller — an admin of a trial cannot read another person's link;
 *  - live: queued as `identity.staffMessage.requested` for the email adapter (comms module, LATER); reported as
 *    `queued`, never "sent", because nothing confirms delivery yet.
 */
export function outboxNotifier(cipher: FieldCipher | undefined): Notifier {
  return {
    async send(tx, message) {
      const mode = assertExternalEffectAllowed(tx, 'message.staff');
      const id = newId();
      const linkEnc = message.link && cipher ? cipher.encrypt(message.link, `staff-message:${id}`) : null;
      if (mode !== 'live') {
        await sql`select identity.deposit_simulated_message(${id}::uuid, ${tx.tenantId}::uuid, ${message.to},
          ${message.kind}, ${message.subject}, ${message.body}, ${linkEnc})`.execute(tx.db);
        return { mode: mode === 'sandbox' ? 'sandbox' : 'simulated' };
      }
      await tx.emit({
        type: 'identity.staffMessage.requested',
        aggregate: { type: 'staff_message', id },
        payload: {
          kind: message.kind,
          to: message.to,
          subject: message.subject,
          body: message.body,
          ...(linkEnc ? { linkEnc } : {}),
        },
      });
      return { mode: 'queued' };
    },
  };
}

/** Operator console: simulated messages for one recipient (links decrypted). Disabled in production. */
export async function readDevMailbox(
  database: PorticoDatabase,
  cipher: FieldCipher | undefined,
  recipient: string,
) {
  const { rows } = await sql<{
    id: string;
    tenant_id: string;
    kind: string;
    subject: string;
    body: string;
    link_enc: string | null;
    created_at: Date;
  }>`select * from identity.read_dev_mailbox(${recipient}, 50)`.execute(database.kysely);
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.tenant_id,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    link: r.link_enc && cipher ? cipher.decrypt(r.link_enc, `staff-message:${r.id}`) : null,
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * HTTP client for identity providers. Always SSRF-safe (`safeJsonRequest`: https, public addresses only, pinned
 * DNS, no redirects, 10 s, 1 MB). `allowLocalDevelopment` (never in production — the composition root ties it to
 * NODE_ENV) additionally permits `http://localhost` for a developer's local IdP.
 */
export function fetchOidcHttp(
  opts: { timeoutMs?: number; allowLocalDevelopment?: boolean } = {},
): OidcHttpClient {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const local = (url: string) => {
    const u = new URL(url);
    return !!opts.allowLocalDevelopment && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  };
  const localFetch = async (url: string, init: RequestInit) => {
    const res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    let body: unknown = null;
    try {
      body = JSON.parse(await res.text());
    } catch {
      body = null;
    }
    return { status: res.status, body };
  };
  return {
    async getJson(url) {
      const res = local(url)
        ? await localFetch(url, { headers: { accept: 'application/json' } })
        : await safeJsonRequest(url, { method: 'GET', timeoutMs });
      if (res.status !== 200) throw new Error(`GET ${url} returned ${res.status}`);
      return res.body;
    },
    async postForm(url, form, headers = {}) {
      const body = new URLSearchParams(form).toString();
      const h = { 'content-type': 'application/x-www-form-urlencoded', ...headers };
      return local(url)
        ? localFetch(url, { method: 'POST', headers: h, body })
        : safeJsonRequest(url, { method: 'POST', headers: h, body, timeoutMs });
    },
  };
}

/** DNS TXT lookup for SSO domain verification (ADR-0017 §5). */
export async function systemTxtResolver(name: string): Promise<string[]> {
  const { resolveTxt } = await import('node:dns/promises');
  try {
    return (await resolveTxt(name)).map((parts) => parts.join(''));
  } catch {
    return [];
  }
}

/** Placeholder GeoIP: knows no countries, so the new-country rule stays inert until a real source is bound. */
export const unknownGeo: GeoIpResolver = { countryOf: () => null };
