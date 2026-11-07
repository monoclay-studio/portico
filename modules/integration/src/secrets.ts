/**
 * SecretStore port: connection credentials and webhook signing secrets are never stored in plaintext.
 *
 *  - Development / test: `localSecretStore` encrypts with the kernel's AES-256-GCM `localFieldCipher` (key from
 *    the environment) and keeps only ciphertext in `integration.secrets`. The AAD binds each ciphertext to its
 *    organization, secret id and purpose, so a row copied to another organization or purpose cannot be decrypted.
 *  - Production (documented, not built — needs the AWS SDK and infrastructure): an AWS Secrets Manager store.
 *    `put` creates a secret named `portico/<tenant>/<id>` encrypted with a per-environment KMS key and returns its
 *    ARN; `get` reads it (short in-memory cache); `destroy` schedules deletion. The database then holds ARNs only.
 *
 * Destroying a secret deletes its ciphertext (crypto-shredding): a revoked credential cannot be recovered.
 */
import { randomBytes } from 'node:crypto';
import { type TxContext, typed } from '@portico/db';
import { DomainError, type FieldCipher, localFieldCipher, newId } from '@portico/kernel';
import type { IntegrationDB } from './tables';

export type SecretPurpose = 'connection_credential' | 'webhook_signing';

export interface SecretStore {
  readonly kind: string;
  put(tx: TxContext, input: { purpose: SecretPurpose; value: string }): Promise<string>;
  get(tx: TxContext, ref: string): Promise<string>;
  destroy(tx: TxContext, ref: string): Promise<void>;
}

const aad = (tenantId: string, id: string, purpose: string) => `integration:${tenantId}:${id}:${purpose}`;

export function localSecretStore(cipher: FieldCipher, keyId = 'local'): SecretStore {
  return {
    kind: `local-cipher:${keyId}`,
    async put(tx, input) {
      const id = newId();
      await typed<IntegrationDB>(tx.db)
        .insertInto('integration.secrets')
        .values({
          id,
          tenant_id: tx.tenantId,
          purpose: input.purpose,
          ciphertext: cipher.encrypt(input.value, aad(tx.tenantId, id, input.purpose)),
          key_id: keyId,
        })
        .execute();
      return `local:${id}`;
    },
    async get(tx, ref) {
      const id = ref.startsWith('local:') ? ref.slice(6) : '';
      const row = await typed<IntegrationDB>(tx.db)
        .selectFrom('integration.secrets')
        .select(['ciphertext', 'purpose'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) {
        throw new DomainError(
          'secret_unavailable',
          'The stored credential could not be found (it may have been revoked). Add a new credential to continue.',
          { status: 409 },
        );
      }
      try {
        return cipher.decrypt(row.ciphertext, aad(tx.tenantId, id, row.purpose));
      } catch (err) {
        throw new DomainError(
          'secret_unreadable',
          'The stored credential cannot be decrypted with the current key (the encryption key changed). Rotate the credential to continue.',
          { status: 409, cause: err },
        );
      }
    },
    async destroy(tx, ref) {
      const id = ref.startsWith('local:') ? ref.slice(6) : '';
      await typed<IntegrationDB>(tx.db).deleteFrom('integration.secrets').where('id', '=', id).execute();
    },
  };
}

/**
 * Store selected from the environment: `PORTICO_INTEGRATION_SECRET_KEY` (base64, at least 32 bytes). Outside
 * production a missing key falls back to an EPHEMERAL random key (credentials then do not survive a restart) and
 * a warning is printed. In production a missing key is a startup error until the AWS store is built.
 */
export function secretStoreFromEnv(env: NodeJS.ProcessEnv = process.env): SecretStore {
  const raw = env.PORTICO_INTEGRATION_SECRET_KEY;
  if (raw) {
    const bytes = Buffer.from(raw, 'base64');
    if (bytes.length < 32) {
      throw new Error('PORTICO_INTEGRATION_SECRET_KEY must be at least 32 bytes, base64-encoded.');
    }
    return localSecretStore(
      localFieldCipher(raw, env.PORTICO_INTEGRATION_SECRET_KEY_ID ?? 'env'),
      env.PORTICO_INTEGRATION_SECRET_KEY_ID ?? 'env',
    );
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'PORTICO_INTEGRATION_SECRET_KEY is required in production (until the AWS Secrets Manager store is configured). Integration credentials are never stored in plaintext.',
    );
  }
  if (env.NODE_ENV !== 'test') {
    console.warn(
      'integration: PORTICO_INTEGRATION_SECRET_KEY is not set — using an ephemeral key; stored connection credentials will not survive a restart.',
    );
  }
  return localSecretStore(localFieldCipher(randomBytes(32).toString('base64'), 'ephemeral'), 'ephemeral');
}
