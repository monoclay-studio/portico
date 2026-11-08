# Spend visibility and the closest thing AWS offers to a spending cap.
#
# A BUDGET ALERT IS NOT A HARD CAP. AWS Budgets evaluates billing data that lags actual usage by up to ~24 hours
# and never stops spend by itself. What this module can do:
#   1. Notify (email + on-call SNS) at 50% / 80% / 100% of actual spend and at 100% of forecast.
#   2. Demo tier only — budget ACTIONS at 100% of actual spend:
#        a. RUN_SSM_DOCUMENTS / STOP_EC2_INSTANCES stops the demo host (compute billing stops);
#        b. APPLY_IAM_POLICY attaches a deny-StartInstances policy to the office-hours scheduler role, so the next
#           morning's schedule cannot restart it. The owner resets the action to resume.
#      Still NOT a hard cap: EBS, Elastic IP, CloudFront and other per-hour items keep billing (≈ $4–6/month for
#      the demo), and spend between the last billing update and the stop is incurred.
#   3. Never automatically stop a cell that serves a live hotel: an outage at a hotel is worse than an overspend.
#      Production budgets alert only; the human decides.
# Real hard stops: deleting the resources (terraform destroy of the cell), or an AWS Organizations SCP that denies
# everything in the account. See infra/README.md "Budget alerts vs hard caps".

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  stop_enabled = var.enable_stop_actions
  topics       = var.alert_topic_arn == null ? [] : [var.alert_topic_arn]
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = format("%.2f", var.monthly_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "cost_filter" {
    for_each = var.cost_filter_tag == null ? [] : [var.cost_filter_tag]
    content {
      name   = "TagKeyValue"
      values = [format("user:%s$%s", cost_filter.value.key, cost_filter.value.value)]
    }
  }

  dynamic "notification" {
    for_each = toset([for t in var.actual_thresholds_percent : tostring(t)])
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = tonumber(notification.value)
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.alert_emails
      subscriber_sns_topic_arns  = local.topics
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.alert_emails
    subscriber_sns_topic_arns  = local.topics
  }
}

# ── Demo stop actions ─────────────────────────────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "budgets_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }
    # Confused-deputy guard (review P3-4): only this account's use of the service may assume the role.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "actions" {
  count              = local.stop_enabled ? 1 : 0
  name               = "${var.name_prefix}-budget-actions"
  assume_role_policy = data.aws_iam_policy_document.budgets_assume.json
}

data "aws_iam_policy_document" "actions" {
  statement {
    sid       = "StopDemoHost"
    actions   = ["ec2:StopInstances", "ec2:DescribeInstanceStatus"]
    resources = ["*"]
  }
  statement {
    sid       = "RunStopAutomation"
    actions   = ["ssm:StartAutomationExecution", "ssm:GetAutomationExecution", "ssm:DescribeInstanceInformation"]
    resources = ["*"]
  }
  statement {
    sid       = "AttachDenyStartToScheduler"
    actions   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
    resources = ["arn:${data.aws_partition.current.partition}:iam::*:role/${coalesce(var.scheduler_role_name, "none")}"]
  }
}

resource "aws_iam_role_policy" "actions" {
  count  = local.stop_enabled ? 1 : 0
  name   = "budget-actions"
  role   = aws_iam_role.actions[0].id
  policy = data.aws_iam_policy_document.actions.json
}

resource "aws_budgets_budget_action" "stop_host" {
  count              = local.stop_enabled ? 1 : 0
  budget_name        = aws_budgets_budget.monthly.name
  action_type        = "RUN_SSM_DOCUMENTS"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.actions[0].arn
  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 100
  }
  definition {
    ssm_action_definition {
      action_sub_type = "STOP_EC2_INSTANCES"
      region          = data.aws_region.current.region
      instance_ids    = [var.stop_instance_id]
    }
  }
  dynamic "subscriber" {
    for_each = toset(var.alert_emails)
    content {
      address           = subscriber.value
      subscription_type = "EMAIL"
    }
  }
}

data "aws_iam_policy_document" "deny_start" {
  statement {
    sid       = "BudgetExceededKeepDemoStopped"
    effect    = "Deny"
    actions   = ["ec2:StartInstances"]
    resources = [coalesce(var.stop_instance_arn, "*")]
  }
}

resource "aws_iam_policy" "deny_start" {
  count       = local.stop_enabled && var.enable_deny_restart ? 1 : 0
  name        = "${var.name_prefix}-budget-deny-start"
  description = "Attached by an AWS Budgets action when the demo ceiling is reached; reset the action to resume."
  policy      = data.aws_iam_policy_document.deny_start.json
}

resource "aws_budgets_budget_action" "deny_restart" {
  count              = local.stop_enabled && var.enable_deny_restart ? 1 : 0
  budget_name        = aws_budgets_budget.monthly.name
  action_type        = "APPLY_IAM_POLICY"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.actions[0].arn
  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 100
  }
  definition {
    iam_action_definition {
      policy_arn = aws_iam_policy.deny_start[0].arn
      roles      = [var.scheduler_role_name]
    }
  }
  dynamic "subscriber" {
    for_each = toset(var.alert_emails)
    content {
      address           = subscriber.value
      subscription_type = "EMAIL"
    }
  }
}
