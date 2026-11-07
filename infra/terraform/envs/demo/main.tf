# Hosted DEMO (tier "demo", cost-model T1): one small instance with api + worker + Postgres, sample data only,
# every external effect simulated by the application (ADR-0010) and provider domains unresolvable inside the VPC.
# Office-hours schedule and a budget stop action keep spend near the T1 estimate (infra/README.md).
#
# NOTHING HERE HAS BEEN APPLIED. Creating it needs the owner's authorization (OPEN_QUESTIONS Q4, Q22).

module "cell" {
  source = "../../modules/cell"

  tier       = "demo"
  deployment = "demo"
  cell       = var.cell
  cidr_block = var.cidr_block

  domain_name     = var.domain_name
  subdomain       = "demo"
  route53_zone_id = var.route53_zone_id

  oncall_emails       = var.oncall_emails
  budget_monthly_usd  = var.budget_monthly_usd
  budget_alert_emails = var.budget_alert_emails
  budget_stop_actions = true
  office_hours        = var.office_hours

  image_tag            = var.image_tag
  github_repository    = var.github_repository
  github_repository_id = var.github_repository_id
  github_owner_id      = var.github_owner_id
  github_environments  = ["demo"]
}
