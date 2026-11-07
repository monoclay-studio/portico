# Least-privilege roles. Execution roles are what ECS itself uses to start a task (pull the image, write logs,
# read the secrets injected as environment variables); task roles are what the application code may do.
# Each one-off task (migrate, db-bootstrap) gets its own execution role so it can read only its own secrets.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  partition = data.aws_partition.current.partition
  region    = data.aws_region.current.region

  execution_roles = {
    api = {
      secrets   = concat([var.db_app_secret_arn], [for k in var.injected_integration_secrets : var.integration_secret_arns[k]])
      log_group = var.log_group_arns["api"]
      repos     = [var.repository_arns["api"]]
    }
    worker = {
      secrets   = concat([var.db_app_secret_arn], [for k in var.injected_integration_secrets : var.integration_secret_arns[k]])
      log_group = var.log_group_arns["worker"]
      repos     = [var.repository_arns["worker"]]
    }
    migrate = {
      secrets   = [var.db_owner_secret_arn]
      log_group = var.log_group_arns["migrate"]
      repos     = [var.repository_arns["api"]]
    }
    db-bootstrap = {
      secrets   = [var.db_master_secret_arn, var.db_owner_secret_arn, var.db_app_secret_arn]
      log_group = var.log_group_arns["db-bootstrap"]
      repos     = [var.repository_arns["api"]]
    }
  }
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "execution" {
  for_each           = local.execution_roles
  name               = "${var.name_prefix}-${each.key}-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "execution" {
  for_each = local.execution_roles

  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid       = "EcrPull"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = each.value.repos
  }
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${each.value.log_group}:*"]
  }
  statement {
    sid       = "InjectedSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = each.value.secrets
  }
  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = [var.secrets_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "execution" {
  for_each = local.execution_roles
  name     = "execution"
  role     = aws_iam_role.execution[each.key].id
  policy   = data.aws_iam_policy_document.execution[each.key].json
}

# ── Application task roles (api, worker) ──────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "task" {
  for_each           = toset(["api", "worker"])
  name               = "${var.name_prefix}-${each.key}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "ObjectsInDataBuckets"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:GetObjectVersion"]
    resources = [for k in ["documents", "exports"] : "${var.bucket_arns[k]}/*"]
  }
  statement {
    sid       = "ListDataBuckets"
    actions   = ["s3:ListBucket"]
    resources = [for k in ["documents", "exports"] : var.bucket_arns[k]]
  }
  statement {
    sid       = "TenantBackupsWriteOnly"
    actions   = ["s3:PutObject"]
    resources = ["${var.bucket_arns["backups"]}/tenant-exports/*"]
  }
  statement {
    sid       = "StorageKey"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [var.storage_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${local.region}.amazonaws.com"]
    }
  }
  statement {
    sid       = "FieldEncryptionKey"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [var.field_encryption_key_arn]
  }
  statement {
    sid       = "AppMetrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [var.metric_namespace]
    }
  }
  dynamic "statement" {
    for_each = var.ses_enabled ? [1] : []
    content {
      sid       = "SendEmailFromOurDomainOnly"
      actions   = ["ses:SendEmail", "ses:SendRawEmail"]
      resources = compact([var.ses_identity_arn, var.ses_configuration_set_arn])
    }
  }
  dynamic "statement" {
    for_each = var.enable_execute_command ? [1] : []
    content {
      sid       = "EcsExecBreakGlass"
      actions   = ["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"]
      resources = ["*"]
    }
  }
}

resource "aws_iam_role_policy" "task" {
  for_each = aws_iam_role.task
  name     = "application"
  role     = each.value.id
  policy   = data.aws_iam_policy_document.task.json
}
