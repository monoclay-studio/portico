# Guard rails that depend on derived settings (input-only rules are variable validations in variables.tf).
resource "terraform_data" "guards" {
  lifecycle {
    precondition {
      condition     = local.s.db_engine != "aurora" || local.s.db_instance_count >= 1
      error_message = "Aurora needs at least one instance."
    }
    precondition {
      # Never trust every address to set the client IP: per-IP rate limits would then trust spoofed headers.
      condition     = alltrue([for c in local.trusted_proxy_cidrs : can(cidrhost(c, 0)) && !endswith(c, "/0")])
      error_message = "TRUSTED_PROXY_CIDRS must be specific CIDRs (ALB subnets and CloudFront origin-facing ranges), never 0.0.0.0/0."
    }
  }
}

resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

# ── Always present (near-free) ───────────────────────────────────────────────────────────────────────────────
module "network" {
  source                       = "../network"
  name_prefix                  = local.name_prefix
  cidr_block                   = var.cidr_block
  az_count                     = local.s.az_count
  nat_mode                     = var.active ? local.s.nat_mode : "none"
  interface_endpoints          = local.run_managed ? local.s.interface_endpoints : []
  endpoint_az_count            = local.s.endpoint_az_count
  flow_logs_traffic_type       = local.run_managed ? local.preset.flow_logs : null
  flow_logs_retention_days     = local.s.log_retention_days
  dns_firewall_blocked_domains = local.is_demo ? local.demo_blocked_domains : []
}

module "registry" {
  source       = "../registry"
  name_prefix  = local.name_prefix
  repositories = local.is_demo ? ["api", "worker"] : ["api", "worker", "restore-drill"]
  force_delete = local.ephemeral
}

module "budget" {
  source              = "../budgets"
  count               = var.budget_monthly_usd > 0 ? 1 : 0
  name_prefix         = local.name_prefix
  monthly_limit_usd   = var.budget_monthly_usd
  alert_emails        = var.budget_alert_emails
  alert_topic_arn     = one(module.observability[*].oncall_topic_arn)
  cost_filter_tag     = var.cost_filter_tag
  enable_stop_actions = local.run_host && var.budget_stop_actions && length(var.budget_alert_emails) > 0
  enable_deny_restart = local.run_host && var.budget_stop_actions && local.schedule != null
  stop_instance_id    = one(module.single_host[*].instance_id)
  stop_instance_arn   = one(module.single_host[*].instance_arn)
  scheduler_role_name = local.schedule == null ? null : "${local.name_prefix}-host-scheduler"
}

# ── Observability (both runtimes) ────────────────────────────────────────────────────────────────────────────
module "observability" {
  source             = "../observability"
  count              = local.run_any ? 1 : 0
  name_prefix        = local.name_prefix
  log_groups         = local.log_groups
  log_retention_days = local.s.log_retention_days
  oncall_emails      = var.oncall_emails

  enable_host_alarms = local.run_host
  host_instance_id   = local.run_host ? module.single_host[0].instance_id : ""

  enable_alb_alarms        = local.run_managed
  enable_db_alarms         = local.run_managed
  enable_outbox_alarms     = true
  enable_worker_task_alarm = local.run_managed && local.preset.container_insights
  worker_log_group         = local.is_demo ? local.log_group["host"] : local.log_group["worker"]
  api_log_group            = local.is_demo ? local.log_group["host"] : local.log_group["api"]
  alb_arn_suffix           = local.run_managed ? module.compute[0].alb_arn_suffix : ""
  target_group_arn_suffix  = local.run_managed ? module.compute[0].target_group_arn_suffix : ""
  ecs_cluster_name         = local.run_managed ? module.compute[0].cluster_name : ""
  worker_service_name      = "worker"
  db_engine                = local.s.db_engine
  db_identifier            = local.run_managed ? module.database[0].identifier : ""
  db_serverless            = local.s.db_engine == "aurora" && local.s.db_instance_class == "db.serverless"
  db_has_replicas          = local.s.db_engine == "aurora" ? local.s.db_instance_count > 1 : local.s.db_multi_az
  db_connections_threshold = local.preset.db_connections_warn
  external_check_fqdn      = local.run_managed ? local.external_fqdn : null
}

# ── Demo tier: single host ───────────────────────────────────────────────────────────────────────────────────
module "single_host" {
  source            = "../single-host"
  count             = local.run_host ? 1 : 0
  name_prefix       = local.name_prefix
  instance_type     = local.s.host_instance_type
  cpu_architecture  = var.cpu_architecture
  subnet_id         = module.network.public_subnet_ids[0]
  security_group_id = module.network.security_group_ids["host"]
  repository_urls   = module.registry.repository_urls
  repository_arns   = module.registry.repository_arns
  image_tag         = var.image_tag
  cors_origins      = local.cors_origins
  app_base_url      = local.app_base_url
  trusted_proxies   = local.trusted_proxy_cidrs
  log_group_name    = module.observability[0].log_group_names["host"]
  log_group_arn     = module.observability[0].log_group_arns["host"]
  schedule          = local.schedule
  smoke_base_url    = module.edge[0].public_base_url
  web               = { bucket = module.edge[0].web_bucket_name, distribution_id = module.edge[0].distribution_id }
}

