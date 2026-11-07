variable "name_prefix" {
  type = string
}

variable "enabled" {
  description = "Schedule state. Keep enabled wherever real data lives."
  type        = bool
  default     = true
}

variable "schedule_expression" {
  description = "Default: 1st of each month, 10:00 Maldives time (business hours, so failures are seen)."
  type        = string
  default     = "cron(0 10 1 * ? *)"
}

variable "engine" {
  type = string
}

variable "source_identifier" {
  description = "Cluster identifier (aurora) or instance identifier (rds)."
  type        = string
}

variable "source_arn" {
  type = string
}

variable "db_subnet_group_name" {
  type = string
}

variable "drill_security_group_id" {
  type = string
}

variable "ops_security_group_id" {
  type = string
}

variable "subnet_ids" {
  description = "Public subnets for the drill task (see main.tf)."
  type        = list(string)
}

variable "db_kms_key_arn" {
  type = string
}

variable "drill_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "evidence_bucket" {
  type = string
}

variable "evidence_kms_key_arn" {
  type = string
}

variable "metric_namespace" {
  type = string
}

variable "ecs_cluster_arn" {
  type = string
}

variable "repository_url" {
  type = string
}

variable "repository_arn" {
  type = string
}

variable "image_tag" {
  description = "The repository's mutable release tag, moved by every release (same commit as the application)."
  type        = string
  default     = "release"
}

variable "freshness_schedule_expression" {
  description = "Daily freshness check (age of the newest passed evidence; orphan sweep)."
  type        = string
  default     = "cron(0 9 * * ? *)"
}

variable "max_evidence_age_days" {
  description = "Page when the newest PASSED drill evidence is older than this."
  type        = number
  default     = 35
}

variable "assign_public_ip" {
  description = "true only when the cell runs tasks in public subnets (opt-in); default private subnets behind NAT."
  type        = bool
  default     = false
}

variable "cpu_architecture" {
  type    = string
  default = "ARM64"
}

variable "log_group_name" {
  type = string
}

variable "log_group_arn" {
  type = string
}

variable "alarm_topic_arn" {
  type = string
}
