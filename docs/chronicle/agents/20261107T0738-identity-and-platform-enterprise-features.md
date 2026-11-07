# Agent run: Identity and platform enterprise features

- Started: 2026-11-07T07:38:12.649Z · last activity: 2026-11-07T18:16:17.066Z
- Turns: 1370 · tool uses: 779 · output tokens: 2,738,415
- Type: general-purpose

## Brief (2026-11-07T07:38:12.649Z)

````text
You are the engineer for Portico's enterprise identity & platform features. First read the shared playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md and follow it, with this difference: your write scope is `modules/identity/` and `modules/platform/` (both already exist on main and are yours to extend — keep every existing test passing and do not break their public functions; add new migrations as 0002_*.sql etc., never edit 0001), plus wiring in apps/api/src/composition.ts and apps/api/src/provisioning.ts, plus new tests in apps/api/test/.

Your worktree: /home/user/wt/identity-plus (branch feat/identity-platform-enterprise). Test DB prefix: PORTICO_TEST_DB_PREFIX=w1_idplus. Specs: /home/user/wt/product/docs/specs/identity.md and platform.md. Also read docs/product/operational-readiness-brief.md §12–§13 (privacy, security, enterprise administration), docs/product/adoption-integration-brief.md §3 and §11 (trial environments, enterprise rollout), docs/readiness/security-privacy-readiness.md, ADR-0002/0010/0012/0014.

