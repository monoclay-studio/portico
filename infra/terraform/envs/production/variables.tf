variable "region" {
  description = "Primary region (OPEN_QUESTIONS Q4)."
  type        = string
  default     = "ap-south-1"
}

variable "allowed_account_ids" {
  description = "Set to the production account id; Terraform refuses to touch any other account."
  type        = list(string)
  default     = null
}

variable "tier" {
  description = "lean | resilient — OWNER DECISION, deliberately without a default."
  type        = string
  validation {
    condition     = contains(["lean", "resilient"], var.tier)
    error_message = "Production runs lean or resilient (the demo tier holds sample data only)."
  }
}

variable "overrides" {
  description = "Per-setting overrides of the tier preset (see modules/cell/locals.tf)."
  type        = any
  default     = {}
}

variable "cell" {
  type    = string
  default = "c01"
}

variable "cidr_block" {
  type    = string
  default = "10.20.0.0/16"
}

variable "domain_name" {
  description = "Required (OPEN_QUESTIONS Q1)."
  type        = string
}

variable "route53_zone_id" {
  type = string
}

variable "oncall_emails" {
  type = list(string)
}

variable "budget_monthly_usd" {
  description = "Alert-only budget (OPEN_QUESTIONS Q22)."
  type        = number
}

variable "budget_alert_emails" {
  type = list(string)
}

variable "engine_version" {
  type    = string
  default = "16.10"
}

variable "dr_region" {
  description = "Backup copy region for the resilient tier (data residency — owner decision)."
  type        = string
  default     = "ap-south-2"
}

variable "image_tag" {
  type    = string
  default = "bootstrap"
}

variable "github_repository" {
  type    = string
  default = null
}

variable "email_domain" {
  type    = string
  default = null
}

variable "email_sending_enabled" {
  type    = bool
  default = false
}

variable "injected_integration_secrets" {
  description = "Only secrets that already have a value (owner adds them after authorization)."
  type        = map(string)
  default     = {}
}

variable "api_holds_worker_credentials" {
  description = "true once the API serves the payments webhook route through a portico_worker pool (payments FOUNDATION_REQUESTS §4)."
  type        = bool
  default     = false
}
