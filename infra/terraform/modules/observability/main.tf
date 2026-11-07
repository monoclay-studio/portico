# Logs, alarms and paging for one cell.
#
# Every alarm notifies the on-call SNS topic (email subscriptions until a paging tool is chosen — README owner
# decisions). Alarm thresholds mirror the TARGETS in docs/readiness/support-recovery-plan.md §1; they are targets,
# not commitments.
#
# Outbox alarms read metrics derived from worker log lines (metric filters). Two log lines exist today:
#   {"level":"error","msg":"event delivery failed",…}  and  {"level":"error","msg":"worker loop error",…}
# Two more are a CONTRACT the worker does not emit yet (infra/README.md, Findings):
#   {"level":"error","msg":"event delivery dead","eventId":…,"consumer":…}            when a delivery goes dead
#   {"level":"info","msg":"outbox stats","pending":N,"oldestPendingAgeSeconds":N,"dead":N}   every 60 s
# Until the worker emits them, the backlog/dead alarms stay in INSUFFICIENT_DATA; `outbox_stats_contract_live`
# turns on the "stats missing" alarm once it does, so a silent or dead worker pages someone.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  account   = data.aws_caller_identity.current.account_id
  region    = data.aws_region.current.region
  namespace = "Portico/${var.name_prefix}"
  actions   = [aws_sns_topic.oncall.arn]
}

# ── KMS key for logs and the on-call topic ────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "logs_key" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${local.account}:root"]
    }
  }
  statement {
    sid       = "CloudWatchLogs"
    actions   = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${local.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:${data.aws_partition.current.partition}:logs:${local.region}:${local.account}:log-group:*"]
    }
  }
  statement {
    sid       = "AlarmAndBudgetPublishers"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "budgets.amazonaws.com", "events.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "logs" {
  description             = "${var.name_prefix} CloudWatch Logs and on-call SNS topic"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.logs_key.json
}

resource "aws_kms_alias" "logs" {
  name          = "alias/${var.name_prefix}-logs"
  target_key_id = aws_kms_key.logs.key_id
}

# ── Log groups ────────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "this" {
  for_each          = toset(var.log_groups)
  name              = "/portico/${var.name_prefix}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn
}

# ── On-call topic ─────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_sns_topic" "oncall" {
  name              = "${var.name_prefix}-oncall"
  kms_master_key_id = aws_kms_key.logs.arn
}

