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
import { emailDomain, emailDomainAllowed, groupsFromClaim } from '../domain/role-mapping';
import { NotConfiguredError } from '../errors';
import type { IdentityPorts } from '../ports';
import type { IdentityDB } from '../tables';
import {
  assertCanGrantRole,
  assertNotElevated,
  assertRootChange,
  credentialSummary,
  hasAnyCredential,
  isHumanSelf,
  membershipsElsewhere,
  notifyAdministrators,
  verifyEmailOwnership,
} from './guard';
import { reconcileMappedRoles } from './mapped-roles';
import { getSecurityPolicy } from './policy';
import { checkSignInLocation, raiseSecurityAlert } from './security';
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

/** P2-2: https only; `http://localhost` only when the deployment explicitly allows a local development IdP. */
function assertSecureUrl(url: string, field: string, allowLocal = false) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ValidationError('invalid_url', `${field} is not a valid URL.`);
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (local && !allowLocal)
    throw new ValidationError('insecure_url', `${field} must be a public https address.`);
  if (u.protocol !== 'https:' && !(allowLocal && local && u.protocol === 'http:'))
    throw new ValidationError('insecure_url', `${field} must use https.`);
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

/**
 * Read the issuer's OpenID configuration. Call it OUTSIDE any database transaction (P2-2) and pass the result to
 * `configureSso`.
 */
export async function discoverIssuer(
  ports: Pick<IdentityPorts, 'oidcHttp' | 'config'>,
  issuer: string,
): Promise<Discovery> {
  const allowLocal = ports.config?.allowLocalIdentityProvider ?? false;
  assertSecureUrl(issuer, 'issuer', allowLocal);
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
    assertSecureUrl(v, k, allowLocal);
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
  ports: Pick<IdentityPorts, 'oidcHttp' | 'secrets' | 'hasEntitlement' | 'config' | 'notifier'>,
  input: SsoConfigInput,
  expectedVersion?: number,
  /** Pre-fetched with `discoverIssuer` outside the transaction (routes do this; tests may omit it). */
  discovery?: Discovery,
): Promise<SsoConnectionView> {
  requirePermission(tx, 'identity.sso.manage');
  assertNotElevated(tx, 'Changing single sign-on');
  await requireSsoEntitlement(tx, ports);
  if (!ports.secrets) throw new NotConfiguredError('Single sign-on', 'the secret store');
  const domains = [...new Set(input.allowedEmailDomains.map((d) => d.toLowerCase().trim()))];
  if (domains.length === 0 || domains.some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))
    throw new ValidationError('invalid_domains', 'List at least one email domain such as lagoon.mv.');
  const d =
    discovery && discovery.issuer === input.issuer ? discovery : await discoverIssuer(ports, input.issuer);
  const existing = await db(tx).selectFrom('identity.sso_connections').selectAll().executeTakeFirst();
  // ADR-0017 rule 15 (review R2-P1-1): the issuer, the email allow-list and trusting the IdP's MFA decide who can sign
  // in as whom, so changing them is a root change.
  const sameDomains = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const issuerChanged = !!existing && existing.issuer !== input.issuer;
  const rootChange =
    !existing ||
    issuerChanged ||
    !sameDomains(existing.allowed_email_domains, domains) ||
    existing.trust_idp_mfa !== (input.trustIdpMfa ?? existing.trust_idp_mfa);
  if (rootChange)
    assertRootChange(tx, 'Changing the identity provider, the allowed email domains or trust in its MFA');
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
    trust_idp_mfa: input.trustIdpMfa ?? existing?.trust_idp_mfa ?? false,
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
  if (issuerChanged) {
    // ADR-0017 rule 15: a new issuer re-confirms domain ownership (verification is not inherited, R2-P3-5) and the
    // old issuer's links stop meaning anything.
    await db(tx).updateTable('identity.sso_domains').set({ verified_at: null }).execute();
    await db(tx).deleteFrom('identity.sso_identities').where('issuer', '=', existing.issuer).execute();
  }
  if (rootChange && existing) {
    const by = tx.actor.kind === 'user' ? (tx.actor.displayName ?? tx.actor.userId) : tx.actor.kind;
    const summary = issuerChanged
      ? `Single sign-on now trusts a different identity provider (${input.issuer}); email domains must be verified again.`
      : 'Single sign-on root settings changed (allowed email domains or trust in the identity provider’s MFA).';
    await raiseSecurityAlert(tx, {
      rule: 'sso_root_change',
      severity: 'high',
      summary,
      details: { issuerChanged, by },
      dedupeKey: `sso_root_change:${row.id}:${row.version}`,
    });
    await notifyAdministrators(tx, ports, {
      subject: 'Single sign-on settings changed',
      body: `${summary} Changed by ${by}. If you did not expect this, review the SSO settings now.`,
    });
  }
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
  assertNotElevated(tx, 'Changing single sign-on role mappings');
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
 * signed in through this organization's SSO and that at least one active member keeps password sign-in as an
 * emergency account (P2-4). Password sessions of non-exempt members are revoked.
 */
