import { createHash } from 'node:crypto';
import { type PorticoDatabase, type Selectable, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  EntitlementError,
  ExternalServiceError,
  isUuid,
  NotFoundError,
  newId,
  type RequestContext,
  randomToken,
  requirePermission,
  sha256Hex,
  systemAuthorizer,
  type TenantEnvironment,
  UnauthenticatedError,
  ValidationError,
} from '@portico/kernel';
import { createLocalJWKSet, type JSONWebKeySet, type JWTPayload, jwtVerify } from 'jose';
import { emailDomainAllowed, groupsFromClaim } from '../domain/role-mapping';
import { NotConfiguredError } from '../errors';
import type { IdentityPorts } from '../ports';
import { assertCanGrantRole } from '../service';
import type { IdentityDB } from '../tables';
import { reconcileMappedRoles } from './mapped-roles';
import { checkSignInLocation } from './security';
import { createSession } from './sessions';

/**
 * Enterprise single sign-on with OpenID Connect (authorization code + PKCE, confidential client), per organization:
 * issuer discovery, client secret held in the SecretStore, allowed email domains, group → role mapping with JIT
 * provisioning, and an optional "SSO required" enforcement that disables password sign-in for members
 * (up to three named exempt accounts for identity-provider outages). SAML 2.0 is LATER and will reuse the same
 * group → role mapping model. Tested only against an in-process fake identity provider (readiness R3).
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export const SSO_STATE_MINUTES = 10;
type Connection = Selectable<IdentityDB['identity.sso_connections']>;

function requireHttp(ports: Pick<IdentityPorts, 'oidcHttp'>) {
  if (!ports.oidcHttp) throw new NotConfiguredError('Single sign-on', 'outbound HTTP to identity providers');
  return ports.oidcHttp;
}

async function requireSsoEntitlement(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  feature = 'identity.sso',
) {
  if (ports.hasEntitlement && !(await ports.hasEntitlement(tx, feature))) throw new EntitlementError(feature);
}

function assertSecureUrl(url: string, field: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ValidationError('invalid_url', `${field} is not a valid URL.`);
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))
    throw new ValidationError('insecure_url', `${field} must use https.`);
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

async function discover(ports: Pick<IdentityPorts, 'oidcHttp'>, issuer: string): Promise<Discovery> {
  const http = requireHttp(ports);
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  let doc: unknown;
  try {
    doc = await http.getJson(url);
  } catch (err) {
    throw new ExternalServiceError(
      'identity_provider',
      `Could not read the identity provider's configuration at ${url}. Check the issuer URL.`,
      {
        cause: err,
        retryable: true,
      },
    );
  }
  const d = doc as Partial<Discovery>;
  if (
    !d ||
    typeof d !== 'object' ||
    !d.issuer ||
    !d.authorization_endpoint ||
    !d.token_endpoint ||
    !d.jwks_uri
  ) {
    throw new ValidationError(
      'invalid_discovery',
      'The identity provider did not return a valid OpenID configuration.',
    );
  }
  if (d.issuer !== issuer)
    throw new ValidationError(
      'issuer_mismatch',
      `The provider reports issuer "${d.issuer}", not "${issuer}". Use the exact issuer.`,
    );
  for (const [k, v] of Object.entries({
    authorization_endpoint: d.authorization_endpoint,
    token_endpoint: d.token_endpoint,
    jwks_uri: d.jwks_uri,
  }))
    assertSecureUrl(v, k);
  return d as Discovery;
}

export interface SsoConnectionView {
  id: string;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecretSet: boolean;
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post';
  scopes: string[];
  allowedEmailDomains: string[];
  groupsClaim: string;
  jitProvisioning: boolean;
  trustIdpMfa: boolean;
  ssoRequired: boolean;
  ssoExemptUserIds: string[];
  status: 'active' | 'disabled';
  mappings: Array<{ id: string; group: string; roleKey: string; scopeType: string; scopeId: string | null }>;
  version: number;
}

async function toView(tx: TxContext, c: Connection): Promise<SsoConnectionView> {
  const mappings = await db(tx)
    .selectFrom('identity.group_role_mappings as m')
    .innerJoin('identity.roles as r', 'r.id', 'm.role_id')
    .select(['m.id', 'm.group_name', 'r.key', 'm.scope_type', 'm.scope_id'])
    .orderBy('m.group_name')
    .execute();
  return {
    id: c.id,
    displayName: c.display_name,
    issuer: c.issuer,
    clientId: c.client_id,
    clientSecretSet: !!c.client_secret_ref,
    tokenEndpointAuthMethod: c.token_endpoint_auth_method,
    scopes: c.scopes,
    allowedEmailDomains: c.allowed_email_domains,
    groupsClaim: c.groups_claim,
    jitProvisioning: c.jit_provisioning,
    trustIdpMfa: c.trust_idp_mfa,
    ssoRequired: c.sso_required,
    ssoExemptUserIds: c.sso_exempt_user_ids,
    status: c.status,
    mappings: mappings.map((m) => ({
      id: m.id,
      group: m.group_name,
      roleKey: m.key,
      scopeType: m.scope_type,
      scopeId: m.scope_id,
    })),
    version: c.version,
  };
}

export async function getSsoConnection(tx: TxContext): Promise<SsoConnectionView | null> {
  requirePermission(tx, 'identity.sso.manage');
  const c = await db(tx).selectFrom('identity.sso_connections').selectAll().executeTakeFirst();
  return c ? toView(tx, c) : null;
}

export interface SsoConfigInput {
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret?: string | undefined;
  tokenEndpointAuthMethod?: 'client_secret_basic' | 'client_secret_post' | undefined;
  scopes?: string[] | undefined;
  allowedEmailDomains: string[];
  groupsClaim?: string | undefined;
  jitProvisioning?: boolean | undefined;
  trustIdpMfa?: boolean | undefined;
  status?: 'active' | 'disabled' | undefined;
}

/**
 * Create or replace the organization's OIDC connection. Endpoints come from the issuer's discovery document; the
 * client secret is written to the SecretStore and only its reference is kept. `expectedVersion` is required when
 * a connection exists (If-Match).
 */
