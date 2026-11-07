# Agent run: Second steward review: identity-plus

- Started: 2026-11-07T16:15:52.255Z · last activity: 2026-11-07T16:43:14.648Z
- Turns: 112 · tool uses: 118 · output tokens: 139,739
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

## Report (2026-11-07T16:43:14.570Z)

````text
## Verdict: do not merge

Counts of new findings: **P0 1 · P1 3 · P2 6 · P3 9**.

The fix round does close every attack the first review proved. I rewrote the first review's attack tests for the new API and ran them: all 11 identity attacks are now refused, and so are the original SSO and X-Forwarded-For attacks. The guard design is sound. But one new cross-organization takeover gets around it.

I reviewed `09d010c`. While I worked, the branch moved to `cf913b2` (the parallel test-adaptation commit, which changes no identity code). I re-ran everything there and every new attack still works.

## Original findings
- **P0-1, P0-2, P1-1, P1-2, P1-3, P1-5, P1-8:** closed for the paths the first review reported.
- **P1-4 (separation of duties):** closed; one P2 residual.
- **P1-6 (power ordering):** mostly closed; two P2 gaps remain.
- **P1-7 (second-factor brute force, spoofed IPs):** mostly closed; one P2 race remains.

## Top new findings
1. **P0 — account pre-hijacking.** ADR-0017 still lets any org (a free trial is enough) create a brand-new global user with a password the attacker chooses, for an email it doesn't own.
   - When a real hotel later invites that email, the attacker accepts in the app (`GET /v1/me/invitations`, then accept). They sign in to the live hotel, enrol their own authenticator and become its admin.
   - The real GM can reset the password by email but is then locked out by the attacker's authenticator. The hotel's admin cannot reset it.
   - Live-org provisioning has the same hole: the attacker becomes the **only** admin of a newly provisioned live organization (proven over HTTP).
   - With the hotel's own SSO and verified domain, the attacker's preset password also survives the link.
   - Fix: amend ADR-0017. Remove `initialPassword`, add an email-verified flag, and wipe any credentials set before the person first proves their email.
2. **P1 — SSO admin can impersonate the org admin.** Someone with only `identity.sso.manage` repoints SSO to their own identity provider and signs in as the org admin with full sensitive permissions. The domain verification carries over to the new provider.
3. **P1 — any org can permanently block a new person from joining another org** by inviting their email first. The real invitation link refuses ("sign in there"), "forgot password" sends nothing, and the hotel's admin can't help.
4. **P1 — the verified-domain check (ADR-0017 §5) is skipped for an SSO link created before the person existed.** A failed SSO sign-up still saves the user and the link. Later the attacker's provider signs in as the real person and makes them an active member of the attacker's org without consent.
5. **P2 items:**
   - The per-person second-factor limit is a check-then-act race: 8 of 8 concurrent wrong codes were evaluated, where the limit should start delaying after 5.
   - `transferMember` strips roles at a property where the actor has no authority.
   - SSO and SCIM group syncing can remove the last administrator.
   - One admin can satisfy separation of duties with a second account they created with `initialPassword`.
   - Live provisioning silently leaves the first admin "invited" with no email sent.
   - The turbo cache hides typecheck failures (below).

## Command results (exit codes)

| Check | `09d010c` | `cf913b2` |
|---|---|---|
| lint | pass | pass |
| `pnpm typecheck` | reported pass, but all 16 results came from a stale turbo cache | — |
| `pnpm typecheck --force` | **fails** in `@portico/integration` test harness (2 type errors) | pass, 16/16 |
| identity tests | 105/105 pass | 105/105 pass |
| platform tests | 62/62 pass | 62/62 pass |
| api tests | 7 of 60 fail, all from the intended MFA-before-sensitive-permissions change | 60/60 pass |

The stale cache happens because `turbo.json` gives `typecheck` and `test` no dependency on their workspace packages. Until that changes, merge gates should run with `--force`.

No databases left behind and the reviewed worktree is untouched; both scratch copies were removed. Nothing is committed.

Report: `/home/user/portico/docs/orchestration/reviews/review-identity-plus-2.md`

Attack tests, in `/home/user/portico/docs/orchestration/reviews/identity-plus-poc/`:
- `identity-zz-review2-poc.test.ts.txt` — 9 tests; each passes because the new attack works.
- `api-zz-review2-poc.test.ts.txt` — the HTTP takeover of a new live org's first admin.
- `identity-zz-review2-original.test.ts.txt` — 11 tests; each passes because the original attack is now refused.
````

