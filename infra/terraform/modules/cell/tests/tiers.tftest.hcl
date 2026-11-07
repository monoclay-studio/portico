# Plan-level tests for every tier with MOCKED providers (no AWS credentials, no network, no cost):
#   cd infra/terraform/modules/cell && terraform init && terraform test
# They prove the configuration plans (no dependency cycles, no count/for_each on unknown values, tier presets
# resolve, guard rails fire). They do NOT prove AWS accepts the resources — only a real plan/apply can.

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
    defaults = { id = "pl-0123456789abcdef0" }
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

mock_provider "random" {}

variables {
  cidr_block          = "10.20.0.0/16"
  budget_monthly_usd  = 50
  budget_alert_emails = ["owner@example.invalid"]
  oncall_emails       = ["oncall@example.invalid"]
  github_repository   = "monoclay/portico"
  github_environments = ["test"]
}

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
    condition     = output.effective_settings.nat_mode == "none" && output.effective_settings.private_tasks
    error_message = "lean tier: no NAT; tasks private behind VPC endpoints."
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
    condition     = output.effective_settings.nat_mode == "per_az" && length(module.backup) == 1
    error_message = "resilient tier: NAT per AZ and AWS Backup."
  }
  assert {
    condition     = output.effective_settings.waf_level == "full"
    error_message = "resilient tier: full WAF."
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
    condition     = length(module.compute) == 0 && length(module.database) == 0 && length(module.edge) == 0 && length(module.observability) == 0
    error_message = "inactive staging must not create compute, database, edge or observability."
  }
  assert {
    condition     = output.effective_settings.nat_mode == "none" || length(module.network.nat_public_ips) == 0
    error_message = "inactive staging must not create NAT gateways."
  }
}

run "lean_requires_a_domain" {
  command = plan
  variables {
    tier       = "lean"
    deployment = "staging"
  }
  expect_failures = [terraform_data.guards]
}

run "demo_tier_refused_for_production" {
  command = plan
  variables {
    tier       = "demo"
    deployment = "production"
  }
  expect_failures = [terraform_data.guards]
}
