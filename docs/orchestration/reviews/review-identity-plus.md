# Steward review — `feat/identity-platform-enterprise` (identity + platform, wave 1 enterprise)

Reviewer: architecture steward · 2026-11-07 · worktree `/home/user/wt/identity-plus` @ `3830b9f` (17 commits, 83 files,
+18 392 / −228). Experiments were run in a copy, never in the worktree:
`/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy` (branch as-is) and
`/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-merge` (branch merged with `main` @ `8556aec`).

## Verdict: **do not merge**

The code is well organised and the test suite is green, but the branch has **two P0 cross-organization account-takeover
paths** (both proven by executable tests below) and eight P1s, several of them escalation or MFA bypasses. The P0s come
from one design gap: sign-in credentials (password, TOTP factor, recovery codes) are **global per person**, but this
branch lets **any organization's admin, SSO connection or SCIM client change them**. The admin only needs a membership
row for that email, and they can create one without the person's consent. Fixing this needs a design change, not a
patch, so the fixes need a second review.

Counts: **P0 2 · P1 8 · P2 17 · P3 12**.

---

## 1. Command results

| Command (`PORTICO_TEST_DB_PREFIX=review_idplus*`) | Branch as-is | Branch merged with `main` |
|---|---|---|
| `pnpm install --frozen-lockfile` | pass | pass |
| `pnpm lint` (biome + boundaries) | pass ("Module boundaries OK (2 modules checked)") | pass |
| `pnpm typecheck` | pass (8/8) | pass |
| `pnpm --filter @portico/identity test` | pass (9 files, 75 tests) | pass (75) |
| `pnpm --filter @portico/platform test` | pass (6 files, 56 tests) | pass (57) |
| `pnpm --filter @portico/api test` | pass (5 files, 21 tests) | **FAIL**: `test/permission-catalog.test.ts` → `expected [ 'identity: finance.posting.correct' ] to deep equal []` (see P1-1) |
| `git merge main` | — | **conflict** in `modules/platform/src/manifest.ts` (`platform.dataAuthority.manage` registered on both sides; keep the branch's list) |
| `node tools/parity-report.mjs --gate platform` (with `wt/parity-front/docs/parity/platform.md`) | **FAIL**: 30 P0 open, 3 P1 missing; 28 % capabilities / 31 % edge cases tested | — |
| `node tools/parity-report.mjs --gate identity` | **FAIL**: "No parity file for module identity" | — |

After the merge, if the doc comment is reworded (P1-1), `turbo run test --continue` passes in every package: kernel 22,
db 12, http 2, platform 57, identity 75, api 22.

### Proof-of-concept tests written for this review
All of these pass, which means each attack works:
- `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy/modules/identity/test/zz-review-poc.test.ts` (10 tests)
- `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy/modules/identity/test/zz-review-sso-poc.test.ts` (1 test)
- `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy/apps/api/test/zz-review-poc.test.ts` (1 test)
- `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy/packages/kernel/src/zz-review.test.ts` (1 test)

The author should turn these into regression tests that fail today and pass after the fixes.

---

## 2. Findings

### P0 — security / isolation

| id | file:line | problem | why it matters | concrete fix |
|---|---|---|---|---|
| **P0-1** | `services/lifecycle.ts:51-59, 109-111, 369-383, 386-412`; `adapters.ts:55`; `routes.ts:596-613`; `service.ts:118-131` (`createUser`); `lifecycle.ts:260-277` (`acceptInvitation`) | **An admin of one organization can take over a member of another organization by setting their password.** Path A (any non-live org: trial, demo, training or sandbox): `inviteMember(victimEmail)` calls `ensure_user` and gets the victim's *global* user id. `POST /v1/users/:id/password-reset` then returns `delivery.simulated.link`, which contains the reset token, in the HTTP response. `completePasswordReset` rewrites the global `identity.users.password_hash`, and the attacker signs in to the victim's **live** organization. Path B (any **live** org): `createUser({ email: victim, initialPassword })` sets the global password of any existing user who has no password yet, which covers members provisioned by SCIM, SSO or a pending invitation. PoC: `zz-review-poc.test.ts` "a trial-org admin resets the global password of a live-org GM…" and "any LIVE org admin sets the first password…". | Anyone who administers a trial can reach a live hotel's money and guest data as another person: any live customer with `platform.trial.manage` can create such a trial in one call (`POST /v1/environments/trials`), and the operator console creates one for every prospect. This breaks PLT-R01/PLT-I01 and S17. The existing test `roles-lifecycle.test.ts:317-330` reads the link from the response without noticing the cross-org effect. | (1) Never return credential links (`inv.`/`prt.`) in API responses. Show simulated messages only in an operator or dev mailbox, or only when every membership of the target is in that same non-live org. (2) Credential-changing operations (password set or reset, MFA reset) may be started by an org admin only for people whose **every** membership, in any status, is in this org. Otherwise send the person to self-service. (3) `createUser`/`inviteMember`/SCIM/JIT for an email that already belongs to a global user must create an `invited` membership that the person accepts **while signed in as themselves**. Never set their password and never activate silently. (4) Cover each path with a cross-org regression test. |
| **P0-2** | `migrations/0002_identity_enterprise.sql:62-73` (`member_only` RLS on `mfa_factors`/`mfa_recovery_codes`), `:430-433` (`active_membership_count` counts only `active`); `services/mfa.ts:385-419` (`resetMemberMfa`), `:101-219` (`enrolTotp`/`confirmTotp`), `:243-251`; `services/sso.ts:204-206, 575-646` | **Another organization can strip or replace a person's MFA, which is global.** (a) Any org admin invites the victim's email (status `invited`, not counted by `active_membership_count`) and calls `POST /v1/users/:id/mfa/reset`. The victim's TOTP and recovery codes are disabled for **every** organization. PoC: "a trial-org admin strips the MFA of a live-org member". (b) An enterprise org configures SSO against its own IdP and puts the **victim's domain** on `allowedEmailDomains`; there is no domain-ownership check. JIT links the session to the victim's global user, `amr: ['mfa']` satisfies `requireRecentStepUp`, and `enrolTotp` + `confirmTotp` disable the victim's factor, activate the attacker's and return 10 fresh recovery codes. PoC: `zz-review-sso-poc.test.ts`: the victim's own authenticator then fails at sign-in to the live org. | Combined with P0-1, an attacker gets full takeover including MFA, or locks the victim out of every organization. The MFA guarantees in the README ("A TOTP time step is accepted at most once…", IDN-I04) mean nothing while another tenant can rewrite the factor. | (1) Changing a global credential (enrol or replace TOTP, disable, regenerate codes) needs proof of the **existing** factor, not just a fresh session. An SSO session from an arbitrary org's IdP must never count as step-up for global credentials. (2) `resetMemberMfa`: refuse if the person has **any** membership row (any status) outside this tenant. Better, let only Monoclay support reset a shared identity. (3) SSO: require verified domain ownership (DNS TXT) before an org can JIT-provision or link **existing** global users of that domain. Without it, link only users who have no other memberships, or require the person to prove control of the existing account. (4) Bind SSO sessions to `(issuer, sub)` after the first link (see P1-8). |

### P1 — contract / architecture / missing MUST / bypasses

| id | file:line | problem | why it matters | concrete fix |
|---|---|---|---|---|
| **P1-1** | `modules/identity/src/domain/step-up.ts:5`; `modules/platform/src/manifest.ts` (merge) | After merging `main`, `apps/api/test/permission-catalog.test.ts` (added on main by 8d58366) fails. Its regex matches the doc comment `` `requirePermission(ctx, 'finance.posting.correct')` `` in identity, which is not a registered permission. The platform manifest also conflicts with main (both register `platform.dataAuthority.manage`). | The merge gate requires green checks. | Reword the comment, e.g. `requirePermission(ctx, <sensitive permission>)`. Resolve the conflict by keeping the branch's permission list, which registers the key once. |
| **P1-2** | `service.ts:384-406` (`stepUpStateFor`); `domain/step-up.ts:199-205`; `scim.ts:137, 227`; `sso.ts:608, 629`; `lifecycle.ts:280`; migration `:96` (grace up to 720 h) | **The enrolment grace lets privileged roles use sensitive permissions without MFA.** For 72 h after `activated_at`, every ⚑ permission works with a password only, including for `org_admin` ('*'). PoC: "a brand-new org_admin uses sensitive permissions with password only". The grace **restarts** on every rehire, SCIM rehire, SCIM `active=true` cycle, invitation acceptance and SSO invited→active. An SCIM client or admin can therefore keep a member permanently MFA-free. The policy allows up to 30 days. | IDN-I04 ("a user with any ⚑ permission has MFA enrolled **before** that permission becomes effective") and IDN-R03 MUST are violated. Together with P1-3, a password phished during the grace becomes a permanent credential with no MFA. | Grace should cover only enrolment itself: allow `/me/mfa/*` but not ⚑ permissions. If onboarding friction is the concern, allow a short grace only for non-admin ⚑ roles, never for identity/platform-admin ⚑ (`identity.*`, `platform.organization/legalEntity/dataAuthority/trial…`). Anchor the grace to the person's first activation anywhere, so reactivation and rehire cannot reset it. Cap the policy at ≤ 72 h. Record the decision in `docs/OPEN_QUESTIONS.md`. |
| **P1-3** | `services/api-clients.ts:16-59`; `service.ts:646-671` (no step-up wrapper for `ptk.`); `service.ts:291-320` (`suspendMember` keeps API keys); `lifecycle.ts:386-412` (password reset keeps API keys) | **API clients bypass MFA and persist access.** Any ⚑ permission, including `identity.role.assign`, `identity.apiClient.manage`, `identity.security.manage` and `'*'`, can be minted into a key with **no expiry**. The key is never step-up checked, and it is not revoked when its creator is suspended, resets their password or has MFA reset; only *removal* revokes it. IDN-R16 MUST "Issuing production keys calls `assertExternalEffectAllowed`" and CLAUDE.md rule 12 (`credentials.production`) are not applied (the README admits this). | A single short session (or a session during the grace) becomes a permanent org-admin credential with no MFA. A compromised account stays compromised after a password reset. | Keys carrying ⚑ permissions need: a recent step-up at issuance even during the grace; a mandatory expiry (e.g. ≤ 90 days); revocation on suspension, password reset, MFA reset and credential compromise of the creator. Exclude `identity.*` administration permissions from keys except `identity.scim.provision` (or add an explicit, alerted "admin key" class). Call `assertExternalEffectAllowed(ctx, 'credentials.production')`. |
| **P1-4** | `platform/src/service.ts:33-35` (`actorKey`); `services/activation.ts:403-409`; `services/authority-transitions.ts:170-176`; `services/configuration.ts:787-792`; `identity/services/break-glass.ts:186-191` | **Separation of duties compares principals, not people.** A user requests as `user:X` and approves with an API client they issued (`api_client:Y`). PoC: "one person requests a pilot as a user and approves it with an API client they issued" (decidedBy `api_client:…`, requestedBy `user:…`). The same bypass works for authority transitions (CR-10 / ST-11), configuration approvals and break-glass review. | CR-10, RR-05 and the adoption brief's "approved by a different person" become a formality. Rule 9 audit trails would show two actors where there was one person. | Add a kernel helper `responsiblePerson(actor)`: API client → creating user (store `created_by` as the user id), support → operator. Use it in every SoD comparison. Or refuse SoD-gated approvals from API clients altogether (simplest; approvals are human acts). |
| **P1-5** | `services/policy.ts:51-110`; `services/break-glass.ts:31-133` | **Break-glass self-designation escalates to org_admin.** A holder of `identity.security.manage` (no other admin rights) adds **themselves** to `breakGlassUserIds`, sets `breakGlassRoleKey: 'org_admin'`, elevates, and mints a non-expiring `'*'` API key that still works after the elevation ends. PoC: "identity.security.manage alone is enough to become org_admin and mint a durable '*' API key". Elevation can also create other durable privileges: role grants to a confederate, SSO group mappings, policy changes. | Bypasses the README's escalation guardrail, and the time box of IDN-R19 becomes meaningless. | Designation: refuse to designate yourself; the designator must hold every permission of the break-glass role (`assertCanGrantRole`); require a second approver or at least a high-severity alert. During an elevation, refuse durable-privilege actions (assign role, issue API key, edit roles, SSO mappings, security policy, SCIM token), or auto-revoke whatever was created when the elevation ends. |
| **P1-6** | `service.ts:256-288` (`revokeAssignment`), `:291-320` (`suspendMember`); `lifecycle.ts:619-680` (`removeMember`); `mfa.ts:385-419`; `lifecycle.ts:369-383` | **A lower-privileged admin can disempower more-privileged ones, with no protection for the last admin.** A custom role with only `identity.role.assign` + `identity.user.read` + `platform.property.read` revoked the org admin's `org_admin` assignment. PoC: "a lower-privileged role assigner removes the only administrator". The same applies to suspend, remove, MFA reset and admin-sent password reset (which in non-live orgs hands over the account; see P0-1). | The organization can lose all administrators. Monoclay support cannot repair it (⚑ is excluded from support sessions) and there is no operator recovery path. This is IDN-R14 guardrail territory. | An actor may revoke, suspend, remove or reset only members whose effective permissions are ⊆ the actor's own (reuse `assertCanGrantRole` on the target's roles). Refuse any change that would leave zero active members holding `identity.role.assign` + `identity.user.manage` org-wide. Add an operator-side recovery runbook. |
| **P1-7** | `services/mfa.ts:423-516` (5 attempts per *challenge* only); `packages/http/src/server.ts:75` (`trustProxy: true`) | **TOTP can be brute-forced once the password is known.** Each password sign-in issues a new challenge with 5 more attempts. There is no per-account counter, lockout or alert for second-factor failures, and `record_login_result(true)` resets password failures. PoC: "50 wrong TOTP codes over 10 fresh challenges: the account is never locked". The per-IP limits (`/auth/login` 20/min, `/auth/login/mfa` 20/min) are bypassable from a single host because `trustProxy: true` trusts any client-supplied `X-Forwarded-For`. PoC: `apps/api/test/zz-review-poc.test.ts` (30 rotating-XFF attempts → 0 × 429; same XFF → 429). The same spoofing defeats credential-stuffing rule R1 and poisons the new-country rule R2. | IDN-R02 MUST "rate-limited per account and per IP" is not met. With ~3 valid codes in each window, about 67 k challenges succeed with 63 % probability, reachable from one machine. | Add a per-user consecutive second-factor failure counter across challenges and step-ups (e.g. ≥ 10 → escalating delay or lock plus a `mfa_bruteforce_suspected` alert to the member and admins). Reset it only on a successful second factor. Foundation: set `trustProxy` to the load-balancer hop count or CIDR (env-configured) and key rate limits on the real client IP. |
| **P1-8** | `services/sso.ts:575-646`, `:608-610` (`external_id = oidc:sub` stored but never used for matching), `:577` (`email_verified` absent ⇒ accepted) | **SSO identity is keyed only on the mutable `email` claim.** After JIT, later SSO sign-ins look the member up by email, not by `(issuer, sub)`, and an IdP that omits `email_verified` is trusted. | This is the nOAuth class of bug: an IdP user who can change their own email attribute (Entra guests, mutable profile fields) signs in as another member of the same org, including admins. It is also half of P0-2. | After the first link, match on `(issuer, sub)` and refuse if the email maps to a different linked user. Require `email_verified === true`, or make that a per-connection opt-out with a warning. Add `requiredClaims: ['exp','iat','sub','nonce']` to `jwtVerify`. |

### P2 — tests, robustness, UX/error quality, maintainability

| id | file:line | problem | concrete fix |
|---|---|---|---|
| P2-1 | `routes.ts:130-151` (`installStepUpTranslator`) | The `onSend` rewrite is **safe**: it only relabels a 403 for the caller's own permission and cannot grant anything. It is **brittle**, though. (a) It works only because every module's `routes(app)` receives the same `/v1` Fastify instance; if any module is registered in its own encapsulated plugin, the rewrite stops silently. (b) It re-parses serialized bodies. (c) Identity's own escalation refusals (`ForbiddenError(p, { reason })` in `assertCanGrantRole`, `assertEditorHolds`, `issueApiClient`) put `{reason}` into `details.scope`. `explainDenial(p, {reason})` then falls back to `can(p)` without a property, so a grantor who holds *p* somewhere is told `mfa_required`, steps up, and still gets `forbidden`. | Implement FR-2 now: kernel `requirePermission` consults `explainDenial` and throws `MfaRequiredError`. Delete the hook. Until then, pass `scope` only when it carries a `propertyId`. |
| P2-2 | `adapters.ts:76-81`; `sso.ts:54-64, 73-115, 462-474, 565` | **SSRF.** The issuer, discovery endpoints and JWKS may be `http://localhost` / `http://127.0.0.1` in production, and any internal HTTPS host is accepted. These outbound calls also run **inside** the tenant DB transaction while it holds a `FOR UPDATE` lock on the login state, for up to 10 s per call. | Allow loopback only when `NODE_ENV !== 'production'`. Resolve DNS and refuse private, link-local and loopback ranges. Do discovery, token and JWKS calls outside the transaction (two-phase: consume the state, call the IdP, then provision in a second transaction). |
| P2-3 | `sso.ts:408-457, 514-548` | The SSO `state` is not bound to the browser. The callback is public and the PKCE verifier is held server-side, so anyone holding `(state, code)` (Referer, logs, history) redeems the session. This also enables login CSRF. | At `/auth/sso/start`, set an HttpOnly SameSite cookie (or have the SPA send a hash of a nonce kept in sessionStorage) and require it at the callback. |
| P2-4 | `sso.ts:329-381` | SSO-required allows **zero** exempt accounts. Afterwards the connection can be reconfigured or broken (`configureSso`) while SSO stays required. Monoclay cannot recover, because support excludes ⚑ and there is no operator route. | Require ≥ 1 exempt break-glass account while SSO is required. Test-sign-in a changed connection before saving it while required. Add an operator recovery procedure. |
| P2-5 | `authority-transitions.ts:233-250`; `apps/api/src/composition.ts` (`transitionGuard` unbound) | ST-08 (pending forwarded operations block completion) **fails open** in the real composition, yet the README lists ST-08 as "done". | Fail closed: refuse to complete a transition that moves a domain out of `forward` while the guard is unbound, or mark the item "partial" in the README and readiness register. |
| P2-6 | `activation.ts:581-626` | `assertEffectInScope` writes the refusal audit row and then **throws**, so the transaction rolls the audit row back unless the caller catches. "Refusals audited (EV-05)" is therefore conditional. | Return a refusal value, or write the audit in a separate committed transaction or outbox, and test that the row survives a thrown refusal. |
| P2-7 | `routes-enterprise.ts:547-560, 436-449`; identity `routes.ts:655-678`; `packages/db/src/idempotency.ts:86-87` | `POST /environments/trials` and `/configuration-bundles/from-trial` call `requireIdempotencyKey` but **ignore** it, so a retry creates a second trial organization or bundle. `POST /api-clients` runs through `runIdempotent`, which stores the **plaintext API token** in `response_body`; in non-live orgs the invitation link is stored the same way. | Use the idempotency key for cross-transaction operations by storing the outcome keyed by `(tenant, key)`. Redact secrets from stored responses and on replay return "already issued — revoke and reissue". |
| P2-8 | `createProperty` `service.ts:276-284` vs `activation.ts:124-140` | Two inconsistent limit semantics. Creation counts **all** properties against `limits.properties` (setup and inactive included), contradicting PLT-R10, which the activation checklist implements (pilot + active). The activation limit check also takes no lock, so once creation is aligned two concurrent approvals can exceed the limit. | Count pilot + active at creation as well (or a separate setup cap) and take a tenant-level advisory lock in the activation approval. |
| P2-9 | `domain/activation.ts:45-62`; `activation.ts:549-574` | The activation scope lacks the "Domains and authority" element of evaluation-and-trial §6.1. Pilot and production approval has no Monoclay launch-gate owner sign-off (§6.1 "Approvals"; readiness §21). `active → inactive` has no precondition checks (spec §4.2: no in-house or future stays, folios settled). | Add `authority` to the scope document and validate it against `listDataAuthority`. Add an optional operator approval step for production. Add a `deactivationChecks` port. |
| P2-10 | `kernel/src/context.ts:73-84` (on main) | `staticAuthorizer.lookup` returns the **first** match: an exact key with a property set shadows a `'*'` / `'all'` grant. PoC `zz-review.test.ts`. Break-glass (`elevationPermissions` → `'all'`) therefore does **not** widen permissions the person already holds at property scope, and `assertCanGrantRole` under-counts. This fails closed. | Union all matching grants: exact, every wildcard level, and `'all'`. |
| P2-11 | `services/owners.ts:85` (+ update and archive audits) | The owner audit `after` holds `email`, `phone` and `taxId` in the append-only audit log, which cannot be erased later. | Audit field names and changed-field flags only, or hash and mask. |
| P2-12 | `identity/manifest.ts`; platform `manifest.ts`, `search.ts` | Universal record contract (rule 17): identity declares no `recordTypes` or `SearchProvider` (staff members are primary records). The new platform records (outlet, owner, activation request, authority transition, configuration change, trial) are not in `recordTypes` and do not expose `status`/`allowedActions` with reasons, `issues`, `owner` or `links`. | Add record types and summaries, and `allowedActions` on activation and transitions (e.g. "approve — disabled: you requested it"). |
| P2-13 | tests | Isolation tests are missing for most new identity tables: SSO connection and mappings, SCIM groups, elevations, alerts, API clients, roles and members by id. The README claims "roles or members" isolation, but only support sessions are tested. Platform activation requests and authority transitions have no isolation tests either. The `member_only` MFA policy has **no** isolation test, and that is where P0-2 sits. Concurrency tests exist only for unit-ownership shares. I verified that concurrent TOTP and recovery-code replay holds (`zz-review-poc.test.ts` "concurrent replay"); add that test. | Add a per-table cross-tenant suite (another org: 404 for read, 404 for write) and concurrent tests for replay, support approval and transition open/complete. |
| P2-14 | `adapters.ts:51-70`, `lifecycle.ts:174-196` | In `live`, invitations and resets return `delivery.mode: 'live'`, but no consumer delivers `identity.staffMessage.requested`. The UI will say "sent" (CLAUDE.md §5: never show success the authoritative system did not confirm). | Return `queued` (pending) until a delivery receipt exists. |
| P2-15 | `service.ts:51-71` | `seedSystemRoles` upserts by `key`. A future template whose key equals an existing custom role (e.g. `dpo`) would **overwrite** that custom role's permissions while `is_system` stays false. | Reserve a namespace (system keys prefixed, or custom keys refused if they match a reserved list) and never `doUpdateSet` a non-system row. |
| P2-16 | `services/scim.ts` + `mapped-roles.ts` | Holding `identity.scim.provision` is effectively the power to grant **any** mapped role (e.g. a group mapped to `org_admin`) to anyone, including the token holder's own provisioned membership. Mapping validation checks the mapping editor, not the SCIM client's creator. | Document it in the catalog as "equivalent to the mapped roles", or check at reconcile time against the API client's creator. |
| P2-17 | `services/support.ts:44-75`, `routes.ts:1041-1110` | Operator principals use static bearer tokens with no expiry and no MFA, on public `/v1/operator/*` routes. The README states they will be replaced. | Treat this as a launch gate in the readiness register. Allow only private network access, or fall back to "disabled" when `NODE_ENV=production` until IAM Identity Center is wired. |

Missing MUSTs (spec) are listed in §3. Under the merge gate they are not P1 individually: the README discloses each one as R1 or a known gap. They must stay visible in the readiness register.

### P3 — nits

- P3-1 `mfa.ts:221-227, 365-377`: revoked recovery codes are marked `used_at`, so forensics cannot tell "used" from "revoked". Add `revoked_at`.
- P3-2 `mfa.ts:449-516`: `checkSignInLocation` (rule R2) runs only on the password-only and SSO paths, not after the MFA challenge, so the most privileged users skip it.
- P3-3 `break-glass.ts:56-84`: concurrent `startElevation` on one session can create two elevations; the index is not unique. Add a unique partial index on `(session_id) where ended_at is null`.
- P3-4 `break-glass.ts:110-131`: only holders of the `org_admin` template are notified (spec: "all organization admins"); custom admin roles are missed.
- P3-5 `sso.ts:529-537, 578`: failed-SSO audits store emails and groups of non-members in the tenant's append-only audit.
- P3-6 `roles.ts:184-206`: `cloneRole` reads the source role before any permission check (existence oracle within the tenant).
- P3-7 `activation.ts:354-359`: `recordStatusChange` ignores the update count and records history even if the guarded update matched 0 rows.
- P3-8 `mfa.ts:400-405`: the error text tells org A that this person also belongs to another organization.
- P3-9 `domain/configuration.ts:126-141`: the carry-forward denylist matches exact dot-segments (`guestProfiles` ≠ `guests`). It relies on providers being honest.
- P3-10 `apps/api/src/provisioning.ts:142-170`: no limit or rate on trials per live organization (plans define `limits.environments.*` for training and sandbox only).
- P3-11 The README's "Open questions for the owner" (grace and step-up defaults; operator IdP) were not appended to `docs/OPEN_QUESTIONS.md` (autonomy rule §1).
- P3-12 Demo and training organizations will force MFA enrolment on seeded admins after 72 h; decide whether the demo seed enrols MFA or uses a demo policy.

---

## 3. Spec coverage

**identity (`docs/specs/identity.md`)**

| Req | Status |
|---|---|
| IDN-R01 users/memberships | done (wave 0), but consent for existing global users is missing (P0-1) |
| IDN-R02 credentials | partial: no breach-list check (MUST), hard lock rather than escalating delay (wave 0), per-account rate limit missing (P1-7); WebAuthn LATER |
| IDN-R03 MFA mandatory for ⚑ / admins | **violated by the grace** (P1-2) |
| IDN-R04 PIN quick switch | **missing** (README R1) |
| IDN-R05 sessions | partial: idle and absolute times are constants (120 min / 12 h), not policy by device class; device list ✓, remote sign-out ✓, revoke on reset ✓ |
| IDN-R06 lifecycle | done; removal revokes keys, suspension does not (P1-3) |
| IDN-R07 transfer | done |
| IDN-R08 OIDC SSO / SCIM | done against a fake IdP only (R3); SAML LATER; P0-2 / P1-8 |
| IDN-R09 catalog | done |
| IDN-R10 custom roles | done (P2-15) |
| IDN-R11 department scope | **missing** |
| IDN-R12 deny by default | done (kernel) |
| IDN-R13 field-level restriction | **missing** |
| IDN-R14 guardrails | partial: no self-grant ✓ and escalation guard ✓, but P1-4, P1-5 and P1-6 break the guardrails |
| IDN-R15 approvals primitive | **missing** |
| IDN-R16 API clients | partial: no rotation with overlap; no `credentials.production` effect check (P1-3) |
| IDN-R17 consent apps | not in scope |
| IDN-R18 AI delegation | not built |
| IDN-R19 break-glass | done, but P1-5 |
| IDN-R20 support access | done (P2-17) |
| IDN-R21 security log | partial: events are in the audit log plus alerts; no security-log export |
| IDN-I04 | **violated** (P1-2) |
| IDN-I06 | done |
| IDN-I07 | done for sessions; API keys survive suspension and password reset (P1-3) |

**platform (`docs/specs/platform.md`)**

| Req | Status |
|---|---|
| PLT-R03 banner | done |
| PLT-R05 trial | done; reset re-copy depends on integration; purge job LATER; P2-7 |
| PLT-R10 limit | inconsistent (P2-8) |
| PLT-R14 activation | done; deactivation preconditions and launch-gate approval missing (P2-9) |
| PLT-R17 owners | done |
| PLT-R19 outlets | done |
| PLT-R20 / R21 / R22 / R23 editions, entitlements, add-ons, packs | done |
| PLT-R29 rollout groups | done for configuration bundles |
| PLT-R35 / R36 authority, tenth domain, G-01/G-07 | done |
| G-02 transitions | done; ST-08 fails open (P2-5) |
| PLT-R37 preview (MUST) | **missing** |
| PLT-R38 coherence (MUST) | **missing** (EC-PLT-015 incoherent authority passes) |
| PLT-R39 matrix screen / portfolio view | API only |
| PLT-R24 usage meters | **missing** |
| PLT-R40 feature visibility | **missing** |
| PLT-R13 classification history | **missing** |
| PLT-R27 policy locks | **missing** |
| PLT-R34 external business date | **missing** |

### Data authority and activation versus `docs/adoption/source-of-truth-matrix.md`
- Matches the matrix: CR-10's domain list (charges, payments, accounting, availability); ST-07 (frozen → `authority_transition_in_progress`, 409 with expected end); ST-11 (planner cannot approve, but P1-4); ST-12 (external + exclusive refused, also enforced by a DB constraint); ST-13 (history row with approver and transition id, event emitted once per domain); T-6 (one transaction per property).
- Gaps:
  - T-1 preview of affected workflows, screens and roles (PLT-R37) is missing.
  - ST-08 fails open (P2-5).
  - There are no coherence rules, so availability can be made external while reservations stay with Portico.
  - A frozen transition has no expiry or alert when `expected_end_at` passes; the domain stays frozen indefinitely.
  - A system actor bypasses CR-10 (`setDataAuthority` skips the second approver when `actor.kind === 'system'`). No route uses a system actor today; keep it that way and document it.
  - The activation scope is enforced by `assertEffectInScope`, but **no adapter calls it**. G-04 is real only after FR-1 (kernel hook) or adapter adoption, and the README says so honestly.

---

## 4. Scenario-claim assessment

| Claim (README) | Assessment |
|---|---|
| **S17** cross-tenant access: support sessions and roles invisible to other orgs | **False as stated.** Support sessions are tested (`support-security.test.ts:134-136`, HTTP 404 on foreign approve). Roles and members are not tested. P0-1 and P0-2 show another organization *writing* this organization's members' credentials. Withdraw the claim until the P0s are fixed and per-table isolation tests exist. |
| **E04** revoked permission | Partly true. Removal, password reset, SCIM deactivation and API-key revocation take effect on the next request (tested). Suspension and password reset leave the person's API keys working (P1-3). |
| **E09** cross-property transfer | True for identity's part: atomic, audited, immediate or scheduled (`roles-lifecycle.test.ts` "transfers between properties…"). |
| Platform invariants (README table) | Accurate except "Live effects outside the approved scope are refused **and audited**" (P2-6) and "pending forwarded operations block completion (ST-08)" (P2-5). EV-06, EV-09, PLT-I06/G-07, ST-07/11/13 and the ≤ 100 % ownership share under concurrency are genuinely demonstrated. |
| Readiness levels | Honest: R3 for internal work, "fake IdP only", GeoIP placeholder R1, delivery R1. No overclaim found apart from the two items above. |

---

## 5. Behaviour changes other modules will hit (owners must adapt)

| Change | Who is affected | Required adaptation |
|---|---|---|
| `setDataAuthority` refuses `charges`, `payments`, `accounting` and `availability` for non-system actors (`second_approval_required`), and any domain while a transition is open | **integration**: `modules/integration/src/service/connections.ts:985-998` (`applyAuthority` during connection activation). **finance**: `test/security-and-corrections.test.ts:115-135` (charges). **inventory**: `test/isolation-permissions.test.ts:262-276` (availability). Default `testContext` actors are users, so these break after merge. | integration: activate money and availability authority through an authority transition (plan → approve by another person → freeze → complete) and bind `PlatformPorts.transitionGuard`. Tests: use a `system` context or the transition flow. |
| `DataDomain` gains `guestCommunications` | integration `contracts.ts:56-62` keeps its own 9-domain enum; backoffice matrix UI | Import `DATA_DOMAINS` / `dataDomain` from platform contracts instead of copying. |
| `updateProperty` refuses status changes (`use_activation_workflow`) | **backoffice** `features/admin/property-detail-page.tsx:242` (status select through PATCH) | Use the activation page: request, approval by another person, direct stop or deactivate. |
| Login may return `status: 'mfa_required'`; 403 problem codes `mfa_required` / `mfa_enrollment_required` with `verifyPath` / `enrolPath` | **backoffice** `features/auth/sign-in-page.tsx:48` (only handles `select_organization`); `features/learn/practise-in-training.tsx:32` silently ignores it | Add the challenge step, the step-up prompt and the enrolment flow. |
| Sensitive permissions need recent MFA (15 min) after the 72 h grace | Every module whose API or HTTP tests advance the clock more than 72 h with password-only admins (night audit, Day Close: `platform.businessDate.advance` is ⚑; finance corrections) | Enrol TOTP in test helpers, or set the policy in tests. Product decision needed on a 15-minute window for desk ⚑ actions (night audit friction); add to OPEN_QUESTIONS. |
| `assignRole` refuses self-grant and escalation; `assignRole(tx, input, ports?)` | Any harness assigning roles as a user to themselves or beyond their grants (none found in other worktrees) | None found; watch backoffice role UI error codes `segregation_of_duties` / `forbidden`. |
| `general_manager` template: explicit guest permissions, now **including `guests.profile.readShared`** | guests | The guests review asked to add `readShared` only after G-P0-2 is fixed; confirm with the guests owner. |
| Configuration sections run under `platform.configuration.manage` | Every module contributing `configurationSections` (rates, finance charge codes, …) | `applyItems` must call `platform.assertWritable` and the module's own permission checks; bundle approval does not replace them. |
| `trialParticipants` / `activationChecks` ports are empty | Every module with operational data or readiness criteria | Register reset and export participants and readiness checks. |
| `getPropertyFacts` | guests (FR-4 in the guests review) | Rebind the guests property-directory port to `getPropertyFacts`. |

## 6. Cross-module notes for the orchestrator

1. **Global credential ownership (P0 root cause) needs a foundation decision.** Who may change a global person's password or factors, and how an existing global identity joins a new organization (consent and acceptance). Write an ADR before the fix.
2. **Shared code candidates.**
   - `actorKey` is duplicated in platform (`service.ts:33`), integration (`service/common.ts:64`), inventory (`service/context.ts:22`), operations (`service/internal.ts:100`) and payments (`service/shared.ts:84`), and identity mixes three actor formats (`user:<id>`, `<kind>:<id>`, raw id). Move one helper to the kernel, together with `responsiblePerson(actor)` for SoD (P1-4).
   - Kernel `staticAuthorizer` union fix (P2-10).
   - FR-1 (Actor `via`, operator kind) and FR-2 (`explainDenial` in `requirePermission`) should land before more modules depend on the `onSend` hook.
   - `packages/http` `trustProxy: true` must become configured hops or CIDR (P1-7). This is on main and affects every rate limit.
3. **Domain map** (`docs/architecture/domain-map.md:77-99`) still lists 9 domains and 3 platform events. Add `getPropertyFacts`, `assertEffectInScope`, `assertWorkflowInScope`, `getPilotScope`, `getUnitOwnership`, `listOutlets`, `provenanceFor`, `hasEntitlement(…, { propertyId })`, `guestCommunications`, `platform.property.statusChanged`, `platform.authorityTransition.*`, `platform.entitlement.changed`, `platform.trial.*`, `identity.security.alert`, `identity.mfa.*`, `identity.supportSession.*` and `identity.elevation.*`.
4. **Parity.**
   - `wt/parity-front/docs/parity/platform.md` predates this branch. Rows this branch now evidences, which should be re-scored with test citations: PAR-PLT-002, 004, 006, 023, 024, 031, 033; EC-PLT-028, 029.
   - Rows still genuinely open: PAR-PLT-056/057 and EC-PLT-014/015 (preview and coherence), EC-PLT-013/016.
   - **No identity parity file exists.** Competitor capabilities the matrix must cover: SAML; passkeys; per-role or per-device session policies (OPERA, Mews); IP allow-listing; password policy and breach check; security-log export (SIEM); delegated or scoped admin (Apaleo); approval workflows; Mews-style "user activity log" export.
5. **Integration ↔ platform.** The integration connection activation flow (`applyAuthority`) and the platform transition protocol must converge: one activation, one approved transition, a bound `transitionGuard` (ST-08).
6. **Pending-fixes file.** Add the items in §5 to `docs/orchestration/pending-fixes.md` (backoffice MFA and activation UI; integration authority transitions; finance and inventory tests; the guests template question).
