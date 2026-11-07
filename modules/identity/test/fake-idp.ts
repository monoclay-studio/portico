import { createHash } from 'node:crypto';
import { randomToken } from '@portico/kernel';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { expect } from 'vitest';
import type { OidcHttpClient } from '../src/ports';

/**
 * In-process fake OpenID provider: discovery, JWKS, and a token endpoint that checks client authentication and
 * PKCE before issuing an RS256 ID token. Keys are generated per test run; nothing listens on a port.
 */
export async function fakeIdp(issuer: string, clientId: string, clientSecret: string) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const rogue = await generateKeyPair('RS256');
  const codes = new Map<
    string,
    { nonce: string; challenge: string; claims: Record<string, unknown>; rogue: boolean }
  >();
  const calls: string[] = [];
  const http: OidcHttpClient = {
    async getJson(url) {
      calls.push(`GET ${url}`);
      if (url === `${issuer}/.well-known/openid-configuration`)
        return {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        };
      if (url === `${issuer}/jwks`) return { keys: [jwk] };
      throw new Error(`unexpected ${url}`);
    },
    async postForm(url, form, headers = {}) {
      calls.push(`POST ${url}`);
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      if (url !== `${issuer}/token` || headers.authorization !== `Basic ${basic}`)
        return { status: 401, body: { error: 'invalid_client' } };
      const entry = codes.get(form.code ?? '');
      if (!entry) return { status: 400, body: { error: 'invalid_grant' } };
      codes.delete(form.code ?? '');
      const challenge = createHash('sha256')
        .update(form.code_verifier ?? '')
        .digest('base64url');
      if (challenge !== entry.challenge)
        return { status: 400, body: { error: 'invalid_grant', error_description: 'PKCE' } };
      const idToken = await new SignJWT({ nonce: entry.nonce, ...entry.claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject(String(entry.claims.sub ?? entry.claims.email))
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(entry.rogue ? rogue.privateKey : privateKey);
      return { status: 200, body: { id_token: idToken, access_token: 'unused', token_type: 'Bearer' } };
    },
  };
  /** The browser leg: the person authenticates at the IdP, which redirects back with a code. */
  const authorize = (
    authorizationUrl: string,
    claims: Record<string, unknown>,
    opts: { rogue?: boolean } = {},
  ) => {
    const u = new URL(authorizationUrl);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('client_id')).toBe(clientId);
    const code = randomToken(16);
    codes.set(code, {
      nonce: u.searchParams.get('nonce') as string,
      challenge: u.searchParams.get('code_challenge') as string,
      claims,
      rogue: opts.rogue ?? false,
    });
    return { code, state: u.searchParams.get('state') as string };
  };
  return { http, authorize, calls };
}
