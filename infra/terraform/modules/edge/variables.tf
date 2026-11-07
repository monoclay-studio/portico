variable "name_prefix" {
  type = string
}

variable "bucket_prefix" {
  description = "Globally unique bucket prefix (the web bucket is <prefix>-web)."
  type        = string
}

variable "aliases" {
  description = "Custom hostnames, e.g. [\"app.example.com\", \"api.example.com\"]. Empty = use the *.cloudfront.net name."
  type        = list(string)
  default     = []
}

variable "route53_zone_id" {
  description = "Hosted zone for aliases and certificate validation (required when aliases is non-empty)."
  type        = string
  default     = null
}

variable "origin_domain_name" {
  description = "ALB origin hostname (HTTPS) or demo host public DNS (HTTP)."
  type        = string
}

variable "origin_protocol" {
  description = "https-only for ALB origins; http-only only for the demo host (sample data)."
  type        = string
  validation {
    condition     = contains(["https-only", "http-only"], var.origin_protocol)
    error_message = "origin_protocol must be https-only or http-only."
  }
}

variable "origin_http_port" {
  type    = number
  default = 80
}

variable "origin_verify_secret" {
  type      = string
  sensitive = true
}

variable "waf_level" {
  description = "none | basic | full (see waf.tf)."
  type        = string
  validation {
    condition     = contains(["none", "basic", "full"], var.waf_level)
    error_message = "waf_level must be none, basic or full."
  }
}

variable "rate_limit_per_5min" {
  description = "Requests per client IP per 5 minutes before blocking. A busy front desk behind one NAT shares one IP."
  type        = number
  default     = 3000
}

variable "login_rate_limit_per_5min" {
  type    = number
  default = 100
}

variable "waf_log_retention_days" {
  type    = number
  default = 30
}

variable "price_class" {
  description = "PriceClass_200 includes India/Asia edges (closest to the Maldives) without the most expensive regions."
  type        = string
  default     = "PriceClass_200"
}

variable "content_security_policy" {
  description = "Applied to responses that do not set their own CSP. Tighten when the SPA exists."
  type        = string
  default     = "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
}
