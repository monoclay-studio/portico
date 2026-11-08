variable "name" {
  description = "Prefix for account-level resources."
  type        = string
  default     = "portico"
}

variable "security_emails" {
  description = "Who is paged for destructive or security-relevant account events (owner decision D11)."
  type        = list(string)
  default     = []
}

variable "trail_bucket_name" {
  description = "Globally unique bucket for CloudTrail logs (e.g. portico-cloudtrail-<account id>). Use a separate log-archive account when an AWS Organization exists."
  type        = string
}

variable "trail_retention_days" {
  type    = number
  default = 400
}

variable "global_region" {
  description = "Region where IAM, root sign-in and other global events are delivered."
  type        = string
  default     = "us-east-1"
}
