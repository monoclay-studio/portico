# ECS Fargate compute for the lean and resilient tiers:
#
#   api       Fastify API behind an ALB. The ALB only answers requests carrying the secret X-Origin-Verify header
#             that CloudFront adds, and its security group only admits CloudFront's origin-facing ranges, so the
#             WAF in front of CloudFront cannot be bypassed. Target health = /health/ready (DB ping).
#   worker    outbox dispatcher; no inbound traffic.
#   migrate   one-off task definition run by the deploy pipeline BEFORE new api/worker revisions roll out.
#   db-bootstrap  one-off task (master credentials) that makes DB roles match Secrets Manager.
#
# Terraform owns the task definitions' shape (roles, secrets, env, sizes); the deploy pipeline owns the IMAGE.
# The pipeline renders a new revision from the latest one with a new image tag and updates the service, so
# services ignore task_definition/desired_count drift here (docs/runbooks/deploy.md).
#
# Deployment safety: rolling deploys keep 100% healthy capacity; the ECS deployment circuit breaker and the
# 5xx-rate / no-healthy-target CloudWatch alarms roll a bad revision back automatically.

locals {
  images = {
    api    = "${var.repository_urls["api"]}:${var.image_tag}"
    worker = "${var.repository_urls["worker"]}:${var.image_tag}"
  }

  # Non-secret configuration shared by api and worker (both run the full composition root, so both need the same
  # keys and settings; apps/api/src/config.ts and the module READMEs list them).
  base_environment = concat([
    { name = "NODE_ENV", value = "production" },
    { name = "LOG_LEVEL", value = var.log_level },
    { name = "PORTICO_CELL", value = var.name_prefix },
    { name = "PORTICO_DEPLOYMENT", value = var.deployment_name },
    # Key id recorded with every field ciphertext (kernel localFieldCipher). Stable for the life of the key.
    { name = "PORTICO_FIELD_KEY_ID", value = "${var.name_prefix}-field-v1" },
    { name = "PORTICO_FIELD_KMS_KEY_ID", value = var.field_encryption_key_arn },
    { name = "PORTICO_DOCUMENTS_BUCKET", value = var.bucket_names["documents"] },
    { name = "PORTICO_EXPORTS_BUCKET", value = var.bucket_names["exports"] },
    { name = "AWS_REGION", value = local.region },
    ],
    var.app_base_url == null ? [] : [{ name = "PORTICO_APP_BASE_URL", value = var.app_base_url }],
    var.ses_enabled ? [
      { name = "PORTICO_EMAIL_DOMAIN", value = coalesce(var.ses_domain, "unset.invalid") },
      { name = "PORTICO_SES_CONFIGURATION_SET", value = coalesce(var.ses_configuration_set_name, "unset") },
    ] : [],
    [for k, v in var.extra_environment : { name = k, value = v }]
  )

  app_key_secrets     = [for env_name in sort(keys(var.app_key_secret_arns)) : { name = env_name, valueFrom = var.app_key_secret_arns[env_name] }]
  integration_secrets = [for env_name, key in var.injected_integration_secrets : { name = env_name, valueFrom = var.integration_secret_arns[key] }]

  api_secrets = concat(
    [{ name = "APP_DATABASE_URL", valueFrom = "${var.db_app_secret_arn}:url::" }],
    var.api_holds_worker_credentials ? [{ name = "WORKER_DATABASE_URL", valueFrom = "${var.db_worker_secret_arn}:url::" }] : [],
    local.app_key_secrets,
    local.integration_secrets,
  )
  # The worker connects as portico_worker (app privileges + the job-routing functions, infra/db/bootstrap-roles.mjs).
  worker_secrets = concat(
    [{ name = "APP_DATABASE_URL", valueFrom = "${var.db_worker_secret_arn}:url::" }],
    local.app_key_secrets,
    local.integration_secrets,
  )

  hardening = {
    readonlyRootFilesystem = true
    user                   = "1000:1000"
    linuxParameters        = { initProcessEnabled = true, capabilities = { drop = ["ALL"] } }
    stopTimeout            = 30
  }

  log_options = {
    for k in ["api", "worker", "migrate", "db-bootstrap"] : k => {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.log_group_names[k]
        "awslogs-region"        = local.region
        "awslogs-stream-prefix" = k
        "mode"                  = "non-blocking"
        "max-buffer-size"       = "25m"
      }
    }
  }
}

