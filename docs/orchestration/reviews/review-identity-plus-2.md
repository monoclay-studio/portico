# Steward review 2: `feat/identity-platform-enterprise` (ADR-0017 fix round)

Reviewer: architecture steward · 2026-11-07 · branch `feat/identity-platform-enterprise` @ `09d010c` (merge of `main`
into the fix round). While this review ran, the branch moved to `cf913b2` ("test: adapt other modules' tests to
identity-plus behaviour"). That commit changes no identity code; it makes platform's `getDataAuthority` and
`setDataAuthority` generic and adapts other modules' tests. Every finding below was re-checked at `cf913b2` and still
reproduces. The worktree `/home/user/wt/identity-plus` was not modified. Experiments ran in detached scratch copies
(`git worktree add --detach …`), which were removed afterwards.

## Verdict: **do not merge**

The fix round closes every attack the first review proved. All 11 original identity PoCs, re-expressed against the
new API, are now refused. So are the original SSO PoC and the original `X-Forwarded-For` PoC. The guard design
(`services/guard.ts`, proof of the existing factor, `(issuer, sub)` binding, power ordering, human approvers) is sound.

The branch still has **one new P0 cross-organization account takeover**, proven by executable tests in the module and
over HTTP. ADR-0017 lets any organization create a **brand-new global identity, with a password the admin chooses,
for an email address it does not own**. Nobody checks that the person behind the email consented. When a real hotel
later adds that email, the identity's holder accepts the invitation in-app (`GET /v1/me/invitations` →
`POST /v1/me/invitations/:id/accept`) and becomes the hotel's administrator. That includes the **first administrator of
a newly provisioned live organization**.

Three new P1s sit next to it:
- an `identity.sso.manage` holder can impersonate the org admin;
- any organization can permanently block a new person from joining;
- a pre-created SSO link skips the verified-domain gate.

The root cause of the P0 and of two of the P1s is the same: **orgs can mint global identities and credentials for
emails whose ownership nobody has verified**. Like the first round, the fix needs a small ADR-0017 amendment
(email-verified identities), not only patches. It therefore needs a third review.

There is also a gate-integrity problem (R2-P2-6). At `09d010c`, `pnpm typecheck` failed but reported a pass from a
stale turbo cache. `cf913b2` fixes the type error; the cache problem remains.

Counts (new findings): **P0 1 · P1 3 · P2 6 · P3 9**.

---

## 1. Command results

Scratch copies, `PORTICO_TEST_DB_PREFIX=review2_idplus`, `DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres`.
Exit codes were captured directly, not through a pipe.

| Command | `09d010c` (reviewed) | `cf913b2` (current head) |
|---|---|---|
| `pnpm install --frozen-lockfile` | pass | pass |
| `pnpm lint` (biome + boundaries) | **pass**: "Checked 625 files … Module boundaries OK (10 modules checked)" | **pass** |
| `pnpm typecheck` | exit 0, but `Cached: 16 cached, 16 total … FULL TURBO`, a **stale cache hit** (R2-P2-6) | — |
| `pnpm typecheck --force` | **FAIL** (exit 1): `@portico/integration` `test/harness.ts(102,55)` and `(103,42)` TS2322. Platform's data-authority view now has 10 domains (`guestCommunications`), which is not assignable to integration's 9-domain `DataAuthorityView`. With `--continue`: 15/16 succeed | **pass**: 16/16, `Cached: 0` |
| `pnpm --filter @portico/identity test` | **pass**: 13 files, 105 tests | **pass**: 105 |
| `pnpm --filter @portico/platform test` | **pass**: 7 files, 62 tests | **pass**: 62 |
| `pnpm --filter @portico/api test` | **FAIL**: 7 of 60 (`payments.test.ts` 6, `integration.test.ts` 1). All come from the intended "MFA before ⚑" change: test admins sign in with a password only, `POST /v1/legal-entities` answers 403 `mfa_enrollment_required`, and that cascades into a 400. Not a finding. `permission-catalog.test.ts` passes (P1-1) | **pass**: 15 files, 60 tests |
| Review-2 PoCs (below) | 9 new attacks work; 11 original attacks refused; HTTP PoC works | **same** |
| Test databases | each suite drops its own; `select count(*) from pg_database where datname like 'review2_idplus%'` → 0 afterwards | 0 |