export async function configureSso(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'oidcHttp' | 'secrets' | 'hasEntitlement'>,
  input: SsoConfigInput,
  expectedVersion?: number,
): Promise<SsoConnectionView> {
  requirePermission(tx, 'identity.sso.manage');
  await requireSsoEntitlement(tx, ports);
  if (!ports.secrets) throw new NotConfiguredError('Single sign-on', 'the secret store');
  assertSecureUrl(input.issuer, 'issuer');
  const domains = [...new Set(input.allowedEmailDomains.map((d) => d.toLowerCase().trim()))];
  if (domains.length === 0 || domains.some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))
    throw new ValidationError('invalid_domains', 'List at least one email domain such as lagoon.mv.');
  const d = await discover(ports, input.issuer);
  const existing = await db(tx).selectFrom('identity.sso_connections').selectAll().executeTakeFirst();
  if (existing && expectedVersion === undefined)
    throw new ValidationError('if_match_required', 'Send If-Match with the connection version to change it.');
  if (!existing && !input.clientSecret)
    throw new ValidationError(
      'client_secret_required',
      'Enter the client secret issued by your identity provider.',
    );
  const secretRef = input.clientSecret
    ? (await ports.secrets.put(tx, { name: 'sso.client_secret', value: input.clientSecret })).ref
    : (existing?.client_secret_ref as string);
  if (existing && input.clientSecret && existing.client_secret_ref !== secretRef)
    await ports.secrets.delete(tx, existing.client_secret_ref);
  const by = tx.actor.kind === 'user' ? `user:${tx.actor.userId}` : tx.actor.kind;
  const values = {
    display_name: input.displayName,
    issuer: input.issuer,
    client_id: input.clientId,
    client_secret_ref: secretRef,
    token_endpoint_auth_method: input.tokenEndpointAuthMethod ?? 'client_secret_basic',
    authorization_endpoint: d.authorization_endpoint,
    token_endpoint: d.token_endpoint,
    jwks_uri: d.jwks_uri,
    scopes: input.scopes ?? ['openid', 'email', 'profile'],
    allowed_email_domains: domains,
    groups_claim: input.groupsClaim ?? 'groups',
    jit_provisioning: input.jitProvisioning ?? true,
    trust_idp_mfa: input.trustIdpMfa ?? false,
    status: input.status ?? 'active',
    updated_by: by,
  };
  let row: Connection | undefined;
  if (existing) {
    row = await db(tx)
      .updateTable('identity.sso_connections')
      .set({ ...values, version: sql`version + 1` })
      .where('id', '=', existing.id)
      .where('version', '=', expectedVersion as number)
      .returningAll()
      .executeTakeFirst();
    if (!row)
      throw new ValidationError(
        'version_conflict',
        'The SSO connection was changed by someone else. Reload and retry.',
      );
  } else {
    row = await db(tx)
      .insertInto('identity.sso_connections')
      .values({ id: newId(), tenant_id: tx.tenantId, ...values })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  await tx.audit({
    action: existing ? 'identity.sso.update' : 'identity.sso.create',
    target: { type: 'sso_connection', id: row.id },
    after: { ...values, client_secret_ref: '(stored in secret store)' },
  });
  return toView(tx, row);
}

