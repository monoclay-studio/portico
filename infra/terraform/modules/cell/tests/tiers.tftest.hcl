# Plan-level tests for every tier with a MOCKED AWS provider (no AWS credentials, no network, no cost):
#   cd infra/terraform/modules/cell && terraform init -backend=false && terraform test
# They prove the configuration plans (no dependency cycles, no count/for_each on unknown values, tier presets
# resolve, the runtime contract the application needs is wired, guard rails fire). They do NOT prove AWS accepts the
# resources — only a real plan/apply can (infra/README.md § Validation status).
#
# `random` is NOT mocked: the mocking framework does not support ephemeral resources, and the real random provider
# runs locally with no credentials. Its values only ever reach write-only attributes, so nothing is stored.

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"] }
  }
  mock_data "aws_region" {
    defaults = { region = "ap-south-1", name = "ap-south-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_ec2_managed_prefix_list" {
    # Shape of com.amazonaws.global.cloudfront.origin-facing (a few real-looking entries; the real list is longer).
    defaults = {
      id = "pl-0123456789abcdef0"
      entries = [
        { cidr = "13.32.0.0/15", description = "" },
        { cidr = "52.84.0.0/15", description = "" },
        { cidr = "130.176.0.0/18", description = "" },
      ]
    }
  }
  mock_data "aws_elb_service_account" {
    defaults = { arn = "arn:aws:iam::718504428378:root" }
  }
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
  mock_data "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
  }
}

variables {
  cidr_block           = "10.20.0.0/16"
  budget_monthly_usd   = 50
  budget_alert_emails  = ["owner@example.invalid"]
  oncall_emails        = ["oncall@example.invalid"]
  github_repository    = "monoclay-studio/portico"
  github_repository_id = 987654321
  github_owner_id      = 123456
  github_environments  = ["test"]
}

# ── Tier shapes ───────────────────────────────────────────────────────────────────────────────────────────────

run "demo_tier_plans" {
  command = plan
  variables {
    tier       = "demo"
    deployment = "demo"
  }
  assert {
    condition     = length(module.single_host) == 1 && length(module.compute) == 0 && length(module.database) == 0
    error_message = "demo tier must run the single host and no managed database or Fargate."
  }
  assert {
    condition     = module.network.nat_public_ips == []
    error_message = "demo tier must not create NAT gateways."
  }
  assert {
    condition     = output.effective_settings.waf_level == "none" && output.effective_settings.schedule != null
    error_message = "demo tier: no WAF, office-hours schedule on."
  }
  assert {
    condition     = module.budget[0].stop_actions_enabled
    error_message = "demo tier must enable the budget stop action."
  }
  assert {
    # CloudFront connects to the host directly: only its origin-facing ranges may set X-Forwarded-For.
    condition     = jsonencode(output.trusted_proxy_cidrs) == jsonencode(["13.32.0.0/15", "130.176.0.0/18", "52.84.0.0/15"])
    error_message = "demo host: TRUSTED_PROXY_CIDRS must be exactly CloudFront's origin-facing ranges."
  }
}

run "lean_tier_plans" {
  command = plan
  variables {
    tier            = "lean"
    deployment      = "production"
    domain_name     = "portico.example"
    route53_zone_id = "Z0000000000000000000"
    email_domain    = "mail.portico.example"
  }
  assert {
    condition     = length(module.compute) == 1 && length(module.database) == 1 && length(module.single_host) == 0
    error_message = "lean tier must run Fargate + managed database."
  }
  assert {
    # Q158 default: the stricter posture — private tasks behind one NAT gateway (egress to Stripe, IdPs, webhooks).
    condition     = output.effective_settings.nat_mode == "single" && output.effective_settings.private_tasks && length(output.effective_settings.interface_endpoints) == 0
    error_message = "lean tier default: one NAT gateway, private tasks, no paid interface endpoints."
  }
  assert {
    condition     = output.effective_settings.db == "rds db.t4g.small x1"
    error_message = "lean tier: single-AZ RDS db.t4g.small."
  }
  assert {
    condition     = output.effective_settings.schedule == null
    error_message = "production must never be on an office-hours schedule."
  }
  assert {
    condition     = length(module.backup) == 0 && length(module.restore_drill) == 1
    error_message = "lean tier: no AWS Backup plan, but the monthly restore drill runs."
  }
  assert {
    condition     = output.app_key_replica_region == "ap-south-2" && length(output.protected_keys) == 3
    error_message = "production (any tier): the three irreplaceable keys are protected and replicated to the DR region."
  }
}

