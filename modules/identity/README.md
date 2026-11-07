# identity

Decides, for every request, **who** is acting and **whether** they may do this here: staff users and their
credentials, MFA, enterprise SSO and SCIM, sessions, roles and scoped role assignments, API clients, Monoclay
support access, break-glass emergency access and suspicious-activity signals. Spec: `docs/specs/identity.md`
(IDN-R*), readiness brief §12–§13, ADR-0012.

## Status (2026-11-07)

Wave-1 enterprise identity is implemented and tested internally. Nothing is integrated with a real identity
provider, email service or GeoIP source: SSO is tested only against an in-process fake OpenID provider, staff
messages are queued (live) or simulated (non-live) but never delivered, and the GeoIP binding knows no countries.
`docs/parity/identity.md` does not exist yet (the parity gate cannot pass until the parity owner writes it; the
invariants and edge cases below are a starting list).

## Capabilities

| Capability | Spec | Status | Readiness | Evidence |
|---|---|---|---|---|
| Sign-in, sessions bound to one organization, lockout (wave 0) | IDN-R01/R02 | kept, extended | R3 | `test/identity.test.ts` |
| TOTP MFA: enrolment with `otpauth://` URI, field-encrypted secret, ±1 step drift, replay protection (a time step is accepted at most once, enforced by a guarded UPDATE), 10 hashed single-use recovery codes | IDN-R03 | done | R3 | `src/domain/totp.test.ts` (RFC 4226/6238 vectors), `test/mfa.test.ts` |
| Second factor at sign-in for enrolled members (`mfa_required` challenge, 5 minutes, 5 attempts) | IDN-R03 | done | R3 | `test/mfa.test.ts`, `apps/api/test/identity-enterprise.test.ts` |
| Central step-up: sensitive (⚑) permissions need recent MFA (`mfaStepUpWindowMinutes`, default 15) and enrolment after a grace period (default 72 h); optional MFA for everyone | IDN-R03, IDN-I04 | done (see design) | R3 | `src/domain/permissions.test.ts`, `test/mfa.test.ts`, HTTP `mfa_required` test |
| WebAuthn / passkeys | IDN-R02 | LATER (same factor table, `kind = 'webauthn'`) | R1 | — |
| Enterprise SSO: OIDC authorization code + PKCE (confidential client), discovery, JWKS with key-rotation refetch, nonce/issuer/audience/expiry checks, email-domain allow-list, `email_verified`, JIT provisioning, group → role mapping with reconciliation, "SSO required" with anti-lockout and ≤ 3 exempt accounts, IdP-asserted MFA (`amr` or `trustIdpMfa`) | IDN-R08 | done | **R3 — fake IdP only**; R4 needs real Entra ID/Okta/Google test tenants | `test/sso-scim.test.ts` |
| SAML 2.0 | IDN-R08 | LATER, reusing the same group → role model (`identity.group_role_mappings`) | R1 | — |
| SCIM 2.0 Users (create, get, `eq` filters, replace, patch, deactivate/reactivate, delete) and Groups (create, get, list, patch members/rename, delete) driving roles through the same mappings | IDN-R08 | done | R3 (no IdP connector tested) | `test/sso-scim.test.ts`, HTTP test |
| Permission catalog `GET /v1/permissions` (grouped by module, scope kind, ⚑ flags) | IDN-R09 | done | R3 | HTTP test |
| Custom roles from the catalog: create (keys and wildcards validated), clone templates, preview ("N members gain …"), versioned edits (If-Match), archive when unused; system templates immutable | IDN-R10 | done | R3 | `test/roles-lifecycle.test.ts`, HTTP test |
| Grant guardrails: no self-grant, no escalation (grantor must hold every permission of the role across the scope); role and API-client editors cannot add permissions they lack | IDN-R14, IDN-I03 | done | R3 | `test/roles-lifecycle.test.ts`, HTTP test |
| Invitations (token, 7-day expiry, Notifier honouring environment safety), acceptance with first password, rehire | IDN-R06 | done | R3 (delivery R1) | `test/roles-lifecycle.test.ts`, HTTP test |
| Password reset (self-service without account enumeration; admin-sent), single-use 60-minute token, sessions revoked in **every** organization | IDN-R05 | done | R3 | `test/roles-lifecycle.test.ts` |
| Transfer between properties as one previewed, audited operation (immediate or scheduled) | IDN-R07 | done | R3 | `test/roles-lifecycle.test.ts` |
| Time-limited assignments (`startsAt`/`endsAt` enforced per request) | IDN-R11 | done | R3 | `test/roles-lifecycle.test.ts` |
| Session list and revoke (self and admin), revoke others / all | IDN-R05 | done | R3 | `test/roles-lifecycle.test.ts` |
| Suspension (wave 0), reactivation, removal (sessions, roles, invitations, elevations and API keys issued by the person revoked; audit kept) | IDN-R06, IDN-I07 | done | R3 | `test/roles-lifecycle.test.ts`, HTTP test |
| API client administration (issue once, list, revoke; permissions validated) | IDN-R16 | done (rotation with overlap LATER) | R3 | HTTP test |
| Monoclay support access: operator principals separate from tenant users, time-boxed reasoned sessions, customer approval (or policy pre-approval of read-only only), read-only = `*.read`, never ⚑ permissions, per-request access log, impersonation marker on every audit record, customer revoke, exports refused | IDN-R20, IDN-I06 | done | R3 | `test/support-security.test.ts`, HTTP test |
| Break-glass: designated members, ≥ 20-char reason, ≤ 4 h, current session only, admins notified + high-severity alert, auto-expiry, actions tagged, post-incident review by someone else | IDN-R19 | done | R3 | `test/support-security.test.ts` |
| Suspicious activity: credential stuffing by IP, new-country sign-in, mass export → `identity.security.alert`, alert list and acknowledgement | readiness §13 | done (GeoIP placeholder) | R3 (geo source R1) | `test/support-security.test.ts` |
| Organization security policy (MFA window, grace, MFA for all, support approval mode and max duration, break-glass users/role/max) | — | done | R3 | `test/mfa.test.ts`, HTTP test |
| Retention job: pre-auth sign-in attempts purged after 48 h | — | done | R3 | `test/support-security.test.ts` |
| PIN quick-switch on shared terminals | IDN-R04 | not built | R1 | — |
| Generic approval primitive | IDN-R15 | not built (platform has its own activation/configuration approvals) | R1 | — |
| Department scope, field-level restriction | IDN-R11/R13 | not built | R1 | — |

