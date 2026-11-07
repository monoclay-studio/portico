import { type TxContext, typed } from '@portico/db';
import { assertExternalEffectAllowed, type FieldCipher, NotFoundError, newId } from '@portico/kernel';
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
 * Staff notifier honouring environment safety. Non-live environments never deliver: the message is returned as
 * *simulated* so the UI can show it. In `live`, the message is queued as an outbox event
 * (`identity.staffMessage.requested`) for the email adapter (comms module, LATER); the one-time link travels
 * encrypted so it never sits in the outbox in clear text.
 */
export function outboxNotifier(cipher: FieldCipher | undefined): Notifier {
  return {
    async send(tx, message) {
      const mode = assertExternalEffectAllowed(tx, 'message.staff');
      if (mode !== 'live') return { mode, simulated: message };
      const id = newId();
      await tx.emit({
        type: 'identity.staffMessage.requested',
        aggregate: { type: 'staff_message', id },
        payload: {
          kind: message.kind,
          to: message.to,
          subject: message.subject,
          body: message.body,
          ...(message.link && cipher ? { linkEnc: cipher.encrypt(message.link, `staff-message:${id}`) } : {}),
        },
      });
      return { mode };
    },
  };
}

/** HTTP client for identity providers: https only (http allowed for localhost development), 10 s timeout. */
export function fetchOidcHttp(opts: { timeoutMs?: number } = {}): OidcHttpClient {
  const timeout = opts.timeoutMs ?? 10_000;
  const check = (url: string) => {
    const u = new URL(url);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))
      throw new Error(`Refusing non-https URL ${url}`);
  };
  return {
    async getJson(url) {
      check(url);
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
      return res.json();
    },
    async postForm(url, form, headers = {}) {
      check(url);
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(timeout),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          ...headers,
        },
        body: new URLSearchParams(form).toString(),
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: res.status, body };
    },
  };
}

/** Placeholder GeoIP: knows no countries, so the new-country rule stays inert until a real source is bound. */
export const unknownGeo: GeoIpResolver = { countryOf: () => null };
