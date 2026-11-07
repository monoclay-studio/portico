# PRODUCTION: where a pilot hotel's real data would live.
#
# The tier has NO default — choosing it is an owner decision (README "Owner decisions"):
#   lean       T2 ≈ $100–160/month infra. Single-AZ database: an AZ outage means restoring from backup
#              (TARGET RTO in hours, not minutes). Reasonable for a small guesthouse pilot with a paper fallback.
#   resilient  T3. Aurora with a standby in another AZ, NAT per AZ, cross-region backups, vault lock.
#              Required before a resort or group pilot.
# Moving lean → resilient changes the database engine (RDS → Aurora): a planned, rehearsed migration, not a flip.
# Alternative: keep engine = "rds" and set overrides = { db_multi_az = true } — an online change.
#
# Production is never auto-stopped, keeps deletion protection, final snapshots and 30-day secret recovery, and its
# budget only alerts (an outage at a hotel is worse than an overspend).
#
# NOTHING HERE HAS BEEN APPLIED. Requires the owner's authorization (OPEN_QUESTIONS Q4, Q22) and a signed pilot.

module "cell" {
  source = "../../modules/cell"

  tier       = var.tier
  deployment = "production"
  cell       = var.cell
  cidr_block = var.cidr_block
  overrides  = var.overrides

  domain_name     = var.domain_name
  subdomain       = ""
  route53_zone_id = var.route53_zone_id

  oncall_emails       = var.oncall_emails
  budget_monthly_usd  = var.budget_monthly_usd
  budget_alert_emails = var.budget_alert_emails

  engine_version               = var.engine_version
  dr_region                    = var.dr_region
  image_tag                    = var.image_tag
  github_repository            = var.github_repository
  github_environments          = ["production"]
  email_domain                 = var.email_domain
  email_sending_enabled        = var.email_sending_enabled
  injected_integration_secrets = var.injected_integration_secrets
  api_holds_worker_credentials = var.api_holds_worker_credentials
}
