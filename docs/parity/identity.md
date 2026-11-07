# Parity matrix and edge cases: identity

Module: `identity` (staff users and memberships, credentials and MFA, sessions, roles and scoped assignments,
enterprise SSO/SCIM, API clients, delegated AI identity, break-glass, Monoclay support access, security signals,
administration). Spec: `docs/specs/identity.md` (Draft v2, prefix IDN); ADR-0012, ADR-0017 (+ amendment 1).
Property-level structure, audit storage and environments are in `platform.md` (PAR-PLT-020, PAR-PLT-061). Researched
and statused 2026-11-07 by the parity-ops researcher.

**Two code bases, one rule.** `main` holds identity wave 0 (`modules/identity`: sign-in, organization selection,
lockout, scoped role assignments, suspension, API clients). Wave 1 enterprise identity (MFA, step-up, invitations,
custom roles, guardrails, SSO/SCIM, break-glass, support access, security alerts) is on branch
`feat/identity-platform-enterprise` (worktree `identity-plus`, mid-fix after the second steward review), read-only
here. A row is `tested` only with a named test **on `main`**; a row proven only by branch tests is `building` and its
Test cell starts with `branch:` — those rows become `tested` when the branch merges with the same tests green.
Test paths are relative to `modules/identity/` unless they start with `apps/` or `modules/`. Readiness is at most R3:
SSO has only been exercised against an in-process fake OpenID provider, staff email is never delivered, GeoIP is a
placeholder.

**Baseline:** OPERA Cloud 26.3 *Role Manager* (chain, template and property roles; tasks to roles; charge codes per
role; users; job titles; roles report; changes log; interface users) and Oracle Hospitality identity federation
(SAML 2.0 through OCI IAM). **Modern additions:** Mews single sign-on (OpenID via Auth0; Okta, Entra ID, Google;
free for all customers since 2025), Apaleo user management (invite by email, predefined roles only, property-scoped
roles, OAuth scopes and consent), Cloudbeds roles (custom privileges, organization users, card-viewing password).
Our research: R04 D4 (RFP identity requirements: SAML/OIDC SSO with Entra ID and Okta, SCIM, role-based access across
group/brand/property/department, MFA enforcement, full audit logs) and decision 10 (security roadmap); R02 §8 item 15
(agent-safe permissions); R05 digest §2 identity row (OHIP module scopes and Sensitive Data Access; human principal
behind every agent action). No competitor documentation found for break-glass, support-access approval or
cross-organization takeover protection — those rows are `assumption`.
**Evidence:** a source marked "search-located" under *Sources* was found by web search but its host blocks direct
fetches here — facts resting only on it are unverified. Priorities: P0 compete/pilot, P1 full-service/group
expectation, P2 differentiator or rare.

## Capabilities