### Proof-of-concept files (kept in `docs/orchestration/reviews/identity-plus-poc/`)
- `identity-zz-review2-poc.test.ts.txt`: 9 tests. **All pass, which means each new attack works.** N-1, N-1b, N-2,
  N-4, N-5, N-6, N-7, N-8 and N-9 (mapped to finding ids below). Copy to `modules/identity/test/` to run.
- `api-zz-review2-poc.test.ts.txt`: 1 test, **passes**. N-1 over HTTP: the first administrator of a newly provisioned
  live organization is captured. Copy to `apps/api/test/`.
- `identity-zz-review2-original.test.ts.txt`: 11 tests, **all pass, which means each original attack is now refused**.
  These are the first review's PoCs re-expressed against the new API.
- The original `identity-zz-review-sso-poc` and `api-zz-review-poc` were also re-run with their assertions inverted.
  Both pass: the SSO attack fails with `existing_account_requires_verified_domain`, and rotating XFF now gets 429.

---

## 2. Original P0/P1 findings: closed?

| id | Closed? | Evidence |
|---|---|---|
| **P0-1** admin sets another org's member's password | **Original paths closed; the P0 class is not.** | `sendPasswordResetForMember` refuses a person with any membership elsewhere (`guard.ts:24-38`, `lifecycle.ts:526-543`). `createUser` refuses `initialPassword` for an existing person and makes them `invited` (`service.ts:126-139`). Links never appear in responses (`routes.ts:496-521`; the notifier deposits them in the operator mailbox, `adapters.ts:52-80`). Re-run PoCs: "original P0-1 path A", "path B" and "wave-0 createUser" are refused. **But** R2-P0-1 reaches the same outcome, a live-org takeover by another org, through the brand-new-identity exception that ADR-0017 §2 itself grants |
| **P0-2** another org strips or replaces global MFA | **Original paths closed; two residuals.** | `resetMemberMfa` requires sole membership with invitations counted (`mfa.ts:580-619`, `memberships_elsewhere` counts every status). Enrol, disable and regenerate need proof of the existing factor (`mfa.ts:213-267`), and an SSO session never counts. SSO linking of a person who works elsewhere needs a verified domain (`sso.ts:692-702`). Re-run: "original P0-2a" and "a session alone replaces the authenticator" are refused, and the original SSO PoC is refused. Residuals: R2-P1-3 (the domain gate is skipped for pre-created links) and R2-P0-1 (a pre-registered TOTP locks the real person out) |
| **P1-1** merge break (doc comment, manifest conflict) | **Closed.** | Lint passes; `apps/api/test/permission-catalog.test.ts` passes. At `09d010c` the forced typecheck still failed for a different reason (R2-P2-6), fixed at `cf913b2` |
| **P1-2** grace lets ⚑ work without MFA | **Closed.** | `domain/step-up.ts:28-39`: ⚑ is never effective without enrolment. The grace is anchored to `users.first_activated_at` by a SECURITY DEFINER trigger (`migrations/0002…:478-487`) and capped by a check constraint at ≤ 72 h (`:106`). Re-run "original P1-2" is refused |
| **P1-3** unbounded API keys | **Closed** (one P3 residual). | `api-clients.ts:19-70`: no `*` or `identity.*` except `scim.provision`, ⚑ keys need an expiry ≤ 90 days and a fresh step-up. `service.ts:749-751` calls `assertExternalEffectAllowed('credentials.production')`. Keys are revoked on suspension (`service.ts:358`), password reset (`revoke_sessions_everywhere`, `0002…:462-463`) and MFA reset (`mfa.ts:607`). Residual: R2-P3-7 |
| **P1-4** SoD compares principals | **Closed** (P2 residual). | `platform/src/service.ts:43-62` (`responsiblePerson`, `assertHumanApprover`) is used by activation (`activation.ts:411-422`), transitions (`authority-transitions.ts:176-182`) and configuration (`configuration.ts:793-803`). Re-run "original P1-4" is refused with `human_approval_required`. Residual: R2-P2-4 (one admin, two identities) |
| **P1-5** break-glass self-designation, durable privilege | **Closed** (P3 residual). | `policy.ts:66-104`: no self-designation, the designator must hold the role, the designee must be active, and changes raise a high alert. `assertNotElevated` guards role grants, role edits, keys, SSO, SCIM tokens, policy and user creation. Re-run "original P1-5" refuses both self-designation and designating others for a role the officer lacks. Residual: R2-P3-1 (an elevated session can create a trial) |
| **P1-6** lower-privileged admin disempowers higher | **Mostly closed** (two P2s). | `assertPowerOver` and `assertAdministratorRemains` run on revoke, suspend, remove and both resets (`guard.ts:104-160`). Re-run "original P1-6" is refused. Residuals: R2-P2-2 (`transferMember`) and R2-P2-3 (group reconciliation) |
| **P1-7** TOTP brute force; spoofable client IP | **Mostly closed** (P2 residual). | Per-person counter: 5 failures → 1 min, 10 → 15 min + alert, 20 → 24 h (`mfa.ts:151-191`). Trusted proxies come from `TRUSTED_PROXY_CIDRS` (`packages/http/src/server.ts:87`). Re-run "original P1-7" locks; the original XFF PoC now gets 429. Residual: R2-P2-1 (check-then-act race) |
| **P1-8** SSO keyed on the mutable email | **Closed for the reviewed path** (P1 residual). | `sso_identities (tenant, issuer, subject)`; a linked subject whose email maps to someone else is refused (`sso.ts:687-690`); `email_verified === true` (`:673`); `requiredClaims` (`:526`). Covered by the author's `review-sso-regressions.test.ts`. Residual: R2-P1-3 |