/** Replace the group → role mappings. The editor must be able to grant every mapped role (no escalation). */
export async function setGroupRoleMappings(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'propertyIdsInScope'>,
  mappings: Array<{
    group: string;
    roleKey: string;
    scopeType: 'organization' | 'brand' | 'region' | 'property';
    scopeId?: string | undefined;
  }>,
) {
  requirePermission(tx, 'identity.sso.manage');
  const roles = new Map(
    (
      await db(tx).selectFrom('identity.roles').select(['id', 'key', 'permissions', 'archived_at']).execute()
    ).map((r) => [r.key, r]),
  );
  for (const m of mappings) {
    const role = roles.get(m.roleKey);
    if (!role || role.archived_at) throw new NotFoundError('role', m.roleKey);
    if ((m.scopeType === 'organization') !== (m.scopeId === undefined))
      throw new ValidationError(
        'invalid_scope',
        `Mapping for ${m.group}: organization roles have no scope id; others need one.`,
      );
    await assertCanGrantRole(tx, role.permissions, { type: m.scopeType, id: m.scopeId ?? null }, ports);
  }
  const before = await db(tx).selectFrom('identity.group_role_mappings').selectAll().execute();
  await db(tx).deleteFrom('identity.group_role_mappings').execute();
  const by = tx.actor.kind === 'user' ? `user:${tx.actor.userId}` : tx.actor.kind;
  for (const m of mappings) {
    await db(tx)
      .insertInto('identity.group_role_mappings')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        group_name: m.group,
        role_id: (roles.get(m.roleKey) as { id: string }).id,
        scope_type: m.scopeType,
        scope_id: m.scopeId ?? null,
        created_by: by,
      })
      .execute();
  }
  await tx.audit({
    action: 'identity.sso.mappings',
    target: { type: 'organization', id: tx.tenantId },
    before: before.map((b) => ({
      group: b.group_name,
      roleId: b.role_id,
      scope: `${b.scope_type}:${b.scope_id ?? '-'}`,
    })),
    after: mappings,
  });
  return mappings.length;
}

/**
 * Turn "SSO required" on or off. To prevent lock-out, enabling it requires that the administrator is currently
 * signed in through this organization's SSO. Password sessions of non-exempt members are revoked.
 */
