# Steward review 3: `feat/identity-platform-enterprise` (ADR-0017 amendment 1)

Reviewer: architecture steward · 2026-11-07 · branch `feat/identity-platform-enterprise` @ `3f72a15`.
The worktree `/home/user/wt/identity-plus` was not modified. Experiments ran in two detached scratch copies:
- the branch head, for the PoCs;
- the branch merged with current `main` (`32b5cd2`), for the gates.

Both copies were removed afterwards.

Scope: a short, focused re-review of ADR-0017 Amendment 1 (rules 12–15) and the fix round for the second review
(`review-identity-plus-2.md`).

## Verdict: **merge after fixes**

The amendment works for every attack the second review proved.
- All nine R2 attacks (N-1 … N-9) are now refused, re-expressed against the new API.
- So is the HTTP capture of a new live organization's first administrator.
- So are all 11 first-review attacks.
- No P0 remains: no deterministic path lets an organization set, keep or use a credential for an email it does not
  own.
- All three gates pass on a copy merged with `main`, forced and uncached.

Two new P1s must be fixed before merge. Both are small and local. Neither needs another ADR amendment, only one
clarifying sentence in rule 15.

1. **R3-P1-1: the first-verification wipe is not atomic.** A credential write that is already in flight when the
   real person verifies their email survives the wipe. PoC W-1 proves it. An attacker organization:
   - pre-creates the person's identity through its own SSO;
   - keeps a pending authenticator for it;
   - confirms that authenticator while the real GM accepts the hotel's invitation.

   The attacker's authenticator becomes the GM's active factor *after* the wipe. The GM is locked out at
   onboarding, and the hotel's admin cannot reset it. If the GM is the hotel's first or only administrator, the
   live organization has no usable admin, and Portico has no recovery runbook yet. The attacker also holds the
   GM's second factor and fresh recovery codes, so phishing the password is all that remains.
2. **R3-P1-2: rule 15's root-change list misses the groups claim.** An `identity.sso.manage` holder cannot map a
   group to `org_admin`, but can change *which claim carries the groups*. PoC W-2 shows them becoming `org_admin`
   through a profile claim they edit themselves. This is the R2-P1-1 class through a lever the fix did not cover.

The P2s should be fixed before the first pilot. They are:
- R3-P2-1: SSO managers can delete mappings they could not create;
- R3-P2-2: domain verification is stale and non-exclusive, yet now counts as global email verification;
- R3-P2-3: the documented "SSO-only member loses the link" gap is in fact a permanent lock-out under SSO-required,
  and the README's stated remedy does not work.

**Condition for merge.** PoCs W-1, W-2 and W-3 must fail (the attack is refused) and be committed as regression
tests. A steward spot-check of those three is enough; a fourth full review is not needed.

Counts (new findings): **P0 0 · P1 2 · P2 3 · P3 5**.

---

## 1. Command results

Gates ran in a scratch copy of `3f72a15` merged with `main` `32b5cd2`. The merge had one conflict, in
`docs/OPEN_QUESTIONS.md`: both sides appended questions (Q146–Q149 and Q150–Q155). It was resolved by keeping both.
Settings: `DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres`, `PORTICO_TEST_DB_PREFIX=review3_idplus`.
Exit codes were captured directly, not through a pipe.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `pnpm lint` | **exit 0**: "Checked 627 files … No fixes applied. Module boundaries OK (10 modules checked)" |
| `pnpm turbo run typecheck --force` | **exit 0**: 16/16 successful, `Cached: 0 cached, 16 total` |
| `pnpm turbo run test --force --concurrency=2` | **exit 0**: 14/14 successful, `Cached: 0`, **1,334 tests**. identity 135 · platform 62 · api 62 · finance 85 · operations 120 · reservations 147 · integration 173 · guests 173 · rates 128 · payments 113 · inventory 96 · kernel 25 · db 12 · http 3 |
| PoCs (branch head, prefix `review3_idplus_poc`) | Re-runs: 9 R2 + 1 HTTP + 11 originals, **all refused**. New: **6 attacks work** (W-1 … W-6) |
| Test databases | `select datname from pg_database where datname like 'review3_idplus%'` → **0 rows** after all runs |

R2-P2-6 (stale turbo cache) is closed on `main` by `1be3ddc`: task inputs now hash every workspace package. The
branch still carries the old `turbo.json`; the merge brings in the fix.

### Proof-of-concept files (`docs/orchestration/reviews/identity-plus-poc/`)