Suspicious-activity rules (`src/domain/security-rules.ts`): R1 ≥ 10 failed sign-ins across ≥ 3 accounts from one IP
within 15 min; R2 sign-in from a country never seen for that member (needs a prior baseline); R3 ≥ 5 exports or
≥ 10 000 records by one actor within 60 min. Alerts are de-duplicated per rule, subject and time bucket.

## Design notes

### MFA step-up, enforced centrally (modules never deal with MFA)
- `buildAuthorizer` wraps the role-based authorizer in `stepUpAuthorizer` (`src/domain/step-up.ts`) when the
  permission catalog is bound. `can()` keeps the kernel contract (pure boolean, never throws) and returns **false**
  for a sensitive permission whose step-up is missing; `propertyScope()` returns `[]`, so lists fail closed.
- The authorizer also exposes `explainDenial(permission, scope)` → `mfa_required | mfa_enrollment_required | null`.
- Kernel `requirePermission` still throws a plain `forbidden`. Identity's HTTP module installs one `onSend` hook in
  the shared `/v1` context that rewrites a `forbidden` problem into `mfa_required` / `mfa_enrollment_required`
  (403, with `verifyPath` / `enrolPath`) **only** when the permission is granted by role and blocked by MFA; a
  permission the person truly lacks stays `forbidden`. Verified on a platform route over HTTP.