data "aws_iam_policy_document" "oncall" {
  statement {
    sid       = "AccountServicesPublish"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.oncall.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "budgets.amazonaws.com", "events.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }
}

resource "aws_sns_topic_policy" "oncall" {
  arn    = aws_sns_topic.oncall.arn
  policy = data.aws_iam_policy_document.oncall.json
}

resource "aws_sns_topic_subscription" "oncall_email" {
  for_each  = toset(var.oncall_emails)
  topic_arn = aws_sns_topic.oncall.arn
  protocol  = "email"
  endpoint  = each.key
}

# ── Metric filters (log-derived metrics) ──────────────────────────────────────────────────────────────────────
locals {
  metric_filters = var.enable_outbox_alarms ? {
    DeliveryFailures = { group = var.worker_log_group, pattern = "{ $.msg = \"event delivery failed\" }", value = "1" }
    WorkerLoopErrors = { group = var.worker_log_group, pattern = "{ $.msg = \"worker loop error\" }", value = "1" }
    DeadDeliveries   = { group = var.worker_log_group, pattern = "{ $.msg = \"event delivery dead\" }", value = "1" }
    OutboxPending    = { group = var.worker_log_group, pattern = "{ $.msg = \"outbox stats\" }", value = "$.pending" }
    OutboxOldestAge  = { group = var.worker_log_group, pattern = "{ $.msg = \"outbox stats\" }", value = "$.oldestPendingAgeSeconds" }
    OutboxDeadTotal  = { group = var.worker_log_group, pattern = "{ $.msg = \"outbox stats\" }", value = "$.dead" }
    ApiErrorLogs     = { group = var.api_log_group, pattern = "{ $.level >= 50 }", value = "1" }
  } : {}
}

resource "aws_cloudwatch_log_metric_filter" "this" {
  for_each       = local.metric_filters
  name           = "${var.name_prefix}-${each.key}"
  log_group_name = each.value.group
  pattern        = each.value.pattern
  metric_transformation {
    name      = each.key
    namespace = local.namespace
    value     = each.value.value
    unit      = "None"
  }
  depends_on = [aws_cloudwatch_log_group.this]
}

# ── Single-metric alarms ──────────────────────────────────────────────────────────────────────────────────────
locals {
  db_dims  = var.db_engine == "aurora" ? { DBClusterIdentifier = var.db_identifier, Role = "WRITER" } : { DBInstanceIdentifier = var.db_identifier }
  alb_dims = { LoadBalancer = var.alb_arn_suffix }
  tg_dims  = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.target_group_arn_suffix }

  # Every entry has the same keys so the map has one object type.
  alarm_defs = merge(
    var.enable_alb_alarms ? {
      "api-elb-5xx" = {
        ns     = "AWS/ApplicationELB", metric = "HTTPCode_ELB_5XX_Count", dims = local.alb_dims, stat = "Sum", ext = null
        period = 60, evals = 5, dta = 3, op = "GreaterThanThreshold", threshold = 10, missing = "notBreaching"
        desc   = "Load balancer generated 5xx (no healthy target, timeouts). Runbook: docs/runbooks/incident-response.md"
      }
      "api-latency-p95" = {
        ns     = "AWS/ApplicationELB", metric = "TargetResponseTime", dims = local.tg_dims, stat = null, ext = "p95"
        period = 60, evals = 10, dta = 8, op = "GreaterThanThreshold", threshold = var.latency_p95_seconds, missing = "notBreaching"
        desc   = "API p95 latency above the TARGET (support-recovery-plan §1)."
      }
      "api-latency-p99" = {
        ns     = "AWS/ApplicationELB", metric = "TargetResponseTime", dims = local.tg_dims, stat = null, ext = "p99"
        period = 60, evals = 10, dta = 8, op = "GreaterThanThreshold", threshold = var.latency_p99_seconds, missing = "notBreaching"
        desc   = "API p99 latency high."
      }
      "api-unhealthy-targets" = {
        ns     = "AWS/ApplicationELB", metric = "UnHealthyHostCount", dims = local.tg_dims, stat = "Maximum", ext = null
        period = 60, evals = 3, dta = 3, op = "GreaterThanThreshold", threshold = 0, missing = "notBreaching"
        desc   = "At least one API task fails /health/ready (database unreachable or app not ready)."
      }
      "api-no-healthy-targets" = {
        ns     = "AWS/ApplicationELB", metric = "HealthyHostCount", dims = local.tg_dims, stat = "Minimum", ext = null
        period = 60, evals = 2, dta = 2, op = "LessThanThreshold", threshold = 1, missing = "breaching"
        desc   = "SEV1 candidate: no healthy API task. Hotels cannot work."
      }
    } : {},
    var.enable_db_alarms ? {
      "db-cpu" = {
        ns     = "AWS/RDS", metric = "CPUUtilization", dims = local.db_dims, stat = "Average", ext = null
        period = 300, evals = 3, dta = 3, op = "GreaterThanThreshold", threshold = var.db_cpu_percent, missing = "missing"
        desc   = "Database CPU high for 15 minutes."
      }
      "db-connections" = {
        ns     = "AWS/RDS", metric = "DatabaseConnections", dims = local.db_dims, stat = "Maximum", ext = null
        period = 300, evals = 2, dta = 2, op = "GreaterThanThreshold", threshold = var.db_connections_threshold, missing = "missing"
        desc   = "Database connections near the limit (pool leak or too many tasks x DB_POOL_MAX)."
      }
      "db-freeable-memory" = {
        ns     = "AWS/RDS", metric = "FreeableMemory", dims = local.db_dims, stat = "Minimum", ext = null
        period = 300, evals = 3, dta = 3, op = "LessThanThreshold", threshold = 134217728, missing = "missing"
        desc   = "Database free memory below 128 MiB."
      }
    } : {},
    var.enable_db_alarms && var.db_engine == "rds" ? {
      "db-free-storage" = {
        ns     = "AWS/RDS", metric = "FreeStorageSpace", dims = local.db_dims, stat = "Minimum", ext = null
        period = 300, evals = 1, dta = 1, op = "LessThanThreshold", threshold = 2147483648, missing = "missing"
        desc   = "Less than 2 GiB free storage (storage autoscaling should act first)."
      }
    } : {},
    var.enable_db_alarms && var.db_engine == "aurora" && var.db_has_replicas ? {
      "db-replica-lag" = {
        ns     = "AWS/RDS", metric = "AuroraReplicaLagMaximum", dims = { DBClusterIdentifier = var.db_identifier }, stat = "Maximum", ext = null
        period = 60, evals = 5, dta = 5, op = "GreaterThanThreshold", threshold = 1000, missing = "missing"
        desc   = "Aurora replica lag above 1 s for 5 minutes: failover would lose recent writes' visibility."
      }
    } : {},
    var.enable_db_alarms && var.db_serverless ? {
      "db-acu-saturation" = {
        ns     = "AWS/RDS", metric = "ACUUtilization", dims = { DBClusterIdentifier = var.db_identifier }, stat = "Average", ext = null
        period = 300, evals = 3, dta = 3, op = "GreaterThanThreshold", threshold = 90, missing = "missing"
        desc   = "Serverless capacity near its maximum ACU."
      }
    } : {},
    var.enable_outbox_alarms ? {
      "outbox-delivery-failures" = {
        ns     = local.namespace, metric = "DeliveryFailures", dims = {}, stat = "Sum", ext = null
        period = 300, evals = 1, dta = 1, op = "GreaterThanThreshold", threshold = 10, missing = "notBreaching"
        desc   = "Event deliveries failing (retrying with backoff). Check consumer errors in the worker log."
      }
      "outbox-dead-deliveries" = {
        ns     = local.namespace, metric = "DeadDeliveries", dims = {}, stat = "Sum", ext = null
        period = 300, evals = 1, dta = 1, op = "GreaterThanThreshold", threshold = 0, missing = "notBreaching"
        desc   = "A delivery exhausted its retries and is dead: a reaction (e.g. dirty room after checkout) did NOT happen."
      }
      "outbox-backlog-age" = {
        ns     = local.namespace, metric = "OutboxOldestAge", dims = {}, stat = "Maximum", ext = null
        period = 60, evals = 5, dta = 5, op = "GreaterThanThreshold", threshold = var.outbox_oldest_age_seconds, missing = "missing"
        desc   = "Oldest pending event older than the TARGET: background work is delayed."
      }
      "worker-loop-errors" = {
        ns     = local.namespace, metric = "WorkerLoopErrors", dims = {}, stat = "Sum", ext = null
        period = 300, evals = 1, dta = 1, op = "GreaterThanThreshold", threshold = 3, missing = "notBreaching"
        desc   = "Worker main loop failing (database unreachable?)."
      }
      "api-error-logs" = {
        ns     = local.namespace, metric = "ApiErrorLogs", dims = {}, stat = "Sum", ext = null
        period = 300, evals = 1, dta = 1, op = "GreaterThanThreshold", threshold = 20, missing = "notBreaching"
        desc   = "API logged more than 20 error/fatal lines in 5 minutes."
      }
    } : {},
    var.enable_outbox_alarms && var.outbox_stats_contract_live ? {
      "outbox-stats-missing" = {
        ns     = local.namespace, metric = "OutboxPending", dims = {}, stat = "SampleCount", ext = null
        period = 300, evals = 2, dta = 2, op = "LessThanThreshold", threshold = 1, missing = "breaching"
        desc   = "No 'outbox stats' line for 10 minutes: the worker is down or stuck."
      }
    } : {},
    var.enable_worker_task_alarm ? {
      "worker-not-running" = {
        ns     = "ECS/ContainerInsights", metric = "RunningTaskCount", dims = { ClusterName = var.ecs_cluster_name, ServiceName = var.worker_service_name }, stat = "Minimum", ext = null
        period = 60, evals = 3, dta = 3, op = "LessThanThreshold", threshold = 1, missing = "breaching"
        desc   = "No worker task running: outbox, schedules and integrations are stopped."
      }
    } : {},
  )
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarm_defs
  alarm_name          = "${var.name_prefix}-${each.key}"
  alarm_description   = each.value.desc
  namespace           = each.value.ns
  metric_name         = each.value.metric
  dimensions          = each.value.dims
  statistic           = each.value.stat
  extended_statistic  = each.value.ext
  period              = each.value.period
  evaluation_periods  = each.value.evals
  datapoints_to_alarm = each.value.dta
  comparison_operator = each.value.op
  threshold           = each.value.threshold
  treat_missing_data  = each.value.missing
  alarm_actions       = local.actions
  ok_actions          = local.actions
  depends_on          = [aws_cloudwatch_log_metric_filter.this]
}