| File | Tests | Meaning when they pass | Copy to |
|---|---|---|---|
| `identity-zz-review3-poc.test.ts.txt` | 6 | **The new attack works** (W-1 … W-6) | `modules/identity/test/` |
| `identity-zz-review3-rerun.test.ts.txt` | 9 | The R2 attack N-1 … N-9 is **refused** | `modules/identity/test/` |
| `identity-zz-review3-original.test.ts.txt` | 11 | The first-review attack is **refused** (R2's file; only path B now expects `password_not_allowed`) | `modules/identity/test/` |
| `api-zz-review3-http.test.ts.txt` | 1 | The HTTP first-admin capture is **refused** | `apps/api/test/` |

In the HTTP file, `POST /v1/users` with `initialPassword` answers `password_not_allowed`. Provisioning returns
`adminStatus: 'invited'` with `delivery: queued`. Live provisioning with a password for a real address is refused.

W-1 adds a test-only trigger (`pg_sleep(1.5)` when `email_verified_at` goes from null to set). It widens the real
window so the interleaving is deterministic. The trigger changes timing only, never logic. In production the window
is the argon2 hash (19 MiB, t=2) plus the wipe's statements, roughly 50–100 ms.

---

## 2. Second-review findings: closed?

| R2 id | Closed? | Evidence |
|---|---|---|
| **R2-P0-1** pre-hijacking (A in-app, B SSO, C first live admin) | **Closed for every deterministic path.** One race residual: **R3-P1-1**. | `initialPassword` is refused (`lifecycle.ts` `createUser`, `password_not_allowed`). `seedDemoMember` is the only password path: system actor, `demo` environment, `*.portico.invalid` (`lifecycle.ts:169-212`). Listing and acceptance require a verified email and an unexpired invitation (`lifecycle.ts:534-600`). The first verification wipes everything (`0002…:541-568`). Re-runs N-1 (both the `createUser` path and the JIT-ghost path) and N-1b refused; the HTTP first-admin re-run is refused |
| **R2-P1-1** `identity.sso.manage` impersonates the admin | **Closed for issuer, allow-list, `trustIdpMfa` and SSO-required.** **Not closed** for the groups claim (**R3-P1-2**) or mapping removal (**R3-P2-1**). | `assertRootChange` (`guard.ts`, end) is called from `configureSso` (`sso.ts:240-246`) and `setSsoEnforcement` (`sso.ts:398`). An issuer change resets domain verification, deletes the old issuer's links and alerts admins (`sso.ts:303-325`). Re-run N-2 is refused with `forbidden` |
| **R2-P1-2** any org blocks onboarding | **Closed.** | The decision now rests on credentials (`lifecycle.ts:405-421`). `requestPasswordReset` reaches people who only hold invitations (`lifecycle.ts:642-649`). Re-run N-5: the real link works and the reset is sent. A domain-verified org can still block one way (R3-P2-2) |
| **R2-P1-3** pre-created link skips the domain gate; a failed JIT commits | **Closed.** | The callback runs every check before writing and throws `SsoRefusal` to roll back; refusals are audited separately (`sso.ts:759-949`). The domain gate runs whenever a membership would be created or activated (`sso.ts:830-838`). Re-run N-7: nothing is persisted, and the later sign-in is refused |
| R2-P2-1 second-factor race | **Closed.** | `reserveSecondFactorAttempt` (`mfa.ts:156-169`): a guarded `UPDATE` holds the row. Re-run N-4: 5 of 8 concurrent wrong codes evaluated, 3 got `second_factor_locked` (R2: 8 of 8) |
| R2-P2-2 `transferMember` | **Closed.** | `requirePermission` is checked at both properties, `assertCanGrantRole` on the removed roles, and self-transfer is refused (`lifecycle.ts:827-855`). Re-run N-6 is refused |
| R2-P2-3 group reconciliation removes the last admin | **Closed.** | `mapped-roles.ts`: the assignment is kept and a `last_administrator_kept` alert is raised. Re-run N-8 still has at least one admin |
| R2-P2-4 SoD with a self-made identity | **Cheap path closed; residual accepted.** | No organization-set password exists. Re-run N-9 is refused (`password_not_allowed`). The approver-age and created-by checks were not added; this is documented in the README "Known gaps" |
| R2-P2-5 silent invited first admin | **Closed.** | `provisioning.ts:44-96` returns `adminStatus` and `delivery` and requires a notifier. HTTP re-run passes |
| R2-P2-6 turbo cache | **Closed on `main`** (`1be3ddc`). | Gates above: `Cached: 0`, and every input is hashed |
| R2-P3-1 trial during elevation | Closed | `provisioning.ts:213-218` |
| R2-P3-2 `confirmTotp` uncapped | Closed | `mfa.ts:366-416`: 5 attempts per pending factor, also counted per person |
| R2-P3-3 acceptance ignores expiry | Closed | `hasValidInvitation` (`lifecycle.ts:517-528`); the SSO path checks it too (`sso.ts:849-859`) |
| R2-P3-4 two email parsers | Closed for SSO | `emailDomain` (`role-mapping.ts:80-91`); `seedDemoMember` still uses `split('@').at(-1)`, harmless because it is system-only |
| R2-P3-5 domain verification never re-checked or bound | **Partly.** | Reset on an issuer change, but never re-checked, and now load-bearing: **R3-P2-2** |
| R2-P3-6 enumeration / invited person's MFA shown | Closed | `createUser` always answers `invited` with the same shape; `getMember.mfa` is null while invited |
| R2-P3-7 API keys survive demotion | Open (documented) | README known gaps |
| R2-P3-8 state consumed before binding check | Closed | `sso.ts:708-710` |
| R2-P3-9 `assertEffectInScope` durability | Open (outside this round) | — |

All **11 originals** pass inverted (`identity-zz-review3-original`): P0-1 A and B, wave-0 `createUser`, P0-2a, P0-2,
P1-2, P1-4, P1-6, P1-5, P1-7, and concurrent replay.

---

## 3. New findings

### P1: security / bypass of an ADR-0017 rule

| id | file:line | attack | concrete fix |
|---|---|---|---|
| **R3-P1-1** The first-verification wipe (rule 12) is not serialized against credential writes already in flight. A factor, link or session created concurrently survives it. | **The wipe:** `0002_identity_enterprise.sql:541-568` (`first_email_verification`) locks the `users` row first, then updates factors, codes, links and sessions by `user_id`. Rows inserted or read by a concurrent transaction are invisible to it. `lifecycle.ts:420-424` hashes the new password with argon2 after the wipe, inside the same transaction, which widens the window. **`confirmTotp`:** `mfa.ts:380-392` reads the pending factor before taking the row lock in `reserveSecondFactorAttempt`. `mfa.ts:355-361` (`verifyFactorCode`) does not check `status`. `mfa.ts:422-426` activates `where id = pending.id` without re-checking `status = 'pending'`. **SSO phase 3** (`sso.ts:759-949`) never locks the user row: a link or session inserted while a wipe is running survives it. | PoC **W-1**. (1) The attacker administers any customer organization with SSO: an allow-list for `resort.mv`, never verified, with JIT. Before the hotel invites its GM, the attacker's IdP signs in `gm@resort.mv`. This mints the identity and gives the attacker a session. (2) As a sole-organization member with no credential, the attacker enrols factor A without proof, then keeps a fresh pending factor P, re-enrolling every 10 minutes with A's codes or recovery codes. (3) The hotel invites the GM. The GM follows the link and chooses a password, which starts the first verification. (4) Any attacker `confirmTotp(P)` request that starts inside that transaction authenticates, because the session revocation is not yet committed. It reads P as pending and then waits on the users row. Once the wipe commits, it activates P, writes new recovery codes and commits. (5) Result: the GM's identity is verified, holds the GM's password **and the attacker's active authenticator**. The GM's login returns `mfa_required`, and the GM has no code. The hotel admin's `resetMemberMfa` is refused with `person_shared_with_other_organization`, because the attacker's JIT membership counts as "working elsewhere". The wipe runs only once, so nothing cleans this up. **Variant:** an SSO sign-in in the attacker org that overlaps the wipe leaves a session, or a new `(issuer, sub)` link if the ghost was SCIM-created and not yet linked. That link persists for a now-verified identity, which can then list and accept the person's future invitations. **Preconditions:** the attacker guesses the email in advance (the same as R2-P0-1) and wins a race of about 50–100 ms. The race can be retried continuously, because the attacker loops enrol and confirm in its own org and the alerts go to its own admins. | Make credential creation and the wipe mutually exclusive, and make the wipe win. (a) Every path that creates or activates a credential locks the person's `users` row **before reading credential state**, and re-reads `email_verified_at` and a new `credential_epoch` after the lock. Paths: `confirmTotp`, `enrolTotp`, SSO link insert and session creation, `createSession` for password login, API-key issue, `acceptInvitation`, `completePasswordReset`. In `confirmTotp`, move `reserveSecondFactorAttempt` (or `select … for update`) **before** the pending read. (b) Defence in depth: add `users.credential_epoch int`, incremented by `first_email_verification`. Stamp every factor, recovery code, link, session and API key with the epoch at creation; `hasActiveTotp`, `authenticateToken`, the link lookup and key auth ignore rows from an older epoch. That makes the wipe atomic whatever the races. (c) `confirmTotp` activation: `where id = $1 and status = 'pending'`, and check the row count. `verifyFactorCode`: add `status in ('pending','active')`. (d) Hash the new password **before** the transaction, as `completePasswordReset` already does. (e) Regression test: W-1 must fail. |
| **R3-P1-2** Rule 15's root-change list misses the groups claim, so an `identity.sso.manage` holder re-points group membership and becomes `org_admin` | `sso.ts:240-246` (`rootChange` covers issuer, domains and `trustIdpMfa` only); `sso.ts:271-272` (`groups_claim`, `jit_provisioning` written for any `identity.sso.manage` holder); compare `sso.ts:355` (`setGroupRoleMappings` refuses a mapping the editor could not grant) | PoC **W-2**. (1) A root admin maps the IdP group `admins` to `org_admin`, which is normal practice. (2) IT holds a custom role `['identity.sso.manage','identity.user.read']`. Mapping a group to `org_admin` is refused with `forbidden`, as designed. (3) IT calls `configureSso` with the same issuer, domains and trust, but `groupsClaim: 'nickname'`. This is not a root change, so it succeeds with no alert. (4) IT links their own IdP account (`POST /v1/me/sso/link`, password plus fresh TOTP) with `nickname: "admins"`. In Keycloak, Okta (profile editor) and Google Workspace (name), people can edit such profile claims themselves. (5) Reconciliation grants `org_admin`: `identity.role.assign` and `platform.dataAuthority.manage` become true. Repointing to a claim that is absent instead strips every SSO-mapped role at next sign-in. **Precondition:** the IdP emits a claim the attacker can influence, plus a mapping to a powerful role. | Treat `groups_claim` as a root change in `configureSso`, and also `jit_provisioning` and `client_id`; the client id decides which app's tokens are accepted under a shared issuer such as `accounts.google.com`. A simpler rule: every field except `display_name` and `client_secret` rotation is root. Amend rule 15's list in ADR-0017 to say "anything that decides who signs in or which roles a sign-in grants". Regression test: W-2 must be refused. |

### P2: robustness, consistency, availability

| id | file:line | problem | concrete fix |
|---|---|---|---|
| **R3-P2-1** `setGroupRoleMappings` checks only the **new** mappings, so an SSO manager deletes mappings to roles they could never grant | `sso.ts:330-358` (the `assertCanGrantRole` loop covers `mappings`, then `deleteFrom('identity.group_role_mappings')` removes all) | PoC **W-3**: IT (holding `identity.sso.manage` only) replaces the mappings with `[]`. The next sign-in of an SSO-mapped `org_admin` revokes that role; the last-admin guard keeps only the very last one. This is the R2-P2-2 class (power ordering) on the mapping surface. | Before deleting, run `assertCanGrantRole` for every **removed or changed** mapping, the same check as for added ones, or treat mapping edits that touch `*`-holding roles as root changes. Regression test: W-3 must be refused. |
| **R3-P2-2** Domain verification is never re-checked and not exclusive across organizations, yet rule 12 makes it a **global** email-verification authority with power to consent to other organizations' invitations | `sso.ts:779-785` (`domainVerified` reads a stored `verified_at`); `sso.ts:811` (`wipedFirst`); `sso.ts:909` (`verifyEmailOwnership` for any verified-domain sign-in); `sso.ts:1014-1049` (one DNS check, kept forever, per tenant, with no uniqueness across tenants); `lifecycle.ts:534-600` (any verified identity's session lists and accepts every org's invitation) | PoC **W-4**. Org X once verified `atoll.mv`; think of a former management company or IT contractor. Its TXT record has since been removed. (1) The real hotel invites `newhire@atoll.mv` as `org_admin`. (2) X's IdP signs the person in: JIT in X, and the stale verification marks the email **verified globally**. (3) X's session lists the hotel's invitation and **accepts it on the person's behalf**: the hotel now shows an active admin who never consented. (4) The person's own link is dead (`unauthenticated`). (5) Rule 14 is bypassed: a third org's invitation link now answers `sign_in_to_accept`, because X planted a link. The person recovers only through "forgot password". X keeps a permanent link to their identity, and the wipe never runs again. No access to the hotel is gained, because X still has no credential there. | (1) When a verified-domain sign-in is about to count as **first** verification, re-check the TXT record live, with a cache of at most 24 h. Fail closed to "not verified". (2) Re-verify every domain periodically, for example every 30 days, through a job that clears `verified_at` when the record is gone, and alert admins. (3) Make verification exclusive: at most one organization holds a verified domain at a time, enforced through a definer-function registry. A second claim needs the first org's release or an operator decision. (4) Scope the consent: an identity verified only through org X's IdP may accept invitations only from X; others need an emailed link (`email_verified_via` on users). |
| **R3-P2-3** First verification anywhere permanently locks an SSO-only member out of an SSO-required organization whose domain is unverified. The README's remedy does not work. | `0002…:541-568` (the wipe deletes the org's legitimate link); `sso.ts:806-812` (a verified person with a password needs proof, and domain verification does not count); `sso.ts:548-581` (`/me/sso/link` needs a **password** session **in that org**); `service.ts` `login` → `SsoRequiredError`; `README.md:249` ("A re-links them only after domain verification or their proof") | PoC **W-5**. (1) Pat signs in only through org A's SSO; A's domain is unverified and A requires SSO. (2) Pat accepts org B's emailed invitation or resets a password. That is a first verification, so the wipe deletes A's link. (3) A's SSO answers `existing_credentials_require_proof`. Password login to A answers `sso_required`, so there is no session from which to call `/me/sso/link`. (4) A then verifies its domain, and Pat is **still refused**: `wipedFirst` is false for an already-verified person. A's admin cannot help, because Pat works elsewhere. Any organization can trigger this with an invitation the person accepts in good faith. | (a) Keep links issued by the **same** organization's IdP while the person was a sole-org member, and wipe only links from organizations the person never joined with consent; or (b) let proof for `/me/sso/link` come from a password session in **any** organization, binding the state to the target org; or (c) let a verified-domain sign-in re-link a verified person whose only credentials were set after verification by the person themselves. Correct the README. Regression test: W-5. |

