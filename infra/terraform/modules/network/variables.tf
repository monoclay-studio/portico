variable "name_prefix" {
  description = "Cell name prefix, e.g. portico-prod-aps1-c01."
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR. Must be a /16; give every cell a distinct range so cells can be peered later."
  type        = string
  validation {
    condition     = can(cidrhost(var.cidr_block, 0)) && endswith(var.cidr_block, "/16")
    error_message = "cidr_block must be a valid IPv4 /16."
  }
}

variable "az_count" {
  description = "Availability zones to use (2 or 3). Load balancers and database subnet groups need at least 2."
  type        = number
  validation {
    condition     = contains([2, 3], var.az_count)
    error_message = "az_count must be 2 or 3."
  }
}

variable "nat_mode" {
  description = "none | single | per_az. See the cost note at the top of main.tf."
  type        = string
  validation {
    condition     = contains(["none", "single", "per_az"], var.nat_mode)
    error_message = "nat_mode must be none, single or per_az."
  }
}

variable "interface_endpoints" {
  description = "Interface endpoint service suffixes, e.g. [\"ecr.api\", \"ecr.dkr\", \"logs\", \"secretsmanager\"]."
  type        = list(string)
  default     = []
}

variable "endpoint_az_count" {
  description = "How many AZs carry interface endpoint ENIs. 1 saves money; tasks in other AZs cross-AZ to them."
  type        = number
  default     = 1
}

variable "app_port" {
  description = "Container port of the API."
  type        = number
  default     = 4000
}

variable "flow_logs_traffic_type" {
  description = "null (off), REJECT or ALL."
  type        = string
  default     = null
  validation {
    condition     = var.flow_logs_traffic_type == null || contains(["REJECT", "ALL", "ACCEPT"], coalesce(var.flow_logs_traffic_type, "x"))
    error_message = "flow_logs_traffic_type must be null, REJECT, ACCEPT or ALL."
  }
}

variable "flow_logs_retention_days" {
  type    = number
  default = 30
}

variable "logs_kms_key_arn" {
  description = "KMS key for the flow-log log group (optional)."
  type        = string
  default     = null
}

variable "dns_firewall_blocked_domains" {
  description = "Domains made unresolvable inside the VPC (non-live cells): payment, channel, messaging, paid AI."
  type        = list(string)
  default     = []
}
