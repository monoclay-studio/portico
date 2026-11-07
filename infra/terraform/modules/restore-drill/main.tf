# Monthly automated restore drill (lean and resilient tiers). EventBridge Scheduler runs a Fargate task
# (infra/restore-drill) that restores the primary database to its latest restorable time into a throwaway copy,
# runs infra/restore-drill/verify.sql, writes evidence to the backups bucket and deletes the copy.
#
# Isolation: the restored copy uses the `drill_database` security group, which admits Postgres only from ops
# tasks; application tasks can never reach it, and it is never given application credentials. For a stronger
# boundary (a separate recovery AWS account) see docs/runbooks/backup-restore-verification.md — that variant needs
# snapshot sharing + KMS grants (database module `recovery_account_ids`) and is not automated here.
#
# Cost: one restore-sized instance for ~1 hour per month plus a few Fargate minutes — cents to ~$1/month.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  partition = data.aws_partition.current.partition
  region    = data.aws_region.current.region
  account   = data.aws_caller_identity.current.account_id
  family    = "${var.name_prefix}-restore-drill"
  target_arns = [
    "arn:${local.partition}:rds:${local.region}:${local.account}:cluster:${var.name_prefix}-drill-*",
    "arn:${local.partition}:rds:${local.region}:${local.account}:db:${var.name_prefix}-drill-*",
  ]
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ── Execution role (pull image, write logs) ──────────────────────────────────────────────────────────────────
resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-drill-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "execution" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [var.repository_arn]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${var.log_group_arn}:*"]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

# ── Task role (restore, verify, delete — only resources named <prefix>-drill-*) ───────────────────────────────
resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-drill-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "Describe"
    actions   = ["rds:DescribeDBClusters", "rds:DescribeDBInstances"]
    resources = ["*"]
  }
  statement {
    sid       = "RestoreFromSource"
    actions   = ["rds:RestoreDBClusterToPointInTime", "rds:RestoreDBInstanceToPointInTime"]
    resources = concat([var.source_arn], local.target_arns)
  }
  statement {
    sid = "ManageDrillCopiesOnly"
    actions = [
      "rds:RestoreDBClusterToPointInTime", "rds:RestoreDBInstanceToPointInTime", "rds:CreateDBInstance",
      "rds:ModifyDBCluster", "rds:ModifyDBInstance", "rds:DeleteDBCluster", "rds:DeleteDBInstance",
      "rds:AddTagsToResource",
    ]
    resources = local.target_arns
  }
  statement {
    sid     = "RestoreDependencies"
    actions = ["rds:RestoreDBClusterToPointInTime", "rds:RestoreDBInstanceToPointInTime", "rds:CreateDBInstance"]
    resources = [
      "arn:${local.partition}:rds:${local.region}:${local.account}:subgrp:${var.db_subnet_group_name}",
      "arn:${local.partition}:rds:${local.region}:${local.account}:pg:*",
      "arn:${local.partition}:rds:${local.region}:${local.account}:cluster-pg:*",
      "arn:${local.partition}:rds:${local.region}:${local.account}:og:*",
    ]
  }
  statement {
    sid       = "EncryptedRestore"
    actions   = ["kms:CreateGrant", "kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey*", "kms:ReEncrypt*"]
    resources = [var.db_kms_key_arn]
  }
  statement {
    sid       = "Evidence"
    actions   = ["s3:PutObject"]
    resources = ["arn:${local.partition}:s3:::${var.evidence_bucket}/restore-drills/*"]
  }
  statement {
    sid       = "EvidenceEncryption"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [var.evidence_kms_key_arn]
  }
  statement {
    sid       = "Metrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [var.metric_namespace]
    }
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "restore-drill"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ── Task definition ──────────────────────────────────────────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "drill" {
  family                   = local.family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
  container_definitions = jsonencode([{
    name      = "restore-drill"
    image     = "${var.repository_url}:${var.image_tag}"
    essential = true
    environment = [
      { name = "ENGINE", value = var.engine },
      { name = "SOURCE_ID", value = var.source_identifier },
      { name = "DRILL_PREFIX", value = var.name_prefix },
      { name = "DB_SUBNET_GROUP", value = var.db_subnet_group_name },
      { name = "DRILL_SECURITY_GROUP_ID", value = var.drill_security_group_id },
      { name = "KMS_KEY_ID", value = var.db_kms_key_arn },
      { name = "EVIDENCE_BUCKET", value = var.evidence_bucket },
      { name = "METRIC_NAMESPACE", value = var.metric_namespace },
      { name = "INSTANCE_CLASS", value = var.drill_instance_class },
      { name = "DB_NAME", value = "portico" },
      { name = "AWS_REGION", value = local.region },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = var.log_group_name
        "awslogs-region"        = local.region
        "awslogs-stream-prefix" = "restore-drill"
      }
    }
  }])
}

# ── Schedule ─────────────────────────────────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.name_prefix}-drill-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["ecs:RunTask"]
    resources = ["arn:${local.partition}:ecs:${local.region}:${local.account}:task-definition/${local.family}:*"]
  }
  statement {
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "run-drill"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule" "monthly" {
  name                         = "${var.name_prefix}-restore-drill"
  description                  = "Monthly restore drill — backups only count when restored and verified."
  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = "Indian/Maldives"
  state                        = var.enabled ? "ENABLED" : "DISABLED"
  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 60
  }
  target {
    arn      = var.ecs_cluster_arn
    role_arn = aws_iam_role.scheduler.arn
    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.drill.arn_without_revision
      launch_type         = "FARGATE"
      task_count          = 1
      network_configuration {
        # Public subnet + public IP: the drill needs the RDS, S3 and CloudWatch APIs but the lean tier has no NAT.
        # No inbound rule exists on the ops security group, so the public IP accepts nothing.
        subnets          = var.subnet_ids
        security_groups  = [var.ops_security_group_id]
        assign_public_ip = true
      }
    }
    retry_policy {
      maximum_retry_attempts = 1
    }
  }
}

# ── Failure paging ───────────────────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "failure" {
  alarm_name          = "${var.name_prefix}-restore-drill-failed"
  alarm_description   = "The monthly restore drill failed: the latest backup could not be restored and verified. Runbook: docs/runbooks/backup-restore-verification.md"
  namespace           = var.metric_namespace
  metric_name         = "RestoreDrillFailure"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarm_topic_arn]
}

# A drill task that dies before it can publish a metric (bad image, no capacity) still pages someone.
resource "aws_cloudwatch_event_rule" "task_stopped" {
  name        = "${var.name_prefix}-restore-drill-stopped"
  description = "Restore drill task stopped with a non-zero exit code."
  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      lastStatus        = ["STOPPED"]
      taskDefinitionArn = [{ prefix = "arn:${local.partition}:ecs:${local.region}:${local.account}:task-definition/${local.family}:" }]
      containers        = { exitCode = [{ anything-but = 0 }] }
    }
  })
}

resource "aws_cloudwatch_event_target" "task_stopped" {
  rule = aws_cloudwatch_event_rule.task_stopped.name
  arn  = var.alarm_topic_arn
}
