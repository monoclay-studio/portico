variable "name_prefix" {
  type = string
}

variable "engine" {
  description = "aurora (Aurora PostgreSQL) or rds (RDS for PostgreSQL)."
  type        = string
  validation {
    condition     = contains(["aurora", "rds"], var.engine)
    error_message = "engine must be aurora or rds."
  }
}

variable "engine_version" {
  description = "PostgreSQL 16 minor version. Verify availability first: aws rds describe-db-engine-versions --engine <aurora-postgresql|postgres> --query 'DBEngineVersions[?starts_with(EngineVersion, `16.`)].EngineVersion'. Minor upgrades are deliberate (staging first), never automatic."
  type        = string
  validation {
    condition     = startswith(var.engine_version, "16.")
    error_message = "Portico targets PostgreSQL 16 (CI runs postgres:16)."
  }
}

variable "instance_class" {
  description = "Aurora: db.serverless or a provisioned class (db.t4g.medium, db.r8g.large…). RDS: db.t4g.small etc."
  type        = string
}

variable "instance_count" {
  description = "Aurora only: writer + readers. >= 2 gives automatic cross-AZ failover (Multi-AZ)."
  type        = number
  default     = 1
}

variable "multi_az" {
  description = "RDS only: synchronous standby in a second AZ."
  type        = bool
  default     = false
}

variable "availability_zones" {
  description = "AZs to place instances in (round-robin)."
  type        = list(string)
}

variable "serverless_min_acu" {
  type    = number
  default = 0.5
}

variable "serverless_max_acu" {
  type    = number
  default = 4
}

variable "serverless_auto_pause_seconds" {
  description = "Only when serverless_min_acu = 0."
  type        = number
  default     = 600
}

variable "aurora_io_optimized" {
  description = "Aurora I/O-Optimized storage: higher instance/storage price, no per-I/O charge. Worth it above ~25% I/O share of the bill."
  type        = bool
  default     = false
}

variable "allocated_storage_gb" {
  description = "RDS only."
  type        = number
  default     = 20
}

variable "max_allocated_storage_gb" {
  description = "RDS only: storage autoscaling ceiling."
  type        = number
  default     = 100
}

variable "database_name" {
  type    = string
  default = "portico"
}

variable "master_username" {
  description = "Break-glass/bootstrap user only. The application connects as portico_app_* login roles."
  type        = string
  default     = "portico_master"
}

variable "subnet_ids" {
  description = "Isolated data subnets (>= 2 AZs, required by DB subnet groups)."
  type        = list(string)
}

variable "security_group_id" {
  type = string
}

variable "secrets_kms_key_arn" {
  description = "KMS key that encrypts the RDS-managed master user secret."
  type        = string
}

variable "logs_kms_key_arn" {
  type    = string
  default = null
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "backup_retention_days" {
  description = "Automated backups / PITR window (1–35)."
  type        = number
  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 1 and 35."
  }
}

variable "backup_window" {
  description = "UTC. Default 19:30–20:30 UTC = 00:30–01:30 Maldives time."
  type        = string
  default     = "19:30-20:30"
}

variable "maintenance_window" {
  description = "UTC. Default Sun 22:00–23:00 UTC = Mon 03:00–04:00 Maldives time, after a typical Day Close."
  type        = string
  default     = "sun:22:00-sun:23:00"
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "final_snapshot" {
  description = "Take a final snapshot on delete (production). Off for synthetic-data cells that are destroyed and recreated."
  type        = bool
  default     = true
}

variable "iam_auth_enabled" {
  description = "Allow IAM database authentication (used for the optional portico_ops_readonly human role)."
  type        = bool
  default     = false
}

variable "performance_insights_enabled" {
  description = "Not available on the smallest burstable classes; 7-day retention is the no-extra-cost tier."
  type        = bool
  default     = true
}

variable "enhanced_monitoring_interval" {
  description = "0 disables; 60 = OS metrics every minute (billed as CloudWatch Logs)."
  type        = number
  default     = 0
}

variable "ca_cert_identifier" {
  type    = string
  default = "rds-ca-rsa2048-g1"
}

variable "log_min_duration_ms" {
  description = "Log statements slower than this."
  type        = number
  default     = 1000
}

variable "apply_immediately" {
  description = "false: changes wait for the maintenance window."
  type        = bool
  default     = false
}

variable "recovery_account_ids" {
  description = "AWS accounts allowed to use the DB key for cross-account restore drills / DR copies."
  type        = list(string)
  default     = []
}
