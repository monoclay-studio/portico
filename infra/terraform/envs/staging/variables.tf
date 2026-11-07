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
  type    = string
  default = null
}

variable "email_domain" {
  type    = string
  default = null
}
