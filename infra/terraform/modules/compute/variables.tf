variable "name_prefix" {
  type = string
}

variable "deployment_name" {
  description = "demo | staging | production (the AWS deployment, not a tenant's environment)."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  description = "Subnets for the load balancer."
  type        = list(string)
}

variable "task_subnet_ids" {
  description = "Subnets for tasks (private app subnets unless assign_public_ip)."
  type        = list(string)
}

variable "assign_public_ip" {
  description = "true only when tasks run in public subnets without NAT/endpoints."
  type        = bool
  default     = false
}

variable "security_group_ids" {
  description = "Map from the network module (alb, api, worker, ops…)."
  type        = map(string)
}

variable "app_port" {
  type    = number
  default = 4000
}

variable "cpu_architecture" {
  description = "ARM64 (Graviton; ≈44% cheaper Fargate in ap-south-1, Nov 2026 price list) or X86_64. Images must be built for it."
  type        = string
  default     = "ARM64"
  validation {
    condition     = contains(["ARM64", "X86_64"], var.cpu_architecture)
    error_message = "cpu_architecture must be ARM64 or X86_64."
  }
}

variable "repository_urls" {
  type = map(string)
}

variable "repository_arns" {
  type = map(string)
}

variable "image_tag" {
  description = "Initial image tag for the Terraform-registered task definitions. The pipeline sets the real one."
  type        = string
  default     = "bootstrap"
}

variable "api" {
  description = "API sizing. cpu/memory in Fargate units (256 = 0.25 vCPU)."
  type = object({
    cpu                 = number
    memory              = number
    desired             = number
    min                 = number
    max                 = number
    db_pool_max         = number
    requests_per_target = number
  })
}

variable "worker" {
  type = object({
    cpu     = number
    memory  = number
    desired = number
    min     = number
    max     = number
  })
}

variable "schedule" {
  description = "Office-hours schedule for non-production cells; null = always on."
  type = object({
    start_cron = string
    stop_cron  = string
    timezone   = string
  })
  default = null
}

variable "log_level" {
  type    = string
  default = "info"
}

variable "log_group_names" {
  description = "Keys: api, worker, migrate, db-bootstrap."
  type        = map(string)
}

variable "log_group_arns" {
  type = map(string)
}

variable "container_insights" {
  type    = bool
  default = false
}

variable "enable_execute_command" {
  description = "ECS Exec break-glass shell. Keep false in production unless an incident requires it."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "origin_fqdn" {
  description = "DNS name CloudFront uses to reach the ALB (certificate + alias record are created for it)."
  type        = string
}

variable "route53_zone_id" {
  type = string
}

variable "origin_verify_secret" {
  description = "Header value CloudFront sends and the ALB requires."
  type        = string
  sensitive   = true
}

variable "health_check_path" {
  type    = string
  default = "/health/ready"
}

variable "alb_access_logs_bucket" {
  description = "Bucket NAME for ALB access logs (must be known at plan time: pass the configured name)."
  type        = string
  default     = null
}

variable "deployment_alarm_names" {
  description = "CloudWatch alarms that roll back an API deployment when they fire."
  type        = list(string)
  default     = []
}

variable "cors_origins" {
  type    = list(string)
  default = []
}

variable "extra_environment" {
  description = "Additional non-secret environment variables for api and worker."
  type        = map(string)
  default     = {}
}

# Data plane dependencies
variable "db_writer_endpoint" {
  type = string
}

variable "db_name" {
  type    = string
  default = "portico"
}

variable "db_master_secret_arn" {
  type = string
}

variable "db_owner_secret_arn" {
  type = string
}

variable "db_app_secret_arn" {
  type = string
}

variable "db_iam_readonly_role" {
  type    = bool
  default = false
}

variable "db_app_connection_limit" {
  type    = number
  default = -1
}

variable "secrets_kms_key_arn" {
  type = string
}

variable "integration_secret_arns" {
  type    = map(string)
  default = {}
}

variable "injected_integration_secrets" {
  description = "ENV_VAR_NAME => integration secret key. Only list secrets that HAVE a value, or tasks fail to start."
  type        = map(string)
  default     = {}
}

variable "field_encryption_key_arn" {
  type = string
}

variable "storage_kms_key_arn" {
  type = string
}

variable "bucket_names" {
  type = map(string)
}

variable "bucket_arns" {
  type = map(string)
}

variable "metric_namespace" {
  type = string
}

variable "ses_enabled" {
  description = "Static switch: grant ses:SendEmail on the identity/configuration set below."
  type        = bool
  default     = false
}

variable "ses_identity_arn" {
  type    = string
  default = null
}

variable "ses_configuration_set_arn" {
  type    = string
  default = null
}

variable "smoke_base_url" {
  description = "Public URL the pipeline smoke-tests after a deploy."
  type        = string
}