IDENTITY — build and test:
1. MFA: TOTP enrolment (RFC 6238, secret field-encrypted, QR provisioning URI), verification with replay protection (used time-step), recovery codes (hashed, single use), WebAuthn as a documented LATER item. Organization policy: MFA required for roles holding any `sensitive` permission (from module manifests) and for org admins; step-up: sessions record mfa_verified_at; sensitive permissions require a recent MFA verification (configurable window) — enforce centrally in the authorizer so modules don't have to (e.g. the authorizer returns false for sensitive permissions when step-up is missing, and the HTTP layer returns a distinct `mfa_required` problem). Design the cleanest way and document it.
2. Enterprise SSO: per-organization OIDC configuration (issuer, client id, client secret via a SecretStore port, allowed email domains, role mapping from IdP groups/claims to Portico roles with scopes), authorization-code + PKCE login flow endpoints, JIT provisioning of memberships, enforcement option "SSO required" (password login disabled for that org's members). Test with a local fake IdP (sign tokens with `jose` keys generated in the test). SAML: document as LATER with the same role-mapping model. SCIM: provisioning endpoints (Users, Groups) — at least create/update/deactivate users with tests.
3. Custom roles: CRUD for organization roles built from the permission catalog (validate keys/wildcards against registered permissions), with sensitive permissions flagged; system role templates remain immutable but clonable.
4. Staff lifecycle: invite (token with expiry, email via a Notifier port honoring environment safety — simulated outside live), password reset, transfer between properties (revoke old scoped assignments + grant new, audited), time-limited assignments (ends_at enforced), session list & revoke (self and admin), suspension (exists) and removal (memberships removed; audit retained).
5. Support access (readiness brief §13): Monoclay operator access to a customer organization only through a time-boxed, reason-recorded "support session" that the customer can see (and optionally must approve — org policy), with a distinct actor kind/impersonation marker on every audit record. Operator authentication for the internal console: separate operator principals (not tenant users) — design minimal but secure (e.g. operator API tokens from env for now, documented as to-be-replaced by AWS IAM Identity Center/SSO).
6. Break-glass emergency access: time-boxed elevation with mandatory reason, immediate alert event, automatic expiry, post-incident review flag.
7. Suspicious activity signals: repeated failed logins across accounts from one IP, sign-in from new country (placeholder geo), mass export attempts — emit `identity.security.alert` events (detection rules simple, documented).

PLATFORM — build and test:
8. Owners & ownership (brief §2 "individual owners where ownership arrangements require separate accounting"): owner entities (person/company, payout details reference — no bank data in plaintext), ownership shares of units by unit id (unit ids from inventory referenced by id only; no FK), effective dating; owner statements are LATER (finance) — expose the data.
9. Outlets: CRUD (restaurant, bar, spa, dive center, boutique, transfer desk, minibar, in-room dining…), legal entity, default charge code ref (by key), opening hours, room-charge eligibility flag.
10. Configuration templates & bulk setup (adoption brief §11): export a property's platform configuration (and a registry where other modules can contribute their config sections later) as a versioned "configuration bundle"; apply a bundle to one or many properties with a dry-run validation report first (what would change, conflicts, local overrides preserved); rollout groups (named sets of properties with stage: pilot/wave1/wave2…) and an approval control (separation of duties: the person who prepares a portfolio-wide change cannot approve it — configurable).
11. Environments & trial lifecycle (adoption brief §3): create a `trial` organization linked to a live (or prospective) organization; reset trial (delete operational data, keep config), export trial data, delete trial (respecting retention obligations — document), and "carry forward" selected configuration from trial to production via configuration bundles with validation. Provenance: trial org data is labeled `copied` where it came from an import.
12. Property activation stages: setup → pilot → active requires an explicit, audited approval by a different user with `platform.property.activate` (sensitive); pilot scope settings (which modules/workflows are live in the pilot).

Also: expand the permission catalog endpoint (GET /v1/permissions) for role editors, and add HTTP routes + Zod contracts for everything above. Update modules/identity/README.md and modules/platform/README.md (create them) per the playbook deliverables, with honest readiness levels (SSO tested only against a fake IdP = R3; nothing is integrated with a real IdP).
````

## Follow-up message (2026-11-07T11:13:06.867Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue exactly where you stopped (MFA suite was passing; next were roles and staff-lifecycle tests; check `git status` and README Checkpoints; uncommitted work is still in the worktree). Remember the queued follow-ups (data-authority G-01/02/04/06/07, editions §7 + Connect plan, getPropertyFacts). Commit after each meaningful step. Postgres was restarted and is up. When finished, deliver your final report as originally specified.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T11:52:40.319Z)

````text
The coordinator sent a message while you were working:
Fix round for feat/identity-platform-enterprise. The steward verdict is "do not merge": there are 2 P0 cross-organization account-takeover paths, each proven by a passing PoC test.

Read these first:
1. The full review: /home/user/portico/docs/orchestration/reviews/review-identity-plus.md. It is also on main, along with everything below.
2. ADR-0017 (main, docs/adr/0017-global-identity-and-cross-organization-safety.md). This is the design decision your fixes must implement. Core rule: credentials (password, MFA factors, recovery codes) belong to the person. An org admin, SSO connection or SCIM client may reset them only for a person whose EVERY membership (any status) is in that org. Adding an existing global user to an org creates an invited membership the person accepts while signed in as themselves. Credential links never appear in API responses. Changing a credential needs proof of the existing factor. SSO binds on (issuer, sub), and linking existing global users requires DNS TXT domain verification.

Steps:
- Start by merging main into your branch (`git merge main`).
  - Resolve the conflict in modules/platform/src/manifest.ts by keeping your branch's permission list. It registers `platform.dataAuthority.manage` once.
  - Reword the doc comment at modules/identity/src/domain/step-up.ts:5 so apps/api/test/permission-catalog.test.ts passes, e.g. `requirePermission(ctx, <sensitive permission>)` (P1-1).
  - Main has also replaced `trustProxy: true` with `trustedProxies` / `TRUSTED_PROXY_CIDRS` in packages/http; that part of P1-7 is done.
- Copy the review's PoC tests into your branch and turn each one into a regression test that asserts the attack is REFUSED. They pass today, which means each attack works:
  - /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy/modules/identity/test/zz-review-poc.test.ts
  - /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy/modules/identity/test/zz-review-sso-poc.test.ts
  - /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy/apps/api/test/zz-review-poc.test.ts
  - /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy/packages/kernel/src/zz-review.test.ts (P2-10: kernel lives on main. Put the union-of-grants fix in `pending-fixes` as a foundation request, don't edit packages/kernel.)

Must fix, with the concrete fixes the review gives:
- P0-1 and P0-2 per ADR-0017 §1–5.
- P1-2: MFA grace covers enrolment only. ⚑ permissions do not take effect during the grace; the grace is anchored to first activation anywhere; cap 72 h.
- P1-3: API keys per ADR-0017 §9.
- P1-4: separation of duties compares people (`responsiblePerson`), and API clients cannot make SoD approvals.
- P1-5: break-glass per ADR-0017 §10.
- P1-6: power ordering, plus last-admin protection.
- P1-7: per-person second-factor failure counter across challenges, with an alert.
- P1-8: SSO matches on (issuer, sub); `email_verified` required; `requiredClaims`.
- P2 items that are cheap and security-relevant:
  - P2-2: SSRF, plus IdP calls outside the DB transaction (reuse integration's safeFetch approach if you can; don't import across modules).
  - P2-3: browser-bound SSO state.
  - P2-4: at least one exempt account while SSO is required.
  - P2-5: transition guard fails closed.
  - P2-6: refusal audits survive the rollback.
  - P2-7: use idempotency keys properly, and never store plaintext tokens or links in `response_body`.
  - P2-11: no PII in owner audits.
  - P2-14: report `queued`, never `live` "sent".
  - P2-15: reserved system role keys.
  - P2-17: operator routes disabled in production until IAM Identity Center.
- Remaining P2 and P3 items: fix them if cheap. Otherwise list them in your README under "Known gaps" with a reason.
- P3-11: append your README's owner questions to docs/OPEN_QUESTIONS.md using its template.

Rules:
- Stay in your write scope.
- Commit after each meaningful step (Conventional Commits). Do not push.
- When done, run `pnpm lint && pnpm typecheck && pnpm test` with PORTICO_TEST_DB_PREFIX=w1_idplus_fix and check the exit codes, not piped output.
- Reply with:
  - a table mapping each finding id to its fix commit and test name;
  - the command results;
  - anything you deliberately did differently from the review, and why.

A second steward review will follow before merge.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T12:07:35.550Z)

````text
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

<system-reminder>
<tools-used-before-summary>Bash, Read, SubagentHandback, Write</tools-used-before-summary>
</system-reminder>
Summary:
1. Primary Request and Intent:

   **Original task (completed earlier, report delivered via SubagentHandback):**
   - Build enterprise identity & platform features in worktree /home/user/wt/identity-plus (branch feat/identity-platform-enterprise, PORTICO_TEST_DB_PREFIX=w1_idplus).
   - Write scope: `modules/identity/`, `modules/platform/`, `apps/api/src/composition.ts`, `apps/api/src/provisioning.ts`, and new tests in `apps/api/test/`.
   - Never edit 0001 migrations. Commit with Conventional Commits plus the trailers below. Never push.

   **CURRENT fix round (coordinator message, verbatim essentials):**
   - "Fix round for feat/identity-platform-enterprise. The steward verdict is 'do not merge': there are 2 P0 cross-organization account-takeover paths…"
   - Read the review at docs/orchestration/reviews/review-identity-plus.md and ADR-0017 (docs/adr/0017-global-identity-and-cross-organization-safety.md). ADR core rule:
     - Credentials (password, MFA factors, recovery codes) belong to the person.
     - An org admin, SSO connection or SCIM client may reset them only for a person whose EVERY membership (any status) is in that org.
     - Adding an existing global user creates an invited membership, which the person accepts while signed in as themselves.
     - Credential links never appear in API responses.
     - Changing a credential needs proof of the existing factor.
     - SSO binds on (issuer, sub); linking existing global users requires DNS TXT domain verification.
   - Merge main.
     - Manifest conflict: keep the branch's list (dataAuthority registered once).
     - Reword step-up.ts:5 so permission-catalog.test passes (P1-1).
     - Main replaced trustProxy with trustedProxies / TRUSTED_PROXY_CIDRS (that part of P1-7 is done).
   - Copy the review's PoC tests and turn each into a regression test asserting the attack is REFUSED:
     - /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy/modules/identity/test/zz-review-poc.test.ts
     - …/modules/identity/test/zz-review-sso-poc.test.ts
     - …/apps/api/test/zz-review-poc.test.ts
     - …/packages/kernel/src/zz-review.test.ts — a later UPDATE says P2-10 is fixed on main (47c76b9); adapt the kernel PoC as a passing test or drop it; no pending-fixes entry needed.
   - Must fix, using the concrete fixes the review gives:
     - P0-1 and P0-2 per ADR-0017 §1–5.
     - P1-2: grace covers enrolment only; ⚑ never takes effect during the grace; anchored to first activation anywhere; capped at 72 h.
     - P1-3: API keys per ADR §9.
     - P1-4: SoD compares people (responsiblePerson); API clients cannot make SoD approvals.
     - P1-5: break-glass per ADR §10.
     - P1-6: power ordering plus last-admin protection.
     - P1-7: per-person second-factor failure counter across challenges, with an alert.
     - P1-8: SSO (issuer, sub); email_verified required; requiredClaims.
   - Cheap, security-relevant P2s:
     - P2-2: SSRF, plus IdP calls outside the DB transaction (reuse integration's safeFetch approach; don't import across modules).
     - P2-3: browser-bound SSO state.
     - P2-4: ≥1 exempt account.
     - P2-5: transition guard fails closed.
     - P2-6: refusal audits survive rollback.
     - P2-7: idempotency keys used properly; no plaintext tokens or links in response_body.
     - P2-11: no PII in owner audits.
     - P2-14: report `queued`, never `live` "sent".
     - P2-15: reserved system role keys.
     - P2-17: operator routes disabled in production until IAM Identity Center.
   - Remaining P2/P3: fix if cheap, otherwise list in the README "Known gaps" with a reason.
   - P3-11: append the README owner questions to docs/OPEN_QUESTIONS.md using its template.
   - Rules:
     - Stay in your write scope.
     - Commit after each meaningful step (Conventional Commits). Do not push.
     - When done, run `pnpm lint && pnpm typecheck && pnpm test` with PORTICO_TEST_DB_PREFIX=w1_idplus_fix and check the exit codes, not piped output.
   - Reply with:
     - a table mapping each finding id to its fix commit and test name;
     - the command results;
     - anything deliberately done differently from the review, and why.
   - A second steward review follows.

   **Commit trailer (required):**
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
   ```
   Use `git -c commit.gpgsign=false commit`.

   **Security constraints (from the playbook and CLAUDE.md):**
   - No secrets in code, tests, fixtures or logs.
   - Never push. Never drop databases you did not create.
   - Do not modify packages/kernel, db, http or testing, other modules, CLAUDE.md, or docs outside your module. Exceptions explicitly allowed by the coordinator: docs/OPEN_QUESTIONS.md (P3-11), and pending-fixes if needed (no longer needed for P2-10).
   - Never activate live/production integrations. Tests must not start listeners on ports.
   - Final report goes via SubagentHandback (single call, ends the run).

2. Key Technical Concepts:
   - Fastify modular monolith; Kysely with RLS (`core.enable_tenant_isolation`); `withTenantTx`; `runIdempotent`.
   - Identity data model:
     - Global `identity.users` vs tenant `memberships`.
     - SECURITY DEFINER functions; `identity.user_tenants` (synced from memberships, any status).
   - Step-up authorizer (`stepUpAuthorizer`, `explainDenial`) and the onSend translator for `mfa_required`.
   - ADR-0017 guardrails:
     - sole-organization member; power ordering; last administrator;
     - elevation lock; human approver; responsible person for SoD.
   - Outcome pattern: return failures so counters commit, throw after the transaction.
   - Per-person second-factor counter: users.mfa_failed_attempts / mfa_locked_until.
     - Escalation: 5 → 1 min; 10 → 15 min plus `mfa_bruteforce_suspected` alert; 20 → 24 h.
   - Credential proof: TOTP/recovery code if enrolled, else current password, else sole-org only.
   - SSO three-phase flow (no IdP calls inside a tx), (issuer, sub) links, DNS TXT `_portico-verification.<domain>` = `portico-verify=<token>`, browserBinding.
   - SSRF-safe fetch: https, public addresses, pinned DNS, no redirects, 1 MB cap.
   - Dev mailbox for simulated messages (operator-only, link encrypted); notifier modes queued/simulated/sandbox.
   - API keys:
     - no identity.* (except identity.scim.provision), no '*';
     - keys with ⚑ permissions: expiry ≤ 90 days plus a fresh step-up;
     - `assertExternalEffectAllowed('credentials.production')`;
     - revoked on suspension, MFA reset and password reset (definer `revoke_sessions_everywhere` now also revokes keys).

3. Files and Code Sections:

   - **apps/api/src/composition.ts** (merged, committed in 4b4843f)
     - Main's guests/inventory wiring, plus `CompositionOptions {env, identity, platform}`, platformPorts, identity ports (cipher from `fieldCryptoFromEnv(env)`, fieldEncryptedSecretStore, outboxNotifier, `fetchOidcHttp()`, unknownGeo, `operatorDirectoryFromConfig(env.PORTICO_OPERATORS)`, hasEntitlement, organizationName, assertPropertyExists via getPropertyFacts, config {appBaseUrl, ssoRedirectUri, totpIssuer}).
     - httpModules: [platform, identity, provisioning, inventory, guests, records].
     - jobs: [...CORE_JOBS, ...IDENTITY_JOBS, inventory, guests].
     - Returns identityPorts/platformPorts.
     - STILL TO DO:
       - `fetchOidcHttp({ allowLocalDevelopment: env.NODE_ENV !== 'production' })`;
       - `config.allowLocalIdentityProvider`;
       - `config.operatorConsoleEnabled` (false in production);
       - disable operators in production;
       - `dnsTxt: systemTxtResolver`.

   - **modules/platform/src/manifest.ts**: the branch version kept (committed).

   - **modules/identity/src/domain/step-up.ts** (uncommitted)
     - Comment reworded (P1-1).
     - New rules doc; `stepUpDenial`:
       ```ts
       if (!s.mfaEnrolled) {
         if (sensitive) return 'mfa_enrollment_required';
         const inGrace = s.enrolmentGraceEndsAt !== null && s.now < s.enrolmentGraceEndsAt;
         return s.requireMfaForAll && !inGrace ? 'mfa_enrollment_required' : null;
       }
       if (!sensitive) return null;
       // fresh within window → null, else 'mfa_required'
       ```
     - `permissions.test.ts` updated: the test "never lets sensitive permissions work without MFA, even inside the enrolment grace (ADR-0017 §8)" passes.

   - **modules/identity/migrations/0002_identity_enterprise.sql** (uncommitted)
     - users: `first_activated_at`, `mfa_failed_attempts`, `mfa_locked_until`, with a backfill.
     - mfa_recovery_codes: `revoked_at`.
     - grace check `between 0 and 72`.
     - sso_login_states: `binding_hash not null`.
     - elevations: `create unique index elevations_session_idx ... (session_id) where ended_at is null`.
     - New tables: `identity.sso_identities` (tenant, issuer, subject, user_id, email_at_link, linked_at, unique(tenant_id, issuer, subject)) and `identity.sso_domains` (domain, verification_token, verified_at, created_by).
     - Replaced `active_membership_count` with `identity.memberships_elsewhere(user_id, tenant_id)` (any status).
     - Trigger `identity.mark_first_activation` (definer, after insert or update of status).
     - `identity.dev_mailbox` table (app role revoked) with definer functions `deposit_simulated_message(id, tenant, recipient, kind, subject, body, link_enc)` and `read_dev_mailbox(recipient, limit)`.
     - `identity.pending_invitations(user_id) returns setof uuid`.
     - `revoke_sessions_everywhere` also: `update identity.api_clients set status='revoked' where created_by = p_user_id::text and status='active'`.
     - Grants for the new functions.

   - **modules/identity/src/tables.ts**: typings for the above (users new columns; recovery codes `revoked_at: Generated<Date|null>`; sso_login_states.binding_hash; `identity.sso_identities`; `identity.sso_domains`).

   - **modules/identity/src/services/guard.ts** (NEW). Exports:
     - `membershipsElsewhere`;
     - `assertSoleOrganizationMember(tx, userId, 'password_reset'|'mfa_reset')` — error `person_shared_with_other_organization`;
     - `isHumanSelf`, `assertHumanApprover(tx, what)` — `human_approval_required`;
     - `assertNotElevated(tx, what)` — `not_during_emergency_access`;
     - `assertCanGrantRole(tx, permissions, scope, ports?, reason?)` (moved here from service.ts and re-exported from service.ts);
     - `assertPowerOver(tx, targetUserId, ports?)` — checks each active target assignment via assertCanGrantRole;
     - `assertAdministratorRemains(tx, {userId?, assignmentIds?})` — refuses with `last_administrator` only if admins(before) > 0 && admins(after) === 0, where an admin holds org-scope identity.role.assign plus identity.user.manage among active members;
     - `revokeApiKeysIssuedBy(tx, userId)`.

   - **modules/identity/src/service.ts** (uncommitted)
     - `createUser` returns `{userId, status: 'active'|'invited'}`.
       - Brand-new (ensure_user returned the candidate id) → active with optional password.
       - Existing person → `invited`, no password; initialPassword given → ValidationError `person_already_has_sign_in`.
       - assertNotElevated.
     - New `addSelfToOrganization(tx, {userId, displayName, roleKey})` (system actor only), for self-requested trials.
     - `seedSystemRoles` doUpdateSet with `.where('identity.roles.is_system','=',true)`.
     - `assignRole`: assertNotElevated.
     - `revokeAssignment(tx, id, reason, ports?)`: assertPowerOver + assertAdministratorRemains.
     - `suspendMember(tx, userId, reason, ports?)`: power, last admin, revoke API keys.
     - `stepUpStateFor` anchored on `u.first_activated_at` (added to the session select).
     - API-client actor includes `createdBy: client.created_by` (cast as Actor).
     - `createApiClient`: assertNotElevated + `assertExternalEffectAllowed(tx, 'credentials.production')`.

   - **modules/identity/src/services/mfa.ts** (full rewrite, uncommitted). Exports:
     - `Outcome<T>`, `CredentialProof {currentPassword?, code?, recoveryCode?}`, `SECOND_FACTOR_LIMITS`, `MFA_PENDING_MINUTES=15`;
     - `SecondFactorLockedError` (429, `second_factor_locked`);
     - `secondFactorLock`, `recordSecondFactorFailure(tx, ports, userId)` (alert plus notifier to the person at 10/20), `recordSecondFactorSuccess`;
     - `proveExistingCredential` (returns {ok} | {ok:false, error});
     - `enrolTotp(tx, ports, proof)` → Outcome;
     - `confirmTotp` (pending ≤ 15 min);
     - `regenerateRecoveryCodes(tx, ports, proof)` → Outcome;
     - `verifySecondFactor` (recovery codes respect revoked_at);
     - `stepUp` (also per-person counter/lock; StepUpOutcome has lockedUntil), `stepUpFailure`;
     - `disableOwnMfa(tx, ports, proof)` → Outcome;
     - `resetMemberMfa(tx, userId, reason, ports?)` (sole-org, power, revoke sessions and keys);
     - `createMfaChallenge`;
     - `completeMfaChallenge` (lock check, per-person counter, checkSignInLocation after success — P3-2);
     - `requireRecentStepUp` kept for break-glass.

   - **modules/identity/src/domain/security-rules.ts**: added rules `'break_glass_designation_changed' | 'mfa_bruteforce_suspected'`.

   - **modules/identity/src/ports.ts**
     - `NotifierResult { mode: 'queued'|'simulated'|'sandbox' }` (no simulated message).
     - New port `dnsTxt?: (name) => Promise<string[]>`.
     - config: `allowLocalIdentityProvider?`, `operatorConsoleEnabled?`.

   - **modules/identity/src/adapters.ts**
     - `outboxNotifier`: non-live → `identity.deposit_simulated_message` (encrypted link), returns `simulated`/`sandbox`; live → emits `identity.staffMessage.requested`, returns `queued`.
     - `readDevMailbox(database, cipher, recipient)`.
     - `fetchOidcHttp({timeoutMs, allowLocalDevelopment})` uses `safeJsonRequest`, except local dev localhost.
     - `systemTxtResolver(name)`.
     - Imports `PorticoDatabase, sql`.

   - **modules/identity/src/net/address-policy.ts** (copied from integration, with attribution and FR-5 note) and **net/safe-json.ts** (NEW): `safeJsonRequest(url, {method, headers, body, timeoutMs, resolver})`.

   - **modules/identity/src/services/lifecycle.ts** (uncommitted)
     - `send()` without a notifier → `{mode:'simulated'}`.
     - `inviteMember`: assertNotElevated; uses the new exported `sendInvitation(tx, ports, {userId, email, displayName})` → `{invitationExpiresAt, delivery}`; returns `{userId, invitationExpiresAt, delivery}` with no link.
     - `acceptInvitation(database, ports, {token, password?, code?, recoveryCode?})`:
       - existing password → proves password plus TOTP if enrolled (counts failures; doesn't consume the token on failure);
       - no password but memberships elsewhere → `sign_in_to_accept`;
       - else sets the first password.
     - Helper `activateInvitedMembership`.
     - New `listMyInvitations(database, actor)` and `acceptMembershipAsSelf(database, actor, organizationId)`.
     - `sendPasswordResetForMember(tx, ports, userId)`: membership check, then sole-org and power.
     - `removeMember(tx, userId, reason, ports?)`: power + last admin.

   - **modules/identity/src/services/api-clients.ts**
     - `FORBIDDEN_IN_KEYS` (`'*'`, `identity.*` except `identity.scim.provision`) → `permission_not_allowed_in_keys`.
     - `MAX_SENSITIVE_KEY_DAYS=90`: sensitive keys need an expiry (`expiry_required`) and a fresh step-up via `isExplainingAuthorizer(tx.authz)` stepUp (else MfaRequiredError); system exempt.

   - **modules/identity/src/services/policy.ts**: `updateSecurityPolicy` changes:
     - assertNotElevated;
     - designation change → refuse self-add (`segregation_of_duties`);
     - role must exist;
     - assertCanGrantRole of the break-glass role org-wide;
     - added users must be active members;
     - high alert `break_glass_designation_changed`.
   - **services/roles.ts**: `isReservedRoleKey` (template keys + `portico_` prefix) → `reserved_role_key`; assertNotElevated in createRole/updateRole; cloneRole requirePermission first (P3-6).
   - **services/break-glass.ts**: notify everyone holding identity.user.manage org-wide (P3-4); `reviewElevation` assertHumanApprover.
   - **services/support.ts**: `approveSupportSession` assertHumanApprover.

   - **modules/identity/src/services/sso.ts**
     - `assertSecureUrl(url, field, allowLocal)`.
     - Exported `discoverIssuer(ports, issuer)` and `Discovery`.
     - `configureSso(tx, ports, input, expectedVersion?, discovery?)`; assertNotElevated in configureSso, mappings and enforcement.
     - setSsoEnforcement requires ≥1 active exempt member (`emergency_account_required`).
     - `startSsoLogin` returns `browserBinding` (hash stored).
     - `verifyIdToken` with `requiredClaims: ['exp','iat','sub','nonce']`.
     - `completeSsoLogin(database, ports, {state, code, browserBinding?, ip?, userAgent?})` in three phases:
       - phase 1 tx: consume state, check binding;
       - phase 2 no tx: token exchange + verify;
       - phase 3 tx: `email_verified === true`, domain allowed, link by (issuer, sub); an email mapping to another user → fail; a new link to an existing user with memberships elsewhere requires a verified domain; JIT; activate invited; reconcile; session.
     - Failure audits are `emailFingerprint` only (domain plus hash prefix).
     - New `addSsoDomain(tx, domain)`, `listSsoDomains(tx)`, `verifySsoDomain(database, ctx, ports, domain)` (TXT check outside tx).

   - **PoC tests read** (to convert):
     - zz-review-poc.test.ts:
       - trial admin resets a live GM's password via a simulated link;
       - trial admin strips MFA;
       - createUser adds an existing person as active;
       - grace: org_admin sensitive with password only;
       - SoD via own API client approving a pilot;
       - lower-privileged role assigner revokes org_admin;
       - security officer self-designates break-glass → '*' key;
       - 50 wrong TOTP codes over 10 challenges never locked;
       - createUser initialPassword on a password-less existing user;
       - concurrent replay (keep as a passing test).
     - zz-review-sso-poc.test.ts: an attacker org with the victim domain on its SSO allow-list replaces the victim's TOTP.
     - apps/api zz-review-poc.test.ts: XFF rotation bypasses 429 (main now trusts no proxy by default → should now see 429).
     - kernel zz-review.test.ts: union of grants (fixed on main).

4. Errors and fixes:
   - Merge conflicts in composition.ts and the platform manifest: resolved as instructed.
   - The last-admin check would have broken orgs with no admins (e.g. the wave-0 suspend test). Fixed by refusing only when the change removes the last admin (admins before > 0 and after == 0).
   - sendPasswordResetForMember: the sole-org check initially ran before the membership lookup. Reordered so NotFound comes first.
   - Remaining typecheck errors are expected in routes.ts and test files, which have not been updated yet:
     - enrolTotp, regenerateRecoveryCodes and disableOwnMfa now return Outcome and take proof;
     - acceptInvitation now takes ports;
     - createUser returns status;
     - NotifierResult changed.
   - Earlier phase errors (resolved): wrong test expectations (front_desk includes finance.folio.read; geo test needed ports), optional-chain lint, operatorDirectoryFromConfig export.

5. Problem Solving:
   - The design approach follows ADR-0017 exactly.
   - Breaking changes to existing tests are expected and must be updated:
     - wave-0 identity.test "asks which organization…" (B createUser is now invited → accept via acceptMembershipAsSelf);
     - mfa.test (grace tests, enrol now needs proof/Outcome);
     - roles-lifecycle (removal of the sole admin needs a second admin; invites delivery `simulated` without link → read from h.sent; hr_assistant sensitive needs MFA);
     - sso-scim (email_verified, browserBinding, no PII audit reasons list; the domain test for an existing person);
     - support-security (break-glass designation by another admin; elevation now blocks key issuance);
     - apps/api tests: helpers.ts signedInOrg must enrol TOTP and verify so ⚑ permissions work; enterprise-harness login likewise; identity-enterprise invitation `queued`.
   - Platform still to do:
     - P1-4: responsiblePerson in platform `actorKey` usage (user → `user:id`, api_client with createdBy → `user:<createdBy>`, support → operator) and refusal of API-client approvals in activation, transitions and configuration.
     - P2-5: fail closed when transitionGuard is unbound and a domain is currently `forward`.
     - P2-6: `assertEffectInScope` option `database` to audit the refusal in a separate tx.
     - P2-7: from-trial and trials idempotency via runIdempotent; POST /api-clients must not store the token (return `already_issued` on replay).
     - P2-11: owner audits by field names only.
     - P2-8: advisory lock in activation approval.
     - P3-7: recordStatusChange checks numUpdatedRows.
     - P3-9: broader carry-forward denylist.
     - P3-10: ≤3 active trials per live org.
   - Provisioning: createTrialForOrganization uses `addSelfToOrganization` for the requesting user; operator prospect trials use createUser (invited if existing).

6. All user messages:
   - **Original task message:** engineer for Portico enterprise identity & platform; read the playbook; write scope, worktree, prefix, specs; long list of IDENTITY items 1–7 and PLATFORM items 8–12; update READMEs with honest readiness (SSO fake IdP = R3).
   - **Orchestrator:** merge main, then implement G-01, G-07, G-02, G-06, G-04 (activation scope), with FOUNDATION_REQUESTS for kernel changes; keep platform tests passing.
   - **Orchestrator:** editions.md §7 plans.ts update plus the Connect plan with module packs; no prices.
   - **Orchestrator:** add `platform.getPropertyFacts(tx, propertyId)` (no requirePermission, RLS-scoped, never over HTTP).
   - **Orchestrator checkpoint:** add "## Checkpoint" to both READMEs and commit "wip(identity,platform): checkpoint".
   - **Orchestrator:** usage reset; continue where stopped; remember the follow-ups; Postgres restarted; deliver the final report.
   - **Orchestrator:** after merging main, use kernel `fieldCryptoFromEnv()` for TOTP/SSO secrets instead of a module-specific env var; replace `general_manager: guests.*` with an explicit list (no erasure/document/health-data).
   - **Orchestrator (CURRENT fix round):** the full message summarized in section 1 (P0/P1/P2/P3 fixes per ADR-0017; PoC regressions; rules; final reply format with table, command results, deviations; run `pnpm lint && pnpm typecheck && pnpm test` with PORTICO_TEST_DB_PREFIX=w1_idplus_fix checking exit codes).
   - **Orchestrator update:** "P2-10 is fixed on main in 47c76b9. Kernel staticAuthorizer now unions exact and wildcard grants. After you merge main, adapt the kernel PoC as a passing test or drop it; there's no need to add a pending-fixes entry."
   - **Current instruction:** produce a text-only summary (no tools).

7. Pending Tasks:
   - Update **modules/identity/src/routes.ts** for the new signatures:
     - enrol/disable/regenerate with proof bodies and unwrap Outcome (throw error after tx);
     - acceptInvitation(database, ports, body with password/code/recoveryCode);
     - new routes: GET /v1/me/invitations, POST /v1/me/invitations/:organizationId/accept, SSO domains (POST/GET /v1/sso/domains, POST /v1/sso/domains/:domain/verify), GET /v1/operator/mailbox (operator, disabled in production);
     - /auth/sso/start returns browserBinding; /auth/sso/callback requires browserBinding;
     - PUT /sso does discoverIssuer before the tx;
     - POST /users sends an invitation when status is invited (no link in the response);
     - invitation/reset delivery `{mode}` only;
     - POST /api-clients must not store the token in idempotency (replay → `already_issued`);
     - pass ports to revoke/suspend/remove/reset;
     - P2-1 translator: use scope only when it carries propertyId, and skip when details.scope.reason exists;
     - requireOperator refuses when `config.operatorConsoleEnabled === false` (P2-17).
   - Update **contracts.ts**:
     - mfaGracePeriodHours max 72;
     - delivery mode enum queued/simulated/sandbox;
     - enrol/disable/regenerate request bodies;
     - accept request adds code/recoveryCode;
     - ssoStartResponse browserBinding; ssoCallbackRequest browserBinding;
     - createUser response status;
     - domain schemas;
     - invitations list.
   - Update index.ts exports (readDevMailbox, systemTxtResolver).
   - Update composition bindings and provisioning.ts (addSelfToOrganization for self-requested trials; trial limit P3-10).
   - Platform fixes:
     - P1-4 (responsiblePerson + no API-client approvals) in activation.ts, authority-transitions.ts, configuration.ts;
     - P2-5, P2-6, P2-7, P2-8 lock, P2-11, P3-7, P3-9, P3-10.
   - Update identity manifest description of identity.scim.provision (P2-16: "equivalent to the mapped roles").
   - SCIM: scimCreateUser for an existing global user → invited (no activation); `active=true` on invited stays invited; last-admin/power on SCIM deactivate/delete if cheap.
   - Tests:
     - convert the PoCs into regression tests (refused) in modules/identity/test/zz-review-regressions*.test.ts and apps/api/test (XFF → now 429 with no trusted proxies);
     - drop the kernel PoC (or add an identity test for elevation widening property-scoped perms);
     - add the concurrent replay test;
     - per-table isolation tests (P2-13) where cheap;
     - fix all existing tests;
     - update apps/api/test/helpers.ts signedInOrg to enrol TOTP and verify (keep the signature);
     - enterprise-harness likewise.
   - Docs:
     - README updates (Known gaps for remaining P2/P3 with reasons; withdraw the S17 claim until tests exist; deviations);
     - FOUNDATION_REQUESTS (FR-5 shared safe-fetch; kernel `onBehalfOf`/responsiblePerson field);
     - append owner questions to docs/OPEN_QUESTIONS.md (P3-11: grace/step-up defaults, operator IdP, demo MFA P3-12, 15-min window for desk ⚑ actions).
   - Commit after each meaningful step.
   - Final checks: `pnpm lint && pnpm typecheck && pnpm test` with PORTICO_TEST_DB_PREFIX=w1_idplus_fix (check exit codes); drop leftover w1_idplus_fix* databases.
   - Final reply via SubagentHandback: table of finding id → fix commit → test name; command results; deviations.

8. Current Work:
   I had just finished rewriting modules/identity/src/services/sso.ts:
   - `verifyIdToken` with requiredClaims;
   - the three-phase `completeSsoLogin` with (issuer, sub) binding, `email_verified===true`, domain verification for linking existing people with memberships elsewhere, browserBinding check and fingerprint-only failure audits;
   - `addSsoDomain`, `listSsoDomains`, `verifySsoDomain`.

   The last command, `npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v "^ " | grep -v "routes.ts\|test/"`, returned no errors. So all identity services compile; only routes.ts and the tests remain broken. Nothing since merge commit 53d70bc is committed. All the ADR-0017 work (migration, tables, guard.ts, service.ts, mfa.ts, lifecycle.ts, api-clients.ts, policy.ts, roles.ts, break-glass.ts, support.ts, sso.ts, net/, adapters.ts, ports.ts, step-up.ts and its test) is uncommitted in /home/user/wt/identity-plus.

9. Optional Next Step:
   Update modules/identity/src/routes.ts and contracts.ts for the new service signatures, then compose bindings. Specifically:
   - enrol/disable/regenerate take proof and return Outcome;
   - acceptInvitation takes ports;
   - SSO start/callback carry browserBinding;
   - discoverIssuer runs before the tx in PUT /sso;
   - add the new invitation, domain and mailbox routes;
   - the operator console is disabled in production;
   - API-client idempotency must not store tokens.

   Then commit (e.g. "fix(identity): ADR-0017 credential ownership, consent, MFA proof and SSO identity binding"), and continue with the platform P1-4/P2 fixes and the regression tests. This follows the coordinator's instruction: "Must fix, with the concrete fixes the review gives: P0-1 and P0-2 per ADR-0017 §1–5 … Commit after each meaningful step (Conventional Commits). Do not push."

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /root/.claude/projects/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/subagents/agent-a7776526c1143a346.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.
````

## Follow-up message (2026-11-07T16:15:52.742Z)

````text
The coordinator sent a message while you were working:
Thanks, good round. A second steward review of your branch is running in parallel on a copy; don't wait for it.

Your next task, on feat/identity-platform-enterprise in /home/user/wt/identity-plus: make the full workspace `pnpm test` green after your second merge of main. I'm widening your write scope for this task ONLY to these test files, plus apps/api/test/helpers.ts if needed:
- modules/inventory/test/isolation-permissions.test.ts (×3: data authority for availability now needs an authority transition and a second approver)
- the finance test file `security-and-corrections` (×1)
- operations' `real-inventory` test, R2 (×1)
- apps/api/test/payments.test.ts (×6) and apps/api/test/integration.test.ts (×1): sign in with MFA via signedInOrg / enrolMfa
- the guests `sharing.test` (×1): Professional now includes portfolio.crossPropertyProfiles. Test the "plan lacks it" case with a plan that really lacks it, e.g. Essentials.

Rules:
- Change only what each test must change to reflect the new intended behaviour. Do NOT weaken what a test proves. Where a test asserted something now done through a transition, route it through the transition (request + second approver) rather than deleting the assertion.
- If any failure turns out to be a real bug in your code rather than an intended change, fix your code instead and say so.

When done, run `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force` (PORTICO_TEST_DB_PREFIX=w1_idplus_fix2; Postgres is at 127.0.0.1:5432 again) and check the exit codes. Commit (Conventional Commits), don't push, and reply with the results. Later I may send you findings from the second review.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T16:44:06.830Z)

````text
The coordinator sent a message while you were working:
Second steward review of feat/identity-platform-enterprise: verdict "do not merge".

Good news first: all 11 original identity PoCs, the SSO PoC and the XFF PoC are now refused, and the guard design is sound.

What's left:
- 1 new P0, a pre-hijacking class, plus 3 P1s, 6 P2s and 9 P3s.
- Report (on main): docs/orchestration/reviews/review-identity-plus-2.md
- New attack tests: docs/orchestration/reviews/identity-plus-poc/
  - identity-zz-review2-poc.test.ts.txt has 9 tests that pass today, meaning each attack works.
  - api-zz-review2-poc.test.ts.txt is the HTTP takeover of a new live org's first admin.
  - identity-zz-review2-original.test.ts.txt has the 11 originals, which must keep being refused.

ADR-0017 is amended on main (commit 3056a49, "Amendment 1", rules 12–15). Implement it:
- **R2-P0-1 (rules 12–13):**
  - Remove `initialPassword` from createUser, POST /v1/users and provisioning.
  - New people start credential-less, in `email_unverified`, and set their first password only through an emailed link. That link sets `email_verified_at`.
  - First verification WIPES every earlier credential: password, factors, recovery codes, SSO links and sessions.
  - Invitations are listed and accepted only with a verified email, and expire.
  - Live provisioning must send the first admin a real invitation, never silently leave them `invited`.
  - Demo and test seeding may set passwords only as a system process, in the `demo` environment, for `*.portico.invalid` emails. main's apps/api/src/seed/demo.ts uses `initialPassword` with `@<slug>.demo.portico.invalid` emails, so route that through the new seeding-only path. Test helpers may use a test-only path that is not reachable over HTTP.
- **R2-P1-2 (rule 14):**
  - Whether a person can set a first password depends on their credentials, not their memberships.
  - Never-accepted invitations never block it.
  - A password reset reaches people who only hold invitations.
- **R2-P1-1 (rule 15):**
  - SSO issuer, allow-list, trustIdpMfa and SSO-required are root changes: the editor holds org-wide `*`, or a second admin approves.
  - An issuer change resets domain verification and alerts all admins.
  - No linking of existing credentialed members through a new issuer without their proof.
- **R2-P1-3 (rule 15):**
  - Run the verified-domain check whenever a membership would be created or activated.
  - A refused SSO sign-in persists neither user nor link; failure audits stay in their separate transaction.
  - Purge orphan links.
- **R2-P2:** fix all of these, or justify any you leave.
  - R2-P2-1: make the second-factor counter atomic (the race).
  - R2-P2-2: power ordering in transferMember.
  - R2-P2-3: group reconciliation must not remove the last admin.
  - R2-P2-4: SoD with self-created accounts. This mostly disappears with rule 12; confirm it.
  - R2-P2-5: first admin left invited silently.
  - Cheap P3s.

Turn each new PoC into a regression test that asserts the attack is REFUSED, and keep the 11 originals refused.

When you merge main, note the changes there: chronicle tooling, a demo-seed timeout raise, tools/commit-checked.sh, and the ADR amendment.

Gates (the turbo cache can hide failures):
`pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`
Use PORTICO_TEST_DB_PREFIX=w1_idplus_fix3 and check the exit codes.

Commit (Conventional Commits) and don't push. Reply with finding → commit → test, the command results, and any deviations with reasons. A third, short review will verify before merge.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T17:30:36.017Z)

````text
The coordinator sent a message while you were working:
The third steward review of feat/identity-platform-enterprise says **merge after fixes**. There is no P0. All N-1…N-9 attacks, the HTTP first-admin takeover and the 11 originals are refused. New findings: P1 2 · P2 3 · P3 5.
- Report (on main): docs/orchestration/reviews/review-identity-plus-3.md
- PoCs (on main): docs/orchestration/reviews/identity-plus-poc/identity-zz-review3-poc.test.ts.txt, attacks W-1…W-6. Each passes today because the attack works.

Fix:
- **R3-P1-1 (W-1), race on the first-verification wipe.** A pending authenticator confirmed concurrently survives the wipe.
  - Take the person's row lock BEFORE reading any credential state, in confirmTotp, the SSO sign-in, and every credential write.
  - Add a credential epoch, so the wipe invalidates everything created before it, pending factors included.
  - Hash the password before the transaction.
  - Keep W-1's test-only delay trigger, so the race is deterministic in the regression test.
- **R3-P1-2 (W-2), root changes.** The groups claim name, `jit_provisioning` and `client_id` are root changes too, just like issuer and allow-list.
- **R3-P2-1:** deleting a group mapping needs the same power as creating it.
- **R3-P2-2, domain verification.** It is re-checked on a schedule and expires. Two organizations can't both hold the same domain as an email-verification authority: first verified wins, and a conflict needs Monoclay support. A lapsed verification stops verifying emails.
- **R3-P2-3, SSO-only lockout.** Fix the lockout of SSO-only people at an org that requires SSO but has no verified domain, or make the README honest and give a working recovery path.
- **Cheap P3s:**
  - add tenant predicates to the orphan-link purge SQL, and test it as the app role, not superuser;
  - the backfill must not treat org-set passwords as verified;
  - simulated (non-live) links must not verify emails;
  - record the issuer in the link-start state.

Merge condition (the reviewer's): W-1, W-2 and W-3 must be refused and committed as regression tests. I will spot-check those three myself; there is no fourth full review.

New process on main:
- Run docs/quality/playbooks/module-builder-self-check.md before you report, and include its tables.
- Re-attack each P1 fix once more yourself.
- When you merge main, OPEN_QUESTIONS.md conflicts are append-only, so keep both sides. If your Q146–Q149 collide with anything, keep yours and I'll renumber the other.

Gates:
`pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`
Use PORTICO_TEST_DB_PREFIX=w1_idplus_fix4 and check the exit codes.

Commit and don't push. Reply with finding → commit → test, the self-check tables and the command results.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T17:31:30.717Z)

````text
[Request interrupted by user]
````

## Follow-up message (2026-11-07T17:38:53.430Z)

````text
The coordinator sent a message while you were working:
Resume after the owner's checkpoint. Your tree was clean, since you had just started. Do fix round 4 exactly as briefed:
- R3-P1-1: the wipe race. Take the row lock first, add a credential epoch, and hash outside the transaction.
- R3-P1-2: the groups claim, jit_provisioning and client_id are root changes.
- R3-P2-1, R3-P2-2 and R3-P2-3, plus the cheap P3s.

W-1, W-2 and W-3 become regression tests. Include the self-check tables, use the same gates, and use PORTICO_TEST_DB_PREFIX=w1_idplus_fix4.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T17:56:20.589Z)

````text
The coordinator sent a message while you were working:
Good round. I'm widening your write scope for ONE task: make the staff web app work with this branch's sign-in, so the full gate is green. Allowed:
- apps/backoffice/src/features/auth/**
- the backoffice API client types/contracts it needs
- apps/backoffice/e2e/fixtures.ts, and any e2e spec that signs in

What to build:
1. **Sign-in second step for `mfa_required`.** After the password step, ask for the 6-digit code from the authenticator app. Include a "Use a recovery code instead" link, keyboard-first with an autofocused code field, and staff-language errors: wrong code, too many attempts (show the delay), expired challenge (go back to the password step). Follow the UX consistency rules C7 and C8 in docs/ux/round-1/summary.md. Handle any other login outcomes this branch adds, such as enrolment required or email not verified, with a clear next step rather than a dead end.
2. **e2e and demo.** Run the backoffice Playwright suite: `pnpm --filter @portico/backoffice exec playwright test e2e/smoke.spec.ts --trace off` against the branch merged with main. On default ports, use your own DB via PORTICO_E2E_DB=portico_idplus_e2e, and drop it afterwards. Also fix e2e/fixtures.ts so it uses the config's WEB_PORT instead of a hard-coded 5180.
3. **Demo admins and sensitive permissions.** Your rule says ⚑ permissions never take effect without MFA, so demo admins without MFA might lose them, and the demo and UX lab would break.
   - If they do, use this decision: in **demo-environment organizations only**, the demo seed enrols a TOTP factor for its fictitious `*.portico.invalid` users with a fixed demo secret. The demo CLI prints it beside the demo password, and the e2e fixtures and the UX lab use it.
   - It is never allowed outside the demo environment, and never for a real email. Enforce that the same way as seedDemoMember.
   - Add a test that the seeding refuses outside demo.

Then run `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2` (PORTICO_TEST_DB_PREFIX=w1_idplus_fix5), plus the Playwright run. All exit codes must be 0. Commit, don't push, and reply with the results.

I'm adding the reviewer's clarifying sentence to ADR-0017 rule 15 on main myself.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T18:00:20.565Z)

````text
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

<system-reminder>
<tools-used-before-summary>Bash, Read, SubagentHandback, Write, mcp__claude-code-remote__delete_trigger, mcp__claude-code-remote__send_later</tools-used-before-summary>
</system-reminder>
Summary:
1. Primary Request and Intent:

   **Context and standing rules (apply throughout):**
   - Branch `feat/identity-platform-enterprise`, worktree `/home/user/wt/identity-plus`. I am a subagent; final reports go via SubagentHandback (a single call per task; plain text at the end is not delivered).
   - Commit with Conventional Commits using `git -c commit.gpgsign=false commit`. Never push.
   - Commit trailer:
     ```
     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
     ```
   - Security constraints:
     - No secrets in code, tests, fixtures or logs.
     - Never push.
     - Never drop databases you did not create.
     - Stay in the write scope.
     - Never activate live/production integrations.
     - Tests must not start listeners on ports (module tests).
     - Do not modify packages/kernel, db, http, testing, other modules, CLAUDE.md, or docs outside the module, unless the coordinator explicitly widens scope.
   - Original write scope: `modules/identity/`, `modules/platform/`, `apps/api/src/composition.ts`, `apps/api/src/provisioning.ts`, new tests in `apps/api/test/`.
   - Explicit one-off widenings so far:
     - `docs/OPEN_QUESTIONS.md`.
     - Specific other-module tests (fix round 2).
     - `apps/api/src/seed/demo.ts`.
     - Now the backoffice items listed below.
   - Process on main: run `docs/quality/playbooks/module-builder-self-check.md` (§1 gate block, §2 v1 checklist summary as counts of yes / N/A / no, §3 re-attack table with columns: Finding | Fix commit | Regression test | (a) reverse | (b) siblings | (c) failure path | (d) griefing | (e) atomic) before reporting. Re-attack each P1 fix once more. When merging main, OPEN_QUESTIONS conflicts are append-only (keep both).

   **CURRENT task (latest coordinator message, verbatim essentials):**
   - "Good round. I'm widening your write scope for ONE task: make the staff web app work with this branch's sign-in, so the full gate is green."
   - Allowed:
     - `apps/backoffice/src/features/auth/**`
     - the backoffice API client types/contracts it needs
     - `apps/backoffice/e2e/fixtures.ts`, and any e2e spec that signs in
   - What to build:
     1. **Sign-in second step for `mfa_required`.** After the password step, ask for the 6-digit code from the authenticator app. Include a "Use a recovery code instead" link, keyboard-first with an autofocused code field, and staff-language errors: wrong code, too many attempts (show the delay), expired challenge (go back to the password step). Follow the UX consistency rules C7 and C8 in `docs/ux/round-1/summary.md`. Handle any other login outcomes this branch adds, such as enrolment required or email not verified, with a clear next step rather than a dead end.
     2. **e2e and demo.** Run the backoffice Playwright suite: `pnpm --filter @portico/backoffice exec playwright test e2e/smoke.spec.ts --trace off` against the branch merged with main. On default ports, use your own DB via `PORTICO_E2E_DB=portico_idplus_e2e`, and drop it afterwards. Also fix `e2e/fixtures.ts` so it uses the config's WEB_PORT instead of a hard-coded 5180.
     3. **Demo admins and sensitive permissions.** Your rule says ⚑ permissions never take effect without MFA, so demo admins without MFA might lose them, and the demo and UX lab would break.
        - If they do, use this decision: in **demo-environment organizations only**, the demo seed enrols a TOTP factor for its fictitious `*.portico.invalid` users with a fixed demo secret. The demo CLI prints it beside the demo password, and the e2e fixtures and the UX lab use it.
        - It is never allowed outside the demo environment, and never for a real email. Enforce that the same way as seedDemoMember.
        - Add a test that the seeding refuses outside demo.
   - Then run `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2` (`PORTICO_TEST_DB_PREFIX=w1_idplus_fix5`), plus the Playwright run. All exit codes must be 0. Commit, don't push, and reply with the results.
   - "I'm adding the reviewer's clarifying sentence to ADR-0017 rule 15 on main myself."

2. Key Technical Concepts:
   - Platform and data layer:
     - Fastify modular monolith; Kysely + Postgres RLS (`core.enable_tenant_isolation` forces RLS; policy `tenant_id = core.current_tenant_id()`).
     - `withTenantTx`, `runIdempotent` (returns `replayed`); SECURITY DEFINER functions iterate tenants via `set_config('app.tenant_id', …)`.
   - ADR-0017 plus amendment 1 (rules 12–15):
     - No org-set passwords (`initialPassword` → `password_not_allowed`); `createUser` always invites.
     - First email verification wipes all earlier credentials (password, factors, recovery codes, SSO links, sessions, API keys).
     - Rule 13: in-app invitation listing and acceptance need a verified email and an unexpired invitation.
     - Rule 14: the first-password decision depends on credentials, not memberships.
     - Rule 15: SSO root changes need org-wide `*`.
   - Third review (R3) fixes:
     - `credential_epoch` on users / sessions / mfa_factors / mfa_recovery_codes / mfa_challenges / sso_identities.
     - `identity.lock_person` (row lock first), `assertSessionCurrent`.
     - Login reads the epoch (`credential_epoch_for_email`) before the password hash.
     - Verified-domain registry `identity.verified_domains` (first wins); domain lapse after 30 days unseen; live DNS recheck before a first verification; `ssoDomainRecheckJob(dnsTxt)`.
     - `credential_tokens.delivery_mode` (only `queued` verifies email); `sso_login_states.issuer`.
   - TOTP and second factor:
     - TOTP: HMAC-SHA1, 6 digits, 30 s, drift ±1 step, replay protection via `last_used_step`.
     - Per-person second-factor counter: `reserveSecondFactorAttempt` (atomic guarded UPDATE); 5 failures → 1 min, 10 → 15 min plus alert, 20 → 24 h. `SecondFactorLockedError` is 429 with `details.retryAfter`.
   - Backoffice:
     - React + TanStack Router/Query, i18next (en, ar stub), `@portico/ui` (`Button`, `Field`, `Input`, `ProblemAlert`).
     - Playwright e2e against the real API: API on :4100, Vite on :5180; `PORTICO_E2E_*` env.

3. Files and Code Sections:

   **Committed work (key commits in order):**
   - 6d90f0e, 593f413, 4d6ef49, f3c86ad, c619262, 0c5a2b9, 83df549, 09d010c merge: first fix round.
   - cf913b2: cross-module test adaptations; generic `getDataAuthority` / `setDataAuthority<D extends DataDomain>`.
   - 6f2a737 merge.
   - 8f5b13a (identity amendment 1), 4fe98e6 (api provisioning / demo seed), 3f72a15 (docs).
   - abbd5e9 merge (OPEN_QUESTIONS kept Q146–Q149 plus main's Q150–Q155; lockfile from main plus `pnpm install --no-frozen-lockfile`).
   - 65ed7bd: R3 fixes plus `review3-regressions.test.ts`.
   - 51dbe2d: README.

   **Important current-state code:**
   - `modules/identity/migrations/0002_identity_enterprise.sql`:
     - users: `email_verified_at`, `credential_epoch`; the backfill marks only `*.portico.invalid` as verified.
     - Definer functions: `first_email_verification(p_user_id, p_now)` (increments the epoch; tenant predicates), `lock_person(p_user_id)` returns `(email_verified, credential_epoch)` FOR UPDATE, `credential_epoch_for_email`, `credential_summary`, `purge_orphan_sso_links` (tenant predicates).
     - Registry `identity.verified_domains` with `claim_verified_domain`, `release_verified_domain`, `verified_domain_holder`, `sso_domains_due` (iterates the registry), `record_domain_check`.
   - `modules/identity/src/services/guard.ts`: `lockPerson`, `assertSessionCurrent`, `credentialSummary`, `hasAnyCredential`, `verifyEmailOwnership`, `administratorEmails`, `notifyAdministrators`, `assertRootChange`, plus the earlier guards.
   - `modules/identity/src/services/mfa.ts`:
     - `sameEpoch(userId)` SQL predicate; all flows are lock-first.
     - `confirmTotp` returns an `Outcome` (cap of 5 per pending factor).
     - `createMfaChallenge(tx, { userId, credentialEpoch, ip?, userAgent? })`.
     - `completeMfaChallenge` currently:
       ```ts
       if (!c || c.consumed_at || c.expires_at <= tx.now || c.attempts >= MFA_MAX_ATTEMPTS) return { ok: false as const };
       const person = await lockPerson(tx, c.user_id);
       if (person.epoch !== c.credential_epoch) return { ok: false as const };
       const lock = await reserveSecondFactorAttempt(tx, c.user_id);
       if (lock) return { ok: false as const, lock };
       const method = await verifySecondFactor(tx, ports, c.user_id, input);
       if (!method) { /* attempts+1, recordSecondFactorFailure, audit */ return { ok: false as const }; }
       ...
       if (!outcome.ok) {
         if ('lock' in outcome && outcome.lock) throw new SecondFactorLockedError(outcome.lock);
         throw new UnauthenticatedError(CHALLENGE_ERROR);
       }
       ```
       `CHALLENGE_ERROR = 'The verification code is not valid or has expired. Sign in again to get a new challenge.'`
   - `modules/identity/src/services/lifecycle.ts`:
     - `createUser(tx, input, ports)` (always invited, refuses `initialPassword`).
     - `seedDemoMember(tx, input & { password })` with guards: `tx.actor.kind === 'system'`, `tx.environment === 'demo'`, domain `portico.invalid` or `endsWith('.portico.invalid')`, else `ValidationError('password_not_allowed', ...)`.
     - `acceptInvitation`: pre-hashes the password; `lockPerson`; verifies only if `t.delivery_mode === 'queued'`.
     - Also: `listMyInvitations`, `acceptMembershipAsSelf`, `recordDelivery`.
   - `modules/identity/src/services/sso.ts`:
     - Root-change detection compares every field except `display_name` / secret (`next` object).
     - `setGroupRoleMappings` checks removed mappings.
     - `startSsoLink(database, ports, ctx, organizationId?)`.
     - Phase 3: lock-first, epoch-aware link lookup, `domainVerifiedHere`, `recheckDomainBeforeFirstVerification`.
     - `ssoDomainRecheckJob(dnsTxt)`; `DOMAIN_RECHECK_DAYS = 30`; `SsoRefusal` class.
   - `modules/identity/src/service.ts`: login reads the epoch first, then `lockPerson` and an epoch compare; `authenticateToken` rejects sessions whose epoch is not current; `createApiClient` locks the creator only when `tx.actor.sessionId && !impersonatedBy`.
   - `modules/identity/src/services/sessions.ts`: `createSession` requires `credentialEpoch`.
   - `modules/identity/src/routes.ts`: `POST /me/sso/link` with body `{ organizationId? }`; `confirmTotp` unwrapped; `POST /users` → `svc.createUser(tx, req.body, ports)`.
   - `apps/api/src/composition.ts`: registers `ssoDomainRecheckJob(systemTxtResolver)`; identity ports config. The SSO redirect default is `${appBaseUrl}/auth/sso/callback` (considering changing it to `/sign-in` for the SPA SSO return — undecided).
   - `apps/api/src/provisioning.ts`:
     - `provisionOrganization(database, input, operator, ports)` requires `ports.notifier` unless `admin.password` (demo seeding via `seedDemoMember`).
     - Returns `{ tenantId, adminUserId, adminStatus, delivery? }`.
     - `createTrialForOrganization` refuses `via === 'elevation'`.
   - `apps/api/src/seed/demo.ts`: staff via `identity.seedDemoMember`; `DEMO_PASSWORD = 'portico-demo-2026'`; emails `…@<slug>.demo.portico.invalid`.
   - `apps/api/src/seed/demo-cli.ts`: prints the users and "Password for all demo users"; needs to print the demo TOTP secret.
   - `apps/api/test/helpers.ts`: `enrolMfa`, `invitationTokenFor` (dev mailbox or outbox decrypt with `fieldCryptoFromEnv({}).cipher`), `acceptInvitationOverHttp`, `provisionWithAdmin`; `signedInOrg` uses `provisionWithAdmin` + `enrolMfa`.
   - `apps/api/test/enterprise-harness.ts`: `login` handles `mfa_required` with a stored authenticator; `loginWithMfa`.

   **Backoffice files read for the current task (to modify):**
   - `apps/backoffice/playwright.config.ts`:
     - `DB = process.env.PORTICO_E2E_DB ?? 'portico_w1_ui'`.
     - `API_PORT` default 4100, `WEB_PORT` default 5180; `E2E_ENV` (DATABASE_URL, APP_DATABASE_URL `postgres://portico_app:portico_app_dev@127.0.0.1:5432/${DB}`).
     - `webServer` runs the API with `NODE_ENV: 'development'` and Vite.
     - Not currently exporting WEB_PORT — fixtures need it (export it or read env).
   - `apps/backoffice/e2e/fixtures.ts`:
     - Constants `DIRECTOR = 'group.director@demo-azure-atoll.demo.portico.invalid'`, `FRONT_DESK = 'front.desk.agent@…'`, `PASSWORD = 'portico-demo-2026'`, `DEMO_ORG = 'Azure Atoll Collection (demo)'`, `TRAINING_ORG = 'Azure Atoll Collection (training)'`.
     - `apiSignIn` logs in twice (select org, then with `organizationId`) and assumes a token.
     - Worker fixtures use hard-coded `baseURL: 'http://127.0.0.1:5180'` → must use WEB_PORT.
     - `startSignedIn` injects sessionStorage `portico.session.v1`.
   - `apps/backoffice/e2e/global-setup.ts`: runs `pnpm --filter @portico/api migrate` and `pnpm exec tsx scripts/seed-dev.ts` with E2E_ENV.
   - `apps/backoffice/scripts/seed-dev.ts`: runs `seed:demo` if the director can't log in; creates the training org via `provisionOrganization(... admin: { email: GROUP_DIRECTOR, displayName: 'Group Director' }, 'backoffice-seed')`. This will now FAIL (`notifier_required`, and the director would only be invited). Plan: use `platform.provisionOrganization` + `identity.seedSystemRoles` + `identity.addSelfToOrganization(tx, { userId, displayName, roleKey: 'org_admin' })` under a system actor.
   - `apps/backoffice/e2e/smoke.spec.ts`: UI sign-in tests ("signs in with organization selection…", "P0-1 … next person" signs in DIRECTOR then FRONT_DESK, "wrong password …") need a code step if demo users have TOTP; other tests use `startSignedIn(page, demo)`.
   - `apps/backoffice/src/features/auth/sign-in-page.tsx`: the `SignInPage` with the `login` mutation; `onSuccess` handles `select_organization`, else sets `sessionStore` with `data.token` etc. TS errors occur because `data` may be `mfa_required`. Uses `Field`, `Input`, `ProblemAlert`, `Button`, `t('signIn.*')`, `EnvironmentChip`.
   - `apps/backoffice/src/api/endpoints.ts`:
     - `login` → POST `/auth/login`, schema `loginResponse`, `expectUnauthenticated: true`.
     - No MFA challenge endpoint yet: add `loginMfa` (POST `/auth/login/mfa`, body `{ challengeToken, code? | recoveryCode? }`, schema = signed-in variant `loginResponse.options[0]`); perhaps `ssoStart`.
     - `createUser` schema `{ userId }`.
   - `apps/backoffice/src/api/errors.ts`: `ApiError`, `problemFromUnknown` (403 → generic "You don't have access"); consider staff-language mapping for `mfa_required` / `mfa_enrollment_required` codes.
   - `apps/backoffice/src/i18n/en.ts` `signIn` keys (title, wrongCredentials, wrongCredentialsDetail, subtitle, email, password, submit, chooseOrganization, chooseOrganizationHelp, continue, back, sessionExpired, signedOut, environmentHint, footer); `ar.ts` is a `DeepPartial` stub.
   - `apps/backoffice/src/app/router.tsx` (out of scope) defines the `/sign-in` route.
   - `apps/backoffice/src/features/admin/users-page.tsx` (out of scope) still has an `initialPassword` field → server refuses `password_not_allowed` if filled; report as follow-up.
   - `docs/ux/round-1/summary.md` C7 Messages (success says what happened and what's next; errors say what happened, why, what to do, ideally a button; inline validation; small support reference; uncertain outcomes as pending verification; no retry boilerplate) and C8 Language (staff glossary words; CI fails on developer terms; not-yet-available features stated plainly in non-live environments only).
   - API test files using `seedDemo` directly: `apps/api/test/rates.test.ts` (logs in demo org_admin with DEMO_PASSWORD expecting a token), `inventory.test.ts`, `demo-seed.test.ts` (logs in front desk, expects `signed_in`) — demo TOTP must stay optional (default off) so these stay green.

4. Errors and fixes:
   - Round 2 (cross-module tests):
     - Inventory, finance and operations tests failed with `second_approval_required` → routed through authority transitions.
     - payments/integration API tests failed for lack of MFA → `enrolMfa`.
     - guests sharing test → plan 'connect'.
   - Forced typecheck revealed a real bug: platform's 10-domain DataAuthority was not assignable to integration's 9-domain type → made the platform functions generic (fixed in my code, not in integration's test).
   - The demo-seed test timed out under default turbo concurrency (load); main later raised its budget to 120 s.
   - Round 3:
     - test clock advances broke fake-IdP JWT times → reordered SSO tests before clock moves.
     - `identity.test` notifier returned 'simulated' → changed to 'queued' for live (needed for verification).
     - `createApiClient` `lockPerson` failed for testContext fake user actors → lock only when `actor.sessionId` exists.
     - The README edit script assertion mismatch → re-ran with the correct anchor.
     - `sso_domains_due` iterated `user_tenants` (orgs without members were missed) → iterate the `verified_domains` registry.
     - `ScheduledJob.run(database, now)` signature → used `now`.
   - Round 4 gate: the backoffice typecheck fails (`sign-in-page.tsx(56,21)/(58,22)` TS2339 — `token` / `userId` don't exist on the `mfa_required` variant) → this is the current task.

5. Problem Solving:
   - All review-1, review-2 and review-3 attacks are refused with regression tests:
     - `review-regressions.test.ts`, `review-sso-regressions.test.ts`, `review2-regressions.test.ts`, `review2-original-attacks.test.ts` (identity);
     - `review3-regressions.test.ts` (12 tests incl. W-1 with the pg_sleep trigger; the W-1 refusal code is `unauthenticated`);
     - `isolation.test.ts`;
     - platform `review-regressions.test.ts`;
     - apps/api `review-regressions.test.ts`.
   - Last gate results (fix4): lint 0; typecheck 17/18 (backoffice fails); tests 16/16 pass at both concurrency 2 and default.
   - Planned TOTP handling in e2e:
     - A per-email `lastStep` tracker; allowed steps are now−1, now, now+1, each strictly greater than the last used step.
     - Wait when exhausted (each user's factor has its own replay state).

6. All user messages:
   - Coordinator messages arrived as "The coordinator sent a message while you were working: …" or as direct turns. Earlier ones (pre-summary) covered the original task, merges, plans, `getPropertyFacts`, checkpoints and the first fix round (full detail in the earlier summary).
   - Message: "Thanks, good round. A second steward review of your branch is running in parallel on a copy; don't wait for it."
     - Task: on feat/identity-platform-enterprise in /home/user/wt/identity-plus, make the full workspace `pnpm test` green after the second merge of main.
     - Write scope widened for this task ONLY to:
       - `modules/inventory/test/isolation-permissions.test.ts` (×3);
       - finance `security-and-corrections` (×1);
       - operations `real-inventory` R2 (×1);
       - `apps/api/test/payments.test.ts` (×6) and `apps/api/test/integration.test.ts` (×1), signing in with MFA via signedInOrg / enrolMfa;
       - guests `sharing.test` (×1): test the "plan lacks it" case with a plan that really lacks it, e.g. Essentials;
       - plus `apps/api/test/helpers.ts` if needed.
     - Rules: "Change only what each test must change to reflect the new intended behaviour. Do NOT weaken what a test proves. Where a test asserted something now done through a transition, route it through the transition (request + second approver) rather than deleting the assertion. If any failure turns out to be a real bug in your code rather than an intended change, fix your code instead and say so."
     - Run `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force` with PORTICO_TEST_DB_PREFIX=w1_idplus_fix2 (Postgres at 127.0.0.1:5432 again) and check exit codes. Commit, don't push, reply with results.
   - Message: second steward review verdict "do not merge" (1 new P0 pre-hijacking, 3 P1, 6 P2, 9 P3).
     - Report: docs/orchestration/reviews/review-identity-plus-2.md. PoCs: docs/orchestration/reviews/identity-plus-poc/ (`identity-zz-review2-poc.test.ts.txt` = 9 working attacks; `api-zz-review2-poc.test.ts.txt` = HTTP first-admin takeover; `identity-zz-review2-original.test.ts.txt` = 11 originals that must keep being refused).
     - ADR-0017 amended on main (3056a49, "Amendment 1", rules 12–15); implement R2-P0-1 (rules 12–13), R2-P1-2 (rule 14), R2-P1-1 (rule 15), R2-P1-3, R2-P2 (P2-1…P2-5, cheap P3s).
     - "Demo and test seeding may set passwords only as a system process, in the `demo` environment, for `*.portico.invalid` emails… Test helpers may use a test-only path that is not reachable over HTTP."
     - Turn each new PoC into a regression test that asserts refusal; keep the 11 originals refused.
     - Gates: `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`, PORTICO_TEST_DB_PREFIX=w1_idplus_fix3. Commit, don't push; reply with finding → commit → test, command results, deviations.
   - Message: third review "merge after fixes" (no P0; P1 2, P2 3, P3 5).
     - Report: docs/orchestration/reviews/review-identity-plus-3.md; PoCs `identity-zz-review3-poc.test.ts.txt` (W-1…W-6).
     - Fix:
       - R3-P1-1 (W-1): take the person's row lock BEFORE reading credential state in confirmTotp, SSO sign-in and every credential write; add a credential epoch; hash the password before the transaction; keep W-1's test-only delay trigger.
       - R3-P1-2 (W-2): groups claim name, `jit_provisioning` and `client_id` are root changes.
       - R3-P2-1: deleting a mapping needs the same power as creating it.
       - R3-P2-2: domain verification re-checked on a schedule and expires; two orgs can't both hold a domain (first verified wins; a conflict needs Monoclay support); a lapsed verification stops verifying emails.
       - R3-P2-3: fix the SSO-only lockout, or make the README honest and give a working recovery path.
       - Cheap P3s: tenant predicates in the orphan-link purge (tested as the app role, not superuser); the backfill must not treat org-set passwords as verified; simulated links must not verify emails; record the issuer in the link-start state.
     - Merge condition: W-1, W-2 and W-3 refused and committed as regression tests.
     - Process: run `docs/quality/playbooks/module-builder-self-check.md` and include its tables; re-attack each P1 fix once more; OPEN_QUESTIONS conflicts are append-only (keep both; "If your Q146–Q149 collide with anything, keep yours and I'll renumber the other").
     - Gates as above with PORTICO_TEST_DB_PREFIX=w1_idplus_fix4. Commit and don't push; reply with finding → commit → test, the self-check tables and the command results.
   - Message (after an interruption): "Resume after the owner's checkpoint. Your tree was clean, since you had just started. Do fix round 4 exactly as briefed…" — restated the R3 fixes, W-1/W-2/W-3 as regression tests, self-check tables, same gates, PORTICO_TEST_DB_PREFIX=w1_idplus_fix4.
   - Latest message: the backoffice sign-in task (full text in section 1).
   - The current turn is the summary instruction: TEXT ONLY, no tools.

7. Pending Tasks:
   - **Server (identity):** make `completeMfaChallenge` distinguish failures:
     - Expired, consumed, exhausted or stale-epoch challenge → 401 with `details.reason: 'challenge_expired'`.
     - Wrong code → `details.reason: 'invalid_code'` plus `attemptsRemaining`.
     - Keep the `code: 'unauthenticated'` that existing tests expect, using `new DomainError('unauthenticated', msg, { status: 401, details })`.
     - Locked → 429 `second_factor_locked` with `details.retryAfter` (already).
   - **Identity demo TOTP seeding:** add a function (e.g. `seedDemoTotp(tx, ports, { userId, secret })`) with seedDemoMember's guards (system actor, `demo` environment, `*.portico.invalid`).
     - It inserts an active `mfa_factor` with the encrypted secret and the current `credential_epoch` (uses `ports.cipher`).
     - Identity test that it refuses outside demo, refuses real emails, and refuses non-system actors.
   - **apps/api `seed/demo.ts`:**
     - Export `DEMO_TOTP_SECRET` (base32 letters, e.g. `'PORTICODEMOTOTPSECRETKEYDEMOABCD'`).
     - A `seedDemo` option to enrol MFA, default off so rates/inventory/demo-seed tests keep working.
     - `demo-cli.ts` enables it and prints the secret beside the password.
     - Needs a cipher in the seed path (`fieldCryptoFromEnv`).
   - **`apps/backoffice/scripts/seed-dev.ts`:**
     - Create the training org without `provisionOrganization`'s notifier requirement (`platform.provisionOrganization` + `identity.seedSystemRoles` + `identity.addSelfToOrganization` under a system ctx).
     - Ensure the demo seed runs with MFA (the CLI path).
   - **`apps/backoffice/e2e/fixtures.ts`:**
     - Use the config's WEB_PORT (export it from `playwright.config.ts` or read `PORTICO_E2E_WEB_PORT`).
     - Add TOTP code generation from `DEMO_TOTP_SECRET` with per-email step tracking.
     - `apiSignIn` handles `mfa_required` via POST `/v1/auth/login/mfa`.
     - Export a UI helper to enter the code.
   - **`e2e/smoke.spec.ts`:** UI sign-in tests enter the code at the new step.
   - **Backoffice sign-in UI** (`src/features/auth/sign-in-page.tsx`, plus maybe new components in `features/auth`):
     - Second step with an autofocused 6-digit code input (`inputMode="numeric"`, `autoComplete="one-time-code"`).
     - "Use a recovery code instead" toggle.
     - Staff-language errors: wrong code with remaining attempts; locked showing the time until retry; expired → back to the password step with an info message.
     - `sso_required` → clear next step.
     - i18n keys in `en.ts` (optionally `ar.ts`).
   - **Backoffice API client** (`src/api/endpoints.ts`): add `loginMfa`; possibly improve `problemFromUnknown` for 403 `mfa_required` / `mfa_enrollment_required` with next steps.
   - **Verification:**
     - Run the Playwright suite (`PORTICO_E2E_DB=portico_idplus_e2e` on default ports) and drop that DB afterwards (I created it).
     - Run the gates with `PORTICO_TEST_DB_PREFIX=w1_idplus_fix5`; all exit codes 0.
     - Lint (biome) and backoffice typecheck/unit tests.
   - **Wrap-up:**
     - Commit (Conventional Commits plus trailers), don't push.
     - Report via SubagentHandback with results; note the follow-up that `features/admin/users-page.tsx` still offers `initialPassword` (out of scope).

8. Current Work:
   - I was exploring the backoffice for the sign-in MFA task. I had just read `completeMfaChallenge` in `modules/identity/src/services/mfa.ts` intending to add failure reasons.
   - The plan was to replace the generic failures with reasoned ones. Inside the transaction:
     - return `{ ok: false, reason: 'challenge_expired' }` for a missing, consumed, expired, exhausted or stale-epoch challenge;
     - return `{ ok: false, reason: 'invalid_code', attemptsRemaining: MFA_MAX_ATTEMPTS - (c.attempts + 1) }` on a wrong code.
   - After the transaction:
     ```ts
     throw new DomainError('unauthenticated', reason === 'invalid_code'
       ? 'That code is not right. Check the 6-digit code in your authenticator app and try again.'
       : 'This sign-in has expired. Enter your password again to get a new code request.',
       { status: 401, details: { reason, ...(attemptsRemaining !== undefined ? { attemptsRemaining } : {}) } });
     ```
   - Then build the backoffice code step, demo TOTP seeding, the e2e fixture changes, the seed-dev training org fix, and run Playwright and the gates.
   - Branch HEAD is 51dbe2d (after merge abbd5e9); the tree is clean.

9. Optional Next Step:
   - Implement the reasoned MFA-challenge failures in `modules/identity/src/services/mfa.ts`.
   - Then the demo TOTP seeding (identity function with seedDemoMember-style guards plus its refusal test; `seed/demo.ts` option; CLI print).
   - Then the backoffice sign-in second step and API client `loginMfa`, `fixtures.ts` (WEB_PORT plus TOTP), `seed-dev.ts`, and smoke spec sign-ins.
   - Then run Playwright with `PORTICO_E2E_DB=portico_idplus_e2e` (dropping it afterwards) and the gates with `PORTICO_TEST_DB_PREFIX=w1_idplus_fix5`.
   - This is per the coordinator's latest instruction: "make the staff web app work with this branch's sign-in, so the full gate is green… 1. Sign-in second step for `mfa_required` … 2. e2e and demo … 3. Demo admins and sensitive permissions … Then run `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2` (PORTICO_TEST_DB_PREFIX=w1_idplus_fix5), plus the Playwright run. All exit codes must be 0. Commit, don't push, and reply with the results."

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /root/.claude/projects/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/subagents/agent-a7776526c1143a346.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.
````

## Report (2026-11-07T11:24:15.114Z)

````text
All the identity and platform work you asked for is built, including every follow-up you sent mid-task. All tests pass across the workspace (identity 75, platform 56, api 21, plus kernel, db and http), and `pnpm lint` (with the boundary check) and `pnpm typecheck` are clean. Branch `feat/identity-platform-enterprise` in /home/user/wt/identity-plus is merged with current main. Everything is committed, nothing is pushed, and I dropped my leftover test databases.

**Identity — built and tested internally (R3):**
- **MFA:** TOTP enrolment with encrypted secrets, codes that can't be reused, 10 single-use recovery codes, and a second-factor step at sign-in for enrolled users. WebAuthn is documented as LATER.
- **Step-up, enforced centrally:** the authorizer refuses sensitive permissions without a recent MFA check (15 min by default). There is a 72-hour enrolment grace for new members, which keeps existing and other teams' password-only API tests working.
  - The HTTP layer returns a distinct `mfa_required` / `mfa_enrollment_required` problem. This is tested on a platform route.
  - Until the kernel change in FR-2 lands, this is done by one `onSend` hook that rewrites the response.
- **SSO (OIDC with PKCE):** secrets go through the SecretStore port, with email-domain allow-list, group → role mapping, JIT provisioning, "SSO required" with protection against locking everyone out, and MFA reported by the identity provider. It is tested only against an in-process fake provider, so R3 at most. SAML is LATER and will use the same role mapping.
- **SCIM:** Users and Groups, with group membership driving roles.
- **Roles and staff:** custom roles validated against the permission catalog; no self-grant and no granting permissions you don't hold. Also invitations, password reset that signs the person out in every organization, transfers, time-limited roles, session list/revoke, and removal.
- **Operator access:** time-boxed support sessions that the customer approves and can see, with a request log and a support marker on every audit record. Operators sign in with token hashes from configuration, to be replaced by AWS IAM Identity Center.
- **Emergency access and alerts:** break-glass access, and security alerts for repeated failed logins from one IP, new-country sign-in and mass exports.
- **Also added:** `GET /v1/permissions` and API-client issue/list/revoke routes.

**Platform — built and tested internally (R3):**
- Owners and unit ownership shares (never above 100 %, no bank data), outlets, and configuration bundles with a preview step, rollout groups and second-person approval.
- Trials: create, reset, export, close, and copy configuration back to the live organization.
- Property activation needs approval by a different person, with versioned pilot/production scopes.

**Your follow-ups:**
- **Data authority:** G-01, G-02 (append-only history; planned/frozen/effective transitions), G-06, G-07, plus a second approver for money domains and the G-04 scope check `assertEffectInScope`.
- **Editions:** `plans.ts` follows editions §7, with the Connect plan and module packs.
- **Other:** `getPropertyFacts` added; field encryption now uses the kernel's `fieldCryptoFromEnv`; the general manager role has an explicit guest-permission list.

**Behaviour changes other teams will notice:**
- `updateProperty` now refuses status changes and points to the activation workflow.
- `setDataAuthority` rejects external + exclusive, and the money/availability domains now require an authority transition.
- `assignRole` refuses self-grants and permission escalation.
- Login can now return `mfa_required`.

**Needs binding at merge:** platform's trial-reset participants, activation checks and pending-change guard are empty or unbound. Nothing delivers live staff email yet, and the GeoIP binding is a placeholder that knows no countries.

**Risks:** there are no `docs/parity/identity.md` or `platform.md` files (outside my scope), so the parity gate cannot pass. FOUNDATION_REQUESTS.md in both modules covers the operator actor type, `requirePermission` explaining MFA denials, `jose` in the catalog, and a kernel hook for the scope check.
````

## Report (2026-11-07T12:36:37.176Z)

````text
## Fix round: feat/identity-platform-enterprise
Worktree: /home/user/wt/identity-plus. All work is committed locally; nothing is pushed.

**Status:** both P0 takeover paths are closed. Every proof-of-concept attack from the review is now a regression test that asserts the attack is refused, and all of those pass.

**But `pnpm test` is red.** I merged main a second time (main had moved on with finance, reservations, operations, rates, integration and payments). After that merge, 13 tests in other modules fail. All of them are behaviour changes the review already listed in §5 for module owners to adapt, and all are outside my write scope, so I did not touch them (detail under Command results).

### Commits
| Commit | What |
|---|---|
| 6d90f0e | fix(identity): ADR-0017 credential ownership, consent, MFA proof and SSO identity binding |
| 593f413 | fix(platform): SoD compares people, fail-closed transitions, durable refusal audits (also composition and provisioning) |
| 4d6ef49 | test(identity): existing suites adapted to ADR-0017 |
| f3c86ad | test(identity,platform): PoC attacks turned into regression tests |
| c619262 | test(api): HTTP regressions; test admins enrol MFA |
| 0c5a2b9 | test(identity): per-table isolation (P2-13) |
| 83df549 | docs: READMEs, foundation requests, owner questions |
| 09d010c | merge main (second time) |

### Finding → fix commit → test
Test files referred to below:
- Identity regressions: `modules/identity/test/review-regressions.test.ts`
- SSO regressions: `modules/identity/test/review-sso-regressions.test.ts`
- Platform regressions: `modules/platform/test/review-regressions.test.ts`
- API regressions: `apps/api/test/review-regressions.test.ts`

| Finding | Fix | Test |
|---|---|---|
| P0-1 | 6d90f0e (+593f413 provisioning) | Identity regressions, "P0-1": path A (trial admin reset), path B (initialPassword), createUser consent, invitation link cannot set a password. API regressions: "adding an existing person creates an invitation…", "simulated messages … operator mailbox" |
| P0-2 | 6d90f0e | Identity regressions, "P0-2" ×2. SSO regressions, "P0-2b": no verified domain; verified domain still cannot change global MFA |
| P1-1 | 53d70bc (manifest) + 6d90f0e (step-up.ts wording) | apps/api permission-catalog.test passes |
| P1-2 | 6d90f0e | Identity regressions "P1-2". mfa.test "an unenrolled member never has sensitive permissions…" and "caps the grace at 72 hours and anchors it…". permissions.test grace test |
| P1-3 | 6d90f0e | Identity regressions "P1-3" ×3 (forbidden keys and expiry, step-up at issuance, revoked on suspension and on password reset) |
| P1-4 | 593f413 + 6d90f0e | Identity regressions "P1-4". Platform regressions "activation: …" and "authority transitions: …" |
| P1-5 | 6d90f0e | Identity regressions "P1-5" ×3, including the adapted kernel PoC: "emergency access widens permissions…" |
| P1-6 | 6d90f0e | Identity regressions "P1-6" ×2 (power ordering, last administrator) |
| P1-7 | 6d90f0e (per-person counter); proxy part done on main | Identity regressions "P1-7"; API regressions "rotating X-Forwarded-For…" |
| P1-8 | 6d90f0e | SSO regressions "P1-8" ×2 |
| P2-1 | 6d90f0e (interim: hook passes only propertyId and skips `reason`) | No dedicated test |
| P2-2 | 6d90f0e + 593f413 (composition) | src/net/address-policy.test.ts ×3; SSO regressions "P2-2" |
| P2-3 | 6d90f0e | sso-scim "refuses foreign domains…" (binding-mismatch case) |
| P2-4 (partly) | 6d90f0e | sso-scim "SSO required…" (emergency_account_required) |
| P2-5 | 593f413 | Platform regressions "P2-5" |
| P2-6 | 593f413 | Platform regressions "P2-6" |
| P2-7 | 6d90f0e (api-clients, no links) + 593f413 (trials, from-trial) | identity-enterprise SCIM test (`already_issued`; stored body holds no token); API regressions (trial replay) |
| P2-8 | 593f413 (advisory lock) + f3c86ad (creation cap) | No concurrency test (listed in Known gaps) |
| P2-10 | on main (47c76b9) | Kernel PoC adapted as identity test (see P1-5) |
| P2-11 | 593f413 | Platform regressions "P2-11" |
| P2-13 | 0c5a2b9, f3c86ad | test/isolation.test.ts; identity regressions "P2-13: concurrent replay" |
| P2-14 | 6d90f0e | Identity regressions "P2-14"; identity-enterprise invite returns `queued` |
| P2-15 | 6d90f0e | Identity regressions "P2-15" |
| P2-16 | 6d90f0e | Catalog description only |
| P2-17 | 6d90f0e + 593f413 | API regressions "refuses operator tokens when NODE_ENV=production" |
| P3-1 to P3-6 | 6d90f0e | P3-5: sso-scim audit assertion (no emails). Others have no dedicated test |
| P3-7, P3-9, P3-10 | 593f413 | P3-9: platform domain.test; P3-10: API regressions trial limit |
| P3-11, P3-12 | 83df549 | docs/OPEN_QUESTIONS.md Q146–Q149 |
| P2-9, P2-12 | Not done | Platform and identity README "Known gaps", with reasons |

### Command results
All run with `PORTICO_TEST_DB_PREFIX=w1_idplus_fix`, checking exit codes.
- **Before the second merge:** lint 0, typecheck 0, test 1. The only failure was 3 tests in inventory's `isolation-permissions.test.ts` (setDataAuthority for `availability` now needs a second approver, review §5).
- **After the second merge (09d010c):** lint 0, typecheck 0, test 1 (run with `--continue`).
  - Passing: identity 105/105, platform 62/62, reservations, integration, payments, rates, kernel, db, http.
  - 13 failing tests, all in files other modules own:
    - **Data authority needs a second approver** (setDataAuthority for availability/charges now asks for an authority transition):
      - inventory `isolation-permissions` ×3
      - finance `security-and-corrections` ×1
      - operations `real-inventory` R2 ×1
    - **Sensitive permissions now need MFA** (the test logs in with a password only and no MFA):
      - apps/api `payments.test` ×6
      - apps/api `integration.test` ×1
      - Fix: use `signedInOrg` / `enrolMfa` from `apps/api/test/helpers.ts`.
    - **Professional plan now includes `portfolio.crossPropertyProfiles`:**
      - guests `sharing.test` ×1 (it assumes Professional lacks it)
      - This comes from the earlier editions.md §7 plans update, not this fix round.
- I dropped my leftover database `w1_idplus_fix_ed2e02dc99`; no `w1_idplus_fix*` databases remain.

### Deliberately done differently from the review
1. **P3-8:** the refusal message still says "This person also works for another organization", because ADR-0017 "Consequences" prescribes that wording. It never names the other organization.
2. **P2-8:** creation keeps a setup cap (properties that are not inactive, up to `limits.properties`) rather than counting only pilot + active. This keeps main's wave-0 test passing and stops unlimited setup properties. PLT-R10 is enforced at activation under a tenant advisory lock.
3. **P1-4:** I did both options: compare the responsible person, and refuse approvals by API clients, system processes and support sessions. `requested_by`, `planned_by` and `prepared_by` now store the responsible person; the audit log still records the actual principal.
4. **P2-6:** `assertEffectInScope` takes an optional `database`, so callers that record a "blocked" outcome and commit keep the old in-transaction behaviour.
5. **SSO JIT:** with a DNS-verified domain, the person's own SSO sign-in activates their membership; I treat that sign-in as their acceptance under ADR §2/§5. SCIM never activates someone who also works elsewhere. SCIM deprovisioning is not power-ordered (the IdP acts for the organization, P2-16) but is last-admin protected.
6. **P2-1 and P2-4 are partial:** the `onSend` translator stays until kernel FR-2. SSO-required gets only the "at least 1 exempt account" rule — no test sign-in before saving a changed connection, and no operator recovery runbook.
7. **Kernel PoC:** packages/kernel is outside my scope, so I re-expressed it as an identity test (elevation widens a property-scoped grant).
8. **Owner questions are numbered Q146–Q149**, because main now uses Q140–Q145.
9. **Additions not in the review:**
   - `POST /v1/me/mfa/disable`, an alias of `DELETE /v1/me/mfa` for clients that cannot send a body with DELETE.
   - `identity.apiClient.manage` is itself sensitive, so the step-up check at key issuance is a second layer of the same protection.
   - Test admins enrol MFA instead of a weakened policy.
   - A shared fake IdP helper at `modules/identity/test/fake-idp.ts`.
10. **Merge fix in composition:** platform's data-authority answers are narrowed to integration's 9-domain enum, because integration's enum lacks `guestCommunications` (review §5).

### For the orchestrator
- **Foundation requests:**
  - identity FR-5: one shared SSRF-safe outbound client; identity currently carries a copy of integration's `address-policy`.
  - identity FR-6 / platform FR-3: `responsiblePerson` and `assertHumanApprover` in the kernel.
  - platform FR-4: durable refusal audits.
- **Launch-gate items (owners and SLAs missing):**
  - support-led credential recovery for a person who lost every factor;
  - recovery of an organization that lost every administrator;
  - operator console identity (Q147).

````

## Report (2026-11-07T16:26:10.251Z)

````text
## Making `pnpm test` green after the second merge — feat/identity-platform-enterprise
**Status: almost green.** Lint and typecheck pass. All 13 previously failing tests now pass.
- `pnpm turbo run test --force` failed 2 of 3 times, and both times the only failure was one test timing out: `apps/api/test/demo-seed.test.ts`.
- With the repository's own setting (`--concurrency=2`, which `pnpm test` uses) the whole suite passes: 14/14 packages.
- Work is in commit cf913b2. Nothing pushed. No `w1_idplus_fix2*` databases are left.

### Command results (PORTICO_TEST_DB_PREFIX=w1_idplus_fix2)
| Command | Exit code |
|---|---|
| `pnpm lint` | 0 (625 files; module boundaries OK) |
| `pnpm turbo run typecheck --force` | 0 (16/16) |
| `pnpm turbo run test --force` | 1, then 0, then 1 (the full `&&` chain also ended 1). Every failure was the same demo-seed timeout; everything else passed. |
| `pnpm turbo run test --force --concurrency=2` | 0 (14/14; demo-seed takes 4.8 s) |

**The demo-seed timeout is not caused by this branch.**
- Run alone, the test takes about 2.5 s on main (`/home/user/portico`, read-only run) and 2.6–2.9 s on this branch.
- With turbo's default concurrency (10 tasks on this 4-CPU machine) it took 15 s in the passing run and hit the 30 s limit in the failing runs.
- That test file is outside the scope you gave me, so I left it. Fix options: give that test a longer timeout, or run CI with `--concurrency=2` as `pnpm test` already does.

### What changed per test
Each test still proves the same thing; only the setup changed.
- **Inventory `isolation-permissions` (×3), finance `security-and-corrections` (×1), operations `real-inventory` R2 (×1):**
  - Before: availability or charges were moved to the external system with a direct `setDataAuthority`.
  - Now: they go through an authority transition — one person plans it, a different user with `platform.dataAuthority.manage` approves it, then freeze and complete.
  - All the original assertions then run unchanged (`external_system_of_record`, mirrored state, forwarding refused, `Forwarding charges`, the forwarded work order). The maintenance case in inventory still uses `setDataAuthority`, because maintenance needs no second approver.
- **apps/api `payments.test` (×6) and `integration.test` (×1):** the test administrator enrols MFA with `enrolMfa` from `helpers.ts` right after signing in. `helpers.ts` itself did not change.
- **Guests `sharing.test` (×1):** this deliberately differs from your suggestion. Essentials allows only one property, so the cross-property case can never come up there. The test now uses **Connect**, the only plan with several properties that really lacks `portfolio.crossPropertyProfiles`. It still asserts 404.

### A real bug in my code
`turbo run typecheck --force` exposed a type error that my earlier typecheck had missed because turbo served it from cache.
- **Cause:** `platform.getDataAuthority` / `setDataAuthority` returned platform's 10-domain type, while integration uses its own 9-domain enum. That broke `modules/integration/test/harness.ts`, and my composition binding needed a mapping because of it.
- **Fix (in `modules/platform/src/service.ts`, not in the integration test):** both functions now return the same domain type they are given. The answer always concerns the domain asked about, so this is accurate.
- I removed the mapping from `apps/api/src/composition.ts`, so it is back to main's binding.

Ready for findings from the second review.
````

## Report (2026-11-07T17:09:14.384Z)

````text
## Fix round 2: feat/identity-platform-enterprise (ADR-0017 amendment 1)

All findings from the second review are fixed, except a few P2/P3s that are partial or left as documented gaps (listed below). The full gate chain passes with exit code 0.

Each new attack from the review is now a regression test that asserts refusal. That includes N-1 to N-9, plus the HTTP capture of a new live organization's first administrator. The first review's 11 attacks are kept as tests too, and they are still refused.

Everything is committed in /home/user/wt/identity-plus; nothing is pushed. No `w1_idplus_fix3*` databases are left over.

### Commits
| Commit | What |
|---|---|
| 6f2a737 | Merge of main: chronicle tooling, the 120 s demo-seed budget, `tools/commit-checked.sh`, ADR-0017 amendment 1, the second review and its PoCs |
| 8f5b13a | `fix(identity)`: amendment 1 (rules 12–15) and the P2/P3 fixes, with the identity regression tests |
| 4fe98e6 | `fix(api)`: provisioning invites the first admin; demo seeding is the only way to set a password; HTTP regressions |
| 3f72a15 | `docs(identity)`: README updates |

### Finding → commit → test
Test files referred to below:
- **identity regressions:** `modules/identity/test/review2-regressions.test.ts`
- **identity originals:** `modules/identity/test/review2-original-attacks.test.ts`
- **API regressions:** `apps/api/test/review-regressions.test.ts`

| Finding | Commit | Test |
|---|---|---|
| R2-P0-1 A (in-app pre-hijack) | 8f5b13a | identity regressions, "createUser refuses a password; the pre-created identity has no sign-in…" and "an attacker IdP's ghost identity … can neither see nor accept invitations, and the real person's first link wipes it" |
| R2-P0-1 B (SSO keeps pre-set credentials) | 8f5b13a | identity regressions, "N-1b: the resort's own verified-domain SSO verifies the GM and wipes anything another organization set before" |
| R2-P0-1 C (first live admin) and R2-P2-5 | 4fe98e6 | API regressions, "no password can be pre-registered; provisioning invites the first admin by email; only the real GM gets in" |
| Rule 12 seeding guard | 8f5b13a | identity regressions, "demo seeding sets passwords only in a demo organization…"; `demo-seed.test` passes through the seeding path |
| R2-P1-1 (rule 15) | 8f5b13a | identity regressions, "identity.sso.manage alone cannot repoint the issuer…" and "requiring SSO is a root change" |
| R2-P1-2 (rule 14) | 8f5b13a | identity regressions, "a griefer's earlier invitation does not stop the real link…" and "'forgot password' reaches a person who only holds invitations" |
| R2-P1-3 | 8f5b13a | identity regressions, "a refused JIT persists neither user nor link…" and "the verified-domain check also runs when an EXISTING link would activate a membership" |
| R2-P2-1 (race) | 8f5b13a | identity regressions, "a concurrent burst of wrong codes is cut off after five" |
| R2-P2-2 | 8f5b13a | identity regressions, "a role assigner scoped to property Y cannot strip a manager of property X…" (also refuses self-transfer) |
| R2-P2-3 | 8f5b13a | identity regressions, "SSO: a sign-in without the admin group keeps the only administrator…" and "SCIM: removing the only administrator from the mapped group keeps the role" |
| R2-P2-4 | 8f5b13a | identity regressions, "the account they create has no password they know…" — confirmed to mostly disappear with rule 12 |
| R2-P3-1 | 4fe98e6 | API regressions, "R2-P3-1: emergency access cannot create a trial" |
| R2-P3-2 | 8f5b13a | identity regressions, "P3-2: five wrong confirmation codes discard the pending authenticator" |
| R2-P3-3 | 8f5b13a | identity regressions, "P3-3: an expired invitation is neither listed nor accepted in-app" (SSO activation also needs an unexpired invitation) |
| R2-P3-4, R2-P3-8 | 8f5b13a | identity regressions, "P3-8: a wrong browser binding does not burn the real login; P3-4: a malformed email is refused" |
| R2-P3-6 | 8f5b13a | identity regressions, "P3-6: an invited person's credentials are not shown…" (same response shape for new and existing emails) |
| The 11 original attacks | 8f5b13a | identity originals: all 11 refused. The only change: path B now expects `password_not_allowed` |

### How the main fixes work
- **No organization sets a password (rule 12).**
  - `initialPassword` is gone from `createUser`, `POST /v1/users` (sending it gets a 400 `password_not_allowed`) and provisioning.
  - `createUser` now always creates an invited membership and sends the invitation.
  - The emailed link (invitation or reset) sets `users.email_verified_at`. So does a sign-in through an identity provider whose domain this organization verified.
  - The first verification runs `identity.first_email_verification`. It wipes the password, MFA factors, recovery codes, SSO links, sessions and the API keys the person issued, in every organization.
  - `seedDemoMember` is the only way to set a password. It works only for a system process, in a demo organization, for `*.portico.invalid` addresses. `seed/demo.ts` uses it.
- **Verified email to accept (rule 13).** Invitations are listed and accepted in-app only by an identity with a verified email, and only before they expire.
- **No blocking (rule 14).** Whether a person can set a first password depends on their credentials (`identity.credential_summary`), not on their memberships.
- **SSO as a root change (rule 15).**
  - Changing the issuer, the allowed email domains, trust in the IdP's MFA, or SSO-required needs organization-wide `*`.
  - An issuer change resets domain verification, removes the old issuer's links, raises a high alert and emails every administrator.
  - A person who already has credentials is linked only after proving them. They start the link from a password session with `POST /v1/me/sso/link`.
  - In the SSO callback, all checks run before any write. A refusal rolls back and is audited in its own transaction.
  - Orphan SSO links are removed when a member is removed or deleted by SCIM, and by a new hourly job.
- **Atomic second-factor counter (R2-P2-1).** Each attempt is reserved with one guarded UPDATE before the code is checked. Concurrent attempts wait for each other on the person's row.

### Gate results (PORTICO_TEST_DB_PREFIX=w1_idplus_fix3)
`pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2` → **exit 0**.
- lint: 627 files; module boundaries OK.
- typecheck: 16/16 tasks.
- test: 14/14 packages. Identity 135, platform 62, API 62; all other modules pass.
- A separate forced test run also exited 0 (1 min 14 s).

### Deviations, with reasons
1. **Rule 15, approval path:** only the "editor holds organization-wide `*`" branch is built. The "second administrator approves" flow is not, so a delegated SSO manager cannot change root settings at all. This is stricter, not weaker.
2. **Rule 15, linking proof:** proof means starting the link from a password session, plus a fresh second factor if the person has one. An administrator cannot pre-link someone.
3. **Lost SSO link:** someone who signs in only through SSO at an organization with an unverified domain loses that link when they verify their email elsewhere. That organization can re-link them only after verifying its domain or with their proof. This is in the README "Known gaps".
4. **`createUser` always invites**, even brand-new people, so the person sets their own password from the link. A side effect: an SSO-only organization's new member is activated on first SSO sign-in, which needs an unexpired invitation.
5. **R2-P2-4:** no approver-age or created-by check was added. Rule 12 removes the cheap path, and the remaining case (an admin who controls a second mailbox) is inherent.
6. **R2-P3-5 and R2-P3-7 are partial or not built:** domain verification is reset on an issuer change but not re-checked periodically, and API keys still survive their creator's role revocation. Both are in the README with reasons.
7. **R2-P2-6 (turbo cache):** `turbo.json` is outside my scope. The gates above were run with `--force`.
8. **Test-only paths.** Test helpers read the real invitation link — from the developer mailbox, or decrypted from the queued outbox message — and accept it over HTTP. This needed one-line provisioning changes in `apps/api/test/payments.test.ts` and `integration.test.ts`, which follow from removing `initialPassword` from provisioning. The identity test harness also adds members through invitation and acceptance.
9. **Confirming a new authenticator:** `confirmTotp` now returns a result object instead of throwing on a wrong code, so the failure counters are saved. The route unwraps it as before.
````

## Report (2026-11-07T17:55:43.315Z)

````text
## Fix round 4 (third review): feat/identity-platform-enterprise

**Status: not mergeable yet.** All 25 identity / platform / API test packages pass under both turbo concurrencies, including all six attacks (W-1 to W-6). But the gate chain exits 1, because `@portico/backoffice` no longer typechecks.

**Why backoffice fails.** The backoffice app arrived from main in this merge. Its sign-in page doesn't handle the `mfa_required` login response this branch added in wave 1 (review 1 §5 listed it for the backoffice owner).
- Errors: `apps/backoffice/src/features/auth/sign-in-page.tsx(56,21)` and `(58,22)` (TS2339).
- I didn't touch it because it is outside my write scope, and the fix is a UX decision (add a second-factor step after the password).
- If you widen my scope I can add it; otherwise it goes to the backoffice owner.

Everything is committed in /home/user/wt/identity-plus; nothing is pushed. No `w1_idplus_fix4*` databases are left over.

### Commits
| Commit | What |
|---|---|
| abbd5e9 | Merge of main. `OPEN_QUESTIONS.md` kept both sides (Q146–Q149 and Q150–Q155, no collision); lockfile taken from main and reconciled with this branch's dependencies |
| 65ed7bd | `fix(identity)`: R3-P1-1, R3-P1-2, R3-P2-1/2/3, P3-1 to P3-4, with the regression tests |
| 51dbe2d | `docs(identity)`: README |

### Finding → commit → test
All tests below are in `modules/identity/test/review3-regressions.test.ts`.

| Finding | Commit | Test |
|---|---|---|
| R3-P1-1 / W-1 (race on the first-verification wipe) | 65ed7bd | "a factor confirmation racing the GM's first verification is refused…" (uses W-1's test-only `pg_sleep` trigger; the attacker gets `unauthenticated`). Also "reverse order: a factor confirmed before the wipe is wiped by it" and "sibling: an SSO sign-in racing the wipe leaves no session and no link" |
| R3-P1-2 / W-2 (root changes) | 65ed7bd | "an SSO manager cannot re-point the groups claim, JIT provisioning or the client id; the display name is fine" |
| R3-P2-1 / W-3 (removing mappings) | 65ed7bd | "an SSO manager cannot delete the mapping that makes someone org_admin" (empty list and partial list both refused) |
| R3-P2-2 / W-4 (domain verification) | 65ed7bd | "a second organization cannot hold a verified domain", "a stale verification cannot verify a newly invited person or accept their invitation", "the scheduled re-check ends a verification whose DNS record is gone" |
| R3-P2-3 / W-5 (SSO-only lockout) | 65ed7bd | "after a first verification elsewhere wipes the link, the person re-links from a password session in any organization" |
| R3-P3-1 / W-6 (orphan purge) | 65ed7bd | "a link without a membership in its own organization is purged…" (run as the app role) |
| R3-P3-2 (backfill) | 65ed7bd | Migration only: only `*.portico.invalid` passwords count as verified. No test (no legacy rows to load) |
| R3-P3-3 (simulated links) | 65ed7bd | "accepting a simulated (non-live) invitation does not mark the email verified" |
| R3-P3-4 (issuer in login state) | 65ed7bd | "a login started before an issuer change cannot finish against the new issuer" |
| R3-P3-5 | abbd5e9 | Merge resolved append-only |

### How each fix works
- **R3-P1-1 — the wipe can no longer be raced.**
  - **Row lock first:** every path that creates or activates a credential now takes the person's row lock with `identity.lock_person` before reading anything, then checks its session is still current (not revoked, same credential epoch). Paths covered:
    - authenticator enrol / confirm, step-up, new recovery codes, disabling MFA;
    - password sign-in and the second-factor challenge;
    - SSO sign-in (it locks every person the sign-in could touch, then re-reads the link);
    - invitation acceptance, password reset completion, issuing an API key.
  - **Credential epoch:** `users.credential_epoch` goes up by one on the first verification. Sessions, factors, recovery codes, MFA challenges and SSO links each record the epoch they were created in, and anything from an older epoch never counts.
  - **Smaller window:**
    - `confirmTotp` activates a factor only if it is still pending (it checks the row count);
    - code verification accepts only pending or active factors;
    - the first password is hashed before the transaction opens;
    - sign-in reads the epoch before the password hash.
- **R3-P1-2:** every SSO setting except the display name and a client-secret rotation is now a root change. That covers issuer, client id, auth method, scopes, allowed domains, groups claim, JIT, MFA trust and status. Settings left out of an update now keep their current value instead of resetting to defaults.
- **R3-P2-1:** removing or changing a group mapping is checked with `assertCanGrantRole` on the role it grants.
- **R3-P2-2 — a verified domain now has a single holder and a shelf life.**
  - **One holder:** a new registry (`identity.verified_domains`) gives each domain one organization; the first to verify wins. A second organization gets `domain_held_by_another_organization` and needs Monoclay support.
  - **Live check:** before a verified domain counts as someone's *first* email verification, the TXT record is checked live, outside any transaction, with no cache.
  - **Expiry:** a verification lapses after 30 days without the record being seen.
  - **Daily job:** `identity.recheckSsoDomains` re-checks every verified domain. A missing record ends the verification and raises an alert.
  - **Issuer change:** changing the issuer releases the organization's domains from the registry.
- **R3-P2-3:** `POST /v1/me/sso/link` now takes `{ organizationId }`. The person proves their password (plus a fresh code if they have one) in **any** organization they belong to, and links the target organization's IdP account to themselves. If no organization of theirs allows password sign-in, the admin can temporarily exempt them from SSO-required. The README now says this honestly.

### Re-attacks I ran myself on the P1 fixes
- **W-1:** with the 1.5 s delay trigger in place, the attacker's confirm request waits on the person's row lock and then fails `unauthenticated` (checked by capturing the error). The GM ends with 0 active factors and signs in without MFA. The reverse order and the SSO-sign-in race are both refused too.
- **W-2:** groups claim, JIT and client id are each refused with `forbidden`; scopes, auth method and status go through the same check.

### Self-check § 3 (re-attack table)
| Finding | Fix commit | Regression test | (a) reverse order | (b) siblings checked | (c) failure path | (d) griefing | (e) atomic |
|---|---|---|---|---|---|---|---|
| R3-P1-1 | 65ed7bd | W-1 race, reverse, SSO sibling | Tested: confirm-then-wipe leaves no factor | enrol, confirm, step-up, recovery codes, disable, password sign-in, MFA challenge, SSO sign-in and link, invitation accept, reset, API key | Refusal throws or returns before any write (the session check comes first); W-1 asserts 0 active factors | The wipe is triggered only by the person's own emailed link or a live-verified domain; SSO-only people have a re-link path (W-5) | Row lock plus epoch; concurrency test with a forced interleaving |
| R3-P1-2 | 65ed7bd | W-2 | n/a (no exception added) | `configureSso` is the only writer; `setSsoEnforcement` already root | Refused before any write | n/a | n/a |
| R3-P2-1 | 65ed7bd | W-3 | n/a | `setGroupRoleMappings` is the only mapping writer | Refused before the delete | n/a | n/a |
| R3-P2-2 | 65ed7bd | W-4 ×3 | Second claimant refused while the first holds | `verifySsoDomain`, SSO phase 3, issuer change (release), daily job | The claim and the verified flag are written in one transaction | A first holder could squat a domain; the remedy is Monoclay support (README) | The registry's primary key makes "first wins" atomic; no concurrent test |
| R3-P2-3 | 65ed7bd | W-5 | n/a | link start, callback proof (`link_user_id` must equal the email's identity) | Starting a link for an organization the person is not in is refused; nothing is written | This *is* the griefing fix (any organization's invitation used to cause the lockout) | n/a |
| R3-P3-1…4 | 65ed7bd | W-6, P3 tests | n/a | `first_email_verification`, `credential_summary`, purge (all with tenant predicates); invitation + reset (delivery mode); every login state (issuer) | n/a | n/a | n/a |

### Self-check § 2 (v1 items 5–32): 22 yes · 4 N/A · 2 no
- **No — 19:** `docs/architecture/domain-map.md` doesn't list the new provider functions. It's outside my scope; they are listed under the README's "Contract changes".
- **No — 20:** proven compatibility with real consumers. The backoffice's use of `loginResponse` fails to typecheck — the blocker above.
- **N/A — 13, 16–18, 22:** identity consumes no events; no money; no event consumers yet.
- **N/A — 29:** no staff erasure feature exists.
- **Yes — the rest**, with these tests:
  - 5: `isolation.test.ts`;
  - 6 and 7: transfer at both properties, mapping power, operator console;
  - 8: `permission-catalog.test`;
  - 9 and 11: `lock_person`, the second-factor reservation, W-1 and N-4 concurrency tests;
  - 10: unique constraints (links, registry, one active factor);
  - 12: idempotent replay never stores a token;
  - 14: IdP and DNS calls outside transactions;
  - 15: deliveries report `queued`;
  - 21: the fake IdP checks client auth and PKCE;
  - 23: SSO-required needs an exempt account;
  - 24: platform authority guards;
  - 25: simulated links don't verify; the operator console is off in production;
  - 26: domain ownership is DNS-proven and exclusive;
  - 27: link proof comes from server state;
  - 28: `safeJsonRequest`;
  - 30: no links or tokens in responses or idempotency records;
  - 31: the README invariants table points to tests;
  - 32: R3 at most.

### Command results (PORTICO_TEST_DB_PREFIX=w1_idplus_fix4)
| Command | Exit | Detail |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | |
| `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2` | **1** | lint passes (794 files, boundaries OK); typecheck 17/18 — only `@portico/backoffice` fails, so the test step doesn't run |
| `pnpm turbo run test --force --concurrency=2` (run separately) | 0 | 16/16, `Cached: 0`, 1 min 28 s; identity 147, API 62 |
| `pnpm turbo run test --force` (default concurrency) | 0 | 16/16, 1 min 26 s |
| `pnpm turbo run typecheck --force --continue` | 1 | 17/18, only backoffice |

### Deviations, with reasons
1. **R3-P2-2 consent scoping not done.** The review's optional point 4 (`email_verified_via`, which would stop a person verified through organization X's domain from accepting other organizations' invitations in-app) isn't built. Exclusivity, the live check and the lapse cover the proven attack. It's in "Known gaps".
2. **No epoch on API keys.** Their creation takes the creator's row lock and checks the session, and the wipe revokes them, but keys themselves don't carry an epoch.
3. **R3-P2-3 used review option (b)** (prove in any organization) rather than (a) (keep same-organization links).
4. **ADR wording not changed.** The reviewer asked for one clarifying sentence in rule 15 ("root = anything that decides who signs in or which roles a sign-in grants"). It belongs in `docs/adr/`, which is outside my scope; the code implements that wording.
5. **Domain re-check job is registered separately** as `ssoDomainRecheckJob(systemTxtResolver)` in the composition root, because jobs have no ports and it needs DNS.
````

