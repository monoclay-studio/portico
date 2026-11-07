# Tier "demo": one small Graviton instance running api + worker + Postgres in Docker (readiness brief §16,
# cost-model §4a T1). Same images, same DB role model and same migrations as the managed tiers; what it gives up
# is redundancy and managed backups — acceptable only because a demo holds SAMPLE DATA ONLY (reseedable).
#
#   - Reached only through CloudFront: the security group admits the API port from CloudFront's origin-facing
#     ranges only. CloudFront → host is HTTP inside AWS's network edge-to-region path (no custom domain needed);
#     acceptable for sample data, NOT for real guest data (hence lean/resilient require HTTPS origins).
#   - No SSH. Administration via SSM Session Manager; deploys via SSM Run Command (portico.sh).
#   - IMDSv2 only with hop limit 1: containers cannot obtain the instance role's credentials.
#   - Office-hours schedule stops the instance (compute billing stops; EBS + Elastic IP keep billing).
#   - Budget actions (budgets module) can stop it and block restarts when the demo ceiling is reached.

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
data "aws_partition" "current" {}

data "aws_ssm_parameter" "ami" {
  name = var.cpu_architecture == "ARM64" ? "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64" : "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  region = data.aws_region.current.region
  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    region          = local.region
    api_repo        = var.repository_urls["api"]
    worker_repo     = var.repository_urls["worker"]
    log_group       = var.log_group_name
    postgres_image  = var.postgres_image
    app_port        = var.app_port
    cors_origins    = join(",", var.cors_origins)
    app_base_url    = var.app_base_url == null ? "" : var.app_base_url
    cell            = var.name_prefix
    trusted_proxies = join(",", var.trusted_proxies)
    seed_demo       = tostring(var.seed_demo)
    image_tag       = var.image_tag
    portico_sh_b64  = filebase64("${path.module}/files/portico.sh")
    deploy_on_first = var.image_tag != "bootstrap"
  })
}

# ── Instance role ─────────────────────────────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "host" {
  name               = "${var.name_prefix}-host"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "host" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid       = "EcrPull"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [var.repository_arns["api"], var.repository_arns["worker"]]
  }
  statement {
    sid       = "ContainerLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["${var.log_group_arn}:*"]
  }
}

resource "aws_iam_role_policy" "host" {
  name   = "host"
  role   = aws_iam_role.host.id
  policy = data.aws_iam_policy_document.host.json
}

resource "aws_iam_instance_profile" "host" {
  name = "${var.name_prefix}-host"
  role = aws_iam_role.host.name
}

# ── Instance ──────────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_instance" "host" {
  ami                         = data.aws_ssm_parameter.ami.value
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [var.security_group_id]
  iam_instance_profile        = aws_iam_instance_profile.host.name
  user_data_base64            = base64gzip(local.user_data)
  user_data_replace_on_change = false
  monitoring                  = false

  # Burstable credits in "standard" mode: the instance is throttled instead of billing surplus CPU credits.
  credit_specification {
    cpu_credits = "standard"
  }

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    http_endpoint               = "enabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  tags = { Name = "${var.name_prefix}-host" }

  lifecycle {
    # New AMI releases must not silently replace the host (and its demo database).
    ignore_changes = [ami, user_data_base64]
  }
}

resource "aws_eip" "host" {
  domain   = "vpc"
  instance = aws_instance.host.id
  tags     = { Name = "${var.name_prefix}-host" }
}

# ── Office-hours schedule (EventBridge Scheduler calling EC2 directly; no Lambda) ─────────────────────────────
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    # Confused-deputy guard (review P3-4): only this account's use of the service may assume the role.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  count              = var.schedule == null ? 0 : 1
  name               = "${var.name_prefix}-host-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["ec2:StartInstances", "ec2:StopInstances"]
    resources = [aws_instance.host.arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  count  = var.schedule == null ? 0 : 1
  name   = "start-stop-host"
  role   = aws_iam_role.scheduler[0].id
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule" "host" {
  for_each = var.schedule == null ? {} : {
    start = { cron = var.schedule.start_cron, api = "startInstances" }
    stop  = { cron = var.schedule.stop_cron, api = "stopInstances" }
  }
  name                         = "${var.name_prefix}-host-${each.key}"
  schedule_expression          = each.value.cron
  schedule_expression_timezone = var.schedule.timezone
  flexible_time_window {
    mode = "OFF"
  }
  target {
    arn      = "arn:${data.aws_partition.current.partition}:scheduler:::aws-sdk:ec2:${each.value.api}"
    role_arn = aws_iam_role.scheduler[0].arn
    input    = jsonencode({ InstanceIds = [aws_instance.host.id] })
  }
}

# ── Deploy metadata for the pipeline ──────────────────────────────────────────────────────────────────────────
# The ONLY command the deploy pipeline may send to the host (modules/ci-deploy-role): `portico deploy <sha> <url>`
# with both parameters validated by SSM before anything runs. Never AWS-RunShellScript (root shell on the host).
resource "aws_ssm_document" "deploy" {
  name            = "${var.name_prefix}-deploy"
  document_type   = "Command"
  document_format = "JSON"
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Deploy a Portico release (immutable git SHA) to the demo host."
    parameters = {
      tag     = { type = "String", description = "git SHA", allowedPattern = "^[0-9a-f]{7,40}$" }
      baseUrl = { type = "String", description = "public base URL", allowedPattern = "^https://[A-Za-z0-9.-]{1,253}$" }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = { runCommand = ["/usr/local/sbin/portico deploy '{{ tag }}' '{{ baseUrl }}'"], timeoutSeconds = "1800" }
    }]
  })
}

resource "aws_ssm_parameter" "deploy_config" {
  name        = "/portico/${var.name_prefix}/deploy-config"
  description = "Read by the deploy pipeline (infra/ci/deploy.yml.example). Contains no secrets."
  type        = "String"
  value = jsonencode({
    runtime        = "single_host"
    region         = local.region
    instance_id    = aws_instance.host.id
    document       = aws_ssm_document.deploy.name
    repositories   = var.repository_urls
    smoke_base_url = var.smoke_base_url
    log_group      = var.log_group_name
    web            = var.web
  })
}