### The author's deviations

| # | Assessment |
|---|---|
| 1 P3-8 wording | Accept. ADR-0017 prescribes the text and it names no organization. With R2-P1-2 it will often be triggered by a stranger's invitation, which the wording should then not imply is a real job. |
| 2 P2-8 | Accept as described: an advisory lock at `activation.ts:412-415`. Not re-verified beyond reading. |
| 3 P1-4 | Accept (verified above). |
| 4 P2-6 optional `database` | Accept. Durability depends on callers passing `database`, and no adapter calls `assertEffectInScope` yet (R2-P3-9). |
| 5 SSO sign-in = consent on a verified domain; SCIM never activates elsewhere | **Acceptable in principle**: the domain owner controls the mailbox anyway. **Not safe as built**, for three reasons. (a) Verification survives an issuer change made by a mere `identity.sso.manage` holder (R2-P1-1). (b) Credentials that someone else set before the link survive the link (R2-P0-1 variant B). (c) Group-based role removal is not protected for the last administrator (R2-P2-3). SCIM user creation and activation do respect it (`scim.ts:141, 243-255`). |
| 6 P2-1 / P2-4 partial | Accept; tracked in the README. |
| 7 Kernel PoC as an identity test | Accept (`review-regressions.test.ts:424`). |
| 8 `POST /v1/me/mfa/disable` | Accept: same handler and proof as `DELETE /me/mfa` (`routes.ts:402-414`). |

---

## 3. New findings

### P0: security / isolation

