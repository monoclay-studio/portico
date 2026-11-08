variable "name_prefix" {
  type = string
}

variable "monthly_limit_usd" {
  description = "Monthly budget for this cell (owner decision, OPEN_QUESTIONS Q22)."
  type        = number
}

variable "actual_thresholds_percent" {
  type    = list(number)
  default = [50, 80, 100]
}

variable "alert_emails" {
  description = "At least one address is required for budget actions."
  type        = list(string)
  default     = []
}

variable "alert_topic_arn" {
  type    = string
  default = null
}

variable "cost_filter_tag" {
  description = "Restrict the budget to resources with this cost-allocation tag (activate the tag in Billing first). null = whole account."
  type = object({
    key   = string
    value = string
  })
  default = null
}

variable "stop_instance_id" {
  description = "Demo tier: instance to stop when the budget is exceeded."
  type        = string
  default     = null
}

variable "stop_instance_arn" {
  description = "Demo tier: ARN of the same instance. Must be set together with stop_instance_id (enables the stop actions)."
  type        = string
  default     = null
}

variable "scheduler_role_name" {
  description = "Demo tier: office-hours scheduler role to deny ec2:StartInstances after a budget stop."
  type        = string
  default     = null
}

variable "enable_stop_actions" {
  description = "Demo tier: create the budget actions (static switch; stop_instance_id/arn must then be set)."
  type        = bool
  default     = false
}

variable "enable_deny_restart" {
  description = "Demo tier: also block the office-hours schedule from restarting the host after a budget stop."
  type        = bool
  default     = false
}