run "lean_public_task_ips_is_an_explicit_opt_in" {
  command = plan
  variables {
    tier            = "lean"
    deployment      = "production"
    domain_name     = "portico.example"
    route53_zone_id = "Z0000000000000000000"
    public_task_ips = true
  }
  expect_failures = [check.public_task_ips_warning] # a warning in a real plan
  assert {
    condition     = output.effective_settings.nat_mode == "none" && !output.effective_settings.private_tasks
    error_message = "public_task_ips = true: no NAT, tasks in public subnets (warned by the check block)."
  }
}

run "public_task_ips_refused_on_resilient" {
  command = plan
  variables {
    tier            = "resilient"
    deployment      = "production"
    domain_name     = "portico.example"
    route53_zone_id = "Z0000000000000000000"
    public_task_ips = true
  }
  expect_failures = [var.public_task_ips]
}

run "resilient_tier_plans" {
  command = plan
  variables {
    tier            = "resilient"
    deployment      = "production"
    domain_name     = "portico.example"
    route53_zone_id = "Z0000000000000000000"
  }
  assert {
    condition     = output.effective_settings.db == "aurora db.serverless x2" && output.effective_settings.az_count == 3
    error_message = "resilient tier: Aurora writer + replica across 3 AZs."
  }
  assert {
    condition     = output.effective_settings.nat_mode == "per_az" && length(module.backup) == 1 && output.effective_settings.private_tasks && length(output.effective_settings.interface_endpoints) == 0
    error_message = "resilient tier: NAT per AZ (which also reaches AWS APIs, so no paid interface endpoints by default), private tasks and AWS Backup."
  }
  assert {
    condition     = output.effective_settings.waf_level == "full"
    error_message = "resilient tier: full WAF."
  }
  assert {
    condition     = alltrue([for a in values(module.backup[0].missing_job_alarms) : a.treat_missing_data == "breaching" && length(a.actions) == 1]) && length(module.backup[0].missing_job_alarms) == 2
    error_message = "a backup or DR copy job that never ran must page (missing data = breaching)."
  }
  assert {
    # A database restored in the DR region is useless without the field/blind-index/seal keys.
    condition     = output.app_key_replica_region == "ap-south-2"
    error_message = "resilient tier: the irreplaceable application keys must be replicated to the DR region."
  }
}

run "staging_inactive_is_nearly_empty" {
  command = plan
  variables {
    tier       = "lean"
    deployment = "staging"
    active     = false
  }
  assert {
    condition     = length(module.compute) == 0 && length(module.database) == 0 && length(module.edge) == 0 && length(module.observability) == 0 && length(module.secrets) == 0
    error_message = "inactive staging must not create compute, database, secrets, edge or observability."
  }
  assert {
    condition     = length(module.network.nat_public_ips) == 0
    error_message = "inactive staging must not create NAT gateways."
  }
}

# ── Runtime contract the merged modules need (apps/api/src/config.ts, module READMEs) ──────────────────────────

