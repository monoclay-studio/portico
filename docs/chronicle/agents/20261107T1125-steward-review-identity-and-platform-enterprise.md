# Agent run: Steward review: identity and platform enterprise

- Started: 2026-11-07T11:25:27.594Z · last activity: 2026-11-07T11:46:35.328Z
- Turns: 140 · tool uses: 142 · output tokens: 120,149
- Type: general-purpose

## Brief (2026-11-07T11:25:27.594Z)

````text
You are Portico's architecture steward. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md exactly.
Branch under review: `feat/identity-platform-enterprise` in worktree /home/user/wt/identity-plus — extends modules `identity` and `platform` (already on main) with MFA/step-up, OIDC SSO, SCIM, custom roles, staff lifecycle, operator support access, break-glass, security alerts, owners/outlets, configuration bundles + rollout groups, trial lifecycle, activation stages, data-authority transitions (G-01/02/04/06/07), editions + Connect plan, getPropertyFacts. Specs: /home/user/portico/docs/specs/identity.md and platform.md; ADR-0012/0014; docs/adoption/*. READMEs and FOUNDATION_REQUESTS.md in both modules.
This is security-critical — focus extra care on: (a) authentication: TOTP replay/drift, recovery codes single-use, lockout, step-up enforced centrally for every sensitive permission (check the 72-hour enrolment grace isn't a bypass for privileged roles), the onSend response-rewriting hook (is it safe/robust?); (b) SSO: PKCE/state/nonce validation, issuer/audience checks, email-domain allow-list, JIT role mapping cannot escalate, SSO-required lockout protection; (c) authorization: no self-grant, no escalation beyond the grantor's own permissions (try to break it), custom roles validated; (d) support access & break-glass: time-boxed, approved, visible to the customer, marked on every audit row, operator tokens hashed; (e) cross-tenant isolation for every new table and the operator paths; (f) data-authority transitions and activation scope semantics vs docs/adoption/source-of-truth-matrix.md; (g) behaviour changes other modules will hit (updateProperty status refusal, setDataAuthority transitions, assignRole refusals, login mfa_required) — list who must adapt.
Do not modify the worktree; experiment in /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy. Use PORTICO_TEST_DB_PREFIX=review_idplus. Parity: /home/user/wt/parity-ops/docs/parity/identity.md and /home/user/wt/parity-front/docs/parity/platform.md if present. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-identity-plus.md.
````

## Report (2026-11-07T11:46:35.188Z)

````text
## Verdict: **do not merge**

The branch has two cross-organization account-takeover paths, both proven by tests that pass today. Most of the code is well built: lint and typecheck pass, identity 75/75, platform 56/56, api 21/21.

**Counts:** P0 2 · P1 8 · P2 17 · P3 12

Full report: `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-identity-plus.md`

## Command results
- **Branch as-is:** everything passes.
- **Merged with `main`:**
  - The merge conflicts in `modules/platform/src/manifest.ts`, because both sides register `platform.dataAuthority.manage`. Keep the branch's list.
  - `apps/api/test/permission-catalog.test.ts` fails. It flags a doc comment, `requirePermission(ctx, 'finance.posting.correct')`, in `modules/identity/src/domain/step-up.ts:5`. With the comment reworded, every package passes.
- **Parity gate:** platform fails (30 P0 rows open); there is no identity parity file.

## Top 5 findings
1. **P0-1 — another organization can set a member's password.**
   - In any trial, demo, training or sandbox org, the admin invites a victim's email, then sends a password reset. The reset link comes back in the HTTP response, and the attacker signs in to the victim's live organization.
   - In a live org, `createUser` with `initialPassword` sets the global password of anyone who doesn't have one yet (members added by SCIM, SSO or a pending invitation).
   - Any live admin with `platform.trial.manage` can create such a trial in one call.
2. **P0-2 — another organization can strip or replace a member's MFA.**
   - An org admin invites the victim, then calls `resetMemberMfa`. The invited membership isn't counted as shared, so the victim's TOTP and recovery codes are wiped for every organization.
   - An enterprise org can put the victim's email domain on its SSO allow-list (domain ownership is never checked). Signing in through its own IdP lands on the victim's global account, where it can enrol its own authenticator and take fresh recovery codes. The victim's real authenticator then stops working.
3. **P1-2 / P1-3 — MFA can be bypassed.**
   - For 72 hours after activation, even `org_admin` uses sensitive permissions with a password only. The window restarts on rehire, SCIM reactivation or SSO activation, and policy allows up to 30 days. This breaks IDN-I04.
   - API keys can carry any sensitive permission, including `'*'`, with no expiry and no step-up. Suspending the creator or resetting their password leaves the keys working.
4. **P1-4 / P1-5 / P1-6 — escalation and separation-of-duties bypasses.**
   - One person can request an activation (or authority transition, or config change) as themselves and approve it with an API key they issued. The check compares principals, not people.
   - A holder of `identity.security.manage` alone can name themselves a break-glass user with role `org_admin`, elevate, and mint a permanent `'*'` API key.
   - A custom role holding only `identity.role.assign` can revoke the last org admin. Monoclay support can't repair this.
5. **P1-7 / P1-8 — sign-in hardening.**
   - Second-factor failures are limited per challenge only, never per account, so TOTP can be brute-forced once the password is known.
   - The per-IP limits can be bypassed from one machine by spoofing `X-Forwarded-For`, because `packages/http` sets `trustProxy: true` (this is on main).
   - SSO matches people by the email claim only, never the IdP subject id (`sub`), and accepts a missing `email_verified`.

## Other notable items
- **P1-1** is the post-merge test failure above.
- **P2:**
  - The `onSend` hook that rewrites 403s into MFA prompts is safe (it can't grant anything) but brittle. It also mislabels identity's own escalation refusals as "verify first".
  - SSO accepts `http://localhost` and internal hosts as the issuer in production (server-side request forgery), and calls the IdP inside the DB transaction.
  - The guard that blocks completing an authority transition while forwarded changes are pending is never bound, so it allows completion. The README says it's done.
  - Two create routes require an `Idempotency-Key` but ignore it, so a retry creates a second trial or bundle.
  - `POST /api-clients` stores the plaintext API key in the idempotency table.
  - `createProperty` counts all properties against the plan limit, while activation counts only pilot and active ones.
  - Most new identity tables have no cross-tenant isolation tests.
- **Claims to withdraw:** the README's S17 claim is false as stated, and two platform invariants are overclaimed ("refusals audited" and the pending-operations block above).

## Who must adapt after merge
- **integration:** connection activation calls `setDataAuthority` for availability and money domains, which is now refused. It needs the authority-transition flow and should bind the pending-operations guard.
- **finance and inventory:** tests that set `charges` or `availability` authority as a user will break.
- **backoffice:** sign-in must handle `mfa_required`, plus the step-up and enrolment prompts. Property status can no longer be edited directly; it moves through the activation workflow.
- **Any API test that advances the clock past 72 hours** with password-only admins and then uses sensitive permissions (e.g. Day Close) will fail.
- **guests:** the GM template now grants `guests.profile.readShared`. The guests review said to add it only after G-P0-2 is fixed; confirm with the guests owner.

## Proof-of-concept tests
These all pass today, which means each attack works; the author can turn them into regression tests. All are under `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-idplus-copy/`:
- `modules/identity/test/zz-review-poc.test.ts`
- `modules/identity/test/zz-review-sso-poc.test.ts`
- `apps/api/test/zz-review-poc.test.ts`
- `packages/kernel/src/zz-review.test.ts`

The worktree under review was not modified.

````

