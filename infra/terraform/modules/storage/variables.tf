variable "name_prefix" {
  type = string
}

variable "bucket_prefix" {
  description = "Globally unique prefix, e.g. portico-prod-aps1-c01-<account id>. Buckets are <prefix>-documents etc."
  type        = string
  validation {
    condition     = length(var.bucket_prefix) <= 53 && can(regex("^[a-z0-9][a-z0-9-]+$", var.bucket_prefix))
    error_message = "bucket_prefix must be lowercase alphanumerics/hyphens and at most 53 characters."
  }
}

variable "force_destroy" {
  description = "Allow destroying non-empty buckets (throwaway cells only)."
  type        = bool
  default     = false
}

variable "presigned_url_max_age_seconds" {
  description = "Hard cap on presigned URL lifetime, enforced by bucket policy (s3:signatureAge)."
  type        = number
  default     = 900
}

variable "cors_allowed_origins" {
  description = "Web origins allowed to upload/download documents directly with presigned URLs."
  type        = list(string)
  default     = []
}

variable "documents_ia_transition_days" {
  type    = number
  default = 90
}

variable "documents_noncurrent_days" {
  description = "How long overwritten/deleted document versions remain recoverable. Retention policy is an owner/legal decision (see README)."
  type        = number
  default     = 90
}

variable "exports_expiration_days" {
  type    = number
  default = 7
}

variable "backups_glacier_ir_days" {
  type    = number
  default = 30
}

variable "backups_expiration_days" {
  type    = number
  default = 400
}

variable "backups_object_lock_days" {
  description = "0 disables Object Lock. Can only be enabled when the bucket is created."
  type        = number
  default     = 0
}

variable "access_logs_retention_days" {
  type    = number
  default = 90
}