export async function setSsoEnforcement(
  tx: TxContext,
  input: { ssoRequired: boolean; exemptUserIds: string[] },
) {
  requirePermission(tx, 'identity.sso.manage');
  assertNotElevated(tx, 'Changing single sign-on enforcement');
  assertRootChange(tx, 'Requiring single sign-on (or changing who is exempt)');
  const c = await db(tx).selectFrom('identity.sso_connections').selectAll().executeTakeFirst();
  if (c?.status !== 'active')
    throw new BusinessRuleError('sso_not_configured', 'Configure and activate SSO first.');
  if (input.exemptUserIds.length > 3)
    throw new ValidationError('too_many_exemptions', 'At most 3 accounts may keep password sign-in.');
  if (input.ssoRequired) {
    const active = input.exemptUserIds.length
      ? await db(tx)
          .selectFrom('identity.memberships')
          .select('user_id')
          .where('user_id', 'in', input.exemptUserIds)
          .where('status', '=', 'active')
          .execute()
      : [];
    if (active.length === 0) {
      throw new ValidationError(
        'emergency_account_required',
        'Keep at least one active member on password sign-in while SSO is required, so the organization can still sign in if the identity provider fails.',
      );
    }
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
  input: { organizationId: string; linkUserId?: string | undefined },
): Promise<{ authorizationUrl: string; expiresAt: Date; browserBinding: string }> {
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
    // P2-3: a secret the starting browser keeps (sessionStorage/cookie) and must present at the callback, so a
    // leaked (state, code) pair cannot be redeemed elsewhere (also prevents login CSRF).
    const browserBinding = randomToken(24);
    const expiresAt = new Date(tx.now.getTime() + SSO_STATE_MINUTES * 60_000);
    await db(tx)
      .insertInto('identity.sso_login_states')
      .values({
        id,
        tenant_id: tx.tenantId,
        state_hash: sha256Hex(state),
        binding_hash: sha256Hex(browserBinding),
        nonce,
        code_verifier_enc: cipher.encrypt(verifier, `sso:${id}`),
        redirect_uri: redirectUri,
        link_user_id: input.linkUserId ?? null,
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
    return { authorizationUrl: url.toString(), expiresAt, browserBinding };
  });
}

/**
 * ADR-0017 rule 15: a member who already has their own credentials proves them before their identity-provider account
 * is linked. They start SSO from a session signed in with their password (and a fresh second factor when they have
 * one); the callback then links the IdP account to them, and only to them.
 */
export async function startSsoLink(
  database: PorticoDatabase,
  ports: Pick<IdentityPorts, 'cipher' | 'config'>,
  ctx: RequestContext,
): Promise<{ authorizationUrl: string; expiresAt: Date; browserBinding: string }> {
  const actor = ctx.actor;
  if (!isHumanSelf(actor) || !actor.sessionId)
    throw new BusinessRuleError('not_a_user', 'Sign in as yourself to link your single sign-on account.');
  const sessionId = actor.sessionId;
  await withTenantTx(database, ctx, async (tx) => {
    const s = await db(tx)
      .selectFrom('identity.sessions')
      .select(['auth_method', 'mfa_verified_at'])
      .where('id', '=', sessionId)
      .executeTakeFirst();
    if (s?.auth_method !== 'password')
      throw new BusinessRuleError(
        'password_session_required',
        'Sign in with your Portico password (not single sign-on) to prove it is you, then link your account.',
      );
    const creds = await credentialSummary(tx, actor.userId);
    if (creds.hasFactor) {
      const policy = await getSecurityPolicy(tx);
      const fresh =
        s.mfa_verified_at &&
        tx.now.getTime() - s.mfa_verified_at.getTime() <= policy.mfaStepUpWindowMinutes * 60_000;
      if (!fresh)
        throw new BusinessRuleError(
          'mfa_required',
          'Confirm a code from your authenticator first, then link your single sign-on account.',
        );
    }
  });
  return startSsoLogin(database, ports, { organizationId: ctx.tenantId, linkUserId: actor.userId });
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
  c: { issuer: string; client_id: string; jwks_uri: string },
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
    // P1-8: these claims must be present (jose verifies exp/iat values; sub and nonce are checked below).
    requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
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

/** A refused SSO sign-in: thrown inside the binding transaction so nothing it wrote is kept. */
class SsoRefusal extends Error {
  constructor(
    readonly reason: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(reason);
  }
}

const SSO_FAILED =
  'Single sign-on did not complete. Start again from the sign-in page; if it keeps failing, ask your administrator.';

/** P3-5: failure audits never store a non-member's email or groups — only the domain and a fingerprint. */
function emailFingerprint(email: string | undefined) {
  if (!email) return {};
  return { emailDomain: emailDomain(email), emailHash: sha256Hex(email.toLowerCase()).slice(0, 16) };
}

async function auditFailure(
  database: PorticoDatabase,
  ctx: RequestContext,
  reason: string,
  details: Record<string, unknown> = {},
) {
  await withTenantTx(database, ctx, (tx) =>
    tx.audit({
      action: 'identity.sso.loginFailed',
      target: { type: 'organization', id: tx.tenantId },
      reason,
      metadata: details,
    }),
  );
}

/**
 * Complete SSO (public). Three phases so no identity-provider call happens inside a database transaction (P2-2):
 *  1. consume the login state (single use, bound to the starting browser — P2-3) and load the connection;
 *  2. exchange the code (PKCE + client secret) and verify the ID token against the provider's keys;
 *  3. bind the identity and open a session. ADR-0017 §5 / P1-8: sign-in matches on (issuer, sub) once linked;
 *     `email_verified` must be true; a NEW link to an existing person who also works elsewhere requires that this
 *     organization has verified the email domain (DNS TXT). JIT creates memberships only for mapped groups.
 * Every refusal is audited in the organization (without the non-member's email).
 */
export async function completeSsoLogin(
  database: PorticoDatabase,
  ports: Pick<IdentityPorts, 'cipher' | 'secrets' | 'oidcHttp' | 'geo'>,
  input: {
    state: string;
    code: string;
    browserBinding?: string | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
  },
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

  // Phase 1 — consume the state.
  const prepared = await withTenantTx(database, ctx, async (tx) => {
    const st = await db(tx)
      .selectFrom('identity.sso_login_states')
      .selectAll()
      .where('state_hash', '=', sha256Hex(input.state))
      .forUpdate()
      .executeTakeFirst();
    if (!st || st.consumed_at || st.expires_at <= tx.now)
      return { ok: false as const, reason: 'invalid_or_expired_state' };
    // R2-P3-8: check the browser binding BEFORE consuming, so a leaked (state, code) cannot burn the real login.
    if (!input.browserBinding || sha256Hex(input.browserBinding) !== st.binding_hash)
      return { ok: false as const, reason: 'browser_binding_mismatch' };
    await db(tx)
      .updateTable('identity.sso_login_states')
      .set({ consumed_at: tx.now })
      .where('id', '=', st.id)
      .execute();
    const c = await db(tx).selectFrom('identity.sso_connections').selectAll().executeTakeFirst();
    if (c?.status !== 'active') return { ok: false as const, reason: 'sso_not_active' };
    return {
      ok: true as const,
      c,
      st,
      verifier: cipher.decrypt(st.code_verifier_enc, `sso:${st.id}`),
      secret: await secrets.get(tx, c.client_secret_ref),
    };
  });
  if (!prepared.ok) {
    await auditFailure(database, ctx, prepared.reason);
    throw new UnauthenticatedError(SSO_FAILED);
  }
  const { c, st, verifier, secret } = prepared;

  // Phase 2 — talk to the identity provider (no transaction open).
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
  let claims: JWTPayload;
  try {
    const tokenRes = await requireHttp(ports).postForm(c.token_endpoint, form, headers);
    const idToken = (tokenRes.body as { id_token?: unknown } | null)?.id_token;
    if (tokenRes.status !== 200 || typeof idToken !== 'string') {
      await auditFailure(database, ctx, 'token_exchange_failed', { status: tokenRes.status });
      throw new UnauthenticatedError(SSO_FAILED);
    }
    claims = await verifyIdToken(ports, c, idToken, st.nonce, database.clock.now());
  } catch (err) {
    if (err instanceof UnauthenticatedError) throw err;
    await auditFailure(database, ctx, 'id_token_invalid', { error: (err as Error).message });
    throw new UnauthenticatedError(SSO_FAILED);
  }

  // Phase 3 — every check first, then the writes (R2-P1-3): a refused sign-in throws, so the transaction rolls back
  // and persists neither a user nor a link; the refusal is audited in its own transaction.
  let result: { ok: true; userId: string; token: string; expiresAt: Date };
  try {
    result = await withTenantTx(database, ctx, async (tx) => {
      const refuse = (reason: string, details: Record<string, unknown> = {}): never => {
        throw new SsoRefusal(reason, details);
      };
      const rawEmail = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
      const domain = emailDomain(rawEmail);
      const subject = typeof claims.sub === 'string' ? claims.sub : undefined;
      if (!domain || !subject) return refuse('email_or_subject_missing');
      const email = rawEmail;
      const fp = emailFingerprint(email);
      if (claims.email_verified !== true) return refuse('email_not_verified', fp);
      if (!emailDomainAllowed(email, c.allowed_email_domains)) return refuse('email_domain_not_allowed', fp);
      const groups = groupsFromClaim(claims[c.groups_claim]);
      const { rows: found } = await sql<{ user_id: string }>`
        select user_id from identity.login_lookup(${email})`.execute(tx.db);
      const emailUserId = found[0]?.user_id;
      const domainVerified = !!(await db(tx)
        .selectFrom('identity.sso_domains')
        .select('id')
        .where('domain', '=', domain)
        .where('verified_at', 'is not', null)
        .executeTakeFirst());
      const link = await db(tx)
        .selectFrom('identity.sso_identities')
        .selectAll()
        .where('issuer', '=', c.issuer)
        .where('subject', '=', subject)
        .executeTakeFirst();
      // Link mode: a signed-in member proved their own credentials and asked to link this IdP account to them.
      const provedUserId = st.link_user_id;
      if (provedUserId && emailUserId !== provedUserId) return refuse('link_email_mismatch', fp);
      let userId: string | undefined;
      let newLink = false;
      if (link) {
        if (emailUserId && emailUserId !== link.user_id) return refuse('email_belongs_to_another_person', fp);
        userId = link.user_id;
      } else if (emailUserId) {
        const already = await db(tx)
          .selectFrom('identity.sso_identities')
          .select('id')
          .where('issuer', '=', c.issuer)
          .where('user_id', '=', emailUserId)
          .executeTakeFirst();
        if (already) return refuse('person_linked_to_another_subject', fp);
        if (provedUserId !== emailUserId) {
          const creds = await credentialSummary(tx, emailUserId);
          // A first sign-in through a verified domain verifies the email and wipes credentials set before (rule 12),
          // so only an already-verified person's own credentials need their proof (rule 15).
          const wipedFirst = domainVerified && !creds.emailVerified;
          if (!wipedFirst && hasAnyCredential(creds)) return refuse('existing_credentials_require_proof', fp);
        }
        userId = emailUserId;
        newLink = true;
      } else {
        newLink = true;
      }
      const member = userId
        ? await db(tx)
            .selectFrom('identity.memberships')
            .select(['id', 'status'])
            .where('user_id', '=', userId)
            .executeTakeFirst()
        : undefined;
      if (member && member.status !== 'active' && member.status !== 'invited')
        return refuse('membership_not_active', { userId });
      // ADR-0017 rule 15 / §5: whenever SSO would create or activate a membership for a person who works elsewhere,
      // this organization must have verified the email domain (or the person proved their own credentials).
      const activating = !member || member.status === 'invited';
      if (
        activating &&
        userId &&
        provedUserId !== userId &&
        !domainVerified &&
        (await membershipsElsewhere(tx, userId)) > 0
      )
        return refuse('existing_account_requires_verified_domain', fp);
      if (!member) {
        if (!c.jit_provisioning) return refuse('no_membership', fp);
        const mappings = await db(tx)
          .selectFrom('identity.group_role_mappings')
          .select('group_name')
          .execute();
        const lower = new Set(groups.map((g) => g.toLowerCase()));
        if (!mappings.some((m) => lower.has(m.group_name.toLowerCase())))
          return refuse('no_mapped_group', fp);
      }
      if (member?.status === 'invited') {
        const invitation = await db(tx)
          .selectFrom('identity.credential_tokens')
          .select('id')
          .where('user_id', '=', userId as string)
          .where('kind', '=', 'invitation')
          .where('used_at', 'is', null)
          .where('revoked_at', 'is', null)
          .where('expires_at', '>', tx.now)
          .executeTakeFirst();
        if (!invitation) return refuse('invitation_expired', { userId });
      }

      // All checks passed — now write.
      if (!userId) {
        const { rows } = await sql<{ id: string }>`
          select identity.ensure_user(${newId()}::uuid, ${email}) as id`.execute(tx.db);
        userId = rows[0]?.id as string;
      }
      const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email;
      if (!member) {
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
            external_id: `oidc:${subject}`,
            status_reason: null,
            removed_at: null,
            default_property_id: null,
          })
          .execute();
        await tx.audit({ action: 'identity.user.jitProvision', target: { type: 'user', id: userId } });
        await tx.emit({
          type: 'identity.membership.activated',
          aggregate: { type: 'user', id: userId },
          payload: { userId, via: 'sso' },
        });
      } else if (member.status === 'invited') {
        await db(tx)
          .updateTable('identity.credential_tokens')
          .set({ used_at: tx.now })
          .where('user_id', '=', userId)
          .where('kind', '=', 'invitation')
          .where('used_at', 'is', null)
          .execute();
        await db(tx)
          .updateTable('identity.memberships')
          .set({ status: 'active', activated_at: tx.now, version: sql`version + 1` })
          .where('id', '=', member.id)
          .execute();
      }
      // A sign-in through an identity provider whose domain this organization verified proves control of the email
      // (rule 12): the first time, everything set before is wiped — including older links, so ours is (re)written.
      if (domainVerified && (await verifyEmailOwnership(tx, userId))) newLink = true;
      if (newLink) {
        await db(tx)
          .insertInto('identity.sso_identities')
          .values({
            id: newId(),
            tenant_id: tx.tenantId,
            issuer: c.issuer,
            subject,
            user_id: userId,
            email_at_link: email,
            linked_at: tx.now,
          })
          .onConflict((oc) => oc.columns(['tenant_id', 'issuer', 'subject']).doNothing())
          .execute();
        await tx.audit({
          action: 'identity.sso.link',
          target: { type: 'user', id: userId },
          metadata: { issuer: c.issuer, proved: provedUserId === userId },
        });
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
  } catch (err) {
    if (!(err instanceof SsoRefusal)) throw err;
    await auditFailure(database, ctx, err.reason, err.details);
    throw new UnauthenticatedError(SSO_FAILED);
  }
  return {
    status: 'signed_in' as const,
    token: result.token,
    expiresAt: result.expiresAt,
    userId: result.userId,
    organization: { id: ctx.tenantId, name: ctx.orgName, environment: ctx.environment },
  };
}

// ───────────────────────────── Domain verification (ADR-0017 §5) ─────────────────────────────

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** Claim an email domain: returns the DNS TXT record to publish. */
export async function addSsoDomain(tx: TxContext, domain: string) {
  requirePermission(tx, 'identity.sso.manage');
  assertNotElevated(tx, 'Changing single sign-on domains');
  const d = domain.toLowerCase().trim();
  if (!DOMAIN_RE.test(d)) throw new ValidationError('invalid_domain', 'Enter a domain such as lagoon.mv.');
  const existing = await db(tx)
    .selectFrom('identity.sso_domains')
    .selectAll()
    .where('domain', '=', d)
    .executeTakeFirst();
  const row =
    existing ??
    (await db(tx)
      .insertInto('identity.sso_domains')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        domain: d,
        verification_token: randomToken(24),
        verified_at: null,
        created_by: tx.actor.kind === 'user' ? `user:${tx.actor.userId}` : tx.actor.kind,
      })
      .returningAll()
      .executeTakeFirstOrThrow());
  if (!existing)
    await tx.audit({
      action: 'identity.sso.domainClaim',
      target: { type: 'sso_domain', id: row.id },
      after: { domain: d },
    });
  return domainView(row);
}

function domainView(r: { domain: string; verification_token: string; verified_at: Date | null }) {
  return {
    domain: r.domain,
    verified: r.verified_at !== null,
    verifiedAt: r.verified_at?.toISOString() ?? null,
    txtRecord: { name: `_portico-verification.${r.domain}`, value: `portico-verify=${r.verification_token}` },
  };
}

export async function listSsoDomains(tx: TxContext) {
  requirePermission(tx, 'identity.sso.manage');
  return (await db(tx).selectFrom('identity.sso_domains').selectAll().orderBy('domain').execute()).map(
    domainView,
  );
}

/** Check the DNS TXT record (outside any transaction) and mark the domain verified. */
export async function verifySsoDomain(
  database: PorticoDatabase,
  ctx: RequestContext,
  ports: Pick<IdentityPorts, 'dnsTxt'>,
  domain: string,
) {
  if (!ports.dnsTxt) throw new NotConfiguredError('Domain verification', 'DNS lookups');
  const d = domain.toLowerCase().trim();
  const row = await withTenantTx(database, ctx, async (tx) => {
    requirePermission(tx, 'identity.sso.manage');
    assertNotElevated(tx, 'Changing single sign-on domains');
    return db(tx).selectFrom('identity.sso_domains').selectAll().where('domain', '=', d).executeTakeFirst();
  });
  if (!row) throw new NotFoundError('sso_domain', d);
  const records = await ports.dnsTxt(`_portico-verification.${d}`);
  if (!records.includes(`portico-verify=${row.verification_token}`)) {
    throw new BusinessRuleError(
      'domain_not_verified',
      `The TXT record was not found. Publish _portico-verification.${d} with the value shown, wait for DNS to update, then try again.`,
    );
  }
  return withTenantTx(database, ctx, async (tx) => {
    const updated = await db(tx)
      .updateTable('identity.sso_domains')
      .set({ verified_at: tx.now })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx.audit({
      action: 'identity.sso.domainVerified',
      target: { type: 'sso_domain', id: row.id },
      after: { domain: d },
    });
    return domainView(updated);
  });
}

/** For tests: forget cached provider keys. */
export function clearJwksCache(): void {
  jwksCache.clear();
}
