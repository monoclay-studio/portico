# Agent run: Steward security review: infra

- Started: 2026-11-07T21:14:50.889Z · last activity: 2026-11-07T21:50:37.901Z
- Turns: 137 · tool uses: 146 · output tokens: 173,698
- Type: general-purpose

## Brief (2026-11-07T21:14:50.889Z)

````text
Your launch brief is the "Launch brief (v2)" section of /home/user/portico/docs/quality/playbooks/steward-reviewer.md (latest version). Follow it as written. Read CLAUDE.md, docs/adr/0011-aws-deployment-topology.md and docs/readiness/security-privacy-readiness.md first.

Run parameters (filled by the orchestrator):

```
MODULE:            infra (AWS infrastructure as code, container images, DB role model, CI deploy) — SECURITY-FOCUSED review
BRANCH / COMMIT:   feat/infra-aws @ 0facbba or later (record the exact commit)
WORKTREE:          /home/user/wt/infra (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-infra-copy
                   (git worktree add --detach <copy> feat/infra-aws; merge current main into it; remove at end)
SPEC / README:     infra/README.md (Checkpoint, cost tables, owner decisions D1–D16, Requests); docs/runbooks/*;
                   docs/orchestration/pending-fixes.md (infra items); OPEN_QUESTIONS Q4, Q21, Q22, Q158
FOCUS AREAS:       (a) IAM least privilege: task roles, the CI deploy role (GitHub OIDC trust policy conditions:
                       repository, branch and environment pinning; no wildcard subjects), the operator access path,
                       the restore-drill account.
                   (b) Secrets: never in state, plans, images, logs or env files committed; the write-only attributes
                       really are write-only; rotation paths; the DR replica of the 3 irreplaceable keys.
                   (c) Network: lean tier egress (public task IPs vs NAT; Security Hub ECS.2), security groups (inbound
                       only from the ALB), WAF, CloudFront → ALB TLS and origin protection (can the ALB be reached
                       bypassing CloudFront and WAF?), TRUSTED_PROXY_CIDRS including CloudFront origin-facing ranges
                       (is spoofing still possible from any trusted range?).
                   (d) Database role model: portico_owner / portico_app blue-green / portico_worker; the grants phase;
                       SECURITY DEFINER function exposure; RLS forced; the restore drill's negative tests; can a
                       request handler reach a job-only routing function?
                   (e) Supply chain: pinned base image digests, action SHAs, lockfile-frozen installs, the tsx runtime
                       loader, read-only root filesystem, non-root user.
                   (f) Deploy safety: migrations before services, automatic rollback, the production reviewer gate,
                       environment safety (LIVE keys refused outside production; operator tokens refused in production).
                   (g) Honest readiness: README claims vs tests; nothing presented as deployed or verified on AWS.
                   Tools: terraform 1.16.7 is in the infra agent's scratchpad (checksum-verified); you may download it
                   the same way. Never run apply or any AWS call that changes state; no credentials exist.
PARITY FILE:       none
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_infra (drop your databases at the end)
REPORT PATH:       /home/user/portico/docs/orchestration/reviews/review-infra.md (do not commit); PoCs or probe
                   scripts as docs/orchestration/reviews/infra-poc/*.txt
UI REVIEW?:        no
```

Run the infra branch's own checks in your copy:
- terraform validate and terraform test;
- infra/db/verify-roles.sh;
- infra/ci/test/deploy-cell.test.sh;
- the repo gates (`pnpm lint`, `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`).

Check exit codes.

Reply with:
- the verdict (merge / merge after fixes / do not merge);
- the counts;
- the top findings in plain English;
- the report path.
````

## Report (2026-11-07T21:50:37.793Z)

````text
**Verdict: merge after fixes.** I reviewed `feat/infra-aws` @ `0facbba36ccb6e82604ff4fb892c883968cf91a7`, merged with main @ `2b1d1a6` in a scratch copy. Main later moved to `434e105`, but only docs and `tools/demo-authenticator.mjs` changed, so I did not re-merge.

