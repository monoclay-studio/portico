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

**Steward-review fix round (ADR-0017, global identity and cross-organization safety).** The review proved two
cross-organization account-takeover paths. Both are closed: credentials belong to the person, an organization can
reset them only for people whose every membership is in that organization, existing people join only by accepting an
invitation themselves, credential links never appear in API responses, changing a credential needs the existing
factor, and SSO is bound to `(issuer, sub)` with DNS-verified domains. Every proof-of-concept from the review is now
a regression test that asserts the attack is refused: `test/review-regressions.test.ts`,
`test/review-sso-regressions.test.ts`, `test/isolation.test.ts`, `apps/api/test/review-regressions.test.ts`.

## Capabilities

| Capability | Spec | Status | Readiness | Evidence |
|---|---|---|---|---|
| Sign-in, sessions bound to one organization, lockout (wave 0) | IDN-R01/R02 | kept, extended | R3 | `test/identity.test.ts` |
| TOTP MFA: enrolment with `otpauth://` URI, field-encrypted secret, ±1 step drift, replay protection (a time step is accepted at most once, enforced by a guarded UPDATE), 10 hashed single-use recovery codes | IDN-R03 | done | R3 | `src/domain/totp.test.ts` (RFC 4226/6238 vectors), `test/mfa.test.ts` |
| Second factor at sign-in for enrolled members (`mfa_required` challenge, 5 minutes, 5 attempts per challenge) plus a **per-person** failure counter across challenges and step-ups: 5 → 1-minute delay, 10 → 15 minutes and a high `mfa_bruteforce_suspected` alert (person and admins told), 20 → 24-hour lock; reset only by a successful second factor | IDN-R02/R03, ADR-0017 §8 | done | R3 | `test/mfa.test.ts`, `test/review-regressions.test.ts` "P1-7", HTTP test |
| Central step-up: sensitive (⚑) permissions need MFA **enrolled** and a recent verification (`mfaStepUpWindowMinutes`, default 15). The enrolment grace (policy, ≤ 72 h, anchored to the person's first activation anywhere) only defers "MFA for everyone"; ⚑ permissions never take effect during it | IDN-R03, IDN-I04, ADR-0017 §8 | done (see design) | R3 | `src/domain/permissions.test.ts`, `test/mfa.test.ts`, `test/review-regressions.test.ts` "P1-2", HTTP test |
| Changing a global credential needs proof of the existing one: enrolling/replacing/disabling TOTP and regenerating recovery codes need the current code or a recovery code (or the current password before any factor exists); an SSO session never counts | ADR-0017 §4 | done | R3 | `test/mfa.test.ts`, `test/review-regressions.test.ts` "P0-2", `test/review-sso-regressions.test.ts` |
| WebAuthn / passkeys | IDN-R02 | LATER (same factor table, `kind = 'webauthn'`) | R1 | — |
| Enterprise SSO: OIDC authorization code + PKCE (confidential client), discovery, JWKS with key-rotation refetch, nonce/issuer/audience/expiry checks (`requiredClaims` exp, iat, sub, nonce), login bound to the starting browser (`browserBinding`), email-domain allow-list, `email_verified === true` required, identity bound to `(issuer, sub)` after the first link, linking a person who also works elsewhere only for a **DNS-TXT-verified domain** (`/v1/sso/domains`), JIT provisioning, group → role mapping with reconciliation, "SSO required" with anti-lockout and 1–3 exempt accounts, IdP-asserted MFA (`amr` or `trustIdpMfa`); IdP calls SSRF-safe (public https only, pinned DNS, no redirects, 1 MB) and outside database transactions | IDN-R08, ADR-0017 §5 | done | **R3 — fake IdP only**; R4 needs real Entra ID/Okta/Google test tenants | `test/sso-scim.test.ts`, `test/review-sso-regressions.test.ts`, `src/net/address-policy.test.ts` |
| SAML 2.0 | IDN-R08 | LATER, reusing the same group → role model (`identity.group_role_mappings`) | R1 | — |
| SCIM 2.0 Users (create, get, `eq` filters, replace, patch, deactivate/reactivate, delete) and Groups (create, get, list, patch members/rename, delete) driving roles through the same mappings; a person who works elsewhere is provisioned `invited` (never activated by SCIM); the last administrator cannot be deprovisioned; deactivation revokes the person's API keys | IDN-R08, ADR-0017 §2/§6 | done | R3 (no IdP connector tested) | `test/sso-scim.test.ts`, HTTP test |
| Permission catalog `GET /v1/permissions` (grouped by module, scope kind, ⚑ flags) | IDN-R09 | done | R3 | HTTP test |
| Custom roles from the catalog: create (keys and wildcards validated), clone templates, preview ("N members gain …"), versioned edits (If-Match), archive when unused; system templates immutable | IDN-R10 | done | R3 | `test/roles-lifecycle.test.ts`, HTTP test |
| Grant guardrails: no self-grant, no escalation (grantor must hold every permission of the role across the scope); role and API-client editors cannot add permissions they lack; **power ordering** — revoke, suspend, remove, password reset and MFA reset only for members whose permissions the actor also holds; no change may remove the last active organization-wide administrator; reserved role keys (templates, `portico_*`) | IDN-R14, IDN-I03, ADR-0017 §6 | done | R3 | `test/roles-lifecycle.test.ts`, `test/review-regressions.test.ts` "P1-6", "P2-15" |
| Invitations (token, 7-day expiry, Notifier honouring environment safety), acceptance with first password, rehire. Adding an **existing** person (create, invite, SCIM, JIT without a verified domain) makes an `invited` membership the person accepts while signed in (`GET /v1/me/invitations`, `POST /v1/me/invitations/:id/accept`) or with their own credentials on the link; their password is never set. Links go only to the person: responses carry `delivery.mode` (`queued` / `simulated` / `sandbox`) and never the link; simulated messages land in the operator mailbox (`GET /v1/operator/mailbox`, link field-encrypted) | IDN-R06, ADR-0017 §2/§3 | done | R3 (delivery R1) | `test/roles-lifecycle.test.ts`, `test/review-regressions.test.ts` "P0-1", `apps/api/test/review-regressions.test.ts` |
| Password reset (self-service without account enumeration; admin-sent **only for sole-organization members**), single-use 60-minute token, sessions and the person's API keys revoked in **every** organization | IDN-R05, ADR-0017 §1 | done | R3 | `test/roles-lifecycle.test.ts`, `test/review-regressions.test.ts` |
| Admin MFA reset (lost device) only for sole-organization members and only with power over them; sessions and API keys revoked | ADR-0017 §1/§9 | done | R3 | `test/mfa.test.ts`, `test/review-regressions.test.ts` "P0-2" |
| Transfer between properties as one previewed, audited operation (immediate or scheduled) | IDN-R07 | done | R3 | `test/roles-lifecycle.test.ts` |
| Time-limited assignments (`startsAt`/`endsAt` enforced per request) | IDN-R11 | done | R3 | `test/roles-lifecycle.test.ts` |
| Session list and revoke (self and admin), revoke others / all | IDN-R05 | done | R3 | `test/roles-lifecycle.test.ts` |
| Suspension (wave 0), reactivation, removal (sessions, roles, invitations, elevations and API keys issued by the person revoked; audit kept) | IDN-R06, IDN-I07 | done | R3 | `test/roles-lifecycle.test.ts`, HTTP test |
| API client administration (issue once, list, revoke; permissions validated). Bounded keys: no `*` and no `identity.*` except `identity.scim.provision`; a key with ⚑ permissions must expire within 90 days and needs a fresh step-up; issuance calls `assertExternalEffectAllowed('credentials.production')`; keys are revoked when their creator is suspended, resets a password or has MFA reset; the token is never stored with the idempotency record (a replay answers `already_issued`) | IDN-R16, ADR-0017 §9 | done (rotation with overlap LATER) | R3 | `test/review-regressions.test.ts` "P1-3", HTTP test |
| Monoclay support access: operator principals separate from tenant users, time-boxed reasoned sessions, customer approval (or policy pre-approval of read-only only), read-only = `*.read`, never ⚑ permissions, per-request access log, impersonation marker on every audit record, customer revoke, exports refused | IDN-R20, IDN-I06 | done | R3 | `test/support-security.test.ts`, HTTP test |
| Break-glass: designated members, ≥ 20-char reason, ≤ 4 h, current session only, everyone holding organization-wide `identity.user.manage` notified + high-severity alert, auto-expiry, actions tagged, post-incident review by another person signed in as themselves. Nobody designates themselves; the designator must hold every permission of the break-glass role; designation changes raise a high alert; during an elevation no durable privilege can be created (roles, role edits, API keys, SSO, SCIM, policy) | IDN-R19, ADR-0017 §10 | done | R3 | `test/support-security.test.ts`, `test/review-regressions.test.ts` "P1-5" |
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
- Enrolment grace (ADR-0017 §8): a sensitive permission never takes effect without MFA enrolled. The grace
  (`mfaGracePeriodHours`, ≤ 72 h) only lets a new member keep working on non-sensitive permissions while
  `requireMfaForAll` is on; it is anchored to `users.first_activated_at` (first activation anywhere), so rehiring,
  re-inviting or SCIM cycling cannot restart it. Test administrators enrol MFA (`signInWithMfa`,
  `apps/api/test/helpers.ts`).
- A session is verified at TOTP sign-in, enrolment confirmation, `POST /v1/auth/mfa/verify`, or SSO sign-in with
  IdP-asserted MFA. Five wrong step-up codes revoke the session; the failure counter commits before the error.

### Global identity and cross-organization safety (ADR-0017)
- One person = one global `identity.users` row (password, factors, recovery codes). `identity.memberships_elsewhere`
  (SECURITY DEFINER) counts the person's memberships in other organizations in **any** status and never says which.
- Guards live in `src/services/guard.ts`: `assertSoleOrganizationMember`, `assertPowerOver`,
  `assertAdministratorRemains`, `assertNotElevated`, `assertHumanApprover`, `revokeApiKeysIssuedBy`.
- Credential-changing services return an `Outcome` so failure counters commit; routes throw after the transaction.
- Admin screens explain refusals without naming the other organization ("This person also works for another
  organization, so only they can reset their password…" — the wording ADR-0017 prescribes).
- SSO completes in three phases (consume state → IdP calls without a transaction → bind and open a session). Links
  live in `identity.sso_identities (tenant, issuer, subject)`; domains in `identity.sso_domains`, verified with a TXT
  record `_portico-verification.<domain>` = `portico-verify=<token>`. A person who works elsewhere is linked only
  through a verified domain; their sign-in through that IdP is their acceptance of the membership.
- Simulated (non-live) staff messages go to `identity.dev_mailbox` through SECURITY DEFINER functions; the
  application role cannot read the table; the link is field-encrypted; only operators read it (not in production).

### Operator authentication (internal console)
Operators are **not tenant users**. Interim: `PORTICO_OPERATORS` (JSON array of `{ id, name, email, tokenSha256 }`);
the server stores only token hashes; tokens look like `pto.<operatorId>.<secret>`. To be replaced by AWS IAM Identity
Center (SSO with MFA) before any live hotel data exists. Routes: `/v1/operator/*` (support sessions, platform alerts,
simulated-message mailbox; `/v1/operator/trials` lives in `apps/api/src/provisioning.ts`). **Disabled when
`NODE_ENV=production`** (`config.operatorConsoleEnabled`, review P2-17) — a launch-gate item until IAM Identity Center
is wired.

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
| Tenant isolation: another organization cannot read or change members, roles, API clients, elevations, alerts, SSO connections, SCIM groups, MFA factors, activation requests or authority transitions by id | `test/isolation.test.ts`, `test/support-security.test.ts`, HTTP tests |
| ADR-0017 §1: no organization resets the password or MFA of a person who also belongs elsewhere (invitations count) | `test/review-regressions.test.ts` "P0-1", "P0-2" |
| ADR-0017 §2: an existing person is never activated or given a password by another organization | `test/review-regressions.test.ts`, `test/identity.test.ts` "scenario 17", HTTP test |
| ADR-0017 §3: no response or stored idempotent response contains an `inv.`/`prt.` link or an API token | `test/review-regressions.test.ts`, `apps/api/test/review-regressions.test.ts`, `apps/api/test/identity-enterprise.test.ts` |
| ADR-0017 §5: an IdP cannot assert a person of an unverified domain who works elsewhere; `(issuer, sub)` wins over the email claim | `test/review-sso-regressions.test.ts` |
| A TOTP code or recovery code is accepted once even under concurrent challenges | `test/review-regressions.test.ts` "P2-13" |

## Scenarios covered
- S17 (cross-tenant access): forged tokens (wave 0); per-table isolation (`test/isolation.test.ts`); support
  sessions invisible to other organizations (`apps/api/test/identity-enterprise.test.ts`); no cross-organization
  credential takeover (`test/review-regressions.test.ts`, `test/review-sso-regressions.test.ts`).
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
| `notifier` | `outboxNotifier`: outside live → operator mailbox (`simulated`/`sandbox`); live queues `identity.staffMessage.requested` and reports `queued` — **no email adapter yet** |
| `oidcHttp` | `fetchOidcHttp` (SSRF-safe `safeJsonRequest`; `http://localhost` only when `NODE_ENV !== 'production'`) |
| `dnsTxt` | `systemTxtResolver` (SSO domain verification) |
| `geo` | `unknownGeo` placeholder (no countries) |
| `operators` | `PORTICO_OPERATORS` configuration |

Configuration: `PORTICO_APP_BASE_URL`, `PORTICO_SSO_REDIRECT_URI`, `PORTICO_OPERATORS`, `PORTICO_FIELD_KEY*`.
Jobs: `IDENTITY_JOBS` (`identity.purgeLoginAttempts`), registered in the composition root.

## Contract changes in the fix round (breaking, for ADR-0017)
- `createUser` returns `{ userId, status: 'active' | 'invited' }`; `initialPassword` for an existing person →
  `person_already_has_sign_in`. `POST /v1/users` answers `createUserResponse` (with `delivery` when invited).
- `enrolTotp(tx, ports, proof)`, `regenerateRecoveryCodes(tx, ports, proof)`, `disableOwnMfa(tx, ports, proof)` return
  `Outcome`; the HTTP bodies take `credentialProof` (`currentPassword` | `code` | `recoveryCode`).
  `POST /v1/me/mfa/disable` mirrors `DELETE /v1/me/mfa` for clients that cannot send a body with DELETE.
- `acceptInvitation(database, ports, { token, password?, code?, recoveryCode? })`.
- `delivery` is `{ mode: 'queued' | 'simulated' | 'sandbox' }` — never a message or link.
- `/auth/sso/start` returns `browserBinding`; `/auth/sso/callback` requires it.
- `mfaGracePeriodHours` ≤ 72.
- `revokeAssignment`, `suspendMember`, `removeMember`, `resetMemberMfa` take optional `ports` (power over brand/region
  scopes).
- New: `GET /v1/me/invitations`, `POST /v1/me/invitations/:organizationId/accept`, `GET|POST /v1/sso/domains`,
  `POST /v1/sso/domains/:domain/verify`, `GET /v1/operator/mailbox`; `addSelfToOrganization`, `sendInvitation`,
  `readDevMailbox`, `systemTxtResolver`.

## Contract changes (wave 1, additive)
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
- Expired MFA challenges, SSO login states, credential tokens and dev-mailbox rows are inert but not yet purged
  (tenant-scoped purge LATER, FR-4).
- Monoclay support-led credential recovery for a person who lost every factor (ADR-0017 §1b: identity verification,
  dual control) has no operator endpoint or runbook yet; nor has recovery of an organization that lost every
  administrator. Both are launch-gate items.
- A trial created by the operator console for a prospect lives in a non-live environment, so its staff messages are
  simulated (operator mailbox). The first real delivery path for prospects needs a decision (Q148).
- API-client secret rotation with overlap window.
- SCIM: no bulk, sort or ETags; `userName` cannot change (the sign-in identity may be shared across organizations);
  SCIM deprovisioning is not power-ordered (an IdP acts for the organization; `identity.scim.provision` is documented
  as equivalent to every mapped role — review P2-16) but cannot remove the last administrator.
- Review P2-1: the `onSend` step-up translator remains until kernel FR-2; it now ignores identity's own escalation
  refusals and passes only a property scope, so a grantor is never told to step up when that would not help.
- Review P2-4 (partly): SSO-required now needs ≥ 1 active exempt account; a changed connection is not yet
  test-signed-in before saving while SSO is required.
- Review P2-12: identity declares no `recordTypes`/`SearchProvider` for staff members yet.
- `docs/parity/identity.md` missing (outside this module's write scope).

## Open questions for the owner
Recorded in `docs/OPEN_QUESTIONS.md` (Q146–Q149): enrolment grace and step-up window defaults, the operator-console
identity provider, MFA in demo and training organizations, and trial limits / prospect onboarding delivery.
