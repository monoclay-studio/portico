# STAGING: the lean shape (Fargate + single-AZ RDS), synthetic data only, OFF by default.
#
#   active = false  → only the VPC (no NAT, no endpoints), ECR repositories and the budget exist (≈ $0–1/month).
#   active = true   → full lean cell for a release rehearsal; turn it off again afterwards.
#
#   terraform apply -var active=true    # before a release: migrations from scratch + deploy + smoke tests
#   terraform apply -var active=false   # after: destroys the DB, services, ALB, CloudFront (synthetic data)
#
# Being destroyed and recreated often is a feature: every rehearsal proves the cell builds from nothing and that
# all migrations apply to an empty database. Office-hours scaling applies while active.
#
# NOTHING HERE HAS BEEN APPLIED.

module "cell" {
  source = "../../modules/cell"

  tier       = var.tier
  deployment = "staging"
  active     = var.active
  cell       = var.cell
  cidr_block = var.cidr_block

  domain_name     = var.domain_name
  subdomain       = "staging"
  route53_zone_id = var.route53_zone_id

  oncall_emails       = var.oncall_emails
  budget_monthly_usd  = var.budget_monthly_usd
  budget_alert_emails = var.budget_alert_emails

  engine_version        = var.engine_version
  image_tag             = var.image_tag
  github_repository     = var.github_repository
  github_repository_id  = var.github_repository_id
  github_owner_id       = var.github_owner_id
  github_environments   = ["staging"]
  restore_drill_enabled = false
  email_domain          = var.email_domain

  # TEST-mode provider keys only (the cell refuses *_LIVE outside production).
  injected_integration_secrets = var.injected_integration_secrets
}