# ── Cluster ───────────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_ecs_cluster" "this" {
  name = var.name_prefix
  setting {
    name  = "containerInsights"
    value = var.container_insights ? "enabled" : "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE"]
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ── Origin certificate and DNS ────────────────────────────────────────────────────────────────────────────────
resource "aws_acm_certificate" "origin" {
  domain_name       = var.origin_fqdn
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

# Keyed by the configured hostname (known at plan time); record details come from the certificate at apply time.
locals {
  origin_dvo = { for o in aws_acm_certificate.origin.domain_validation_options : o.domain_name => o }
}

resource "aws_route53_record" "origin_validation" {
  for_each        = toset([var.origin_fqdn])
  zone_id         = var.route53_zone_id
  name            = local.origin_dvo[each.key].resource_record_name
  type            = local.origin_dvo[each.key].resource_record_type
  records         = [local.origin_dvo[each.key].resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "origin" {
  certificate_arn         = aws_acm_certificate.origin.arn
  validation_record_fqdns = [for r in aws_route53_record.origin_validation : r.fqdn]
}

resource "aws_route53_record" "origin" {
  zone_id = var.route53_zone_id
  name    = var.origin_fqdn
  type    = "A"
  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = true
  }
}

# ── Load balancer ─────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_lb" "api" {
  name                       = substr("${var.name_prefix}-api", 0, 32)
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [var.security_group_ids["alb"]]
  subnets                    = var.public_subnet_ids
  drop_invalid_header_fields = true
  enable_deletion_protection = var.deletion_protection
  idle_timeout               = 60

  dynamic "access_logs" {
    for_each = var.alb_access_logs_bucket == null ? [] : [1]
    content {
      bucket  = var.alb_access_logs_bucket
      prefix  = "alb"
      enabled = true
    }
  }
}

resource "aws_lb_target_group" "api" {
  name                 = substr("${var.name_prefix}-api", 0, 32)
  port                 = var.app_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    path                = var.health_check_path
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.origin.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Direct origin access is not allowed."
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [var.origin_verify_secret]
    }
  }
}

# ── Task definitions ──────────────────────────────────────────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api.cpu
  memory                   = var.api.memory
  execution_role_arn       = aws_iam_role.execution["api"].arn
  task_role_arn            = aws_iam_role.task["api"].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  container_definitions = jsonencode([merge(local.hardening, {
    name         = "api"
    image        = local.images.api
    essential    = true
    portMappings = [{ containerPort = var.app_port, protocol = "tcp", name = "http", appProtocol = "http" }]
    environment = concat(local.base_environment, [
      { name = "PORT", value = tostring(var.app_port) },
      { name = "DB_POOL_MAX", value = tostring(var.api.db_pool_max) },
      { name = "CORS_ORIGINS", value = join(",", var.cors_origins) },
      { name = "TRUSTED_PROXY_CIDRS", value = join(",", var.trusted_proxy_cidrs) },
    ])
    secrets          = local.api_secrets
    logConfiguration = local.log_options["api"]
  })])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name_prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker.cpu
  memory                   = var.worker.memory
  execution_role_arn       = aws_iam_role.execution["worker"].arn
  task_role_arn            = aws_iam_role.task["worker"].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  container_definitions = jsonencode([merge(local.hardening, {
    name             = "worker"
    image            = local.images.worker
    essential        = true
    environment      = local.base_environment
    secrets          = local.worker_secrets
    logConfiguration = local.log_options["worker"]
  })])
}

# Migrations run as portico_owner. No task role: the migration needs no AWS API access. The pipeline runs this task
# twice per deploy: the migrations (default command), then the routing grants with a command override
#   ["node", "/app/ops/bootstrap-roles.mjs", "grants"]
# which, as the owner of the functions, grants the job-routing functions to portico_worker only (database-roles.md).
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name_prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution["migrate"].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  container_definitions = jsonencode([merge(local.hardening, {
    name             = "migrate"
    image            = local.images.api
    essential        = true
    command          = ["node", "--import", "/opt/tsx/register.mjs", "src/migrate-cli.ts"]
    environment      = [{ name = "NODE_ENV", value = "production" }]
    secrets          = [{ name = "DATABASE_URL", valueFrom = "${var.db_owner_secret_arn}:url::" }]
    logConfiguration = local.log_options["migrate"]
  })])
}

# Role bootstrap/rotation as the RDS-managed master user. Run once before the first migration and after every
# credential rotation (docs/runbooks/database-roles.md).
resource "aws_ecs_task_definition" "db_bootstrap" {
  family                   = "${var.name_prefix}-db-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution["db-bootstrap"].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  container_definitions = jsonencode([merge(local.hardening, {
    name      = "db-bootstrap"
    image     = local.images.api
    essential = true
    command   = ["node", "/app/ops/bootstrap-roles.mjs"]
    environment = [
      { name = "PGHOST", value = var.db_writer_endpoint },
      { name = "PGPORT", value = "5432" },
      { name = "PGDATABASE", value = var.db_name },
      { name = "PGSSLMODE", value = "verify-full" },
      { name = "ENABLE_IAM_READONLY_ROLE", value = tostring(var.db_iam_readonly_role) },
      { name = "APP_CONNECTION_LIMIT", value = tostring(var.db_app_connection_limit) },
    ]
    secrets = [
      { name = "MASTER_USERNAME", valueFrom = "${var.db_master_secret_arn}:username::" },
      { name = "MASTER_PASSWORD", valueFrom = "${var.db_master_secret_arn}:password::" },
      { name = "OWNER_SECRET_JSON", valueFrom = var.db_owner_secret_arn },
      { name = "APP_SECRET_JSON", valueFrom = var.db_app_secret_arn },
      { name = "WORKER_SECRET_JSON", valueFrom = var.db_worker_secret_arn },
    ]
    logConfiguration = local.log_options["db-bootstrap"]
  })])
}

