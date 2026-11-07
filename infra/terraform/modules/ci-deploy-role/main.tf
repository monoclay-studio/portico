# Role the GitHub Actions deploy workflow assumes through OIDC (no long-lived AWS keys anywhere).
#
# WHAT THIS ROLE IS: it deploys code. Code it deploys runs with the cell's application secrets, so the role is as
# powerful as the application — that is inherent to any deploy identity. What it is NOT: it cannot read a secret
# value, the RDS master password or the database through any AWS API; it cannot register task definitions, run
# one-off tasks, pass IAM roles, or run arbitrary commands. Releases move the `release` image tag (the only mutable
# tag) and force a new deployment of Terraform's own task definitions; migrations and routing grants run as init
# containers whose definition only Terraform changes; the role bootstrap (RDS master) is a human break-glass step.
#
# WHO CAN OBTAIN IT: only a job of the real repository (immutable repository id + owner id), in one of the listed
# GitHub Environments, on an allowed ref, running the deploy workflow file — matched EXACTLY against a customized OIDC
# subject (envs/github sets the template: repository_owner_id, repository_id, environment, ref, job_workflow_ref).
# A renamed/squatted repository, another branch, another workflow or an unprotected environment fails closed.
# The GitHub-side rules this relies on (main protected, environments limited to main with reviewers) are codified in
# envs/github.

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
  issuer    = "token.actions.githubusercontent.com"

  workflow = "${var.github_repository}/${var.workflow_path}"
  # Exact subjects for refs/heads/* refs; release tags (opt-in) use one StringLike pattern whose only wildcard is the
  # tag name (git ref names cannot contain ':', so the wildcard cannot reach into another claim).
  exact_subjects = flatten([for e in var.github_environments : [for r in var.allowed_refs :
    "repository_owner_id:${var.github_owner_id}:repository_id:${var.github_repository_id}:environment:${e}:ref:${r}:job_workflow_ref:${local.workflow}@${r}"
  ]])
  tag_subjects = var.allow_release_tags ? [for e in var.github_environments :
    "repository_owner_id:${var.github_owner_id}:repository_id:${var.github_repository_id}:environment:${e}:ref:refs/tags/v*:job_workflow_ref:${local.workflow}@refs/tags/v*"
  ] : []

  trust_policy = {
    Version = "2012-10-17"
    Statement = [for s in concat(
      [{ op = "StringEquals", subjects = local.exact_subjects }],
      [for t in [local.tag_subjects] : { op = "StringLike", subjects = t } if length(t) > 0],
      ) : {
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Condition = merge(
        {
          StringEquals = merge(
            { "${local.issuer}:aud" = "sts.amazonaws.com" },
            s.op == "StringEquals" ? { "${local.issuer}:sub" = s.subjects } : {},
          )
        },
        s.op == "StringLike" ? { StringLike = { "${local.issuer}:sub" = s.subjects } } : {},
      )
    }]
  }

  log_groups = "arn:${local.partition}:logs:${local.region}:${local.account}:log-group:/portico/${var.name_prefix}/*"

  common_statements = [
    { Sid = "EcrAuth", Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = ["*"] },
    {
      Sid    = "EcrPushReleaseImages"
      Effect = "Allow"
      Action = [
        "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload",
        "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages", "ecr:DescribeImageScanFindings",
      ]
      Resource = var.repository_arns
    },
    {
      Sid      = "DeployConfig"
      Effect   = "Allow"
      Action   = ["ssm:GetParameter"]
      Resource = ["arn:${local.partition}:ssm:${local.region}:${local.account}:parameter${var.deploy_config_parameter}"]
    },
    { Sid = "PublishWebApp", Effect = "Allow", Action = ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"], Resource = [var.web_bucket_arn, "${var.web_bucket_arn}/*"] },
    { Sid = "InvalidateCdn", Effect = "Allow", Action = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"], Resource = [var.distribution_arn] },
  ]

  fargate_statements = [
    {
      # Force a new deployment of Terraform's task definitions (the image resolves from the `release` tag). The
      # condition keeps the service on its own families when ECS supplies the key [unverified for UpdateService].
      Sid      = "RollServices"
      Effect   = "Allow"
      Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
      Resource = ["arn:${local.partition}:ecs:${local.region}:${local.account}:service/${var.ecs_cluster_name}/*"]
      Condition = {
        ArnLikeIfExists = {
          "ecs:task-definition" = [for f in var.service_task_families : "arn:${local.partition}:ecs:${local.region}:${local.account}:task-definition/${f}:*"]
        }
      }
    },
    { Sid = "ReadDeployLogs", Effect = "Allow", Action = ["logs:FilterLogEvents", "logs:GetLogEvents"], Resource = [local.log_groups, "${local.log_groups}:*"] },
    { Sid = "ReadTargetHealth", Effect = "Allow", Action = ["elasticloadbalancing:DescribeTargetHealth"], Resource = ["*"] },
  ]

  host_statements = [
    {
      # Only the cell's own deploy document (tag and URL validated by the document's allowedPattern) — never
      # AWS-RunShellScript, which would be root on the host.
      Sid      = "DeployToDemoHost"
      Effect   = "Allow"
      Action   = ["ssm:SendCommand"]
      Resource = [var.host_instance_arn, var.host_deploy_document_arn]
    },
    { Sid = "ReadCommandResults", Effect = "Allow", Action = ["ssm:GetCommandInvocation"], Resource = ["*"] },
  ]

  deploy_policy = {
    Version = "2012-10-17"
    Statement = concat(
      local.common_statements,
      [for st in local.fargate_statements : st if var.runtime == "fargate"],
      [for st in local.host_statements : st if var.runtime != "fargate"],
    )
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name_prefix}-github-deploy"
  assume_role_policy   = jsonencode(local.trust_policy)
  max_session_duration = 3600

  lifecycle {
    precondition {
      condition     = var.github_repository_id > 0 && var.github_owner_id > 0
      error_message = "github_repository_id and github_owner_id (immutable numeric ids) are required: a repository name alone can be re-registered by someone else."
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = jsonencode(local.deploy_policy)
}