### P3: nits

- **R3-P3-1** The orphan purge relies on RLS alone, so its correctness depends on the role that owns the function
  (`0002…:594-613`).
  - `not exists (select 1 from identity.memberships m where m.user_id = s.user_id …)` has no
    `m.tenant_id = s.tenant_id`.
  - In production `portico_owner` is `nobypassrls` and RLS is forced, so it is tenant-safe (infra
    `db/bootstrap-roles.mjs`).
  - Tests and local `pnpm migrate` run as the `postgres` superuser. There RLS is bypassed and the purge keeps a
    link in X whenever the person has a membership in **any** tenant. PoC **W-6** passes, which means the test
    environment cannot catch a scoping bug in these definer functions.
  - Fix: add explicit `s.tenant_id = t and m.tenant_id = s.tenant_id`, and apply the same to the per-tenant loops in
    `first_email_verification` and `credential_summary`. Consider running the test migrations as a
    `nobypassrls` owner.
- **R3-P3-2** Backfill: `0002…:24` `update identity.users set email_verified_at = created_at where password_hash is
  not null` treats **any** pre-existing password as proof of email. That includes passwords set by an organization
  through `main`'s wave-0 `createUser(initialPassword)`. There is no production yet, but any shared demo or staging
  database migrated from `main` would carry org-set passwords as "verified". Fix: backfill only
  `*.portico.invalid`, and force everyone else through a reset.
