# Tier presets. Every value can be overridden through var.overrides; prices quoted are ap-south-1 on-demand from the
# AWS Price List published 2026-11-05 (see infra/README.md for the full monthly estimates).

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  region = data.aws_region.current.region
  region_codes = {
    "ap-south-1" = "aps1", "ap-south-2" = "aps2", "ap-southeast-1" = "apse1", "me-central-1" = "mec1",
    "eu-west-1"  = "euw1", "eu-central-1" = "euc1", "us-east-1" = "use1", "us-west-2" = "usw2",
  }
  region_code = lookup(local.region_codes, local.region, replace(local.region, "-", ""))
  env_code    = { demo = "demo", staging = "stg", production = "prod" }[var.deployment]

  name_prefix   = "portico-${local.env_code}-${local.region_code}-${var.cell}"
  secret_path   = "portico/${var.deployment}/${local.region_code}-${var.cell}"
  bucket_prefix = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}"

  is_demo     = var.tier == "demo"
  run_host    = local.is_demo && var.active
  run_managed = !local.is_demo && var.active
  run_any     = local.run_host || local.run_managed
  production  = var.deployment == "production"
  # Operator-console placeholders are useless in production (refused there until IAM Identity Center); not created.
  operator_secret_keys = ["operator-token", "portico-operators"]
  integration_secrets  = local.production ? { for k, v in var.integration_secrets : k => v if !contains(local.operator_secret_keys, k) } : var.integration_secrets
  ephemeral            = !local.production # staging/demo data is synthetic: allow clean destroy/recreate

  t = var.tier
  o = var.overrides

  preset = {
    az_count = { demo = 2, lean = 2, resilient = 3 }[local.t]
    nat_mode = { demo = "none", lean = "none", resilient = "per_az" }[local.t]
    # Egress (lean): tasks run in public subnets with a public IP and NO inbound rule except the API port from the
    # ALB's security group. That reaches AWS APIs AND the third parties the app calls (Stripe Connect, OIDC
    # identity providers, outbound webhooks, Channex) for ≈ $3.65/month per task. Interface endpoints (≈ $9.49 each
    # per AZ) reach AWS APIs only, so the app's payment/SSO/webhook calls would fail. Fixed egress IP or private
    # tasks: overrides = { nat_mode = "single" } (≈ +$45/month). README § Egress.
    # Resilient: NAT per AZ already reaches AWS APIs. Interface endpoints for ecr.api/ecr.dkr/logs/secretsmanager in 3
    # AZs would add 12 endpoint-hours ≈ $114/month to save cents of NAT data processing; opt in with overrides =
    # { interface_endpoints = [...], endpoint_az_count = 3 } when AWS-API traffic must not depend on the NAT gateways.
    interface_endpoints = { demo = [], lean = [], resilient = [] }[local.t]
    endpoint_az_count   = { demo = 1, lean = 1, resilient = 3 }[local.t]
    flow_logs           = { demo = null, lean = null, resilient = "ALL" }[local.t]
    db_engine           = { demo = "rds", lean = "rds", resilient = "aurora" }[local.t]
    db_instance_class   = { demo = "db.t4g.micro", lean = "db.t4g.small", resilient = "db.serverless" }[local.t]
    db_instance_count   = { demo = 1, lean = 1, resilient = 2 }[local.t]
    db_multi_az         = { demo = false, lean = false, resilient = false }[local.t]
    db_backup_days      = { demo = 1, lean = 14, resilient = 35 }[local.t]
    db_perf_insights    = { demo = false, lean = false, resilient = true }[local.t]
    db_monitoring       = { demo = 0, lean = 0, resilient = 60 }[local.t]
    db_connections_warn = { demo = 50, lean = 150, resilient = 400 }[local.t]
    waf_level           = { demo = "none", lean = "basic", resilient = "full" }[local.t]
    aws_backup          = { demo = false, lean = false, resilient = true }[local.t]
    container_insights  = { demo = false, lean = false, resilient = true }[local.t]
    log_retention_days  = { demo = 7, lean = 30, resilient = 90 }[local.t]
    host_instance_type  = "t4g.small"
    api = {
      demo      = { cpu = 256, memory = 512, desired = 1, min = 1, max = 1, db_pool_max = 5, requests_per_target = 500 }
      lean      = { cpu = 512, memory = 1024, desired = 1, min = 1, max = 2, db_pool_max = 10, requests_per_target = 500 }
      resilient = { cpu = 512, memory = 1024, desired = 2, min = 2, max = 6, db_pool_max = 10, requests_per_target = 500 }
    }[local.t]
    worker = {
      demo      = { cpu = 256, memory = 512, desired = 1, min = 1, max = 1 }
      lean      = { cpu = 256, memory = 512, desired = 1, min = 1, max = 1 }
      resilient = { cpu = 256, memory = 512, desired = 2, min = 2, max = 4 }
    }[local.t]
  }

  s = {
    az_count            = coalesce(local.o.az_count, local.preset.az_count)
    nat_mode            = coalesce(local.o.nat_mode, local.preset.nat_mode)
    interface_endpoints = local.o.interface_endpoints != null ? local.o.interface_endpoints : local.preset.interface_endpoints
    endpoint_az_count   = coalesce(local.o.endpoint_az_count, local.preset.endpoint_az_count)
    db_engine           = coalesce(local.o.db_engine, local.preset.db_engine)
    db_instance_class   = coalesce(local.o.db_instance_class, local.preset.db_instance_class)
    db_instance_count   = coalesce(local.o.db_instance_count, local.preset.db_instance_count)
    db_multi_az         = coalesce(local.o.db_multi_az, local.preset.db_multi_az)
    db_backup_days      = coalesce(local.o.db_backup_days, local.preset.db_backup_days)
    waf_level           = coalesce(local.o.waf_level, local.preset.waf_level)
    aws_backup          = coalesce(local.o.aws_backup, local.preset.aws_backup)
    log_retention_days  = coalesce(local.o.log_retention_days, local.preset.log_retention_days)
    host_instance_type  = coalesce(local.o.host_instance_type, local.preset.host_instance_type)
    api                 = local.o.api != null ? local.o.api : local.preset.api
    worker              = local.o.worker != null ? local.o.worker : local.preset.worker
  }

  # Tasks run in private subnets when they have a way out (NAT or endpoints); otherwise in public subnets with a
  # public IP and no inbound rules.
  private_tasks = local.s.nat_mode != "none" || length(local.s.interface_endpoints) > 0

  schedule = (local.production || var.always_on) ? null : var.office_hours

  env_domain    = var.domain_name == null ? null : (var.subdomain == "" ? var.domain_name : "${var.subdomain}.${var.domain_name}")
  aliases       = local.env_domain == null ? [] : ["app.${local.env_domain}", "api.${local.env_domain}"]
  origin_fqdn   = local.env_domain == null ? null : "origin-${local.region_code}-${var.cell}.${local.env_domain}"
  cors_origins  = [for a in local.aliases : "https://${a}"]
  external_fqdn = local.env_domain == null ? null : "api.${local.env_domain}"
  # Staff web app base URL for links in invitations and password resets (identity: PORTICO_APP_BASE_URL). Without a
  # domain (demo only) the deploy passes the CloudFront URL at deploy time instead (single-host portico.sh).
  app_base_url = local.env_domain == null ? null : "https://app.${local.env_domain}"

  # Who may set the client IP through X-Forwarded-For (API: TRUSTED_PROXY_CIDRS). The chain is
  #   viewer → CloudFront (appends the viewer IP) → ALB (appends the CloudFront edge IP) → task.
  # Trusting only the ALB subnets would make the CloudFront EDGE the "client", so every viewer behind one edge
  # location would share a per-IP rate limit (e.g. sign-in: 20/min). Trusting the CloudFront origin-facing ranges as
  # well yields the real viewer IP; a viewer cannot spoof it because CloudFront always appends the address it saw.
  # The demo host is reached by CloudFront directly (no ALB). Never 0.0.0.0/0 (guard in main.tf).
  trusted_proxy_cidrs = concat(
    local.is_demo ? [] : module.network.public_subnet_cidrs,
    module.network.cloudfront_origin_cidrs,
  )

  # Non-live demo: provider domains that must never be reachable (defense in depth behind ADR-0010).
  demo_blocked_domains = [
    "stripe.com", "*.stripe.com", "channex.io", "*.channex.io", "booking.com", "*.booking.com",
    "expedia.com", "*.expedia.com", "agoda.com", "*.agoda.com", "graph.facebook.com", "*.whatsapp.net",
    "twilio.com", "*.twilio.com", "api.anthropic.com", "api.openai.com",
  ]

  log_groups = local.is_demo ? ["host"] : ["api", "worker", "migrate", "db-bootstrap", "restore-drill"]
  log_group  = { for g in local.log_groups : g => "/portico/${local.name_prefix}/${g}" }
}
