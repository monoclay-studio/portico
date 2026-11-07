variable "bucket_name" {
  description = "Globally unique, e.g. portico-tfstate-<account id>."
  type        = string
}

variable "noncurrent_version_days" {
  description = "How long previous state versions are kept (state rollback window)."
  type        = number
  default     = 90
}