### 1. People, credentials and sessions

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-IDN-001 | One global person with memberships in several organizations; sign-in asks which organization; every session, permission check and audit record belongs to one organization | OPERA [managing users][op-users] · Cloudbeds [organization user permissions][cb-orgperm] · verified 2026-11-07 (Cloudbeds search-located, unverified) | P0 | tested | identity.md IDN-R01 | test/identity.test.ts "asks which organization when a person belongs to several, and never mixes them (scenario 17)" |
| PAR-IDN-002 | Password sign-in with one error for unknown email and wrong password, rate limit and lockout | assumption (R04 D4) | P0 | tested | identity.md IDN-R02 | test/identity.test.ts "gives the same error for unknown email and wrong password, and locks after repeated failures" |
| PAR-IDN-003 | Password policy: Argon2id, minimum 12 characters, no composition rules, breached-password check | assumption (NIST SP 800-63B practice) | P1 | building | identity.md IDN-R02 | — Argon2id and min length 12 in `src/service.ts`, `src/contracts.ts` — partial: no breach-list check; no test |
| PAR-IDN-004 | TOTP MFA with recovery codes, replay protection and proof of the existing factor to change it | R04 D4 (MFA enforcement in RFPs) | P0 | building | identity.md IDN-R03 | branch: test/mfa.test.ts; src/domain/totp.test.ts (RFC vectors); test/review-regressions.test.ts "P2-13" |
| PAR-IDN-005 | MFA mandatory for sensitive permissions and administrators; sensitive actions need a recent step-up | R05 digest §2 (OHIP Sensitive Data Access) · Cloudbeds [card-viewing password][cb-cardpw] · search-located 2026-11-07, unverified | P0 | building | identity.md IDN-R03, IDN-I04 | branch: test/mfa.test.ts "central step-up enforcement"; src/domain/permissions.test.ts |
| PAR-IDN-006 | Passkeys (WebAuthn) | assumption | P2 | specified | identity.md IDN-R02 [SHOULD] | — (branch: LATER) |
| PAR-IDN-007 | Invitation by email with expiry; the person sets their first password from the link (email verified); no organization ever sets a password | Apaleo [inviting users][apaleo-users] · search-located 2026-11-07, unverified | P0 | building | identity.md IDN-R06; ADR-0017 rules 12–14 | branch: test/roles-lifecycle.test.ts "invites (simulated outside live), accepts with a password"; test/review2-regressions.test.ts "R2-P0-1" |
| PAR-IDN-008 | Self-service password reset without account enumeration; single-use token; sessions revoked in every organization | assumption | P0 | building | identity.md IDN-R05 | branch: test/roles-lifecycle.test.ts "password reset: no enumeration, single-use token, sessions revoked in every organization" |
| PAR-IDN-009 | Administrator resets a member's MFA after a lost device (only with power over them, only for single-organization members) | assumption | P1 | building | identity.md IDN-R03; ADR-0017 §1 | branch: test/mfa.test.ts "administrator MFA reset (lost device)" |
| PAR-IDN-010 | Session list and remote sign-out for self and administrators | assumption | P1 | building | identity.md IDN-R05 | branch: test/roles-lifecycle.test.ts "lists and revokes sessions (self and admin)" |
| PAR-IDN-011 | Idle timeout and absolute lifetime by policy (desk 30 min with PIN re-unlock, mobile 12 h, admin 15 min) | assumption | P1 | specified | identity.md IDN-R05 | — |
| PAR-IDN-012 | Quick switch on shared desk terminals: device session plus personal PIN so every action is attributed; full sign-in for money above threshold, user admin and exports | assumption (desk practice; OPERA has no documented equivalent found) | P1 | specified | identity.md IDN-R04 | — (branch: not built) |

### 2. Membership lifecycle

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-IDN-013 | Suspension revokes the member's sessions immediately (offboarding) | Apaleo [deactivate users][apaleo-roles] · search-located 2026-11-07, unverified | P0 | tested | identity.md IDN-R06, IDN-I02 | test/identity.test.ts "suspending a member revokes sessions immediately (offboarding)" |
| PAR-IDN-014 | Removal revokes sessions, role assignments, invitations, elevations and API keys issued by the person; audit attribution kept | assumption | P0 | building | identity.md IDN-R06, IDN-I07 | branch: test/roles-lifecycle.test.ts "removal revokes sessions, roles and the API keys the person issued; audit is kept" |
| PAR-IDN-015 | Rehire creates a new membership for the same person; history of the old one kept | assumption | P2 | building | identity.md §4 membership status | branch: README "rehire" — no dedicated test named |
| PAR-IDN-016 | Transfer between properties as one previewed, audited operation (immediate or scheduled) | assumption | P1 | building | identity.md IDN-R07 | branch: test/roles-lifecycle.test.ts "transfers between properties in one audited operation, now or scheduled"; test/review2-regressions.test.ts "R2-P2-2" |
| PAR-IDN-017 | Time-limited role assignments (seasonal staff, cover for leave) | assumption | P1 | building | identity.md IDN-R11 | branch: test/roles-lifecycle.test.ts "enforces time-limited assignments (ends_at)" |
| PAR-IDN-018 | Job titles recorded separately from roles | OPERA [job titles][op-jobtitles] · verified 2026-11-07 | P2 | built | identity.md IDN-R01 (membership job title) | — column exists on main; no test |