run "runtime_contract_lean_production" {
  command = plan
  variables {
    tier            = "lean"
    deployment      = "production"
    domain_name     = "portico.example"
    route53_zone_id = "Z0000000000000000000"
    email_domain    = "mail.portico.example"
  }
  # Secret ARNs are only known after apply; give the two logins distinct ARNs at plan time.
  override_resource {
    target          = module.secrets[0].aws_secretsmanager_secret.db["app"]
    override_during = plan
    values          = { arn = "arn:aws:secretsmanager:ap-south-1:123456789012:secret:portico/production/aps1-c01/db/app-AbCdEf" }
  }
  override_resource {
    target          = module.secrets[0].aws_secretsmanager_secret.db["worker"]
    override_during = plan
    values          = { arn = "arn:aws:secretsmanager:ap-south-1:123456789012:secret:portico/production/aps1-c01/db/worker-AbCdEf" }
  }
  assert {
    condition = alltrue([for k in ["APP_DATABASE_URL", "PORTICO_FIELD_KEY", "PORTICO_BLIND_INDEX_KEY", "PORTICO_TERMS_SEAL_KEY", "PAYMENTS_SIMULATOR_SIGNING_SECRET"] :
    contains(output.runtime_contract.api.secrets, k) && contains(output.runtime_contract.worker.secrets, k)])
    error_message = "api and worker both run the composition root: both need the DB URL, field/blind-index/seal keys and the shared simulator secret."
  }
  assert {
    condition     = contains(output.runtime_contract.api.environment, "TRUSTED_PROXY_CIDRS") && contains(output.runtime_contract.api.environment, "PORTICO_APP_BASE_URL") && contains(output.runtime_contract.api.environment, "PORTICO_FIELD_KEY_ID")
    error_message = "api needs TRUSTED_PROXY_CIDRS, PORTICO_APP_BASE_URL and PORTICO_FIELD_KEY_ID."
  }
  assert {
    condition     = contains(output.runtime_contract.api.environment, "PORTICO_SES_CONFIGURATION_SET") && contains(output.runtime_contract.worker.environment, "PORTICO_EMAIL_DOMAIN")
    error_message = "with an email domain, api and worker get the SES configuration (staff invitations / resets)."
  }
  assert {
    condition     = endswith(output.runtime_contract.worker.database, "/db/worker-AbCdEf") && endswith(output.runtime_contract.api.database, "/db/app-AbCdEf")
    error_message = "the worker must connect with the portico_worker login, the API with the portico_app login."
  }
  assert {
    condition     = !contains(output.runtime_contract.api.secrets, "WORKER_DATABASE_URL")
    error_message = "least privilege: the API does not hold worker credentials until the webhook route needs them."
  }
  assert {
    condition     = length([for k in concat(output.runtime_contract.api.secrets, output.runtime_contract.worker.secrets) : k if contains(["OPERATOR_TOKEN", "PORTICO_OPERATORS"], k)]) == 0
    error_message = "no operator token in production."
  }
  assert {
    condition     = !contains(keys(module.secrets[0].integration_secret_arns), "operator-token") && contains(keys(module.secrets[0].integration_secret_arns), "payments-stripe-connect-secret-key-live")
    error_message = "production creates the payment-provider placeholders but not the operator-console ones."
  }
  assert {
    condition     = alltrue([for c in output.trusted_proxy_cidrs : !endswith(c, "/0")]) && contains(output.trusted_proxy_cidrs, "10.20.0.0/20") && contains(output.trusted_proxy_cidrs, "10.20.16.0/20") && contains(output.trusted_proxy_cidrs, "13.32.0.0/15")
    error_message = "TRUSTED_PROXY_CIDRS = the ALB (public) subnets + CloudFront origin-facing ranges, never a /0."
  }
  assert {
    condition     = !contains(output.trusted_proxy_cidrs, "10.20.0.0/16")
    error_message = "trust the ALB subnets only, not the whole VPC (tasks and the database live there too)."
  }
  assert {
    condition     = module.network.vpc_dns_support
    error_message = "the SSO domain re-check job resolves DNS TXT records through the VPC resolver."
  }
  assert {
    condition     = alltrue([for svc in ["backup.amazonaws.com", "ses.amazonaws.com", "cloudwatch.amazonaws.com", "events.amazonaws.com"] : contains(module.observability[0].oncall_publishers, svc)])
    error_message = "AWS Backup and SES must be able to publish to the on-call topic (and use its key) — review P2-10."
  }
  assert {
    condition     = alltrue([for c in output.trusted_proxy_cidrs : tonumber(split("/", c)[1]) >= 8])
    error_message = "no trusted proxy range shorter than /8 (review P3-1)."
  }
  assert {
    condition     = output.runtime_contract.api.values.NODE_ENV == "production" && output.runtime_contract.api.values.PORTICO_DEPLOYMENT == "production" && output.runtime_contract.worker.values.PORTICO_DEPLOYMENT == "production"
    error_message = "production runs NODE_ENV=production and PORTICO_DEPLOYMENT=production (values, not just names; review P2-9)."
  }
  assert {
    condition     = alltrue([for c in output.runtime_contract.every_command : slice(c, 0, 3) == ["node", "--import", "/app/ops/env-guard.mjs"]])
    error_message = "every container starts behind the env guard (live-key refusal by value, mandatory keys)."
  }
  assert {
    condition = jsonencode([for c in output.runtime_contract.api_task_containers : [c.name, c.essential, c.depends_on, c.node_env]]) == jsonencode([
      ["migrate", false, [], "production"], ["grants", false, ["migrate:SUCCESS"], "production"], ["api", true, ["grants:SUCCESS"], "production"],
    ])
    error_message = "api tasks: migrate → grants (both must SUCCEED, NODE_ENV=production) → api."
  }
  assert {
    condition     = output.runtime_contract.api_task_containers[1].command[4] == "grants" && contains(output.runtime_contract.api_task_containers[0].secrets, "DATABASE_URL") && !contains(output.runtime_contract.api_task_containers[2].secrets, "DATABASE_URL")
    error_message = "only the init containers get the owner URL; the api container never does."
  }
  assert {
    condition     = output.runtime_contract.api.image_tag == "release" && output.runtime_contract.worker.image_tag == "release"
    error_message = "Terraform's task definitions reference the release tag; the pipeline never registers revisions."
  }
}