- Clean end state: kernel `requirePermission` consults `explainDenial` and throws the richer error itself
  (FOUNDATION_REQUESTS FR-2); the hook is then deleted.
- Enrolment grace: sensitive permissions keep working for `mfaGracePeriodHours` after a membership is activated
  (default 72 h) so onboarding is possible; afterwards they stop until MFA is enrolled. This also keeps all existing
  tests and other modules' API tests (password-only administrators) working.
- A session is verified at TOTP sign-in, enrolment confirmation, `POST /v1/auth/mfa/verify`, or SSO sign-in with
  IdP-asserted MFA. Five wrong step-up codes revoke the session; the failure counter commits before the error.

### Operator authentication (internal console)
Operators are **not tenant users**. Interim: `PORTICO_OPERATORS` (JSON array of `{ id, name, email, tokenSha256 }`);
the server stores only token hashes; tokens look like `pto.<operatorId>.<secret>`. To be replaced by AWS IAM Identity
Center (SSO with MFA) before any live hotel data exists. Routes: `/v1/operator/*` (support sessions, platform alerts;
`/v1/operator/trials` lives in `apps/api/src/provisioning.ts`).

### Actor markers
The kernel `Actor` has no operator kind, so support actions use `{ kind: 'user', userId: <operatorId>,
impersonatedBy: 'monoclay-operator:<id>', sessionId: <supportSessionId>, via: 'support', operatorId,
supportSessionId }`, and break-glass sessions add `{ via: 'elevation', elevationId }`. The extra fields are stored in
every audit row's `actor` JSON (tested). FOUNDATION_REQUESTS FR-1 proposes first-class kernel fields.

## Invariants → tests

| Invariant | Test |
|---|---|
| A TOTP time step is accepted at most once; recovery codes are single-use | `test/mfa.test.ts` "enrols, stores only ciphertext…" |
| TOTP secrets and SSO client secrets never stored in clear text | `test/mfa.test.ts`, `test/sso-scim.test.ts` "keeps the client secret out…" |
| Sensitive permissions are effective only with enrolment (after grace) and recent verification | `test/mfa.test.ts` (step-up), HTTP test |
| IDN-I02: removed/suspended members and disabled users have no effective access; `ends_at` enforced | `test/identity.test.ts`, `test/roles-lifecycle.test.ts` |
| IDN-I03: no self-grant; no escalation through roles, role edits or API clients | `test/roles-lifecycle.test.ts`, HTTP test |
| IDN-I06: no support access outside an approved window; read-only never writes; ⚑ never available | `test/support-security.test.ts`, HTTP test |
| IDN-I07: after removal / password reset no session authenticates (password reset: every organization) | `test/roles-lifecycle.test.ts` |
| IDN-I08: API client permissions ⊆ grants at creation | `test/identity.test.ts` |
| SSO accepts only tokens signed by the issuer's keys, for this client, with this login's nonce, from allowed domains; state is single-use | `test/sso-scim.test.ts` "refuses foreign domains…" |
| Tenant isolation: other organizations cannot see or approve support sessions, roles or members | `test/support-security.test.ts`, HTTP tests |

## Scenarios covered
- S17 (cross-tenant access): forged tokens (wave 0); support sessions and roles invisible to other organizations
  (`apps/api/test/identity-enterprise.test.ts`).
- E04 (revoked permission): removal, password reset, SCIM deactivation and API-client revocation take effect on the
  next request (`test/roles-lifecycle.test.ts`, `test/sso-scim.test.ts`, HTTP test).
- E09 (cross-property): transfers move access atomically (`test/roles-lifecycle.test.ts`).

## Permissions (new)
`identity.security.manage` ⚑ · `identity.securityLog.read` ⚑ · `identity.sso.manage` ⚑ · `identity.scim.provision` ⚑ ·
`identity.supportAccess.read` · `identity.supportAccess.approve` ⚑ · `identity.elevation.review` ⚑ (organization
scope). Break-glass eligibility is a policy list, not a permission (in an emergency the person may lack permissions).