### 3. Roles, permissions and scope

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-IDN-019 | Permissions registered by modules with scope kind and sensitivity; an unregistered key cannot be checked | OPERA [assigning tasks to a role][op-roletasks] · verified 2026-11-07 | P0 | tested | identity.md IDN-R09 | apps/api/test/permission-catalog.test.ts "has no checked-but-unregistered permission keys in any composed module" |
| PAR-IDN-020 | Permission catalogue readable by administrators, grouped by module with sensitive flags | OPERA [configured roles and tasks report][op-rolereport] · verified 2026-11-07 | P1 | building | identity.md IDN-R09 | branch: src/domain/permissions.test.ts "groups the catalog by module"; HTTP test |
| PAR-IDN-021 | Read-only role templates per persona that organizations clone and edit | OPERA [template and property roles][op-proproles] · Apaleo [predefined roles only][apaleo-roles] · verified 2026-11-07 (Apaleo search-located, unverified) | P0 | building | identity.md IDN-R10 | branch: test/roles-lifecycle.test.ts "system templates are immutable but clonable" (main ships templates only) |
| PAR-IDN-022 | Custom roles built from the catalogue with a preview of who gains what; versioned edits | Cloudbeds [add, edit or delete roles][cb-roles] · OPERA [property roles][op-proproles] · verified 2026-11-07 (Cloudbeds search-located, unverified) | P1 | building | identity.md IDN-R10 | branch: test/roles-lifecycle.test.ts "validates keys and wildcards", "edits are versioned, previewed and guarded" |
| PAR-IDN-023 | Role assignment scoped to organization, brand, region or property | OPERA [chain roles][op-chainroles] · Apaleo [property-scoped roles][apaleo-users] · verified 2026-11-07 (Apaleo search-located, unverified) | P0 | tested | identity.md IDN-R11 | test/identity.test.ts "signs in, authenticates the token with scoped permissions"; apps/api/test/api.test.ts |
| PAR-IDN-024 | Department-scoped assignments (housekeeping supervisor sees housekeeping only) | R04 D4 (department-level access in RFPs) | P1 | specified | identity.md IDN-R11 | — (branch: not built) |
| PAR-IDN-025 | Deny-by-default authorization on every endpoint with property scope | OPERA [about roles][op-roles] · verified 2026-11-07 | P0 | tested | identity.md IDN-R12 | apps/api/test/api.test.ts "rejects unauthenticated requests"; per-module isolation tests (e.g. modules/operations/test/isolation-permissions.test.ts) |
| PAR-IDN-026 | Field-level restriction of sensitive fields (identity documents, card metadata, private alerts) with an audited read per view | Cloudbeds [card-viewing password][cb-cardpw] · search-located 2026-11-07, unverified | P0 | building | identity.md IDN-R13 | modules/guests/test/documents.test.ts (audited document reveal) — partial: implemented per module; no identity-level mechanism |
| PAR-IDN-027 | Grant guardrails: no self-grant, no escalation beyond the grantor's own permissions, power ordering, last administrator always kept | assumption | P0 | building | identity.md IDN-R14, IDN-I03 | branch: test/roles-lifecycle.test.ts "prevents self-grants and privilege escalation"; test/review-regressions.test.ts "P1-6" |
| PAR-IDN-028 | Segregation of duties for money (creator cannot approve their own write-off or refund above threshold) with an alternative-approver hint | assumption (R04 B7) | P0 | building | identity.md IDN-R14 | branch: test/review-regressions.test.ts "P1-4: separation of duties compares people" — partial: activation approvals only; finance thresholds not built |
| PAR-IDN-029 | Generic approval primitive (request → approve/decline, approver permission in scope, expiry, consumed once) | assumption | P1 | specified | identity.md IDN-R15, IDN-I05 | — (branch: not built; platform has its own approvals) |
| PAR-IDN-030 | Report and export of who can do what (roles, permissions, members) | OPERA [roles and tasks report][op-rolereport] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-IDN-031 | Charge codes a role may post restricted per role | OPERA [charge codes to property roles][op-rolecodes] · verified 2026-11-07 | P2 | missing | — (finance posting permissions are per module, not per charge code) | — |