export async function setSsoEnforcement(
  tx: TxContext,
  input: { ssoRequired: boolean; exemptUserIds: string[] },
) {
  requirePermission(tx, 'identity.sso.manage');
  const c = await db(tx).selectFrom('identity.sso_connections').selectAll().executeTakeFirst();
  if (c?.status !== 'active')
    throw new BusinessRuleError('sso_not_configured', 'Configure and activate SSO first.');
  if (input.exemptUserIds.length > 3)
    throw new ValidationError('too_many_exemptions', 'At most 3 accounts may keep password sign-in.');
  if (input.ssoRequired) {
    const sessionId = tx.actor.kind === 'user' ? tx.actor.sessionId : undefined;
    const s = sessionId
      ? await db(tx)
          .selectFrom('identity.sessions')
          .select('auth_method')
          .where('id', '=', sessionId)
          .executeTakeFirst()
      : undefined;
    if (s?.auth_method !== 'sso') {
      throw new BusinessRuleError(
        'sign_in_with_sso_first',
        'Sign in with SSO once before requiring it, so you know it works and nobody is locked out.',
      );
    }
  }
  await db(tx)
    .updateTable('identity.sso_connections')
    .set({
      sso_required: input.ssoRequired,
      sso_exempt_user_ids: input.exemptUserIds,
      version: sql`version + 1`,
    })
    .where('id', '=', c.id)
    .execute();
  let revoked = 0;
  if (input.ssoRequired) {
    let q = db(tx)
      .updateTable('identity.sessions')
      .set({ revoked_at: tx.now, revoked_reason: 'sso_required' })
      .where('auth_method', '=', 'password')
      .where('revoked_at', 'is', null);
    if (input.exemptUserIds.length) q = q.where('user_id', 'not in', input.exemptUserIds);
    revoked = Number((await q.executeTakeFirst()).numUpdatedRows);
  }
  await tx.audit({
    action: 'identity.sso.enforcement',
    target: { type: 'sso_connection', id: c.id },
    before: { ssoRequired: c.sso_required, exempt: c.sso_exempt_user_ids },
    after: { ...input, passwordSessionsRevoked: revoked },
  });
  return { ssoRequired: input.ssoRequired, passwordSessionsRevoked: revoked };
}

