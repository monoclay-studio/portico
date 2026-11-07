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