### 4. Enterprise SSO and provisioning

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-IDN-032 | Single sign-on with OpenID Connect (Entra ID, Okta, Google), just-in-time provisioning and group → role mapping | Mews [SSO setup][mews-sso] · R04 D4 · verified 2026-11-07 | P1 | building | identity.md IDN-R08 | branch: test/sso-scim.test.ts "JIT-provisions with mapped roles, then reconciles roles"; fake IdP only (R4 needs real test tenants) |
| PAR-IDN-033 | SAML 2.0 single sign-on | Oracle [identity federation (SAML)][op-fed] · R04 D4 · verified 2026-11-07 | P1 | specified | identity.md IDN-R08 | — (branch: LATER) |
| PAR-IDN-034 | "SSO required" with 1–3 exempt emergency accounts and anti-lockout | assumption | P1 | building | identity.md IDN-R08 | branch: test/sso-scim.test.ts "SSO required: enabling needs an SSO session" |
| PAR-IDN-035 | Email-domain verification (DNS TXT) before an identity provider may assert people who also work elsewhere; identity bound to issuer + subject | assumption | P0 | building | identity.md IDN-R08; ADR-0017 §5 | branch: test/review-sso-regressions.test.ts; test/review2-regressions.test.ts "R2-P1-3" |
| PAR-IDN-036 | SCIM 2.0 user and group provisioning; deprovisioning revokes access and API keys | R04 D4 (SCIM in RFPs) | P1 | building | identity.md IDN-R08 ([LATER] in spec) | branch: test/sso-scim.test.ts "creates, finds, deactivates, reactivates and deletes users", "group membership drives roles" |
| PAR-IDN-037 | MFA asserted by the identity provider counts as step-up | Mews [SSO][mews-sso] · verified 2026-11-07 | P2 | building | identity.md IDN-R03 | branch: test/sso-scim.test.ts "identity-provider MFA (amr) counts as step-up" |
| PAR-IDN-038 | SSO and MFA included in every edition, no surcharge | Mews [SSO free for all customers (press)][mews-ssofree] · search-located 2026-11-07, unverified | P2 | missing | — (MFA never gated, IDN-R03; SSO/SCIM gated by `identity.sso`/`identity.scim` entitlements — commercial) | — |

### 5. Machine and delegated identities

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-IDN-039 | API clients with scopes = permission keys and a property filter; secret shown once | Apaleo [API scopes][apaleo-scopes] · Mews [Connector API authentication][mews-auth] · OPERA [interface users][op-ifcusers] · verified 2026-11-07 | P0 | tested | identity.md IDN-R16, IDN-I08 | test/identity.test.ts "API clients are limited to their permissions and properties" |
| PAR-IDN-040 | Bounded keys: no administration scopes, sensitive keys expire within 90 days and need a step-up to issue; revoked when the issuer is suspended or resets credentials | assumption | P1 | building | identity.md IDN-R16 | branch: test/review-regressions.test.ts "P1-3: API keys are bounded" |
| PAR-IDN-041 | Key rotation with overlap window and last-used tracking | Apaleo [OAuth consent][apaleo-consent] · verified 2026-11-07 | P1 | specified | identity.md IDN-R16 | — (branch: rotation LATER) |
| PAR-IDN-042 | Third-party app authorization with a consent screen listing permissions and properties | Apaleo [consent screen][apaleo-consent] · R05 digest #4 (OPERA chain-admin approval per connection) · verified 2026-11-07 | P1 | specified | identity.md IDN-R17; integration.md INT-R27 | — |
| PAR-IDN-043 | AI assistant acts as the user (intersection of permissions), actor recorded `via: ai`, consequential actions only as confirmed proposals | Apaleo [AI integrations (OAuth)][apaleo-ai] · R05 digest §2 · verified 2026-11-07 | P1 | specified | identity.md IDN-R18; ai.md AI-R01, AI-R04 | — |

