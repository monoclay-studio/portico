variable "region" {
  description = "Primary region (OPEN_QUESTIONS Q4; default Mumbai, lowest latency to the Maldives)."
  type        = string
  default     = "ap-south-1"
}

variable "allowed_account_ids" {
  description = "Refuse to plan/apply against any other AWS account."
  type        = list(string)
  default     = null
}

variable "cell" {
  type    = string
  default = "c01"
}

variable "cidr_block" {
  type    = string
  default = "10.40.0.0/16"
}

variable "domain_name" {
  description = "Optional for the demo: without it the demo answers on its *.cloudfront.net name (Q1)."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  type    = string
  default = null
}

variable "oncall_emails" {
  type    = list(string)
  default = []
}

variable "budget_monthly_usd" {
  description = "Demo ceiling (Q22 default is $0 incremental; the T1 estimate is ~$13–20 — see README)."
  type        = number
  default     = 25
}

variable "budget_alert_emails" {
  description = "Required for the budget stop action."
  type        = list(string)
  default     = []
}

variable "office_hours" {
  type = object({
    start_cron = string
    stop_cron  = string
    timezone   = string
  })
  default = {
    start_cron = "cron(0 8 ? * MON-SAT *)"
    stop_cron  = "cron(0 20 ? * * *)"
    timezone   = "Indian/Maldives"
  }
}

variable "image_tag" {
  type    = string
  default = "bootstrap"
}

variable "github_repository" {
  description = "owner/name allowed to deploy via OIDC (placeholder until the owner confirms the repository)."
  type        = string
  default     = null
}
