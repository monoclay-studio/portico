/**
 * The server key that seals agreed terms (composition root → ratesService). Env: PORTICO_TERMS_SEAL_KEY (base64,
 * from the secrets manager in deployed environments). Production refuses to start without it or with the
 * development key. Rotating the key requires re-sealing stored terms (planned: key ids in the seal prefix).
 */
const DEV_KEY = Buffer.from('portico-local-development-terms-seal-key-not-secret').toString('base64');

export function termsSealKeyFromEnv(env: Record<string, string | undefined> = process.env): {
  key: string;
  keySource: 'env' | 'local-dev';
} {
  const key = env.PORTICO_TERMS_SEAL_KEY;
  if (env.NODE_ENV === 'production') {
    if (!key) throw new Error('PORTICO_TERMS_SEAL_KEY must be set in production (from the secrets manager).');
    if (key === DEV_KEY) throw new Error('The development terms seal key must never be used in production.');
  }
  return key ? { key, keySource: 'env' } : { key: DEV_KEY, keySource: 'local-dev' };
}