### 6. Emergency and support access

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-IDN-044 | Break-glass: designated members elevate for ≤ 4 h with reason; administrators alerted; actions tagged; auto-expiry; review by another person | assumption | P1 | building | identity.md IDN-R19 | branch: test/support-security.test.ts "break-glass emergency access"; test/review-regressions.test.ts "P1-5" |
| PAR-IDN-045 | Vendor support access: no standing access; time-boxed, reasoned, customer-approved, read-only by default, every request logged and visible to the customer, revocable | assumption (R04 C4 enterprise security reviews) | P0 | building | identity.md IDN-R20, IDN-I06 | branch: test/support-security.test.ts "Monoclay support access (time-boxed, reasoned, customer-visible)" |
| PAR-IDN-046 | Recovery for a person who lost every factor and for an organization that lost every administrator (identity verification, dual control) | assumption | P1 | specified | ADR-0017 §1b | — (branch: launch-gate item, not built) |

### 7. Security monitoring and audit

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-IDN-047 | Append-only security log (sign-ins, MFA changes, role grants, break-glass, support sessions, API keys) exportable by administrators | OPERA [changes log][op-changeslog] · R04 D4 (full audit logs) · verified 2026-11-07 | P0 | building | identity.md IDN-R21 | branch: security events and `identity.securityLog.read` — partial: no export test |
| PAR-IDN-048 | Suspicious-activity alerts: credential stuffing by IP, new-country sign-in, mass export | assumption | P1 | building | identity.md IDN-R21; readiness brief §13 | branch: test/support-security.test.ts "suspicious activity signals" — partial: GeoIP placeholder |
| PAR-IDN-049 | Per-person second-factor failure counter with delays, lock and alerts to the person and administrators | assumption | P1 | building | ADR-0017 §8 | branch: test/review-regressions.test.ts "P1-7"; test/review2-regressions.test.ts "R2-P2-1" |
| PAR-IDN-050 | Record history shows the actor of every consequential change, including `via: ai`, support and break-glass markers | OPERA [changes log][op-changeslog] · verified 2026-11-07 | P0 | building | identity.md IDN-R18–R21; platform.md PAR-PLT-061 | apps/api/test/records.test.ts "returns one history timeline for a record" — partial: support/elevation markers only on the branch |
| PAR-IDN-051 | Activity search per user and date range ("what did this person change last night") | OPERA [changes log][op-changeslog] · verified 2026-11-07 | P1 | missing | — (history is per record) | — |
| PAR-IDN-052 | Pre-authentication signals kept only briefly (sign-in attempts purged after 48 h) | assumption (GDPR minimization) | P2 | building | readiness brief §12 | branch: test/support-security.test.ts "purges sign-in attempts older than 48 hours" |

