variable "name_prefix" {
  type = string
}

variable "domain" {
  description = "Sending domain (owner decision, OPEN_QUESTIONS Q1). Example: mail.portico.example"
  type        = string
}

variable "mail_from_subdomain" {
  type    = string
  default = "bounce"
}

variable "route53_zone_id" {
  description = "Zone for DKIM/MAIL FROM/DMARC records; null if DNS is managed elsewhere (publish the outputs manually)."
  type        = string
  default     = null
}

variable "sending_enabled" {
  description = "Master switch for the configuration set. Keep false until the owner authorizes real sending."
  type        = bool
  default     = false
}

variable "events_topic_arn" {
  description = "SNS topic for bounce/complaint events."
  type        = string
}

variable "manage_dmarc" {
  type    = bool
  default = true
}

variable "dmarc_report_address" {
  type    = string
  default = "dmarc-reports@example.invalid"
}