run "staging_runs_development_mode_behind_the_guard" {
  command = plan
  variables {
    tier            = "lean"
    deployment      = "staging"
    domain_name     = "portico.example"
    route53_zone_id = "Z0000000000000000000"
  }
  assert {
    condition     = output.runtime_contract.api.values.NODE_ENV == "development" && output.runtime_contract.api.values.PORTICO_DEPLOYMENT == "staging" && output.runtime_contract.api_task_containers[0].node_env == "production"
    error_message = "staging: app NODE_ENV=development (operator console works), migrations still NODE_ENV=production."
  }
  assert {
    condition     = length(output.protected_keys) == 0 && output.app_key_replica_region == null
    error_message = "staging keys stay destroyable (synthetic data, `active = false`)."
  }
}

# Invariant (§5): no principal reachable from CI can read the keys that protect guest data and move guest money.
run "ci_cannot_reach_guest_money_keys" {
  command = plan
  variables {
    tier            = "lean"
    deployment      = "production"
    domain_name     = "portico.example"
    route53_zone_id = "Z0000000000000000000"
  }
  assert {
    condition     = length([for st in output.ci_deploy_policy.Statement : st if length(setintersection(st.Action, ["iam:PassRole", "ecs:RunTask", "ecs:RegisterTaskDefinition", "secretsmanager:GetSecretValue", "ssm:SendCommand"])) > 0]) == 0
    error_message = "the deploy role cannot read secrets, pass the execution roles, register task definitions or run tasks."
  }
  assert {
    condition     = alltrue([for r in output.secret_readers : !strcontains(r, "github-deploy") && !strcontains(r, "*")]) && contains(output.secret_readers, "arn:aws:iam::123456789012:role/portico-prod-aps1-c01-api-exec")
    error_message = "only the api/worker execution roles, break-glass and the Terraform role may read the keys — never a CI role."
  }
}

run "api_may_hold_worker_credentials_when_asked" {
  command = plan
  variables {
    tier                         = "lean"
    deployment                   = "production"
    domain_name                  = "portico.example"
    route53_zone_id              = "Z0000000000000000000"
    api_holds_worker_credentials = true
  }
  assert {
    condition     = contains(output.runtime_contract.api.secrets, "WORKER_DATABASE_URL")
    error_message = "api_holds_worker_credentials must inject WORKER_DATABASE_URL into the API."
  }
}