### 8. Administration and cross-organization safety

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-IDN-053 | Organization security policy: MFA for everyone, step-up window, enrolment grace (≤ 72 h), support approval mode, break-glass settings | assumption | P1 | building | identity.md IDN-R03, IDN-R19, IDN-R20 | branch: test/mfa.test.ts (grace capped at 72 h) |
| PAR-IDN-054 | No organization can reset the password or MFA of a person who also works elsewhere, pre-register their credentials, or block their onboarding | Cloudbeds [organization owner modifiable only by support][cb-orgperm] · search-located 2026-11-07, unverified | P0 | building | ADR-0017 rules 1–15 | branch: test/review-regressions.test.ts "P0-1", "P0-2"; test/review2-regressions.test.ts; test/review2-original-attacks.test.ts |
| PAR-IDN-055 | Staff messages (invitations, resets) simulated outside live environments; links never in API responses | assumption (environment safety) | P0 | building | identity.md IDN-R06; ADR-0017 §3 | branch: test/review-regressions.test.ts "P2-14 / ADR-0017 §3: staff messages" |
| PAR-IDN-056 | Staff members discoverable in global search with the universal record contract | assumption | P2 | specified | domain-map § Universal record contract | — (branch review P2-12: not built) |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-IDN-001 | A token's organization id is swapped for another organization's | Rejected; nothing of either organization disclosed | P0 | tested | apps/api/test/api.test.ts "a token with a swapped organization id is rejected" |
| EC-IDN-002 | A consultant works for two hotel groups and signs in | Asked which organization; the session sees only that organization; data never mixed (S17) | P0 | tested | test/identity.test.ts "asks which organization … (scenario 17)" |
| EC-IDN-003 | Someone probes emails at the sign-in screen | Unknown email and wrong password give the same message; repeated failures lock the account | P0 | tested | test/identity.test.ts "gives the same error … and locks after repeated failures" |
| EC-IDN-004 | An attacker deliberately locks a desk agent out during check-in rush | Escalating delay rather than a long hard lock; per-IP limits; the agent can recover by reset or an administrator | P1 | building | test/identity.test.ts (lock with auto-unlock time) — partial: per-IP limiting and escalation schedule not tested |
| EC-IDN-005 | A member is suspended mid-shift | All sessions revoked immediately; the next request fails | P0 | tested | test/identity.test.ts "suspending a member revokes sessions immediately" |
| EC-IDN-006 | A removed member had issued an API key used by a partner | Key revoked with the removal; partner calls fail with a clear reason; audit attribution kept | P0 | building | branch: test/roles-lifecycle.test.ts "removal revokes sessions, roles and the API keys the person issued" |
| EC-IDN-007 | A person resets their password | Sessions and the person's API keys revoked in every organization they belong to | P0 | building | branch: test/roles-lifecycle.test.ts; test/review-regressions.test.ts "keys stop working when their creator … resets their password" |
| EC-IDN-008 | A trial-organization administrator tries to reset the password of a live-organization general manager | Refused; no link reaches the attacker; wording does not name the other organization | P0 | building | branch: test/review-regressions.test.ts "P0-1"; test/review2-original-attacks.test.ts |
| EC-IDN-009 | An organization creates a user for an email it does not own and tries to set a password | Refused (`password_not_allowed`); the real owner's first emailed link wipes anything set before | P0 | building | branch: test/review2-regressions.test.ts "R2-P0-1 / N-1" |
| EC-IDN-010 | An organization's identity provider asserts the email of another organization's administrator (unverified domain) | Refused; neither user nor link persisted; audit records why | P0 | building | branch: test/review-sso-regressions.test.ts "P0-2b"; test/review2-regressions.test.ts "R2-P1-3" |
| EC-IDN-011 | A second identity-provider account takes a member's email address | Cannot sign in as the member; identity stays bound to the first issuer + subject | P0 | building | branch: test/review-sso-regressions.test.ts "P1-8" |
| EC-IDN-012 | The same TOTP code is submitted in two challenges at once | Exactly one succeeds | P0 | building | branch: test/review-regressions.test.ts "P2-13"; test/review2-original-attacks.test.ts |
| EC-IDN-013 | 50 wrong second-factor codes spread over 10 fresh challenges | Delay after 5, lock after 20, high alert to the person and administrators after 10 | P0 | building | branch: test/review-regressions.test.ts "P1-7"; test/review2-regressions.test.ts "R2-P2-1" (concurrent burst) |
| EC-IDN-014 | A brand-new organization administrator with only a password tries a sensitive action during the MFA grace | Refused with "set up MFA"; the grace only defers MFA for non-sensitive work | P0 | building | branch: test/review-regressions.test.ts "P1-2"; test/mfa.test.ts |
| EC-IDN-015 | A role assigner with fewer permissions tries to revoke the general manager's role | Refused (power ordering) with the reason | P0 | building | branch: test/review-regressions.test.ts "P1-6" |
| EC-IDN-016 | The identity provider's admin group is emptied (SSO sign-in or SCIM change) | The last organization administrator keeps the role; high alert `last_administrator_kept` | P0 | building | branch: test/review2-regressions.test.ts "R2-P2-3 / N-8" |
| EC-IDN-017 | A user tries to grant themselves a role, or to add a permission they lack to a role or API client | Refused (`segregation_of_duties` / escalation) with the alternative approver hint | P0 | building | branch: test/roles-lifecycle.test.ts "prevents self-grants and privilege escalation" |
| EC-IDN-018 | A break-glass user tries to designate themselves or to create an API key, role or policy change during elevation | Refused; no durable privilege can be created during an elevation | P1 | building | branch: test/review-regressions.test.ts "P1-5" |
| EC-IDN-019 | A break-glass elevation reaches its 4-hour limit | Auto-expires; actions stay tagged; a different person must review it | P1 | building | branch: test/support-security.test.ts "only designated members, mandatory reason, tagged actions, alert, auto-expiry, review by someone else" |
| EC-IDN-020 | A support operator in a read-only session attempts a write, or acts outside the approved window | Refused; the attempt is in the customer-visible access log | P0 | building | branch: test/support-security.test.ts "pending until the customer approves; read-only scope; every request logged" |
| EC-IDN-021 | The customer revokes a support session while the operator is working | The next operator request is denied | P0 | building | branch: test/support-security.test.ts "the customer can revoke at any time" |
| EC-IDN-022 | An invitation link is used after its 7-day expiry | Refused and not listed in the person's invitations; a new invitation is needed | P1 | building | branch: test/review2-regressions.test.ts "P3-3" |
| EC-IDN-023 | A seasonal assignment ends at midnight in the property's time zone | Access ends at that instant (property time shown with the zone); requests after it are denied | P1 | building | branch: test/roles-lifecycle.test.ts "enforces time-limited assignments (ends_at)" — partial: property-zone boundary not tested |
| EC-IDN-024 | A transfer is scheduled for the 1st of next month | Old property access ends and new access starts at the effective time in one audited operation | P1 | building | branch: test/roles-lifecycle.test.ts "transfers … now or scheduled" |
| EC-IDN-025 | An API client is created with permissions its creator does not hold | Refused at creation (IDN-I08) | P0 | building | branch: test/identity.test.ts (IDN-I08) — main tests runtime limits only |
| EC-IDN-026 | Failed sign-ins across many accounts from one IP within 15 minutes | Credential-stuffing alert raised once per time bucket; administrators see it | P1 | building | branch: test/support-security.test.ts "flags failed sign-ins across accounts from one IP" |
| EC-IDN-027 | One person exports guest data five times in an hour | Mass-export alert to administrators | P1 | building | branch: test/support-security.test.ts "flags mass exports by one actor" |
| EC-IDN-028 | A desk agent walks away from a shared terminal; a colleague posts a charge | Idle lock after the policy time; the colleague unlocks with their own PIN, so the charge is attributed to them | P1 | specified | — (IDN-R04, IDN-R05) |
| EC-IDN-029 | The hotel's identity provider is down while "SSO required" is on | Exempt emergency accounts sign in with password + MFA; staff are told SSO is unavailable and why | P1 | building | branch: test/sso-scim.test.ts (exempt accounts) — partial: outage path not tested |
| EC-IDN-030 | A housekeeping supervisor with a department-scoped role opens an engineering work order | Denied (department scope) with the reason | P1 | specified | — (IDN-R11) |
| EC-IDN-031 | The AI assistant is asked to refund a folio by a user without refund permission | No proposal executable; the assistant explains the missing permission | P1 | specified | — (IDN-R18, AI-R04) |
| EC-IDN-032 | An organization's only administrator leaves and nobody can manage users | Monoclay recovery with identity verification and dual control; audited; customer-visible | P1 | specified | — (ADR-0017 §1b; not built) |
| EC-IDN-033 | A person is removed from organization A but still works for organization B | Only A's sessions and tokens stop; B is unaffected (IDN-I07) | P0 | building | branch: test/roles-lifecycle.test.ts; test/isolation.test.ts |
| EC-IDN-034 | An API client tries to approve its own issuer's activation request | Refused: separation of duties compares people, not principals | P1 | building | branch: test/review-regressions.test.ts "P1-4" |