| id | file:line | attack | concrete fix |
|---|---|---|---|
| **R2-P0-1** Account pre-hijacking: any organization mints a global identity, with credentials, for an email it does not own, then takes over the real person's membership elsewhere | `service.ts:133-139, 153-159` (`initialPassword` for a "brand-new" email); `contracts.ts:56`; `lifecycle.ts:400-448` (`listMyInvitations` and `acceptMembershipAsSelf` accept with **any** session of the identity, with no email proof and no expiry check); `routes.ts:415-430`; `apps/api/src/provisioning.ts:50-56` (live provisioning: an existing email makes the first admin `invited` silently); `sso.ts:692-716` (a verified-domain link keeps pre-existing credentials) | **A (in-app):** (1) Attacker administers any org, for example a free trial. (2) `POST /v1/users {email: gm@hotel.mv, initialPassword: <own>}` → `status: active`, so the global password is now the attacker's. (3) Later the real hotel adds `gm@hotel.mv` as `org_admin` → `invited`, because the global user exists. (4) The attacker signs in to their own org as "the GM", calls `GET /v1/me/invitations`, sees the hotel, and calls `POST /v1/me/invitations/:hotel/accept`. (5) The attacker signs in to the hotel with their password, enrols their own TOTP (proof = their password) and holds every ⚑ admin permission. They then create a second admin with a brand-new email for persistence. (6) The real GM recovers the password by email, but the attacker's authenticator stays. The GM is stuck at `mfa_required`, and the hotel's admin cannot reset it (`person_shared_with_other_organization`). **B (SSO, deviation 5):** with steps (1)–(2) done, the hotel's legitimate IdP links the existing identity through its verified domain on the GM's first SSO sign-in. The attacker's password still signs in to the hotel unless SSO is required. **C (first live admin):** `provisionOrganization` creates the hotel's first admin with `createUser` → `invited`, discards the status and sends no invitation. The pre-registrant accepts and becomes the **only** administrator of the new live organization. PoCs: `identity-zz-review2-poc` N-1 and N-1b; `api-zz-review2-poc` (HTTP, variant C). Precondition: guessing an email the hotel will use (GM, owner, finance). These are usually public, and the first market has no pilots yet, so every first onboarding is exposed. | Amend ADR-0017 §2. (1) **Remove `initialPassword`** from `createUser`, `POST /v1/users` and provisioning. Every new person sets their first password through the emailed link; seeding uses a system-only helper that is never routed. (2) Add `identity.users.email_verified_at`. Set it only when the person completes an emailed link (invitation, reset) or signs in through an IdP whose domain **this** org verified. (3) An unverified identity is org-local: `listMyInvitations` and `acceptMembershipAsSelf` refuse it, and acceptance also requires a recent step-up when a factor exists and an unexpired, unrevoked invitation. (4) When an email is verified for the first time, through another org's link or a verified-domain IdP, **wipe every credential set before verification** before the person sets their own: password, TOTP, recovery codes, other orgs' `sso_identities` links, sessions everywhere, and API keys created by the identity. This is the standard pre-hijack defence. (5) `provisionOrganization` returns the admin status, sends the invitation, and makes the operator confirm an `invited` first admin. (6) Regression tests for A, B and C. |

### P1: contract / architecture / missing MUST / bypasses