# ── Managed tiers: data ──────────────────────────────────────────────────────────────────────────────────────
module "secrets" {
  source               = "../secrets"
  count                = local.run_managed ? 1 : 0
  name_prefix          = local.name_prefix
  secret_path          = local.secret_path
  db_host              = module.database[0].writer_endpoint
  recovery_window_days = local.ephemeral ? 0 : 30
  integration_secrets  = local.integration_secrets
  # Keys travel with the cross-region backup copies: a restored database is useless without them.
  replica_region = local.s.aws_backup ? var.dr_region : null
}

module "database" {
  source                       = "../database"
  count                        = local.run_managed ? 1 : 0
  name_prefix                  = local.name_prefix
  engine                       = local.s.db_engine
  engine_version               = var.engine_version
  instance_class               = local.s.db_instance_class
  instance_count               = local.s.db_instance_count
  multi_az                     = local.s.db_multi_az
  availability_zones           = module.network.availability_zones
  serverless_min_acu           = 0.5
  serverless_max_acu           = 8
  subnet_ids                   = module.network.data_subnet_ids
  security_group_id            = module.network.security_group_ids["database"]
  secrets_kms_key_arn          = module.secrets[0].secrets_kms_key_arn
  logs_kms_key_arn             = module.observability[0].logs_kms_key_arn
  log_retention_days           = local.s.log_retention_days
  backup_retention_days        = local.s.db_backup_days
  deletion_protection          = local.production
  final_snapshot               = local.production
  iam_auth_enabled             = local.t == "resilient"
  performance_insights_enabled = local.preset.db_perf_insights
  enhanced_monitoring_interval = local.preset.db_monitoring
  apply_immediately            = local.ephemeral
}

module "storage" {
  source                   = "../storage"
  count                    = local.run_managed ? 1 : 0
  name_prefix              = local.name_prefix
  bucket_prefix            = local.bucket_prefix
  force_destroy            = local.ephemeral
  cors_allowed_origins     = local.cors_origins
  backups_object_lock_days = local.production ? 30 : 0
}

module "email" {
  source           = "../email"
  count            = local.run_managed && var.email_domain != null ? 1 : 0
  name_prefix      = local.name_prefix
  domain           = coalesce(var.email_domain, "unset.invalid")
  route53_zone_id  = var.route53_zone_id
  sending_enabled  = var.email_sending_enabled
  events_topic_arn = module.observability[0].oncall_topic_arn
}

# ── Managed tiers: compute ───────────────────────────────────────────────────────────────────────────────────
module "compute" {
  source                       = "../compute"
  count                        = local.run_managed ? 1 : 0
  name_prefix                  = local.name_prefix
  deployment_name              = var.deployment
  vpc_id                       = module.network.vpc_id
  public_subnet_ids            = module.network.public_subnet_ids
  task_subnet_ids              = local.private_tasks ? module.network.app_subnet_ids : module.network.public_subnet_ids
  assign_public_ip             = !local.private_tasks
  security_group_ids           = module.network.security_group_ids
  cpu_architecture             = var.cpu_architecture
  repository_urls              = module.registry.repository_urls
  repository_arns              = module.registry.repository_arns
  image_tag                    = var.image_tag
  api                          = local.s.api
  worker                       = local.s.worker
  schedule                     = local.schedule
  log_group_names              = module.observability[0].log_group_names
  log_group_arns               = module.observability[0].log_group_arns
  container_insights           = local.preset.container_insights
  deletion_protection          = local.production
  origin_fqdn                  = local.origin_fqdn
  route53_zone_id              = var.route53_zone_id
  origin_verify_secret         = random_password.origin_verify.result
  alb_access_logs_bucket       = local.production ? module.storage[0].logs_bucket_name : null
  deployment_alarm_names       = ["${local.name_prefix}-api-5xx-rate", "${local.name_prefix}-api-no-healthy-targets"]
  cors_origins                 = local.cors_origins
  trusted_proxy_cidrs          = local.trusted_proxy_cidrs
  app_base_url                 = local.app_base_url
  db_writer_endpoint           = module.database[0].writer_endpoint
  db_master_secret_arn         = module.database[0].master_user_secret_arn
  db_owner_secret_arn          = module.secrets[0].db_owner_secret_arn
  db_app_secret_arn            = module.secrets[0].db_app_secret_arn
  db_worker_secret_arn         = module.secrets[0].db_worker_secret_arn
  api_holds_worker_credentials = var.api_holds_worker_credentials
  app_key_secret_arns          = module.secrets[0].app_key_secret_arns
  db_iam_readonly_role         = local.t == "resilient"
  secrets_kms_key_arn          = module.secrets[0].secrets_kms_key_arn
  integration_secret_arns      = module.secrets[0].integration_secret_arns
  injected_integration_secrets = var.injected_integration_secrets
  field_encryption_key_arn     = module.secrets[0].field_encryption_key_arn
  storage_kms_key_arn          = module.storage[0].kms_key_arn
  bucket_names                 = module.storage[0].bucket_names
  bucket_arns                  = module.storage[0].bucket_arns
  metric_namespace             = module.observability[0].metric_namespace
  ses_enabled                  = var.email_domain != null
  ses_domain                   = var.email_domain
  ses_configuration_set_name   = one(module.email[*].configuration_set_name)
  ses_identity_arn             = one(module.email[*].identity_arn)
  ses_configuration_set_arn    = one(module.email[*].configuration_set_arn)
  smoke_base_url               = module.edge[0].public_base_url
  web                          = { bucket = module.edge[0].web_bucket_name, distribution_id = module.edge[0].distribution_id }
}

