variable "name_prefix" {
  type = string
}

variable "repositories" {
  description = "Repository short names."
  type        = list(string)
  default     = ["api", "worker", "restore-drill"]
}

variable "keep_images" {
  description = "Images kept per repository. Rollback can only go back as far as this."
  type        = number
  default     = 30
}

variable "force_delete" {
  type    = bool
  default = false
}

variable "release_tag" {
  description = "The only mutable tag (exact name; no wildcard characters)."
  type        = string
  default     = "release"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.release_tag))
    error_message = "release_tag must be a plain lowercase name (it must never match a git SHA)."
  }
}
