# Agent run: Third steward review: identity-plus

- Started: 2026-11-07T17:09:31.338Z · last activity: 2026-11-07T17:23:00.226Z
- Turns: 111 · tool uses: 65 · output tokens: 151,386
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