# ── Services ──────────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_ecs_service" "api" {
  name                               = "api"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.api.arn
  desired_count                      = var.api.desired
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  enable_execute_command             = var.enable_execute_command
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"
  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  dynamic "alarms" {
    for_each = length(var.deployment_alarm_names) > 0 ? [1] : []
    content {
      alarm_names = var.deployment_alarm_names
      enable      = true
      rollback    = true
    }
  }

  network_configuration {
    subnets          = var.task_subnet_ids
    security_groups  = [var.security_group_ids["api"]]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.app_port
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener_rule.from_cloudfront]
}

resource "aws_ecs_service" "worker" {
  name                               = "worker"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.worker.arn
  desired_count                      = var.worker.desired
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  enable_execute_command             = var.enable_execute_command
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.task_subnet_ids
    security_groups  = [var.security_group_ids["worker"]]
    assign_public_ip = var.assign_public_ip
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# ── Autoscaling ───────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_appautoscaling_target" "this" {
  for_each           = { api = var.api, worker = var.worker }
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${each.key}"
  min_capacity       = each.value.min
  max_capacity       = each.value.max
  depends_on         = [aws_ecs_service.api, aws_ecs_service.worker]
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = aws_appautoscaling_target.this
  name               = "${var.name_prefix}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = each.value.service_namespace
  scalable_dimension = each.value.scalable_dimension
  resource_id        = each.value.resource_id
  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "api_requests" {
  name               = "${var.name_prefix}-api-requests"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this["api"].service_namespace
  scalable_dimension = aws_appautoscaling_target.this["api"].scalable_dimension
  resource_id        = aws_appautoscaling_target.this["api"].resource_id
  target_tracking_scaling_policy_configuration {
    target_value       = var.api.requests_per_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.api.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
  }
}

# Off-hours scale-to-zero (non-production cells only). Times are in var.schedule.timezone.
resource "aws_appautoscaling_scheduled_action" "stop" {
  for_each           = var.schedule == null ? {} : aws_appautoscaling_target.this
  name               = "${var.name_prefix}-${each.key}-stop"
  service_namespace  = each.value.service_namespace
  scalable_dimension = each.value.scalable_dimension
  resource_id        = each.value.resource_id
  schedule           = var.schedule.stop_cron
  timezone           = var.schedule.timezone
  scalable_target_action {
    min_capacity = 0
    max_capacity = 0
  }
}

resource "aws_appautoscaling_scheduled_action" "start" {
  for_each           = var.schedule == null ? {} : aws_appautoscaling_target.this
  name               = "${var.name_prefix}-${each.key}-start"
  service_namespace  = each.value.service_namespace
  scalable_dimension = each.value.scalable_dimension
  resource_id        = each.value.resource_id
  schedule           = var.schedule.start_cron
  timezone           = var.schedule.timezone
  scalable_target_action {
    min_capacity = each.key == "api" ? var.api.min : var.worker.min
    max_capacity = each.key == "api" ? var.api.max : var.worker.max
  }
}

# ── Deploy metadata for the pipeline (no secrets) ─────────────────────────────────────────────────────────────
resource "aws_ssm_parameter" "deploy_config" {
  name        = "/portico/${var.name_prefix}/deploy-config"
  description = "Read by the deploy pipeline (infra/ci/deploy.yml.example). Contains no secrets."
  type        = "String"
  value = jsonencode({
    runtime          = "fargate"
    region           = local.region
    cluster          = aws_ecs_cluster.this.name
    services         = { api = aws_ecs_service.api.name, worker = aws_ecs_service.worker.name }
    task_families    = { api = aws_ecs_task_definition.api.family, worker = aws_ecs_task_definition.worker.family, migrate = aws_ecs_task_definition.migrate.family, db_bootstrap = aws_ecs_task_definition.db_bootstrap.family }
    repositories     = var.repository_urls
    ops_subnets      = var.task_subnet_ids
    ops_security     = var.security_group_ids["ops"]
    assign_public_ip = var.assign_public_ip
    log_groups       = var.log_group_names
    smoke_base_url   = var.smoke_base_url
    web              = var.web
    # Routing grants run with the migrate task definition and this command (infra/db/bootstrap-roles.mjs).
    grants_command = ["node", "/app/ops/bootstrap-roles.mjs", "grants"]
  })
}
