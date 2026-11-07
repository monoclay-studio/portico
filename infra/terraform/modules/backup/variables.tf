variable "name_prefix" {
  type = string
}

variable "resource_arns" {
  description = "ARNs to back up (database cluster/instance, documents bucket)."
  type        = list(string)
}

variable "daily_retention_days" {
  type    = number
  default = 35
}

variable "monthly_retention_days" {
  type    = number
  default = 365
}

variable "dr_region" {
  description = "Region for backup copies; null disables cross-region copies. Data-residency choice (README owner decisions)."
  type        = string
  default     = null
}

variable "vault_lock" {
  description = "Governance-mode vault lock (min 7 days, max = monthly retention)."
  type        = bool
  default     = true
}

variable "notification_topic_arn" {
  type    = string
  default = null
}
