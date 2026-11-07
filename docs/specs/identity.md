# Spec: identity

Status: Draft v1 · 2026-11-07 · Wave 0 → 1 · Schema `identity` · Prefix `IDN`

## 1. Purpose

Decide, for every request, **who** is acting and **whether** they may do this here. Staff users, API clients,
AI agents acting for a user, and Monoclay support staff all pass through the same authorization path. Hotel
staff change jobs, properties and shifts constantly; the module must make onboarding, transfers and
terminations fast and safe, and must make every privileged action attributable.

## 2. Scope and non-goals

**In scope:** staff users (per organization), credentials, MFA, SSO links, sessions and devices, roles,
scoped role assignments, permission catalog (registered by modules), API clients and scopes, emergency
("break-glass") access, Monoclay support access, sign-in security events.

**Non-goals:** guest accounts and guest portal sign-in (`guests`/`apps/guest`, LATER); HR records, payroll,
rosters (boundary: identity stores only employment status needed for access); SaaS billing contacts (`billing`).

## 3. Capabilities

### 3.1 Staff users and credentials

- **IDN-R01** [MUST] A staff member belongs to exactly one organization (tenant-owned row). The same email may
  exist in several organizations as separate accounts; sign-in asks which organization when ambiguous. Never
  a cross-tenant user row.
- **IDN-R02** [MUST] Credentials: password (Argon2id, breach-list check, min length 12, no composition rules)
  and/or SSO; passkeys (WebAuthn) [SHOULD]. Login rate-limited per account and per IP; lockout escalates with
  delay rather than hard lock to avoid front-desk denial of service.
- **IDN-R03** [MUST] MFA (TOTP or passkey) is **mandatory** for any user holding a sensitive (⚑) permission and
  for all organization admins; optional otherwise; never gated by edition.
- **IDN-R04** [MUST] **Quick switch on shared terminals:** a desk terminal may keep a device session; staff
  unlock with a personal PIN (6+ digits) bound to their account and that device, so every action is attributed
  to a person and sharing a login is unnecessary. PIN unlock is valid only on registered devices and only for
  permissions not marked `requiresFullAuth` (money movement > policy threshold, user admin, exports).
- **IDN-R05** [MUST] Sessions: idle timeout by policy (desk default 30 min with PIN re-unlock, mobile 12 h,
  admin 15 min), absolute lifetime, device list, remote sign-out, revoke all sessions on password reset or
  termination.
- **IDN-R06** [MUST] **Employment lifecycle:** `invited → active → suspended → terminated`. Termination revokes
  all sessions, API tokens issued *by* the user and pending delegated AI actions within 60 s; records remain
  for audit attribution (never deleted while referenced).
- **IDN-R07** [MUST] **Transfer**: moving a user between properties is a single previewed operation (assignments
  removed/added, effective time), not delete-and-recreate.
- **IDN-R08** [SHOULD] SSO via OIDC and SAML 2.0 with just-in-time provisioning and group→role mapping
  (`identity.sso`). [LATER] SCIM 2.0 provisioning (`identity.scim`).

### 3.2 Roles, permissions and scope

- **IDN-R09** [MUST] Permissions are registered by modules (`ModuleManifest.permissions`) with key, description,
  scope kind (`organization`|`property`) and sensitivity. Unknown permission keys fail at boot.
- **IDN-R10** [MUST] Roles are named permission sets. System role templates per persona
  (`docs/product/personas-and-workspaces.md`) ship read-only; organizations clone and edit. Role edits are
  versioned and previewed ("23 staff gain `finance.posting.adjust`").
- **IDN-R11** [MUST] Role assignment = (user, role, scope) where scope ∈ organization | brand | region |
  property | department-within-property, optional `validFrom/validTo`. Effective permission for (permission,
  property) = any assignment whose scope contains the property (and department, for department-scoped tasks).
- **IDN-R12** [MUST] `authorize(ctx, permission, scope?)` is deny-by-default and is called for every endpoint
  (`requirePermission`). Property-scoped permissions require a property scope argument; a missing scope is a
  programming error (500 in dev, 403 in prod, logged).
- **IDN-R13** [MUST] Field-level restriction for designated sensitive fields (identity documents, payment
  token metadata, guest alerts marked private, salary-like data never stored): reads require explicit
  permissions (e.g. `guests.document.read`) and are audited per read.