**Counts:** P0 0 · P1 3 · P2 11 · P3 12. Patterns: 38 of 57 apply. I ran probes for 16 and read the code for 20; AP-45 and AP-54 were applied as review steps on every finding; none was left unchecked. The other 19 don't apply, each with a reason.

**Gates (all exit 0):**
- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm turbo run typecheck --force` (18/18), `pnpm turbo run test --force --concurrency=2` (16/16).
- `terraform validate` 20/20 and `fmt` clean, on Terraform 1.16.7 (checksum and HashiCorp signature checked). `terraform test` 15/15 + 2/2.
- `verify-roles.sh` 38/38 on my own throwaway SCRAM Postgres 16.
- `deploy-cell.test.sh` 27/27.
- Also: all 7 pinned GitHub Action SHAs match their tags, and the RDS CA bundle checksum matches. Under `strace`, the API and worker write nothing to disk, so the read-only filesystem claim holds.

**Top findings:**
1. **P1-1, deploy role:** the GitHub deploy role is effectively an administrator for its cell. It can run the db-bootstrap task with a changed command and read the RDS master password, the three irreplaceable keys and every provider key. The runbook says it "cannot read secret values or touch the database".
   - Its trust pins only the repository name and the environment name: no branch, workflow file or repository id.
   - The examples name `monoclay/portico`, but this repository is `monoclay-studio/portico`.
2. **P1-2, egress default:** Q158 on main records "NAT gateway, private tasks" as the default. The code's lean tier defaults to public task IPs.
3. **P1-3, restore drill:** as written, the monthly restore drill never runs and nobody is told.
   - No pipeline builds or pushes its `latest-drill` image.
   - A task that can't pull its image has no exit code, so the "bad image still pages someone" rule never matches.
   - The failure alarm treats missing data as OK.
4. **P2-1, LIVE-key guard:** it checks only the variable name. A PoC shows staging accepts the LIVE Stripe Connect key under the TEST variable name. Channex and Monoclay billing keys aren't covered at all.
5. **P2-2, unreviewed definer functions:** the grants step only warns about a new cross-tenant definer function. In the PoC it exits 0, and a request-handler login then reads 13 membership rows across 2 tenants. Only the drill would catch it, and per P1-3 it doesn't run.

**Other P2s:**
- The read-only operator role can't read any tenant table, but reads every tenant's directory tables (staff mailbox, login IPs). None of this is audited, and the runbook claims otherwise.
- The drill's checks miss a `USING (true)` policy and anything granted to the worker role.
- Slow-query logs write guest PII (bind values) to Postgres logs; reproduced.
- The irreplaceable keys can be force-deleted or overwritten, and the cell module can't use the DR replica.
- No base image is pinned by digest, and dependabot covers neither the Dockerfiles nor the tsx lockfile.
- The pipeline builds each release from the latest task-definition revision, not Terraform's, so drift persists.
- `NODE_ENV=production` on every deployment disables the operator console on demo and staging too, contrary to the README.
- The on-call SNS topic rejects AWS Backup and SES, so failed-backup alerts never arrive.
- There is no CloudTrail trail, GuardDuty, or alerting on destructive actions.

**Clean:**
- XFF spoofing through the deployed chain, including IPv6 rotation.
- SECURITY DEFINER hygiene: `search_path` pinned and PUBLIC revoked on all 45 functions.
- Write-only secrets stay out of plans.
- Request handlers can't call job-only routing functions.
- Non-root, read-only images.

**Notes for you:**
- Decide which side of Q158 changes.
- The app never reads `PORTICO_DEPLOYMENT`. Kernel/payments should, to refuse live keys outside production.
- main's `ci.yml` pins actions by tag, not SHA, and runs none of the infra checks.

Cleanup: my scratch worktree and throwaway cluster are removed, and no `review_infra*` databases remain on the shared cluster. Nothing was committed.

Files are in `/home/user/portico/docs/orchestration/reviews/`:
- `review-infra.md`
- `infra-poc/` (9 evidence files)
````

