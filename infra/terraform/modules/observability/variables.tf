variable "name_prefix" {
  type = string
}

variable "log_groups" {
  description = "Short names; each becomes /portico/<name_prefix>/<name>."
  type        = list(string)
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "oncall_emails" {
  description = "Email subscribers of the on-call topic (each must confirm the subscription email)."
  type        = list(string)
  default     = []
}

# Static switches (never derived from values known only after apply).
variable "enable_alb_alarms" {
  type    = bool
  default = false
}

variable "enable_db_alarms" {
  type    = bool
  default = false
}

variable "enable_outbox_alarms" {
  type    = bool
  default = false
}

variable "enable_worker_task_alarm" {
  description = "Requires ECS Container Insights."
  type        = bool
  default     = false
}

variable "enable_host_alarms" {
  type    = bool
  default = false
}

variable "outbox_stats_contract_live" {
  description = "Set true once the worker emits the 'outbox stats' log line every 60 s (see main.tf header)."
  type        = bool
  default     = false
}

# Identifiers of monitored resources.
variable "alb_arn_suffix" {
  type    = string
  default = ""
}

variable "target_group_arn_suffix" {
  type    = string
  default = ""
}

variable "db_engine" {
  type    = string
  default = "rds"
}

variable "db_identifier" {
  type    = string
  default = ""
}

variable "db_serverless" {
  type    = bool
  default = false
}

variable "db_has_replicas" {
  type    = bool
  default = false
}

variable "ecs_cluster_name" {
  type    = string
  default = ""
}

variable "worker_service_name" {
  type    = string
  default = ""
}

variable "host_instance_id" {
  type    = string
  default = ""
}

variable "worker_log_group" {
  description = "Log group holding worker output (worker group on Fargate, host group on the demo host)."
  type        = string
  default     = ""
}

variable "api_log_group" {
  type    = string
  default = ""
}

# Thresholds (TARGETS from support-recovery-plan §1).
variable "latency_p95_seconds" {
  type    = number
  default = 0.5
}

variable "latency_p99_seconds" {
  type    = number
  default = 2
}

variable "error_rate_percent" {
  type    = number
  default = 2
}

variable "db_cpu_percent" {
  type    = number
  default = 80
}

variable "db_connections_threshold" {
  description = "Alarm level for open connections (set to ~80% of max_connections for the instance size)."
  type        = number
  default     = 80
}

variable "outbox_oldest_age_seconds" {
  description = "TARGET: background work delay <= 60 s p95; alarm at twice that."
  type        = number
  default     = 120
}

variable "external_check_fqdn" {
  description = "Public API hostname for the Route 53 health check; null disables it."
  type        = string
  default     = null
}

variable "external_check_path" {
  type    = string
  default = "/health/ready"
}
