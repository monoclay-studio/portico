import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Field-level encryption for sensitive values (identity documents, bank details).
 * Production binds `FieldCipher` to AWS KMS envelope encryption; development uses a local key.
 * Ciphertext format: v1.<keyId>.<iv b64>.<tag b64>.<data b64>
 */
export interface FieldCipher {
  encrypt(plaintext: string, aad: string): string;
  decrypt(ciphertext: string, aad: string): string;
}

export function localFieldCipher(keyBase64: string, keyId = 'local'): FieldCipher {
  const key = createHash('sha256').update(Buffer.from(keyBase64, 'base64')).digest();
  return {
    encrypt(plaintext, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad));
      const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [
        'v1',
        keyId,
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        data.toString('base64'),
      ].join('.');
    },
    decrypt(ciphertext, aad) {
      const [v, , iv, tag, data] = ciphertext.split('.');
      if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext format');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}

/** SHA-256 hex digest — for storing secrets (session tokens, API keys) and request hashing. */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Deterministic JSON (sorted keys) for hashing request bodies and hash chains. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Blind index: a keyed, deterministic fingerprint of a sensitive value (e.g. passport number, email) so it can be
 * matched/deduplicated without storing or exposing the value. Uses a key SEPARATE from the encryption key.
 */
export function blindIndex(keyBase64: string, value: string): string {
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
  return createHmac('sha256', Buffer.from(keyBase64, 'base64')).update(normalized).digest('hex');
}

export interface FieldCrypto {
  cipher: FieldCipher;
  blindIndex(value: string): string;
  /** 'local-dev' keys are never acceptable in production. */
  keySource: 'env' | 'local-dev';
}

const DEV_FIELD_KEY = Buffer.from('portico-local-development-field-key-not-secret').toString('base64');
const DEV_INDEX_KEY = Buffer.from('portico-local-development-blind-index-key-not-secret').toString('base64');

/**
 * The ONE place modules get field encryption and blind indexing from (bound in the composition root and passed to
 * modules through their ports). Env: PORTICO_FIELD_KEY, PORTICO_BLIND_INDEX_KEY (base64, from AWS Secrets Manager
 * in deployed environments), PORTICO_FIELD_KEY_ID. In production both keys are mandatory and must not be the
 * development keys. KMS envelope encryption with key rotation is the next step (FOUNDATION_REQUESTS guests FR-3).
 */
export function fieldCryptoFromEnv(env: Record<string, string | undefined> = process.env): FieldCrypto {
  const production = env.NODE_ENV === 'production';
  const fieldKey = env.PORTICO_FIELD_KEY;
  const indexKey = env.PORTICO_BLIND_INDEX_KEY;
  if (production && (!fieldKey || !indexKey)) {
    throw new Error(
      'PORTICO_FIELD_KEY and PORTICO_BLIND_INDEX_KEY must be set in production (from the secrets manager).',
    );
  }
  if (production && (fieldKey === DEV_FIELD_KEY || indexKey === DEV_INDEX_KEY || fieldKey === indexKey)) {
    throw new Error(
      'Production field-encryption and blind-index keys must be distinct, non-development keys.',
    );
  }
  const fk = fieldKey ?? DEV_FIELD_KEY;
  const ik = indexKey ?? DEV_INDEX_KEY;
  return {
    cipher: localFieldCipher(fk, env.PORTICO_FIELD_KEY_ID ?? (fieldKey ? 'env' : 'local-dev')),
    blindIndex: (value) => blindIndex(ik, value),
    keySource: fieldKey && indexKey ? 'env' : 'local-dev',
  };
}