- **IDN-R14** [MUST] **Segregation guardrails** (policy, default on): the same person cannot both create and
  approve a write-off above threshold; cannot approve their own refund above threshold; cannot grant themselves
  a role. Violations return `segregation_of_duties` with the rule and an alternative approver hint.
- **IDN-R15** [MUST] **Approvals**: a generic approval primitive (request → approve/decline, approver must hold
  the named permission in scope, expires) used by finance (write-offs, refunds over limit), inventory
  (overbooking authorization), platform (policy locks), AI (action proposals).

### 3.3 Machine and delegated identities

- **IDN-R16** [MUST] API clients (OAuth 2.0 client credentials) per organization with scopes = permission keys
  and property filter; secrets shown once, rotatable with overlap window, last-used tracking, expiry.
  Issuing production keys calls `assertExternalEffectAllowed(ctx, 'production_key_issue')`.
- **IDN-R17** [SHOULD] Third-party app authorization (authorization-code + consent screen listing permissions
  in plain language and properties) for marketplace apps (`integration`).
- **IDN-R18** [MUST] AI delegation: the AI assistant acts **as the user**, with the intersection of the user's
  permissions and the assistant's allowed scope; actions are proposals requiring the user's confirmation for
  anything consequential (`ai` spec). The actor recorded is `{type:'user', id, via:'ai'}`.

### 3.4 Emergency and support access

- **IDN-R19** [MUST] **Break-glass**: a pre-designated user may elevate to a named emergency role for ≤ 4 h with
  mandatory reason; elevation notifies all organization admins immediately; every action during elevation is
  tagged; elevation auto-expires.
- **IDN-R20** [MUST] **Monoclay support access**: no standing access to tenant data. A support engineer
  requests a time-boxed session (default 2 h, max 24 h) for one organization with reason and scope
  (read-only default); an organization admin approves (or a pre-authorized policy allows read-only for
  incident tickets); every read and write is audited and visible to the organization in a support-access log.
- **IDN-R21** [MUST] Security events (sign-in success/failure, MFA changes, role grants, break-glass, support
  sessions, API key creation/rotation) are recorded in an append-only security log retained per policy and
  exportable by organization admins.

## 4. Entities and states

`user(id, email, display_name, status, mfa_required, locale, version)` · `credential(user_id, kind, …)` ·
`device(id, user_id?, kind: desk|mobile|kiosk, property_id?, registered_at, last_seen_at)` ·
`session(id, user_id, device_id, auth_level: full|pin, created_at, expires_at, revoked_at?)` ·
`role(id, name, template_key?, permissions[], version)` · `role_assignment(id, user_id, role_id, scope_kind,
scope_id, valid_from, valid_to?)` · `api_client(id, name, scopes[], property_ids|'all', secret_hash, expires_at,
last_used_at)` · `approval_request(id, kind, subject_ref, requested_by, approver_permission, status, expires_at)` ·
`elevation(id, user_id, role_id, reason, started_at, ends_at)` · `support_session(id, operator, scope, reason,
approved_by, starts_at, ends_at)` · `security_event(...)` (append-only).

**User status:** `invited → active` (accepts invite, sets credential/MFA) · `active ⇄ suspended` (admin, reason) ·
`active|suspended|invited → terminated` (admin, reason; terminal). Terminated users cannot be reactivated;
rehire creates a new user linked by `previous_user_id`.

**Approval request:** `pending → approved | declined | expired | withdrawn`. Terminal states are immutable.
An approval is consumable exactly once by the command that requested it (`consumed_at`).

**Session:** `active → (idle_locked ⇄ active) → expired | revoked`.

## 5. Invariants

- **IDN-I01** Every API request except sign-in, public booking-engine endpoints and webhooks with verified
  signatures carries an authenticated actor; every mutating command records `actor` in audit.
- **IDN-I02** `authorize` returns allow only if an active assignment (now within `validFrom..validTo`) grants
  the permission for a scope containing the target property; terminated/suspended users have zero effective
  permissions.
- **IDN-I03** A user cannot create, edit or approve a role assignment for themselves.
- **IDN-I04** A user with any ⚑ permission has MFA enrolled before that permission becomes effective.
- **IDN-I05** An approval request is consumed at most once; a consumed or expired approval cannot authorize
  another command.
