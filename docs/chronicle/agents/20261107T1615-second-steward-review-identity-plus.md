# Agent run: Second steward review: identity-plus

- Started: 2026-11-07T16:15:52.255Z · last activity: 2026-11-07T16:38:34.742Z
- Turns: 196 · tool uses: 99 · output tokens: 278,744
- Type: general-purpose

## Brief (2026-11-07T16:15:52.255Z)

````text
You are the architecture steward for Portico, a hospitality management platform (TypeScript monorepo at /home/user/portico; read its CLAUDE.md first). Do a SECOND, focused security review of branch `feat/identity-platform-enterprise` (worktree /home/user/wt/identity-plus; do NOT modify that worktree — make a copy for experiments, e.g. `git worktree add --detach <scratch dir> feat/identity-platform-enterprise`, and remove it at the end).

Context:
- The first review (docs/orchestration/reviews/review-identity-plus.md on main) said "do not merge": 2 P0 cross-organization account-takeover paths and 8 P1s. Its proof-of-concept tests are in docs/orchestration/reviews/identity-plus-poc/.
- The fix had to implement ADR-0017 (docs/adr/0017-global-identity-and-cross-organization-safety.md on main).
- The author reports every finding fixed or deliberately deferred. Its mapping of finding → commit → test is in the branch's modules/identity/README.md and modules/platform/README.md (Checkpoint / Known gaps). It also lists deliberate deviations:
  1. P3-8 refusal wording kept as ADR-0017 prescribes.
  2. P2-8 keeps a setup cap at creation and enforces PLT-R10 at activation under an advisory lock.
  3. P1-4 compares the responsible person AND refuses SoD approvals from API clients, system and support.
  4. P2-6: assertEffectInScope takes an optional `database` for durable refusal audits.
  5. With a DNS-verified domain, the person's own SSO sign-in activates their invited membership (treated as consent). SCIM never activates someone who works elsewhere. SCIM deprovisioning is not power-ordered but is last-admin protected.
  6. P2-1 and P2-4 are partial.
  7. The kernel PoC is re-expressed as an identity test.
  8. Added POST /v1/me/mfa/disable.
- Known state: after merging main, 13 tests in OTHER modules fail because of intended behaviour changes (data authority needs a second approver; sensitive permissions need MFA; Professional plan now includes portfolio.crossPropertyProfiles). Another engineer is adapting those in parallel. Do not count them as findings unless you think a behaviour change is itself wrong.

Your job:
1. Verify each P0 and P1 fix really closes the attack. Re-run the original PoCs adapted to the new API where needed, and read the code paths, not just the tests.
2. Hunt for NEW bypasses of ADR-0017. Examples:
   - Can any org-controlled path (admin, SSO/JIT, SCIM, API key, break-glass, support session, trial conversion, invitation acceptance, recovery codes, MFA-disable alias) change or strip a credential of a person who belongs to another org, or activate them without consent?
   - Does deviation 5 (SSO sign-in = consent) open a takeover when the IdP is attacker-controlled but the domain was verified by someone else, or when domain verification can be spoofed or reused across orgs?
   - Can separation of duties still be satisfied by one person?
   - Can break-glass still create durable privileges?
   - Is the per-person second-factor counter bypassable?
   - Does session handling or step-up accept org IdP sessions for global credential changes?
3. Check `pnpm lint`, `pnpm typecheck` and the identity + platform + api tests in your copy (PORTICO_TEST_DB_PREFIX=review2_idplus; Postgres runs at postgres://postgres@127.0.0.1:5432/postgres). Check exit codes, not piped output. Drop any databases you create.
4. Write your report to /home/user/portico/docs/orchestration/reviews/review-identity-plus-2.md. Don't commit it; the orchestrator does. Include:
   - verdict: merge / merge after fixes / do not merge;
   - a table of every original P0/P1 → closed? (with evidence);
   - new findings ranked P0/P1/P2/P3, each with file:line, attack steps, and a concrete fix;
   - command results.
   Turn any new attack you prove into a PoC test file kept in docs/orchestration/reviews/identity-plus-poc/ with a .ts.txt suffix.

Rules: no secrets or PII anywhere; never contact external services; be precise and evidence-based — no finding without a code path or test. Reply with the verdict, counts, the top findings in plain English, and the report path.
````