| id | file:line | attack | concrete fix |
|---|---|---|---|
| **R2-P1-1** `identity.sso.manage` alone impersonates any member, the org admin included | `sso.ts:206-281` (`configureSso`: issuer, allow-list and `trustIdpMfa` change with only `identity.sso.manage`, no power check); `sso.ts:686-716` (a new issuer has no links, so a sole-organization member is linked without proof, and a member who works elsewhere is linked through the org's verified domain, which survives the issuer change); `sso.ts:781-787` (IdP-asserted MFA makes the session ⚑-capable); `sso.ts:346-413` (the same person can then require SSO with themselves exempt) | (1) An admin delegates SSO to IT with a custom role `['identity.sso.manage','identity.user.read']`. (2) The IT user enrols MFA and repoints the connection to an issuer they control, with `allowedEmailDomains` covering the admin's domain. (3) Their IdP asserts the admin's email with `amr: ['mfa']` → a session **as the org admin** with every ⚑ permission (`identity.role.assign`, `platform.dataAuthority.manage`, …). The same lever reaches "people who work elsewhere" through the old domain verification (in-org access only; their global credentials stay safe thanks to proof-of-factor). PoC N-2. This breaks IDN-R14's no-escalation guardrail and ADR-0017 §6, and unlike SCIM (P2-16) it is not documented. | Treat the issuer, the allow-list, `trustIdpMfa` and SSO-required as root changes. Either require the editor to hold `*` org-wide (`assertCanGrantRole(tx, ['*'], org)`), or require a second administrator's approval. On an issuer change, reset domain verification to "re-confirm". Never link an existing member who has a password or factor through a new issuer without that member proving it once (or an admin pre-linking them). Alert all admins on every issuer change. Document `identity.sso.manage` as administrator-equivalent until then. |
| **R2-P1-2** Any organization permanently blocks a new person from joining another organization | `lifecycle.ts:340-349` (the link path refuses `sign_in_to_accept` when the person has **no credential at all** but has any other membership, including an `invited` one); `lifecycle.ts:486-489` with `0001…:130-139` (`login_lookup` counts only **active** memberships, so "forgot password" silently sends nothing); `guard.ts:24-38` (the hotel's admin cannot help either) | (1) Before or after the hotel invites `newhire@hotel.mv`, any org (a free trial) invites the same email; the membership stays `invited` forever. (2) The real person opens the hotel's link and chooses a password → `sign_in_to_accept: Sign in there…`, but they have no sign-in anywhere. (3) "Forgot password" → nothing is sent. (4) The hotel admin's reset → `person_shared_with_other_organization`. No recovery path exists apart from the griefer. PoC N-5. This blocks onboarding at will, at any scale, during pilots. | Decide on credentials, not memberships: a person with **no** password, no active factor and no SSO link may set their first password through an emailed link of any org, because the link proves email control. That sets `email_verified_at` (R2-P0-1). Ignore never-accepted `invited` memberships in `membershipsElsewhere` for this decision. `requestPasswordReset` should reach people who only have invitations, through the inviting live org. Expire `invited` memberships with their invitation. |
| **R2-P1-3** An SSO link created before the person exists bypasses the verified-domain gate (ADR-0017 §5); a failed JIT commits the user and the link | `sso.ts:686-734` (the elsewhere/verified check runs only when **no** link exists); `sso.ts:661-669, 743-748` (`fail()` returns, so phase 3 **commits** the `ensure_user` row and the `sso_identities` link even when sign-in is refused); `sso.ts:712-716` | (1) The attacker org's IdP (allow-list = the victim's domain, never verified) signs in as `gm@hotel.mv` with an unmapped group. The sign-in "fails" `no_mapped_group`, but the global user and the `(attacker-issuer, sub)` link are committed. (2) The real GM later joins the real hotel through its invitation. (3) The attacker's IdP signs in again with a mapped group: the existing link skips the domain gate, JIT makes the GM an **active member of the attacker's org** without consent, and the attacker gets a session as the GM's global identity. With that session they can list the GM's pending invitations (organization names) and accept them. PoC N-7. The README invariant "an IdP cannot assert a person of an unverified domain who works elsewhere" is false. | Run the `elsewhere > 0 && !verified` check whenever SSO would **create or activate** a membership, not only for new links. Write the user and the link only after every membership check passes; audit failures in a separate transaction, as `auditFailure` already does. Purge links whose user has no membership in the linking org. Regression test for the pre-link order. |

### P2: tests, robustness, consistency

| id | file:line | problem | concrete fix |
|---|---|---|---|
| **R2-P2-1** The per-person second-factor limit is a check-then-act race | `mfa.ts:141-148` (lock read without a row lock); `mfa.ts:684-693`, `:219-226`, `:494-508`, `lifecycle.ts:315-331` (verify, then count) | With the password, N parallel challenges are all evaluated before any failure commits: **8 of 8** wrong codes were checked concurrently (the test pool size), where the sequential limit delays the 6th. After the 24 h lock, each lock window still gives one burst of pool × instances guesses. PoC N-4. | Reserve the attempt atomically before verifying: `update identity.users set mfa_failed_attempts = mfa_failed_attempts + 1 where id = $1 and (mfa_locked_until is null or mfa_locked_until <= now()) returning …`, or `select … for update` on the user row. Then refund or reset on success. Add a concurrency regression test. |
| **R2-P2-2** `transferMember` bypasses power ordering and property scope | `lifecycle.ts:648-673` (`requirePermission(tx,'identity.role.assign')` without a property; from-property assignments revoked with no `assertPowerOver`) | A role assigner scoped to property Y strips a manager of property X by "transferring" them to Y; `revokeAssignment` on the same assignment is refused. PoC N-6. | Require `identity.role.assign` at both properties, run `assertCanGrantRole` and `assertPowerOver` on the removed roles at the from-property, and refuse self-transfer. |
| **R2-P2-3** Group reconciliation removes the last administrator | `mapped-roles.ts:34-90` (revokes with no `assertAdministratorRemains`), called from `sso.ts:780` and `scim.ts:454-462` (SCIM group patch, delete and rename) | An SSO sign-in without the admin group (or a SCIM group change) revokes the only org-wide `org_admin` → 0 administrators. PoC N-8. The README's "the last administrator cannot be deprovisioned" holds only for SCIM *user* deactivation and deletion. | In reconciliation, skip revoking an assignment that `assertAdministratorRemains` would refuse, keep it, and raise a high alert. Test both SSO and SCIM group paths. |
| **R2-P2-4** One administrator satisfies SoD with an account they created | `service.ts:153-159` + `platform/src/services/activation.ts:411-422` | The admin calls `createUser` with an `initialPassword` they know and `org_admin`, enrols that account's TOTP and approves their own activation request. PoC N-9. This is inherent to two identities, but `initialPassword` makes it free and invisible. | R2-P0-1 (1) removes the cheap path. Add defence in depth: refuse an approval when the approver's membership or roles were created or granted by the requester (`role_assignments.granted_by`, a new `memberships.created_by`), or when the approver has been active for less than 24 h; flag it in the audit. |
| **R2-P2-5** Live provisioning silently creates an `invited` first admin | `apps/api/src/provisioning.ts:50-56` | When the first admin's email already exists, the result hides `invited` and no invitation is sent. The operator believes the org has an active admin, and the real person learns nothing. This is the delivery half of R2-P0-1 C. | Return `adminStatus`, call `sendInvitation`, and have the operator console show "pending acceptance". |
| **R2-P2-6** The turbo cache hides typecheck and test failures | `turbo.json:5-6` (`typecheck` and `test` have `"dependsOn": []`, so a package's cache key ignores changes in its workspace dependencies) | At `09d010c`, `pnpm typecheck` printed "FULL TURBO, 16 cached" and exit 0 on a fresh worktree, while `--force` failed in `@portico/integration` (`test/harness.ts:102-103`, TS2322 against platform's 10-domain view). `cf913b2` fixes that error, but any reviewer or CI that trusts the cache can still merge a red build; `pnpm test` through turbo has the same blind spot. | Make the tasks depend on their workspace dependencies (`"dependsOn": ["^typecheck"]` / `["^test"]`, or `inputs` that include workspace sources). Until then, run the merge gates with `--force`. |

### P3: nits

- **R2-P3-1** `apps/api/src/provisioning.ts:176-181`: `createTrialForOrganization` does not refuse `via: 'elevation'`. A
  break-glass session creates a trial and becomes its durable administrator, against the spirit of ADR-0017 §10.
  Call `assertNotElevated`.
- **R2-P3-2** `mfa.ts:342-366`: `confirmTotp` failures are not counted, and there is no attempt cap per pending factor.
  With a stolen session during someone's 15-minute enrolment window, the pending code can be brute-forced at the global
  limit (600/min/IP), which yields fresh recovery codes. Cap at 5 attempts per pending factor and count them per person.
- **R2-P3-3** `lifecycle.ts:410-448`: in-app acceptance ignores the invitation's 7-day expiry and revocation (only
  `memberships.status = 'invited'` is checked). SSO activation of an invited membership (`sso.ts:772-779`) does too.
