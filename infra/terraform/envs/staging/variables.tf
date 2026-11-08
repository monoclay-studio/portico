variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "allowed_account_ids" {
  type    = list(string)
  default = null
}

variable "tier" {
  description = "Staging mirrors the production tier's shape; lean by default."
  type        = string
  default     = "lean"
}

variable "active" {
  description = "Staging is off by default (cost-model T2: staging started only for releases)."
  type        = bool
  default     = false
}

variable "cell" {
  type    = string
  default = "c01"
}

variable "cidr_block" {
  type    = string
  default = "10.30.0.0/16"
}

variable "domain_name" {
  description = "Required when active (HTTPS origin). OPEN_QUESTIONS Q1."
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
  type    = number
  default = 40
}

variable "budget_alert_emails" {
  type    = list(string)
  default = []
}

variable "engine_version" {
  type    = string
  default = "16.10"
}

variable "image_tag" {
  type    = string
  default = "bootstrap"
}

variable "github_repository" {
  description = "Repository allowed to deploy through OIDC: monoclay-studio/portico. null = no CI role."
  type        = string
  default     = null
}

variable "github_repository_id" {
  description = "Immutable numeric repository id (envs/github output repository_ids, or the GitHub API)."
  type        = number
  default     = null
}

variable "github_owner_id" {
  description = "Immutable numeric id of the monoclay-studio organization."
  type        = number
  default     = null
}

variable "email_domain" {
  type    = string
  default = null
}

variable "injected_integration_secrets" {
  description = "TEST-mode provider secrets that already have a value, e.g. { PAYMENTS_STRIPE_SECRET_KEY_TEST = \"payments-stripe-connect-secret-key-test\" }."
  type        = map(string)
  default     = {}
}