- **IDN-I06** Support sessions are bounded in time; no support-operator read occurs outside an approved
  session window (enforced at the auth layer; audit proves it).
- **IDN-I07** After termination, no session or token of that user authenticates (tested within 60 s).
- **IDN-I08** API client effective permissions ⊆ the scopes granted at creation; property filter applied to
  every list endpoint (list results never include out-of-scope properties' rows).

## 6. Cross-module interactions

Provider contract (domain map): `authorize`, `can`, `listAccessiblePropertyIds`. Consumes `platform`
(organization, properties, departments) for scope resolution and entitlements (`identity.sso`).
Every module registers permissions through its `ModuleManifest`.

### Proposed contract changes

1. `requestApproval(tx, { kind, subjectRef, approverPermission, scope, payload, expiresAt })` and
   `consumeApproval(tx, { approvalId, kind, subjectRef })` (IDN-R15). Additive.
2. `authorize(ctx, permission, scope?: { propertyId?; departmentId? })` — department scope for tasks. Additive.
3. Actor type extended: `{ type: 'user'|'api_client'|'system'|'support', id, via?: 'ai'|'pin'|'elevation' }`
   (must be mirrored in `@portico/kernel` `Actor`).

## 7. Events

Emitted: `identity.user.invited|activated|suspended|terminated`, `identity.roleAssignment.changed`,
`identity.elevation.started|ended`, `identity.supportSession.started|ended`, `identity.apiClient.created|revoked`.
Consumed: `platform.property.lifecycleChanged` (archived properties drop from accessible lists).

## 8. Permissions

`identity.user.read` · `identity.user.manage` ⚑ · `identity.role.manage` ⚑ (org) · `identity.roleAssignment.manage` ⚑ ·
`identity.apiClient.manage` ⚑ (org) · `identity.device.manage` · `identity.securityLog.read` ⚑ (org) ·
`identity.supportAccess.approve` ⚑ (org) · `identity.elevation.use` ⚑.

## 9. UX surfaces

- **Staff directory** with status, roles by scope, last sign-in, MFA status; bulk invite from CSV.
- **Role editor** grouped by module with plain-language permission descriptions; ⚑ permissions highlighted;
  impact preview before saving.
- **"Why can't I?"** — every 403 offers "Request access" (creates an approval request to the user's manager)
  and shows which permission is missing (never which data exists).
- **Shift unlock** screen for shared desk devices (PIN pad, large targets, user avatars of staff on shift).
- **Support access log** visible to organization admins.

## 10. Proof scenarios and evidence

| ID | Identity must demonstrate |
|---|---|
| S17 | A valid user of organization A gets 404 for organization B resource IDs on every endpoint family, in search, exports and reports. |
| E04 | Revoked hotel permission: a user removed from a property loses access immediately; API client rotated/expired → 401 with recovery text; channel/payment credentials expiry handled in their modules. |
| E09 | Cross-property: a user assigned to property P1 only gets 404 (not 403, to avoid existence disclosure) for P2 records, P2 appears in no list, search or report. |
| E15 | Staff error recovery depends on attribution: every correction shows who made the original action and who corrected it. |
| S14 (supporting) | Both editors are identified in conflict UI by display name. |

## 11. Maldives specifics

Resort staff live on-island and often share devices in back offices; PIN quick-switch (IDN-R04) is the
default for desk devices. Expatriate staff turnover is high — invite/terminate flows must take < 1 minute.
Multi-island groups commonly move staff between properties (IDN-R07). Connectivity on islands can be weak:
session lifetimes on registered mobile devices are longer, while sensitive actions still need full auth.

## 12. Competitive inspirations

- Fine-grained OAuth with a consent screen — Apaleo (research 02 §3.3.1, §3.6).
- Enterprise RFP expectations: SAML/OIDC SSO, SCIM, MFA, audit logs (research 04 §D4, §C4).
- Avoid support-gated developer features (Mews webhook registration via support, research 02 §2.8) — API
  clients are self-serve here.

## 13. Open questions

None requiring the owner. Product decisions: staff accounts unlimited in every edition (so shared logins are
never economically motivated); MFA never gated.