<!-- sources (generated from a verified registry; do not edit by hand) -->

## Sources

Registry checked 2026-11-07. **Opened** = the page was fetched from this environment. **Search-located** = found by web search; the host blocks direct fetches here, so the fact is unverified until re-checked. Press releases and trade press are vendor claims, not verified behaviour.

- [Apaleo — AI integrations (MCP server, ~260 tools, OAuth)][apaleo-ai] (opened)
- [Apaleo — API scopes][apaleo-scopes] (opened)
- [Apaleo — OAuth — review consent screen][apaleo-consent] (opened)
- [Apaleo — User management — inviting users (help centre)][apaleo-users] (search-located)
- [Apaleo — User roles (help centre)][apaleo-roles] (search-located)
- [Cloudbeds — Add, edit or delete roles][cb-roles] (search-located)
- [Cloudbeds — Grant and set up credit card viewing password][cb-cardpw] (search-located)
- [Cloudbeds — Organization user permissions][cb-orgperm] (search-located)
- [Mews — Connector API — Authentication][mews-auth] (opened)
- [Mews — How to set up Single Sign-On (SSO) in Mews Operations][mews-sso] (opened)
- [Mews — Single Sign-On free for all customers (press)][mews-ssofree] (search-located)
- [OPERA Cloud 26.3 — About Roles][op-roles] (opened)
- [OPERA Cloud 26.3 — Assigning Tasks to a Role][op-roletasks] (opened)
- [OPERA Cloud 26.3 — Associating Transaction (Charge) Codes to Property Roles][op-rolecodes] (opened)
- [OPERA Cloud 26.3 — Configuring Chain Roles][op-chainroles] (opened)
- [OPERA Cloud 26.3 — Configuring Job Titles][op-jobtitles] (opened)
- [OPERA Cloud 26.3 — Configuring Template and Property Roles][op-proproles] (opened)
- [OPERA Cloud 26.3 — Generating the Configured Roles and Tasks Report][op-rolereport] (opened)
- [OPERA Cloud 26.3 — Managing Interface Users][op-ifcusers] (opened)
- [OPERA Cloud 26.3 — Managing Users][op-users] (opened)
- [OPERA Cloud 26.3 — Viewing Changes Log Details][op-changeslog] (opened)
- [Oracle Hospitality Identity Management — Identity federation — introduction (SAML 2.0 via OCI IAM)][op-fed] (opened)