async function orgContext(
  database: PorticoDatabase,
  organizationId: string,
): Promise<RequestContext & { orgName: string }> {
  const { rows } = await sql<{ id: string; name: string; environment: string; status: string }>`
    select id, name, environment, status from platform.tenant_summaries(${[organizationId]}::uuid[])`.execute(
    database.kysely,
  );
  const org = rows[0];
  if (org?.status !== 'active') throw new NotFoundError('organization', organizationId);
  return {
    tenantId: org.id,
    environment: org.environment as TenantEnvironment,
    actor: { kind: 'system', process: 'sso' },
    authz: systemAuthorizer,
    correlationId: newId(),
    orgName: org.name,
  };
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Start SSO sign-in for an organization (public). Returns the identity provider URL to send the browser to. */
export async function startSsoLogin(
  database: PorticoDatabase,
  ports: Pick<IdentityPorts, 'cipher' | 'config'>,
  input: { organizationId: string },
): Promise<{ authorizationUrl: string; expiresAt: Date }> {
  if (!ports.cipher) throw new NotConfiguredError('Single sign-on', 'field encryption');
  const redirectUri = ports.config?.ssoRedirectUri;
  if (!redirectUri) throw new NotConfiguredError('Single sign-on', 'the redirect URI');
  const ctx = await orgContext(database, input.organizationId);
  const cipher = ports.cipher;
  return withTenantTx(database, ctx, async (tx) => {
    const c = await db(tx).selectFrom('identity.sso_connections').selectAll().executeTakeFirst();
    if (c?.status !== 'active')
      throw new BusinessRuleError(
        'sso_not_configured',
        'This organization does not use single sign-on. Sign in with your password.',
      );
    const id = newId();
    const state = `${tx.tenantId}.${randomToken(24)}`;
    const nonce = randomToken(24);
    const verifier = randomToken(48);
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const expiresAt = new Date(tx.now.getTime() + SSO_STATE_MINUTES * 60_000);
    await db(tx)
      .insertInto('identity.sso_login_states')
      .values({
        id,
        tenant_id: tx.tenantId,
        state_hash: sha256Hex(state),
        nonce,
        code_verifier_enc: cipher.encrypt(verifier, `sso:${id}`),
        redirect_uri: redirectUri,
        expires_at: expiresAt,
        consumed_at: null,
      })
      .execute();
    const url = new URL(c.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: c.client_id,
      redirect_uri: redirectUri,
      scope: c.scopes.join(' '),
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return { authorizationUrl: url.toString(), expiresAt };
  });
}

const jwksCache = new Map<string, { jwks: JSONWebKeySet; fetchedAt: number }>();
const JWKS_TTL_MS = 10 * 60_000;

async function jwksFor(
  ports: Pick<IdentityPorts, 'oidcHttp'>,
  uri: string,
  refresh: boolean,
): Promise<JSONWebKeySet> {
  const cached = jwksCache.get(uri);
  if (!refresh && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.jwks;
  const jwks = (await requireHttp(ports).getJson(uri)) as JSONWebKeySet;
  if (!jwks || !Array.isArray(jwks.keys))
    throw new ExternalServiceError('identity_provider', 'The identity provider returned no signing keys.');
  jwksCache.set(uri, { jwks, fetchedAt: Date.now() });
  return jwks;
}

async function verifyIdToken(
  ports: Pick<IdentityPorts, 'oidcHttp'>,
  c: Connection,
  idToken: string,
  nonce: string,
  now: Date,
): Promise<JWTPayload> {
  const opts = {
    issuer: c.issuer,
    audience: c.client_id,
    algorithms: ['RS256', 'PS256', 'ES256', 'EdDSA'],
    clockTolerance: 60,
    currentDate: now,
  };
  let payload: JWTPayload;
  try {
    payload = (await jwtVerify(idToken, createLocalJWKSet(await jwksFor(ports, c.jwks_uri, false)), opts))
      .payload;
  } catch (err) {
    if ((err as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') throw err;
    // Key rotation at the provider: fetch the key set again once.
    payload = (await jwtVerify(idToken, createLocalJWKSet(await jwksFor(ports, c.jwks_uri, true)), opts))
      .payload;
  }
  if (payload.nonce !== nonce) throw new Error('nonce mismatch');
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== c.client_id)
    throw new Error('azp mismatch');
  return payload;
}

const SSO_FAILED =
  'Single sign-on did not complete. Start again from the sign-in page; if it keeps failing, ask your administrator.';

/**
 * Complete SSO (public): exchange the code (with the PKCE verifier and client secret), verify the ID token against
 * the provider's keys, check the email domain, provision or update the membership (JIT), reconcile group-mapped
 * roles and open a session. Every refusal is audited in the organization.
 */
export async function completeSsoLogin(
  database: PorticoDatabase,
  ports: Pick<IdentityPorts, 'cipher' | 'secrets' | 'oidcHttp' | 'geo'>,
  input: { state: string; code: string; ip?: string | undefined; userAgent?: string | undefined },
) {
  const [tenantId] = input.state.split('.');
  if (!tenantId || !isUuid(tenantId)) throw new UnauthenticatedError(SSO_FAILED);
  if (!ports.cipher || !ports.secrets)
    throw new NotConfiguredError('Single sign-on', 'field encryption and the secret store');
  const cipher = ports.cipher;
  const secrets = ports.secrets;
  const ctx = await orgContext(database, tenantId).catch(() => {
    throw new UnauthenticatedError(SSO_FAILED);
  });
  const result = await withTenantTx(database, ctx, async (tx) => {
    const fail = async (reason: string, details: Record<string, unknown> = {}) => {
      await tx.audit({
        action: 'identity.sso.loginFailed',
        target: { type: 'organization', id: tx.tenantId },
        reason,
        metadata: details,
      });
      return { ok: false as const, reason };
    };
    const st = await db(tx)
      .selectFrom('identity.sso_login_states')
      .selectAll()
      .where('state_hash', '=', sha256Hex(input.state))
      .forUpdate()
      .executeTakeFirst();
    if (!st || st.consumed_at || st.expires_at <= tx.now) return fail('invalid_or_expired_state');
    await db(tx)
      .updateTable('identity.sso_login_states')
      .set({ consumed_at: tx.now })
      .where('id', '=', st.id)
      .execute();
    const c = await db(tx).selectFrom('identity.sso_connections').selectAll().executeTakeFirst();
    if (c?.status !== 'active') return fail('sso_not_active');
    const verifier = cipher.decrypt(st.code_verifier_enc, `sso:${st.id}`);
    const secret = await secrets.get(tx, c.client_secret_ref);
    const form: Record<string, string> = {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: st.redirect_uri,
      code_verifier: verifier,
      client_id: c.client_id,
    };
    const headers: Record<string, string> = {};
    if (c.token_endpoint_auth_method === 'client_secret_post') form.client_secret = secret;
    else
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(c.client_id)}:${encodeURIComponent(secret)}`).toString('base64')}`;
    const tokenRes = await requireHttp(ports).postForm(c.token_endpoint, form, headers);
    const idToken = (tokenRes.body as { id_token?: unknown } | null)?.id_token;
    if (tokenRes.status !== 200 || typeof idToken !== 'string')
      return fail('token_exchange_failed', { status: tokenRes.status });
    let claims: JWTPayload;
    try {
      claims = await verifyIdToken(ports, c, idToken, st.nonce, tx.now);
    } catch (err) {
      return fail('id_token_invalid', { error: (err as Error).message });
    }
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : undefined;
    if (!email) return fail('email_claim_missing');
    if (claims.email_verified === false) return fail('email_not_verified', { email });
    if (!emailDomainAllowed(email, c.allowed_email_domains))
      return fail('email_domain_not_allowed', { email });
    const groups = groupsFromClaim(claims[c.groups_claim]);
    const { rows } = await sql<{
      id: string;
    }>`select identity.ensure_user(${newId()}::uuid, ${email}) as id`.execute(tx.db);
    const userId = rows[0]?.id as string;
    const member = await db(tx)
      .selectFrom('identity.memberships')
      .select(['id', 'status'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (member && member.status !== 'active' && member.status !== 'invited')
      return fail('membership_not_active', { userId });
    const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email;
    if (!member) {
      if (!c.jit_provisioning) return fail('no_membership', { email });
      const mappings = await db(tx).selectFrom('identity.group_role_mappings').select('group_name').execute();
      const lower = new Set(groups.map((g) => g.toLowerCase()));
      if (!mappings.some((m) => lower.has(m.group_name.toLowerCase())))
        return fail('no_mapped_group', { email, groups });
      await db(tx)
        .insertInto('identity.memberships')
        .values({
          id: newId(),
          tenant_id: tx.tenantId,
          user_id: userId,
          display_name: name,
          job_title: null,
          status: 'active',
          activated_at: tx.now,
          provisioned_by: 'sso',
          external_id: typeof claims.sub === 'string' ? `oidc:${claims.sub}` : null,
          status_reason: null,
          removed_at: null,
          default_property_id: null,
        })
        .execute();
      await tx.audit({
        action: 'identity.user.jitProvision',
        target: { type: 'user', id: userId },
        after: { email, groups },
      });
      await tx.emit({
        type: 'identity.membership.activated',
        aggregate: { type: 'user', id: userId },
        payload: { userId, via: 'sso' },
      });
    } else if (member.status === 'invited') {
      await db(tx)
        .updateTable('identity.memberships')
        .set({ status: 'active', activated_at: tx.now, version: sql`version + 1` })
        .where('id', '=', member.id)
        .execute();
    }
    await reconcileMappedRoles(tx, userId, 'sso', groups);
    const amr = Array.isArray(claims.amr) ? claims.amr.map(String) : [];
    const idpMfa =
      c.trust_idp_mfa || amr.some((m) => ['mfa', 'otp', 'hwk', 'swk', 'sms', 'fpt', 'face'].includes(m));
    const session = await createSession(tx, {
      userId,
      authMethod: 'sso',
      mfaVerifiedAt: idpMfa ? tx.now : null,
      idpMfa,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await checkSignInLocation(tx, ports, { userId, ip: input.ip });
    return { ok: true as const, userId, ...session };
  });
  if (!result.ok) throw new UnauthenticatedError(SSO_FAILED);
  return {
    status: 'signed_in' as const,
    token: result.token,
    expiresAt: result.expiresAt,
    userId: result.userId,
    organization: { id: ctx.tenantId, name: ctx.orgName, environment: ctx.environment },
  };
}

/** For tests: forget cached provider keys. */
export function clearJwksCache(): void {
  jwksCache.clear();
}