## Events
Emitted: `identity.mfa.enrolled|disabled`, `identity.membership.invited|activated|suspended|removed`,
`identity.roleAssignment.changed`, `identity.member.transferred`, `identity.password.changed`,
`identity.role.created|updated`, `identity.apiClient.created|revoked`,
`identity.supportSession.requested|started|ended`, `identity.elevation.started|ended`, `identity.security.alert`,
`identity.staffMessage.requested` (live staff email; the one-time link is field-encrypted). Consumed: none yet.

## Ports (`src/ports.ts`) and binding status (`apps/api/src/composition.ts`)

| Port | Binding |
|---|---|
| `propertyIdsInScope`, `hasEntitlement`, `organizationName`, `assertPropertyExists` | platform (real) |
| `permissionCatalog` | all manifests (real) |
| `cipher` | kernel `fieldCryptoFromEnv` (local AES-GCM; KMS envelope LATER) |
| `secrets` | `fieldEncryptedSecretStore` (encrypted rows; AWS Secrets Manager LATER) |
| `notifier` | `outboxNotifier`: simulated outside live; live queues `identity.staffMessage.requested` — **no email adapter yet** |
| `oidcHttp` | `fetchOidcHttp` (https only, 10 s timeout) |
| `geo` | `unknownGeo` placeholder (no countries) |
| `operators` | `PORTICO_OPERATORS` configuration |

Configuration: `PORTICO_APP_BASE_URL`, `PORTICO_SSO_REDIRECT_URI`, `PORTICO_OPERATORS`, `PORTICO_FIELD_KEY*`.
Jobs: `IDENTITY_JOBS` (`identity.purgeLoginAttempts`), registered in the composition root.

## Contract changes (all additive)
- `IdentityPorts` gains optional ports (only `propertyIdsInScope` stays required); `identityHttp({ database, ports? })`.
- `buildAuthorizer(tx, userId, ports, opts?)`; `authenticateToken(…, request?)`; `login(database, input, ports?)`;
  `assignRole(tx, input, ports?)` with `startsAt`, `source`, self-grant and escalation checks.
- `LoginResult` / `loginResponse` gain the `mfa_required` variant; `me` gains optional `mfa` and `elevation`.
- `GET /v1/roles` keeps its wave-0 fields and adds role-editor fields. The domain-map provider calls
  `authorize/can/listAccessiblePropertyIds` remain served by the kernel `Authorizer` on `ctx.authz`.
- `general_manager` template: `guests.*` replaced by an explicit list (no identity documents, health data, privacy
  export or erasure by default).

## Adoption modes
Present in every adoption path (connect alongside, replace capabilities, full migration). Trial organizations get
their own memberships — trial access never implies live access. SSO/SCIM are gated by `identity.sso` /
`identity.scim`; MFA is never gated. No data-authority domains.

## Known gaps
- No real email delivery, GeoIP, IdP or KMS; no SAML; no WebAuthn; no PIN quick-switch; no generic approvals.
- Expired MFA challenges, SSO login states and credential tokens are inert but not yet purged (tenant-scoped purge LATER).
- Admin MFA reset is refused for sign-ins shared with another organization (Monoclay support must handle it; no
  operator endpoint for that yet).
- API-client secret rotation with overlap window; the `credentials.production` effect check for API keys is not
  applied (keys only authenticate in their own organization, so trial/sandbox keys cannot reach live data).
- SCIM: no bulk, sort or ETags; `userName` cannot change (the sign-in identity may be shared across organizations).
- `docs/parity/identity.md` missing (outside this module's write scope).

## Open questions for the owner
- Default enrolment grace (72 h) and step-up window (15 min) trade onboarding friction against security; both are
  organization policy.
- Identity provider for the Monoclay operator console (assumed AWS IAM Identity Center).
