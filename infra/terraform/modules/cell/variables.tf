# One Portico "cell" = one complete deployment (network, data, compute, edge) in one region. More cells (other
# regions for data residency, or a dedicated cell for a large group) are added by instantiating this module again
# with a different `cell` id and CIDR — names, state keys and secrets are cell-scoped.

variable "tier" {
  description = <<-EOT
    Cost/resilience tier (docs/readiness/cost-model.md §4a):
      demo       T1 — one small instance running api + worker + Postgres, CloudFront in front, no NAT/WAF/managed DB,
                      office-hours auto-stop, budget stop action. SAMPLE DATA ONLY.
      lean       T2 — Fargate (1 api + 1 worker), single-AZ RDS PostgreSQL with PITR + monthly restore drill,
                      VPC endpoints (one AZ) instead of NAT, basic WAF.
      resilient  T3 — Fargate across 3 AZs, Aurora PostgreSQL with a cross-AZ replica, NAT per AZ, full WAF,
                      AWS Backup with cross-region copies and vault lock.
  EOT
  type        = string
  validation {
    condition     = contains(["demo", "lean", "resilient"], var.tier)
    error_message = "tier must be demo, lean or resilient."
  }
  validation {
    condition     = !(var.tier == "demo" && var.deployment == "production")
    error_message = "The demo tier (Postgres on a single host, sample data only) cannot be used for production."
  }
}

variable "deployment" {
  description = "demo | staging | production. Production is never auto-stopped and keeps deletion protection."
  type        = string
  validation {
    condition     = contains(["demo", "staging", "production"], var.deployment)
    error_message = "deployment must be demo, staging or production."
  }
}

variable "active" {
  description = "false keeps only free/near-free pieces (VPC, ECR, budget). Used to keep staging off between releases."
  type        = bool
  default     = true
}

variable "cell" {
  description = "Cell id within the region, e.g. c01."
  type        = string
  default     = "c01"
  validation {
    condition     = can(regex("^c[0-9]{2}$", var.cell))
    error_message = "cell must look like c01."
  }
}

variable "cidr_block" {
  description = "Distinct /16 per cell (e.g. 10.20.0.0/16 production aps1-c01, 10.30.0.0/16 staging…)."
  type        = string
}

# ── Naming / DNS ─────────────────────────────────────────────────────────────────────────────────────────────
variable "domain_name" {
  description = "Base domain (OPEN_QUESTIONS Q1). null = no custom domain: allowed for the demo tier only."
  type        = string
  default     = null
  validation {
    condition     = var.domain_name != null || var.tier == "demo" || !var.active
    error_message = "lean/resilient tiers carry real hotel data and need HTTPS end to end: set domain_name and route53_zone_id (OPEN_QUESTIONS Q1)."
  }
}

variable "subdomain" {
  description = "Environment label inside the domain: \"\" for production, \"staging\", \"demo\"."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Hosted zone of domain_name."
  type        = string
  default     = null
  validation {
    condition     = var.domain_name == null || var.route53_zone_id != null
    error_message = "domain_name requires route53_zone_id."
  }
}

# ── People and money ─────────────────────────────────────────────────────────────────────────────────────────
variable "oncall_emails" {
  type    = list(string)
  default = []
}

variable "budget_monthly_usd" {
  description = "Monthly budget for this cell (Q22). 0 disables the budget."
  type        = number
}

variable "budget_alert_emails" {
  type    = list(string)
  default = []
}

variable "budget_stop_actions" {
  description = "Demo tier only: stop the host (and block restarts) when the budget is reached."
  type        = bool
  default     = true
}

variable "cost_filter_tag" {
  description = "Scope the budget to this cell's tag (activate the cost-allocation tag first); null = whole account."
  type = object({
    key   = string
    value = string
  })
  default = null
}

# ── Schedules ────────────────────────────────────────────────────────────────────────────────────────────────
variable "office_hours" {
  description = "Non-production start/stop schedule (EventBridge cron, IANA timezone). Ignored for production."
  type = object({
    start_cron = string
    stop_cron  = string
    timezone   = string
  })
  default = {
    start_cron = "cron(0 8 ? * MON-SAT *)"
    stop_cron  = "cron(0 20 ? * * *)"
    timezone   = "Indian/Maldives"
  }
}

variable "always_on" {
  description = "Disable the office-hours schedule for a non-production cell."
  type        = bool
  default     = false
}

# ── Release / CI ─────────────────────────────────────────────────────────────────────────────────────────────
variable "image_tag" {
  description = "Initial image tag for task definitions / first boot. The pipeline deploys real tags."
  type        = string
  default     = "bootstrap"
}

variable "github_repository" {
  description = "owner/name allowed to deploy through OIDC; null = no CI role."
  type        = string
  default     = null
}

variable "github_environments" {
  type    = list(string)
  default = []
}

variable "cpu_architecture" {
  description = "ARM64 (default; Graviton) or X86_64. Images must be built for it."
  type        = string
  default     = "ARM64"
}

# ── Data ─────────────────────────────────────────────────────────────────────────────────────────────────────
variable "engine_version" {
  description = "PostgreSQL 16 minor version for RDS/Aurora. VERIFY in the target region before apply (see database module)."
  type        = string
  default     = "16.10"
}