- **R3-P3-3** Simulated links verify email globally.
  - `acceptInvitation` and `completePasswordReset` call `verifyEmailOwnership` whatever the delivery mode
    (`lifecycle.ts:420`, `:720`).
  - A link from a non-live organization was never sent to the address; it sits in the operator mailbox. In any
    deployment with the operator console on (`operatorConsoleEnabled: !production`), an operator token holder can
    read any recipient's link and mark a real email verified, with a password they choose.
  - Production is safe because the console is off.
  - Fix: record the delivery mode on the token, and let only live (`queued`) deliveries verify.
- **R3-P3-4** `sso_login_states` stores `link_user_id` but not the issuer (`sso.ts:523`). A root issuer change while a
  link state is open (10 minutes) binds the person to the new issuer. Store the issuer and compare it in the
  callback.
- **R3-P3-5** Merging `main` conflicts in `docs/OPEN_QUESTIONS.md`, because both sides appended questions. The
  numbering does not collide (Q146–Q149 and Q150–Q155). Resolve by keeping both.

---

## 4. Answers to the specific questions

- **Can any path still set or keep a credential for an email before the person proves it?**
  - **Setting a password: no.** `seedDemoMember` refuses a non-system actor, a non-`demo` environment and any domain
    outside `*.portico.invalid`, and it is not routed. Provisioning with a password outside demo is refused (HTTP
    re-run). SCIM has no password attribute. JIT, trial creation (`addSelfToOrganization`) and API clients create
    no person credentials. Support sessions cannot reach the self-credential paths (`selfUserId` refuses
    impersonation). No trial-conversion code path exists. Test helpers live only in `test/`. The operator mailbox
    is disabled in production.
  - **Other credentials: yes, by design.** JIT and SCIM ghosts in unverified-domain orgs still receive SSO links,
    sessions and even TOTP factors before verification; the wipe is meant to remove them.
  - **Keeping them: yes, through a race (R3-P1-1).**
  - **Migration:** the backfill counts old org-set passwords as verified (R3-P3-2).
