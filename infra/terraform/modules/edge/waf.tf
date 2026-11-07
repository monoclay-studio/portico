# AWS WAF (CloudFront scope, therefore us-east-1). Pricing in the 2026-11-05 price list: $5/web ACL/month,
# $1/rule/month (each managed rule group counts as one rule), $0.60 per million requests.
#
#   waf_level = "none"   demo tier (sample data, CloudFront + Shield Standard only)
#   waf_level = "basic"  IP reputation + core rule set + per-IP rate limit                      ≈ $9/month + requests
#   waf_level = "full"   basic + known bad inputs + SQL injection + strict login rate limit     ≈ $11/month + requests
#
# Not used on purpose: the anonymous-IP list (would block hotel partners and channel managers calling from cloud
# hosts) and paid Bot Control / ATP groups ($10/month each) — revisit with real traffic.

locals {
  waf_managed_groups = {
    basic = [
      { name = "AWSManagedRulesAmazonIpReputationList", priority = 10, body_size_count = false },
      { name = "AWSManagedRulesCommonRuleSet", priority = 20, body_size_count = true },
    ]
    full = [
      { name = "AWSManagedRulesAmazonIpReputationList", priority = 10, body_size_count = false },
      { name = "AWSManagedRulesCommonRuleSet", priority = 20, body_size_count = true },
      { name = "AWSManagedRulesKnownBadInputsRuleSet", priority = 30, body_size_count = false },
      { name = "AWSManagedRulesSQLiRuleSet", priority = 40, body_size_count = false },
    ]
    none = []
  }
}

resource "aws_wafv2_web_acl" "this" {
  count  = local.waf_enabled ? 1 : 0
  region = "us-east-1"
  name   = "${var.name_prefix}-edge"
  scope  = "CLOUDFRONT"

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = local.waf_managed_groups[var.waf_level]
    content {
      name     = rule.value.name
      priority = rule.value.priority
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.value.name
          # Core rule set blocks request bodies > 8 KB; API payloads (imports, bulk updates) can be larger, so that
          # single rule only counts. Large files go to S3 through presigned URLs, never through the API.
          dynamic "rule_action_override" {
            for_each = rule.value.body_size_count ? ["SizeRestrictions_BODY"] : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.value.name
        sampled_requests_enabled   = true
      }
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 100
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.rate_limit_per_5min
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = var.waf_level == "full" ? [1] : []
    content {
      name     = "login-rate-limit-per-ip"
      priority = 110
      action {
        block {}
      }
      statement {
        rate_based_statement {
          limit                 = var.login_rate_limit_per_5min
          aggregate_key_type    = "IP"
          evaluation_window_sec = 300
          scope_down_statement {
            byte_match_statement {
              search_string         = "/v1/auth/login"
              positional_constraint = "STARTS_WITH"
              field_to_match {
                uri_path {}
              }
              text_transformation {
                priority = 0
                type     = "LOWERCASE"
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "login-rate-limit-per-ip"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-edge"
    sampled_requests_enabled   = true
  }
}

# WAF logs: the log group name must start with aws-waf-logs- and live in us-east-1. Authorization and cookie
# headers are redacted so tokens never land in logs.
resource "aws_cloudwatch_log_group" "waf" {
  count             = local.waf_enabled ? 1 : 0
  region            = "us-east-1"
  name              = "aws-waf-logs-${var.name_prefix}"
  retention_in_days = var.waf_log_retention_days
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  count                   = local.waf_enabled ? 1 : 0
  region                  = "us-east-1"
  resource_arn            = aws_wafv2_web_acl.this[0].arn
  log_destination_configs = [aws_cloudwatch_log_group.waf[0].arn]
  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
  redacted_fields {
    single_header {
      name = "x-origin-verify"
    }
  }
  logging_filter {
    default_behavior = "DROP"
    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"
      condition {
        action_condition {
          action = "BLOCK"
        }
      }
      condition {
        action_condition {
          action = "COUNT"
        }
      }
    }
  }
}
