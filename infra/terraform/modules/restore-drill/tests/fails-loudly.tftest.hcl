# P1-3 invariant: "a drill that did not run always pages someone". The event pattern itself is evaluated against
# sample events by infra/restore-drill/test/event-pattern.test.mjs; this checks the wiring around it.
mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_region" {
    defaults = { region = "ap-south-1", name = "ap-south-1" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  name_prefix             = "portico-prod-aps1-c01"
  engine                  = "rds"
  source_identifier       = "portico-prod-aps1-c01"
  source_arn              = "arn:aws:rds:ap-south-1:123456789012:db:portico-prod-aps1-c01"
  db_subnet_group_name    = "portico-prod-aps1-c01"
  drill_security_group_id = "sg-drill"
  ops_security_group_id   = "sg-ops"
  subnet_ids              = ["subnet-app-a", "subnet-app-b"]
  db_kms_key_arn          = "arn:aws:kms:ap-south-1:123456789012:key/db"
  evidence_bucket         = "backups"
  evidence_kms_key_arn    = "arn:aws:kms:ap-south-1:123456789012:key/storage"
  metric_namespace        = "Portico/portico-prod-aps1-c01"
  ecs_cluster_arn         = "arn:aws:ecs:ap-south-1:123456789012:cluster/portico-prod-aps1-c01"
  repository_url          = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/portico-prod-aps1-c01/restore-drill"
  repository_arn          = "arn:aws:ecr:ap-south-1:123456789012:repository/portico-prod-aps1-c01/restore-drill"
  log_group_name          = "/portico/portico-prod-aps1-c01/restore-drill"
  log_group_arn           = "arn:aws:logs:ap-south-1:123456789012:log-group:/portico/portico-prod-aps1-c01/restore-drill"
  alarm_topic_arn         = "arn:aws:sns:ap-south-1:123456789012:portico-prod-aps1-c01-oncall"
}

run "missing_evidence_pages" {
  command = plan
  assert {
    condition     = output.alarms.stale.treat_missing_data == "breaching" && output.alarms.stale.metric == "RestoreDrillEvidenceAgeDays"
    error_message = "no datapoint (drill or freshness task never ran) must count as breaching."
  }
  assert {
    condition     = output.alarms.stale.threshold == 35 && output.alarms.stale.period == 86400 && contains(output.alarms.stale.actions, var.alarm_topic_arn)
    error_message = "evidence older than 35 days pages on-call."
  }
  assert {
    condition     = contains(output.alarms.failure_actions, var.alarm_topic_arn)
    error_message = "a reported failure (including skipped checks) pages on-call."
  }
}

run "abnormal_stops_page_immediately" {
  command = plan
  assert {
    condition     = output.alarms.task_stopped_target == var.alarm_topic_arn
    error_message = "the stop rule targets the on-call topic."
  }
  assert {
    condition     = jsonencode(output.alarms.task_stopped_pattern.detail["$or"]) == jsonencode([{ stopCode = ["TaskFailedToStart"] }, { containers = { exitCode = [{ anything-but = 0 }] } }, { containers = { exitCode = [{ exists = false }] } }])
    error_message = "TaskFailedToStart, a non-zero exit and a missing exit code must each page."
  }
}

run "drill_and_freshness_run_the_release_image_privately" {
  command = plan
  assert {
    condition     = output.alarms.schedules.drill.mode == "drill" && output.alarms.schedules.freshness.mode == "freshness"
    error_message = "a monthly drill and a daily freshness check."
  }
  assert {
    condition     = endswith(output.alarms.schedules.drill.image, "/restore-drill:release") && !output.alarms.schedules.drill.public_ip
    error_message = "the drill runs the release-tagged image (moved by every deploy), in private subnets by default."
  }
}
