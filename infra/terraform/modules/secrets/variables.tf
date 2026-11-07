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
