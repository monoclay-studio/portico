# Role the GitHub Actions deploy workflow assumes through OIDC (no long-lived AWS keys anywhere).
#
# Trust: only workflow jobs of `github_repository` that run in one of `github_environments` (GitHub Environments
# carry required reviewers for production). The GitHub OIDC provider itself is account-wide and is created by the
# bootstrap root (envs/bootstrap); this module looks it up.
#
# Permissions are deploy-only: push images, register task definitions, run the migration/bootstrap tasks, update
# the two services (or SSM Run Command on the demo host), publish the SPA, invalidate CloudFront. Terraform
# apply is NOT granted here — infrastructure changes are applied by a human (see docs/runbooks/deploy.md).

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  partition = data.aws_partition.current.partition
  region    = data.aws_region.current.region
  account   = data.aws_caller_identity.current.account_id
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for e in var.github_environments : "repo:${var.github_repository}:environment:${e}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name_prefix}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPushPull"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload",
      "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages", "ecr:DescribeImageScanFindings",
    ]
    resources = var.repository_arns
  }
  statement {
    sid       = "DeployConfig"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:${local.partition}:ssm:${local.region}:${local.account}:parameter${var.deploy_config_parameter}"]
  }
  statement {
    sid       = "PublishWebApp"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [var.web_bucket_arn, "${var.web_bucket_arn}/*"]
  }
  statement {
    sid       = "InvalidateCdn"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [var.distribution_arn]
  }

  dynamic "statement" {
    for_each = var.runtime == "fargate" ? [1] : []
    content {
      sid       = "TaskDefinitions"
      actions   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"]
      resources = ["*"]
    }
  }
  dynamic "statement" {
    for_each = var.runtime == "fargate" ? [1] : []
    content {
      sid     = "ServicesAndOneOffTasks"
      actions = ["ecs:UpdateService", "ecs:DescribeServices", "ecs:RunTask", "ecs:DescribeTasks", "ecs:StopTask"]
      resources = [
        "arn:${local.partition}:ecs:${local.region}:${local.account}:service/${var.ecs_cluster_name}/*",
        "arn:${local.partition}:ecs:${local.region}:${local.account}:task-definition/${var.name_prefix}-*",
        "arn:${local.partition}:ecs:${local.region}:${local.account}:task/${var.ecs_cluster_name}/*",
      ]
    }
  }
  dynamic "statement" {
    for_each = var.runtime == "fargate" ? [1] : []
    content {
      sid       = "PassOnlyCellTaskRoles"
      actions   = ["iam:PassRole"]
      resources = var.pass_role_arns
      condition {
        test     = "StringEquals"
        variable = "iam:PassedToService"
        values   = ["ecs-tasks.amazonaws.com"]
      }
    }
  }
  dynamic "statement" {
    for_each = var.runtime == "fargate" ? [1] : []
    content {
      sid       = "ReadDeployLogsAndHealth"
      actions   = ["logs:GetLogEvents", "logs:FilterLogEvents", "elasticloadbalancing:DescribeTargetHealth"]
      resources = ["*"]
    }
  }
  dynamic "statement" {
    for_each = var.runtime == "single_host" ? [1] : []
    content {
      sid     = "DeployToDemoHost"
      actions = ["ssm:SendCommand"]
      resources = [
        var.host_instance_arn,
        "arn:${local.partition}:ssm:${local.region}::document/AWS-RunShellScript",
      ]
    }
  }
  dynamic "statement" {
    for_each = var.runtime == "single_host" ? [1] : []
    content {
      sid       = "ReadCommandResults"
      actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
      resources = ["*"]
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