- **R2-P3-4** `role-mapping.ts:77-80` (`lastIndexOf('@')`) vs `sso.ts:694` (`split('@')[1]`): the email domain is
  parsed in two ways. JIT accepts unvalidated `email` claims, so `a@b@domain` yields different domains for the
  allow-list and the verification check. Validate the claim with one parser.
- **R2-P3-5** `sso.ts:860-895`: a domain verification is never re-checked and is not bound to the issuer (see
  R2-P1-1). Re-verify periodically and when the issuer changes.
- **R2-P3-6** `service.ts:139` (`status: 'invited'` reveals that an email already has a Portico identity) and
  `lifecycle.ts:898` (`getMember` shows an *invited*, non-consenting person's MFA enrolment and remaining recovery
  codes): account enumeration plus a cross-organization disclosure. Hide credential details until acceptance; return
  the same shape for new and existing emails.
- **R2-P3-7** `guard.ts:163-171`: API keys survive their creator's demotion (role revoked). Only suspension, password
  reset and MFA reset revoke them. Consider re-checking that key permissions ⊆ creator grants at authentication, or
  revoking on role revocation.
- **R2-P3-8** `sso.ts:609-615`: phase 1 marks the state consumed **before** checking the browser binding, so anyone
  holding a leaked `(state, code)` can burn the legitimate login. Check the binding first.
