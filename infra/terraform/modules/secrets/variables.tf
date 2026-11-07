variable "name_prefix" {
  type = string
}

variable "secret_path" {
  description = "Secrets Manager path prefix, e.g. portico/production/aps1-c01."
  type        = string
}

variable "db_host" {
  type = string
}

variable "db_port" {
  type    = number
  default = 5432
}

variable "db_name" {
  type    = string
  default = "portico"
}

variable "recovery_window_days" {
  description = "Days a deleted secret stays recoverable (0 = immediate, only for throwaway cells)."
  type        = number
  default     = 30
}

variable "integration_secrets" {
  description = "Placeholder secrets to create (name => purpose). Values are added by the owner, never by Terraform."
  type        = map(string)
  default     = {}
}

variable "replica_region" {
  description = "Region that keeps a replica of the irreplaceable application keys (resilient tier: the DR region of the cross-region backups). null = no replica."
  type        = string
  default     = null
}

variable "protect_app_keys" {
  description = "Production: prevent_destroy, 30-day recovery and a resource policy that leaves destruction/replacement to the break-glass role."
  type        = bool
  default     = false
}

variable "key_admin_role_arns" {
  description = "Break-glass role(s) allowed to read, replace or delete protected keys (default: role/portico-key-break-glass, created by a human)."
  type        = list(string)
  default     = []
}

variable "reader_role_arns" {
  description = "Execution roles that may read the keys and payment secrets (ECS injects them at task start). Names are deterministic, so no dependency cycle."
  type        = list(string)
  default     = []
}

variable "existing_app_key_secret_arns" {
  description = "DR cell: ENV_VAR => ARN of the replicated key secrets in this region; those keys are NOT generated."
  type        = map(string)
  default     = null
}

variable "terraform_principal_arns" {
  description = "Role(s) that run `terraform apply` for this cell (humans; default role/portico-infra-admin). Never a CI role."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for a in var.terraform_principal_arns : !strcontains(a, "github-deploy") && !strcontains(a, "*")])
    error_message = "terraform_principal_arns must be exact human/admin roles, never a CI deploy role or a wildcard."
  }
}
