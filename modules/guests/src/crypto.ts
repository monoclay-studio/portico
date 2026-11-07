import { createHash, createHmac } from 'node:crypto';
import { localFieldCipher } from '@portico/kernel';
import type { GuestsCryptoPort } from './ports';

/**
 * Development / test binding of the crypto port: kernel `localFieldCipher` (AES-256-GCM) plus an HMAC-SHA256
 * blind index with a key DERIVED SEPARATELY from the same secret. Production binds KMS envelope encryption and
 * a blind-index key from the secrets manager (see README → ports).
 */
export function localGuestsCrypto(keyBase64: string, keyId = 'local'): GuestsCryptoPort {
  const indexKey = createHash('sha256').update(`portico.guests.blind-index:${keyBase64}`).digest();
  return {
    cipher: localFieldCipher(keyBase64, keyId),
    keyId,
    blindIndex: (input: string) => createHmac('sha256', indexKey).update(input).digest('hex'),
  };
}
