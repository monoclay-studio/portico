variable "name_prefix" {
  type = string
}

variable "instance_type" {
  description = "t4g.small (2 vCPU burst, 2 GiB) = $0.0112/h in ap-south-1 (AWS price list 2026-11-05)."
  type        = string
  default     = "t4g.small"
}

variable "cpu_architecture" {
  description = "Must match instance_type (t4g = ARM64) and the image build platform."
  type        = string
  default     = "ARM64"
}

variable "volume_gb" {
  type    = number
  default = 20
}

variable "subnet_id" {
  description = "A public subnet (the host has no NAT; it reaches ECR/SSM/CloudWatch through its Elastic IP)."
  type        = string
}

variable "security_group_id" {
  type = string
}

variable "repository_urls" {
  type = map(string)
}

variable "repository_arns" {
  type = map(string)
}

variable "image_tag" {
  description = "Tag deployed at first boot; 'bootstrap' = wait for the pipeline."
  type        = string
  default     = "bootstrap"
}

variable "postgres_image" {
  description = "Pin by digest before use (docker buildx imagetools inspect …)."
  type        = string
  default     = "public.ecr.aws/docker/library/postgres:16-bookworm"
}

variable "app_port" {
  type    = number
  default = 4000
}

variable "cors_origins" {
  type    = list(string)
  default = []
}

variable "app_base_url" {
  description = "Staff web app URL for invitation/reset links when a custom domain exists; otherwise the deploy passes the CloudFront URL (portico.sh deploy <tag> <base-url>)."
  type        = string
  default     = null
}

variable "trusted_proxies" {
  description = "TRUSTED_PROXY_CIDRS for the API on the host: CloudFront's origin-facing ranges (CloudFront connects to the host directly)."
  type        = list(string)
  validation {
    condition     = length(var.trusted_proxies) > 0 && alltrue([for c in var.trusted_proxies : can(cidrhost(c, 0)) && !endswith(c, "/0")])
    error_message = "trusted_proxies must be non-empty, valid CIDRs and never a /0."
  }
}

variable "seed_demo" {
  description = "Seed the Maldives sample organizations on first deploy."
  type        = bool
  default     = true
}

variable "log_group_name" {
  type = string
}

variable "log_group_arn" {
  type = string
}

variable "schedule" {
  description = "Office-hours start/stop (EventBridge Scheduler cron + IANA timezone); null = always on."
  type = object({
    start_cron = string
    stop_cron  = string
    timezone   = string
  })
  default = null
}

variable "smoke_base_url" {
  type = string
}
