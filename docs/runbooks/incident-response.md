# Runbook: incident response

**Status:** procedure only. No hotel is live, no on-call rota or paging tool exists (on-call is an email list on an
SNS topic until the owner chooses one — `infra/README.md` § Owner decisions), and support hours are undecided (Q21).
Response times below are TARGETS from `docs/readiness/support-recovery-plan.md` §4; they become commitments only
when a staffed rota exists. Hosting 24/7 does not mean support is 24/7.

## Severity

| Severity | Examples | Acknowledge (TARGET, in covered hours) | Updates |
|---|---|---|---|
| **SEV1** | a property cannot check in/out, take payments or sees wrong availability; money or inventory correctness at risk; **suspected data exposure** (any tenant seeing another's data is SEV1 and a P0 bug) | 15–30 min | every 30 min |
| **SEV2** | degraded feature with a workaround; a failed restore drill; a provider (Stripe, Channex, SES) degraded | 2 h | every 4 h |
| **SEV3** | minor issue or question | 1 business day | on resolution |

When unsure, pick the higher severity; downgrade later.

## Roles (pilot staffing)

| Role | Who | Does |
|---|---|---|
| Incident commander | Founder | owns severity, decisions, external communication approval |
| Technical lead | on-call engineer | diagnoses, mitigates, recovers |
| Hotel liaison | founder or support lead | talks to the duty manager / GM; status page |
| Scribe | anyone | timeline with UTC times and the property's local time |

One person may hold several roles; the commander role is never left implicit.

## First 15 minutes

1. **Acknowledge** the alarm (on-call email/SNS) or the hotel's call; open an incident note: what, since when, who
   is affected (property, organization), severity.
2. **Is a hotel operating blind?** Tell the duty manager to switch to the continuity procedures
   (support-recovery-plan §3: printed in-house list, paper registration, standalone terminal). Their guests come first.
3. **Stop the bleeding before diagnosing:**
   - bad release → [rollback](rollback.md) (application only);
   - a background job corrupting data → scale the worker service to 0
     (`aws ecs update-service --cluster <prefix> --service worker --desired-count 0`) — outbox events wait, nothing is
     lost; re-enable after the fix (they are idempotent);
   - abuse / attack → tighten the WAF rate rule or block an IP set (CloudFront-scoped web ACL, `us-east-1`);
   - **suspected data exposure** → follow § Security incidents now.
4. **Never** restore an old backup over production to "undo" something ([disaster recovery](disaster-recovery.md)).

## Where to look

| Signal | Where |
|---|---|
| Alarms | CloudWatch → Alarms, prefix `<cell prefix>-` (5xx rate, no healthy targets, latency, DB CPU/connections/storage/replica lag, outbox backlog/dead deliveries, worker errors, restore drill, external health check in `us-east-1`) |
| API / worker / migration logs | log groups `/portico/<prefix>/api`, `/worker`, `/migrate`, `/db-bootstrap`, `/restore-drill` (demo: `/host`) — JSON lines; PII is redacted by the application logger |
| Deploy history | ECS → service → Deployments; GitHub Actions run of the deploy workflow |
| Database | Performance Insights (resilient); RDS events; migration/job status via `portico_ops_readonly` (no tenant data; [database roles](database-roles.md)) |
| Edge | CloudFront metrics, WAF sampled requests and logs (`aws-waf-logs-<prefix>`) |
| AWS itself | AWS Health Dashboard for ap-south-1; the external health check (Route 53, three regions) |
| Account security | the `portico-security` topic (primary region and us-east-1): key deletion, DB/secret/backup deletion, trail tampering, IAM changes, root activity, GuardDuty high findings; CloudTrail (multi-region trail `portico-account`, log-file validation) for the history |
| Providers | Stripe / Channex status pages; the integration health panel in Portico |

## Security incidents (suspected data exposure, compromised credentials)

1. SEV1. The commander decides containment; the technical lead **preserves evidence first** (do not delete logs,
   tasks or users that are evidence; export the relevant log streams and the CloudTrail events from the
   `portico-account` trail — validate them with `aws cloudtrail validate-logs`).
2. Contain: revoke sessions/API keys of the affected identities (identity module), rotate the database logins
   ([database roles](database-roles.md) § Rotation), rotate provider secrets in Secrets Manager, disable the deploy
   role's trust (GitHub Environment) if CI may be involved.
3. The field-encryption, blind-index and terms-seal keys cannot be rotated today without data loss; if they are
   believed exposed, escalate to the owner immediately — re-encryption is a planned capability, not a runbook step.
4. Notification duties (hotels, guests, regulators — Maldives and the guests' jurisdictions) are a **legal decision
   for the owner and counsel**; this runbook does not decide them. Record facts and times so counsel can.
5. Afterwards: write the cross-tenant regression test that would have caught it (CLAUDE.md §6).

## Communication

- Monoclay informs hotels; hotels inform their guests (support-recovery-plan §4).
- Say what is known, what is affected, the workaround, and when the next update comes. Never say "fixed",
  "synced" or "paid" until verified (CLAUDE.md §5: uncertain outcomes are *pending verification*).
- Template: *"[Portico] {property}: {what is not working} since {local time}. Workaround: {continuity step}. We are
  {action}. Next update by {local time}."*

## Closing

1. Resolved = the hotel confirms normal operation **and** reconciliation shows no lost or duplicated work (outbox
   drained, payment statuses reconciled, Day Close state consistent).
2. Within 5 business days: blameless review — timeline, impact (properties, minutes, money touched), root cause,
   what detected it, what would have detected it sooner, actions with owners. Store it in the repository
   (`docs/` — location to be decided with the first incident).
3. Update alarms, runbooks and tests from the actions.