module "backup" {
  source                 = "../backup"
  count                  = local.run_managed && local.s.aws_backup ? 1 : 0
  name_prefix            = local.name_prefix
  resource_arns          = [module.database[0].arn, module.storage[0].bucket_arns["documents"]]
  dr_region              = var.dr_region
  vault_lock             = local.production
  notification_topic_arn = module.observability[0].oncall_topic_arn
}

module "restore_drill" {
  source                  = "../restore-drill"
  count                   = local.run_managed && var.restore_drill_enabled ? 1 : 0
  name_prefix             = local.name_prefix
  engine                  = local.s.db_engine
  source_identifier       = module.database[0].identifier
  source_arn              = module.database[0].arn
  db_subnet_group_name    = module.database[0].subnet_group_name
  drill_security_group_id = module.network.security_group_ids["drill_database"]
  ops_security_group_id   = module.network.security_group_ids["ops"]
  subnet_ids              = module.network.public_subnet_ids
  db_kms_key_arn          = module.database[0].kms_key_arn
  drill_instance_class    = local.s.db_engine == "aurora" ? "db.t4g.medium" : local.s.db_instance_class
  evidence_bucket         = module.storage[0].bucket_names["backups"]
  evidence_kms_key_arn    = module.storage[0].kms_key_arn
  metric_namespace        = module.observability[0].metric_namespace
  ecs_cluster_arn         = module.compute[0].cluster_arn
  repository_url          = module.registry.repository_urls["restore-drill"]
  repository_arn          = module.registry.repository_arns["restore-drill"]
  cpu_architecture        = var.cpu_architecture
  log_group_name          = module.observability[0].log_group_names["restore-drill"]
  log_group_arn           = module.observability[0].log_group_arns["restore-drill"]
  alarm_topic_arn         = module.observability[0].oncall_topic_arn
}

# ── Edge (both runtimes) ─────────────────────────────────────────────────────────────────────────────────────
module "edge" {
  source               = "../edge"
  count                = local.run_any ? 1 : 0
  name_prefix          = local.name_prefix
  bucket_prefix        = local.bucket_prefix
  aliases              = local.aliases
  route53_zone_id      = var.route53_zone_id
  origin_domain_name   = local.run_host ? module.single_host[0].public_dns : local.origin_fqdn
  origin_protocol      = local.run_host ? "http-only" : "https-only"
  origin_http_port     = local.run_host ? 4000 : 80
  origin_verify_secret = random_password.origin_verify.result
  waf_level            = local.s.waf_level
}

# ── CI deploy role ───────────────────────────────────────────────────────────────────────────────────────────
module "ci_deploy_role" {
  source                  = "../ci-deploy-role"
  count                   = local.run_any && var.github_repository != null ? 1 : 0
  name_prefix             = local.name_prefix
  github_repository       = coalesce(var.github_repository, "unset/unset")
  github_environments     = var.github_environments
  runtime                 = local.is_demo ? "single_host" : "fargate"
  repository_arns         = values(module.registry.repository_arns)
  deploy_config_parameter = "/portico/${local.name_prefix}/deploy-config"
  web_bucket_arn          = "arn:aws:s3:::${module.edge[0].web_bucket_name}"
  distribution_arn        = module.edge[0].distribution_arn
  ecs_cluster_name        = local.name_prefix
  pass_role_arns          = local.run_managed ? concat(values(module.compute[0].task_role_arns), values(module.compute[0].execution_role_arns)) : []
  host_instance_arn       = local.run_host ? module.single_host[0].instance_arn : ""
}
