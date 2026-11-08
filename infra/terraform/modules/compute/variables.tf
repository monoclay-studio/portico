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

variable "release_tag" {
  description = "The one mutable tag of each repository; task definitions reference <repo>:<release_tag> and a release moves it."
  type        = string
  default     = "release"
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

variable "trusted_proxy_cidrs" {
  description = "API TRUSTED_PROXY_CIDRS: the ALB subnets plus CloudFront's origin-facing ranges. Never 0.0.0.0/0."
  type        = list(string)
  validation {
    condition     = length(var.trusted_proxy_cidrs) > 0 && alltrue([for c in var.trusted_proxy_cidrs : can(cidrhost(c, 0)) && try(tonumber(split("/", c)[1]) >= 8, false)])
    error_message = "trusted_proxy_cidrs must be non-empty, valid CIDRs and never shorter than /8 (that would let almost anyone set the client IP)."
  }
}

variable "app_base_url" {
  description = "Staff web app base URL (identity: PORTICO_APP_BASE_URL) for invitation and password-reset links."
  type        = string
  default     = null
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

variable "db_worker_secret_arn" {
  description = "portico_worker login secret (worker task's APP_DATABASE_URL)."
  type        = string
}

variable "api_holds_worker_credentials" {
  description = "Also inject the worker login into the API as WORKER_DATABASE_URL (public webhook route; see cell variable)."
  type        = bool
  default     = false
}

variable "app_key_secret_arns" {
  description = "ENV_VAR_NAME => secret ARN of the generated application keys (field, blind index, terms seal, simulator)."
  type        = map(string)
  validation {
    condition     = alltrue([for k in ["PORTICO_FIELD_KEY", "PORTICO_BLIND_INDEX_KEY", "PORTICO_TERMS_SEAL_KEY", "PAYMENTS_SIMULATOR_SIGNING_SECRET"] : contains(keys(var.app_key_secret_arns), k)])
    error_message = "The API refuses to start in production without PORTICO_FIELD_KEY, PORTICO_BLIND_INDEX_KEY and PORTICO_TERMS_SEAL_KEY; every task needs the shared PAYMENTS_SIMULATOR_SIGNING_SECRET."
  }
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

variable "ses_domain" {
  description = "SES sending domain (PORTICO_EMAIL_DOMAIN for the email adapter; null = none)."
  type        = string
  default     = null
}

variable "ses_configuration_set_name" {
  type    = string
  default = null
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

variable "web" {
  description = "Where the deploy pipeline publishes the staff web app: { bucket, distribution_id } (edge module)."
  type = object({
    bucket          = string
    distribution_id = string
  })
}