# 5xx error RATE (not count), so a quiet night and a busy morning are judged the same way.
resource "aws_cloudwatch_metric_alarm" "api_5xx_rate" {
  count               = var.enable_alb_alarms ? 1 : 0
  alarm_name          = "${var.name_prefix}-api-5xx-rate"
  alarm_description   = "More than ${var.error_rate_percent}% of API responses are 5xx (min 20 requests/minute)."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = var.error_rate_percent
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions

  metric_query {
    id          = "rate"
    expression  = "IF(FILL(requests, 0) > 20, 100 * FILL(errors, 0) / requests, 0)"
    label       = "Target 5xx %"
    return_data = true
  }
  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = local.tg_dims
      period      = 60
      stat        = "Sum"
    }
  }
  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = local.tg_dims
      period      = 60
      stat        = "Sum"
    }
  }
}

# ── Demo host: automatic recovery ─────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "host_system_check" {
  count               = var.enable_host_alarms ? 1 : 0
  alarm_name          = "${var.name_prefix}-host-system-check"
  alarm_description   = "Underlying hardware failed: EC2 recovers the instance onto new hardware (same IP and volume)."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = var.host_instance_id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "missing"
  alarm_actions       = concat(local.actions, ["arn:${data.aws_partition.current.partition}:automate:${local.region}:ec2:recover"])
}