variable "dr_region" {
  description = "Region for backup copies (resilient tier). Data-residency decision — README owner decisions."
  type        = string
  default     = "ap-south-2"
}

variable "restore_drill_enabled" {
  type    = bool
  default = true
}

variable "integration_secrets" {
  description = "Placeholder secrets (no values) to create for this cell: key => purpose."
  type        = map(string)
  default = {
    # Payments (hotel guest money): Monoclay's Stripe Connect PLATFORM keys. The hotel's own merchant account is a
    # connected account; no guest funds move through Monoclay (CLAUDE.md §4.14). OPEN_QUESTIONS Q2/Q3.
    "payments-stripe-connect-secret-key-test"      = "Stripe Connect platform secret key, TEST mode (PAYMENTS_STRIPE_SECRET_KEY_TEST)"
    "payments-stripe-connect-webhook-secrets-test" = "Stripe Connect endpoint signing secrets, TEST mode, comma-separated (PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST)"
    "payments-stripe-connect-secret-key-live"      = "Stripe Connect platform secret key, LIVE mode — production deployment only (PAYMENTS_STRIPE_SECRET_KEY_LIVE)"
    "payments-stripe-connect-webhook-secrets-live" = "Stripe Connect endpoint signing secrets, LIVE mode — production only (PAYMENTS_STRIPE_WEBHOOK_SECRETS_LIVE)"
    # Monoclay SaaS billing: Monoclay's OWN Stripe account (billing module, not built). Never injected as PAYMENTS_*.
    "stripe-billing-secret-key"     = "Monoclay SaaS billing — Monoclay's own Stripe account (never hotel guest money)"
    "stripe-billing-webhook-secret" = "Monoclay SaaS billing webhook signing secret"
    "channex-api-key"               = "Channex channel manager API key (production activation is OPEN_QUESTIONS Q23)"
    # Operator console (identity): static tokens are refused in production until IAM Identity Center replaces them.
    "operator-token"    = "OPERATOR_TOKEN for the internal provisioning endpoint (endpoint disabled while unset; never in production)"
    "portico-operators" = "PORTICO_OPERATORS JSON [{id,name,email,tokenSha256}] for the operator console (non-production only)"
  }
}

variable "injected_integration_secrets" {
  description = "ENV_VAR => integration secret key, ONLY for secrets that already have a value (ECS refuses to start otherwise)."
  type        = map(string)
  default     = {}
  validation {
    condition     = alltrue([for k in values(var.injected_integration_secrets) : contains(keys(var.integration_secrets), k)])
    error_message = "Every injected secret must be one of integration_secrets."
  }
  validation {
    # Static operator tokens have no expiry and no MFA (identity review P2-17): never in a production deployment.
    condition = var.deployment != "production" || (
      length(setintersection(keys(var.injected_integration_secrets), ["OPERATOR_TOKEN", "PORTICO_OPERATORS"])) == 0 &&
      length(setintersection(values(var.injected_integration_secrets), ["operator-token", "portico-operators"])) == 0
    )
    error_message = "OPERATOR_TOKEN / PORTICO_OPERATORS must not be injected into production (operator console is disabled there until IAM Identity Center)."
  }
  validation {
    condition     = var.deployment == "production" || length([for k in keys(var.injected_integration_secrets) : k if endswith(k, "_LIVE")]) == 0
    error_message = "LIVE-mode provider keys may only be injected into the production deployment."
  }
  validation {
    # Two money worlds never mix (CLAUDE.md §4.14): Monoclay's billing account never feeds the guest-payments module.
    condition     = alltrue([for env, key in var.injected_integration_secrets : !(startswith(env, "PAYMENTS_") && startswith(key, "stripe-billing"))])
    error_message = "Monoclay SaaS-billing secrets must never be injected as PAYMENTS_* (hotel guest money)."
  }
}

variable "email_domain" {
  description = "SES sending domain; null = no SES resources."
  type        = string
  default     = null
}

variable "email_sending_enabled" {
  type    = bool
  default = false
}

variable "api_holds_worker_credentials" {
  description = <<-EOF2
    Inject the portico_worker login into the API as WORKER_DATABASE_URL. Turn on only when the API serves the public
    payments webhook route through a worker-role pool (payments FOUNDATION_REQUESTS §4); until then the API does not
    need it (least privilege) and payments.route_webhook stays executable by portico_app.
  EOF2
  type        = bool
  default     = false
}

# ── Per-tier overrides (null = tier default) ─────────────────────────────────────────────────────────────────
variable "overrides" {
  description = "Override individual tier defaults; see locals.tf for the keys and their defaults."
  type = object({
    az_count            = optional(number)
    nat_mode            = optional(string)
    interface_endpoints = optional(list(string))
    endpoint_az_count   = optional(number)
    db_engine           = optional(string)
    db_instance_class   = optional(string)
    db_instance_count   = optional(number)
    db_multi_az         = optional(bool)
    db_backup_days      = optional(number)
    waf_level           = optional(string)
    aws_backup          = optional(bool)
    log_retention_days  = optional(number)
    host_instance_type  = optional(string)
    api = optional(object({
      cpu = number, memory = number, desired = number, min = number, max = number, db_pool_max = number, requests_per_target = number
    }))
    worker = optional(object({
      cpu = number, memory = number, desired = number, min = number, max = number
    }))
  })
  default = {}
}