- **Can the wipe be skipped, raced, or triggered to lock out a real person?**
  - **Skipped:** no deterministic skip was found. It covers the password, factors, codes, links, sessions and keys
    in every tenant listed in `user_tenants`, which is never shrunk.
  - **Raced:** yes (R3-P1-1).
  - **Triggered by an attacker:** only with mailbox or DNS control. Triggered by the person's own good-faith action,
    it locks them out of an SSO-required, unverified-domain organization (R3-P2-3). A stale domain verification
    lets another org trigger it for anyone who is invited but not yet verified (R3-P2-2).
- **Can an org-controlled IdP set `email_verified_at` for a domain the org has not verified?** No. Verification
  needs a `verified_at` row for the email's exact domain in **that** tenant, read under RLS. The one email parser
  rejects malformed domains. Subdomains must be verified separately.
- **Is verified-domain sign-in safe when verification is stale or reused across orgs?** No (R3-P2-2). Per-tenant
  tokens stop reuse of another org's TXT record. But nothing stops two orgs from both verifying the same domain, and
  nothing re-checks the record. A past DNS holder stays a global verification authority with consent power over
  other orgs' invitations.
- **Can rule 14 be abused to take over a credential-less person with an active membership?** Not through rule 14
  itself: the link must come from the person's own mailbox. Through the SSO path, a domain-verified org (even a
  stale one) can link a verified, credential-less person, but that gains no access to the person's other
  organizations. It blocks them and forges consent instead (R3-P2-2).