- **R2-P3-9** Deviation 4: `assertEffectInScope` audits refusals durably only when callers pass `database`, and no
  adapter calls it yet (G-04 remains future work, as the README says). Make `database` mandatory when the kernel hook
  lands.

---

## 4. Answers to the specific questions

- **Can an org-controlled path change or strip a credential of a person who belongs to another org?** Not directly:
  admin, SCIM, API key, support, break-glass, recovery-code and MFA-disable paths all require sole membership or proof
  of the existing factor. **Indirectly, yes (R2-P0-1):** an org can set credentials *before* the person belongs
  anywhere else, and those credentials follow the person into other orgs.
- **Can it activate someone without consent?** Through `acceptMembershipAsSelf` with a pre-hijacked identity
  (R2-P0-1) and through a pre-created SSO link (R2-P1-3). SCIM never activates someone who works elsewhere (verified).
- **Deviation 5 with an attacker-controlled IdP:** another org's verification cannot be reused (it is RLS-scoped per
  tenant, with a per-tenant token). Verification is not bound to the issuer, though, so whoever can change the issuer
  inherits it (R2-P1-1).
- **Can one person satisfy separation of duties?** Not with their own API client or a support session (fixed). Yes
  with a second identity they created with `initialPassword` (R2-P2-4).
- **Can break-glass create durable privileges?** The ADR-0017 §10 list is fully guarded. One residual: trial creation
  (R2-P3-1).
- **Can the per-person second-factor counter be bypassed?** Yes, by concurrency (R2-P2-1). It cannot be reset without
  a correct factor, except by a sole-org admin's MFA reset.
- **Do org IdP sessions count for global credential changes?** No: `proveExistingCredential` ignores the session
  (`mfa.ts:213-267`). The one exception is a person with no password and no factor who is a sole-org member, which is
  by design. Combined with R2-P1-3 or an attacker-org JIT, that exception lets an attacker IdP enrol a TOTP on a ghost
  identity before the real person exists. The R2-P0-1 credential wipe covers that case.

## 5. Notes for the orchestrator

1. The P0 and two of the P1s share one design fix: an **email-verified identity** and a **credential wipe on first
   verification**. Record it as an ADR-0017 amendment before the fix round, then re-run this review's PoCs: they must
   all fail after the fix, and the 11 "original" ones must keep passing.
2. R2-P2-6 affects every merge: until `turbo.json` makes tasks depend on their workspace dependencies, run gates with
   `--force` (`pnpm typecheck --force`, `turbo run test --force`).
3. The integration-harness type error and the 7 API test failures at `09d010c` were the parallel adaptation work;
   `cf913b2` resolves both (forced typecheck 16/16, API 60/60). The new attacks still reproduce at `cf913b2`.