resource "aws_cloudwatch_metric_alarm" "host_instance_check" {
  count               = var.enable_host_alarms ? 1 : 0
  alarm_name          = "${var.name_prefix}-host-instance-check"
  alarm_description   = "Guest OS unresponsive: reboot."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  dimensions          = { InstanceId = var.host_instance_id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "missing"
  alarm_actions       = concat(local.actions, ["arn:${data.aws_partition.current.partition}:automate:${local.region}:ec2:reboot"])
}

# ── External availability check (Route 53 health checkers in several regions) ────────────────────────────────
# Route 53 health-check metrics exist only in us-east-1, so the alarm and its topic live there. These checkers run
# inside AWS; an independent off-AWS uptime check is still recommended (support-recovery-plan §1).
resource "aws_route53_health_check" "api" {
  count             = var.external_check_fqdn == null ? 0 : 1
  fqdn              = var.external_check_fqdn
  port              = 443
  type              = "HTTPS"
  resource_path     = var.external_check_path
  request_interval  = 30
  failure_threshold = 3
  regions           = ["ap-southeast-1", "eu-west-1", "us-east-1"]
  tags              = { Name = "${var.name_prefix}-api" }
}

resource "aws_sns_topic" "oncall_us_east_1" {
  count  = var.external_check_fqdn == null ? 0 : 1
  region = "us-east-1"
  name   = "${var.name_prefix}-oncall-global"
}

resource "aws_sns_topic_subscription" "oncall_us_east_1" {
  for_each  = var.external_check_fqdn == null ? toset([]) : toset(var.oncall_emails)
  region    = "us-east-1"
  topic_arn = aws_sns_topic.oncall_us_east_1[0].arn
  protocol  = "email"
  endpoint  = each.key
}

resource "aws_cloudwatch_metric_alarm" "external_check" {
  count               = var.external_check_fqdn == null ? 0 : 1
  region              = "us-east-1"
  alarm_name          = "${var.name_prefix}-api-external-check"
  alarm_description   = "https://${coalesce(var.external_check_fqdn, "-")}${var.external_check_path} failing from multiple regions."
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.api[0].id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.oncall_us_east_1[0].arn]
  ok_actions          = [aws_sns_topic.oncall_us_east_1[0].arn]
}