- **Is `/v1/me/sso/link` CSRF-safe and bound to the right issuer?**
  - **CSRF:** yes. Authentication is a bearer header only (`packages/http/src/auth.ts:34-38`), no cookies are read,
    and the response (including `browserBinding`) cannot be read cross-origin.
  - **Binding:** the link is bound to the person, because the callback refuses unless the IdP email maps to the
    proving user (`sso.ts:793`), and to the session's organization.
  - **Issuer:** not bound (R3-P3-4).
- **Is the hourly orphan purge tenant-safe?**
  - In production, yes: the definer owner has no `bypassrls` and RLS is forced, so each loop iteration sees one
    tenant.
  - The SQL has no explicit tenant predicates, though, and under the superuser used by tests and local migrations
    it is wrong (R3-P3-1).
  - The job is registered (`composition.ts:603`).

## 5. Notes for the orchestrator

1. **Merge after fixes.** Required fixes:
   - R3-P1-1: lock ordering plus a credential epoch.
   - R3-P1-2: extend the root-change list.

   R3-P2-1 is a one-loop fix and should ride along. The fix round must turn W-1, W-2 and W-3 into regression tests
   that assert refusal. W-4 and W-5 should become tests once their design choice is made. Recommendation for R3-P2-2:
   re-check the TXT record at first verification and make verification exclusive.
2. Rule 15 needs one sentence: "root = anything that decides who can sign in or which roles a sign-in grants". This
   is an ADR clarification, not a new amendment.
3. R3-P3-1 applies to every security-definer "visit each tenant" function in the repository: tests run as superuser,
   so they cannot prove RLS-dependent logic. Consider a migration-owner role with `nobypassrls` in
   `packages/testing`. That would also strengthen the isolation P0 tests generally.