run "injected_test_mode_payment_keys_reach_both_tasks" {
  command = plan
  variables {
    tier            = "lean"
    deployment      = "staging"
    domain_name     = "portico.example"
    route53_zone_id = "Z0000000000000000000"
    injected_integration_secrets = {
      PAYMENTS_STRIPE_SECRET_KEY_TEST      = "payments-stripe-connect-secret-key-test"
      PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST = "payments-stripe-connect-webhook-secrets-test"
    }
  }
  assert {
    condition     = contains(output.runtime_contract.api.secrets, "PAYMENTS_STRIPE_SECRET_KEY_TEST") && contains(output.runtime_contract.worker.secrets, "PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST")
    error_message = "injected provider keys reach the api and the worker."
  }
}

# ── Guard rails ───────────────────────────────────────────────────────────────────────────────────────────────

run "lean_requires_a_domain" {
  command = plan
  variables {
    tier       = "lean"
    deployment = "staging"
  }
  expect_failures = [var.domain_name]
}

run "domain_requires_a_zone" {
  command = plan
  variables {
    tier        = "demo"
    deployment  = "demo"
    domain_name = "portico.example"
  }
  expect_failures = [var.route53_zone_id]
}

run "demo_tier_refused_for_production" {
  command = plan
  variables {
    tier            = "demo"
    deployment      = "production"
    domain_name     = "portico.example"
    route53_zone_id = "Z0000000000000000000"
  }
  expect_failures = [var.tier]
}

run "operator_secret_refused_in_production_under_any_name" {
  command = plan
  variables {
    tier                         = "lean"
    deployment                   = "production"
    domain_name                  = "portico.example"
    route53_zone_id              = "Z0000000000000000000"
    injected_integration_secrets = { SOME_ALIAS = "portico-operators" }
  }
  expect_failures = [var.injected_integration_secrets]
}

run "operator_token_refused_in_production" {
  command = plan
  variables {
    tier                         = "lean"
    deployment                   = "production"
    domain_name                  = "portico.example"
    route53_zone_id              = "Z0000000000000000000"
    injected_integration_secrets = { OPERATOR_TOKEN = "operator-token" }
  }
  expect_failures = [var.injected_integration_secrets]
}

run "live_key_under_a_test_name_refused_outside_production" {
  command = plan
  variables {
    tier                         = "lean"
    deployment                   = "staging"
    domain_name                  = "portico.example"
    route53_zone_id              = "Z0000000000000000000"
    injected_integration_secrets = { PAYMENTS_STRIPE_SECRET_KEY_TEST = "payments-stripe-connect-secret-key-live" }
  }
  expect_failures = [var.injected_integration_secrets]
}

run "channex_production_and_billing_keys_refused_outside_production" {
  command = plan
  variables {
    tier                         = "lean"
    deployment                   = "staging"
    domain_name                  = "portico.example"
    route53_zone_id              = "Z0000000000000000000"
    injected_integration_secrets = { SOME_NAME = "channex-api-key", OTHER = "stripe-billing-secret-key" }
  }
  expect_failures = [var.injected_integration_secrets]
}

run "live_payment_keys_refused_outside_production" {
  command = plan
  variables {
    tier                         = "lean"
    deployment                   = "staging"
    domain_name                  = "portico.example"
    route53_zone_id              = "Z0000000000000000000"
    injected_integration_secrets = { PAYMENTS_STRIPE_SECRET_KEY_LIVE = "payments-stripe-connect-secret-key-live" }
  }
  expect_failures = [var.injected_integration_secrets]
}

run "billing_keys_never_feed_guest_payments" {
  command = plan
  variables {
    tier                         = "lean"
    deployment                   = "production"
    domain_name                  = "portico.example"
    route53_zone_id              = "Z0000000000000000000"
    injected_integration_secrets = { PAYMENTS_STRIPE_SECRET_KEY_LIVE = "stripe-billing-secret-key" }
  }
  expect_failures = [var.injected_integration_secrets]
}

run "unknown_injected_secret_refused" {
  command = plan
  variables {
    tier                         = "lean"
    deployment                   = "staging"
    domain_name                  = "portico.example"
    route53_zone_id              = "Z0000000000000000000"
    injected_integration_secrets = { SOME_KEY = "does-not-exist" }
  }
  expect_failures = [var.injected_integration_secrets]
}
