# Agent run: Infra-as-code (resume)

- Started: 2026-11-07T18:07:15.924Z · last activity: 2026-11-07T18:16:29.220Z
- Turns: 102 · tool uses: 60 · output tokens: 75,000
- Type: general-purpose

## Brief (2026-11-07T18:07:15.924Z)

````text
You are the infrastructure engineer for Portico, a cloud hospitality platform (repo /home/user/portico; read CLAUDE.md, docs/adr/0011-aws-deployment-topology.md, and docs/readiness/cost-model.md §4a, which defines tiers T0–T3). You are resuming a workstream whose first engineer's log was lost in a container restart. The committed work survives.

Your worktree is /home/user/wt/infra (branch feat/infra-aws). Your write scope is infra/**, docs/runbooks/**, apps/api/Dockerfile, apps/worker/Dockerfile and .dockerignore. Commit locally after each step; never push.

Start with:
1. `git merge main`. Main has moved a lot since your branch: identity, rates, payments, reservations, finance, operations, integration and the backoffice web app are merged.
2. Read infra/README.md § Checkpoint. It lists what is done, in progress and next.
3. Read the original brief: docs/chronicle/agents/20261107T0733-aws-infrastructure-as-code.md, on main.

**HARD RULE: deploy nothing.** No AWS credentials exist, and the owner has not authorized spend (OPEN_QUESTIONS Q4/Q22). Never run `terraform apply`, never create cloud resources, never call AWS APIs that change state. Only validate, test with mocked providers, and plan offline.

Finish the checkpoint's "In progress" and "Next" items:
- `terraform validate` for env roots bootstrap, demo, staging and production;
- `terraform test` with mocked providers planning every tier (demo, lean, resilient);
- README cost tables per tier from the verified ap-south-1 prices already downloaded. Label them estimates, with the publication date;
- `infra/ci/deploy.yml.example`;
- runbooks in docs/runbooks/: deploy, rollback, backup-restore verification, incident response, database roles, disaster recovery;
- an owner-decisions list.

Also wire in what main now requires (docs/orchestration/pending-fixes.md lists them):
- **`TRUSTED_PROXY_CIDRS`:** set the API env to the VPC CIDR, i.e. the ALB subnets. Never 0.0.0.0/0. Without it, per-IP rate limits throttle everyone together.
- **`PORTICO_TERMS_SEAL_KEY`:** a secret in Secrets Manager, required in production. Rates seals booking terms with it.
- **Field-encryption keys and blind-index keys:** check the env names in packages/kernel and packages/db, `fieldCryptoFromEnv`.
- **A `portico_worker` DB role:** for apps/worker and the public webhook route. Grant the SECURITY DEFINER routing functions (`payments.route_webhook`, `payments.tenants_for_jobs`, and any other module's job-routing functions) to it only, then update bootstrap-roles.mjs and its verification.
- **Whatever the merged modules need at runtime:** check every module's README and apps/api/src/config.ts for required env and secrets. Cover the payments simulator signing secret, the operator token (disabled in production per identity), SES for staff email and invitations, and DNS resolution for identity's SSO domain re-check job.

Docker: there is no Docker daemon here. Validate Dockerfiles statically and exercise the runtime layout outside Docker as the previous engineer did. Say clearly what was not built.

Before you report done, run the self-check in docs/quality/playbooks/module-builder-self-check.md where it applies to infra, and include its tables. Run `pnpm lint` and check the exit code.

Reply with:
- what is done;
- validation and test results;
- the cost estimate per tier;
- the owner decisions needed;
- exactly what was NOT verified.
````

