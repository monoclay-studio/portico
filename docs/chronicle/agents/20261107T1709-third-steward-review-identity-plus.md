# Agent run: Third steward review: identity-plus

- Started: 2026-11-07T17:09:31.338Z · last activity: 2026-11-07T17:30:16.306Z
- Turns: 144 · tool uses: 82 · output tokens: 254,826
- Type: general-purpose

## Brief (2026-11-07T17:09:31.338Z)

````text
You are the architecture steward for Portico (repo /home/user/portico; read CLAUDE.md). This is a SHORT, focused THIRD security review of branch `feat/identity-platform-enterprise` (worktree /home/user/wt/identity-plus at HEAD 3f72a15 or later). Do NOT modify that worktree. Use a detached scratch copy (`git worktree add --detach <scratch> feat/identity-platform-enterprise`) and remove it at the end.

Read:
- docs/adr/0017-global-identity-and-cross-organization-safety.md, including **Amendment 1** (rules 12–15);
- the second review: docs/orchestration/reviews/review-identity-plus-2.md;
- its PoCs: docs/orchestration/reviews/identity-plus-poc/*.ts.txt;
- the author's fix report, summarised here:
  - `initialPassword` removed everywhere; `seedDemoMember` is the only path that sets a password (system process, demo org, `*.portico.invalid` only);
  - createUser always invites;
  - the email link sets `email_verified_at`, and so does a verified-domain SSO sign-in;
  - first verification runs `identity.first_email_verification`, which wipes the password, factors, recovery codes, SSO links, sessions and the person's API keys in every org;
  - invitations are listed and accepted only with a verified email, before expiry;
  - whether a person can set a first password depends on `identity.credential_summary`;
  - SSO root changes need org-wide `*`; an issuer change resets domain verification, removes the old issuer's links and alerts admins;
  - linking an existing credentialed person needs `POST /v1/me/sso/link` from a password session, plus a fresh second factor;
  - SSO callback checks run before any write, and refusals are audited separately;
  - orphan links are purged hourly;
  - the second-factor counter is reserved atomically;
  - the provisioning API invites the first admin;
  - test helpers read real invitation links from the dev mailbox or the outbox.
- If they exist: docs/quality/playbooks/steward-reviewer.md and docs/quality/patterns.md (on main or on branch docs/quality in /home/user/wt/quality).

Scope (keep it tight):
1. Re-run every second-review PoC (N-1 … N-9, plus the HTTP first-admin takeover) and the 11 originals, adapted to the new API. All must be refused.
2. Look for bypasses of rules 12–15 specifically:
   - Can any path still set or keep a credential for an email before the person proves it? Check: seeding outside demo, SCIM, JIT, trial conversion, migration, API clients, support sessions, test-only paths reachable in production.
   - Can the wipe on first verification be skipped, raced, or triggered by an attacker to lock out a real person?
   - Can `email_verified_at` be set by an org-controlled IdP for a domain the org has not verified?
   - Is the verified-domain sign-in, treated as verification, safe when domain verification is stale or reused across orgs?
   - Can rule 14 (credential-based first password) be abused to take over an account that has no credentials yet but does have an active membership?
   - Is `/v1/me/sso/link` CSRF-safe and bound to the right issuer?
   - Is the hourly orphan purge tenant-safe?
3. Gates on a copy merged with current main:
   - `pnpm lint`;
   - `pnpm turbo run typecheck --force`;
   - `pnpm turbo run test --force --concurrency=2` (PORTICO_TEST_DB_PREFIX=review3_idplus; Postgres at postgres://postgres@127.0.0.1:5432/postgres).

   Check exit codes, and drop the databases you create.

Write the report to /home/user/portico/docs/orchestration/reviews/review-identity-plus-3.md. Don't commit it. Include:
- verdict: merge / merge after fixes / do not merge;
- a table of R2 findings → closed?;
- new findings ranked P0–P3 with file:line, attack steps and a fix;
- command results.

Save any new proven attack as a .ts.txt PoC in docs/orchestration/reviews/identity-plus-poc/.

Reply with the verdict, counts, the top findings in plain English and the report path.
````

## Report (2026-11-07T17:30:16.191Z)

````text
## Third review of `feat/identity-platform-enterprise` @ 3f72a15: merge after fixes

There is no P0 left, but two new P1s must be fixed before merge. New findings: **P0 0 · P1 2 · P2 3 · P3 5**.

Report: `/home/user/portico/docs/orchestration/reviews/review-identity-plus-3.md` (not committed).

### Old attacks
Everything the second review proved is now refused, and so are the first review's attacks. I rewrote each attack test for the new API and ran it:
- the 9 attacks N-1 to N-9;
- the HTTP takeover of a new hotel's first administrator;
- the 11 attacks from the first review.

Every second-review finding is closed except the ones the author documented as remaining (R2-P2-4 and R2-P3-7). R2-P3-5, "domain verification is never re-checked", is only partly fixed and now matters more (R3-P2-2 below).

### New findings
1. **R3-P1-1: the wipe on first email verification can be raced.**
   - An attacker org with its own SSO pre-creates the GM's identity and keeps a half-finished authenticator set-up for it.
   - It finishes that set-up at the moment the real GM accepts the hotel's invitation.
   - The attacker's authenticator becomes the GM's active second factor after the wipe. The GM is locked out at onboarding, and the hotel's admin cannot reset it.
   - If the GM is the hotel's only administrator, nobody can administer the hotel, and there is no recovery runbook yet. The attacker also holds the GM's second factor, so only the password remains to phish.
   - Cause: `confirmTotp` reads the pending factor before taking the person's row lock and activates it by id alone. The SSO sign-in never locks that row either.
   - Fix: take the row lock before reading credential state; add a "credential epoch" so the wipe invalidates everything older; hash the password before the transaction.
2. **R3-P1-2: the root-change rule misses the groups claim.**
   - Someone holding only `identity.sso.manage` cannot map a group to `org_admin`.
   - They can change which claim carries the groups, for example to `nickname`, which people edit themselves in many identity providers. That is not treated as a root change, and they become `org_admin`.
   - Fix: treat the groups claim, `jit_provisioning` and `client_id` as root changes.
3. **R3-P2-1:** an SSO manager can delete group mappings they could never have created. Only new mappings are checked, so they can strip other admins' mapped roles.
4. **R3-P2-2:** domain verification is checked once and kept forever, and two orgs can hold the same domain. Rule 12 now makes it a global email-verification authority. An org that once controlled the DNS can:
   - mark a newly invited person's email verified;
   - accept another hotel's invitation on their behalf;
   - kill the person's own invitation link;
   - stop them setting a first password from any other invitation (bypassing rule 14).

   It still gains no access to the other hotel.
5. **R3-P2-3:** a person who signs in only through SSO at an org that requires SSO and has not verified its domain is locked out for good once they verify their email anywhere else. The README says verifying the domain fixes this; it does not.
6. **P3s:**
   - The hourly orphan-link purge is tenant-safe only because production's owner role is subject to RLS. Its SQL has no tenant predicates, and tests run as superuser, so tests cannot catch a scoping error.
   - The migration backfill treats passwords that organizations set as verified.
   - Simulated (non-live) links still verify an email.
   - The link-start state does not record the issuer.
   - Merging `main` conflicts in `docs/OPEN_QUESTIONS.md`; keeping both sides resolves it.

### Your specific questions
- **Passwords before proof:** no path can still set a password for an email before the person proves it. I checked seeding, SCIM, JIT, trial creation, API clients, support sessions and test-only paths; there is no trial-conversion path. SSO links, sessions and authenticators can still be created for an email nobody has proved, and they can survive the wipe only through the R3-P1-1 race.
- **Org IdP and unverified domains:** an org's identity provider cannot verify an email for a domain the org has not verified.
- **`/v1/me/sso/link`:** it is CSRF-safe, because authentication is a bearer header only.

### Gates
Run on a copy merged with current `main`:
- `pnpm lint`: exit 0.
- `pnpm turbo run typecheck --force`: exit 0, 16/16, nothing cached.
- `pnpm turbo run test --force --concurrency=2`: exit 0, 14/14 packages, 1,334 tests.
- Zero `review3_idplus%` databases remain afterwards. Both scratch worktrees are removed, and `/home/user/wt/identity-plus` was not touched.

### Merge condition
The W-1, W-2 and W-3 attack tests must fail (attack refused) and be committed as regression tests. A steward spot-check of those three is enough; a fourth full review is not needed.

### Files
The attack tests are in `/home/user/portico/docs/orchestration/reviews/identity-plus-poc/`. All four were already committed in `3decba7` by someone else while I worked; their content matches the final versions.
- `identity-zz-review3-poc.test.ts.txt`: the six new attacks W-1 to W-6; each test passes when the attack works.
- `identity-zz-review3-rerun.test.ts.txt`: N-1 to N-9; passes when refused.
- `identity-zz-review3-original.test.ts.txt`: the 11 originals; passes when refused.
- `api-zz-review3-http.test.ts.txt`: the HTTP first-admin takeover; passes when refused.

W-1 uses a test-only database trigger that only slows the email-verification step, so the race happens every run. In production the window is about 50–100 ms.
````