[apaleo-ai]: https://apaleo.dev/guides/ai/overview.html
[apaleo-consent]: https://apaleo.dev/guides/oauth-connection/review-consent-screen.html
[apaleo-roles]: https://apaleo.zendesk.com/hc/en-us/articles/360001498771-User-Roles
[apaleo-scopes]: https://apaleo.dev/guides/api/scopes.html
[apaleo-users]: https://apaleo.zendesk.com/hc/en-us/articles/360001424611-User-management
[cb-cardpw]: https://myfrontdesk.cloudbeds.com/hc/en-us/articles/4411175776667
[cb-orgperm]: https://myfrontdesk.cloudbeds.com/hc/en-us/articles/4402912536603
[cb-roles]: https://myfrontdesk.cloudbeds.com/hc/en-us/articles/218512377
[mews-auth]: https://docs.mews.com/connector-api/guidelines/authentication
[mews-sso]: https://help.mews.com/s/article/How-to-set-up-Single-Sign-on-or-SSO-in-Mews-Operations
[mews-ssofree]: https://www.hospitalitynet.org/news/4131474/major-security-upgrade-mews-makes-single-sign-on-free-for-all-customers-amid-rising-cyber-threats
[op-chainroles]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_manage_chain_roles_configuring_chain_roles.htm
[op-changeslog]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_logs_viewing_changes_log_details.htm
[op-fed]: https://docs.oracle.com/en/industries/hospitality/identity-management/fedag/c_introduction.htm
[op-ifcusers]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_role_manager_managing_interface_users.htm
[op-jobtitles]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_enterprise_configuring_job_titles.htm
[op-proproles]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_manage_property_roles_configuring_property_and_template_roles.htm
[op-rolecodes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_manage_property_roles_assigning_transaction_codes_to_a_role.htm
[op-rolereport]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_role_manager_generating_the_configured_roles_and_tasks_report.htm
[op-roles]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_manage_roles.htm
[op-roletasks]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_manage_property_roles_assigning_tasks_to_roles.htm
[op-users]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_role_manager_managing_users.htm
