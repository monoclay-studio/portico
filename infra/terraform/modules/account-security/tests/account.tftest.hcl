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
}

variables {
  trail_bucket_name = "portico-cloudtrail-123456789012"
  security_emails   = ["owner@example.invalid"]
}

run "detective_controls" {
  command = plan
  assert {
    condition     = output.trail.multi_region && output.trail.log_validation && output.trail.global_events
    error_message = "one multi-region trail with log-file validation and global events."
  }
  assert {
    condition     = output.guardduty_enabled
    error_message = "GuardDuty must be enabled."
  }
}

run "destructive_calls_page" {
  command = plan
  assert {
    condition = alltrue([for e in ["ScheduleKeyDeletion", "DeleteDBInstance", "DeleteDBCluster", "DeleteSecret", "RemoveRegionsFromReplication", "DeleteBackupVaultLockConfiguration", "DeleteRecoveryPoint", "StopLogging", "DeleteTrail"] :
    anytrue([for r in values(output.rules) : contains(r.events, e)])])
    error_message = "key, database, secret, backup and trail destruction must each page."
  }
  assert {
    condition     = output.rules["iam-changes"].region == "us-east-1" && contains(output.rules["iam-changes"].events, "AttachRolePolicy") && output.rules["root-activity"].region == "us-east-1"
    error_message = "IAM changes and root activity are global events: their rules live in us-east-1."
  }
  assert {
    condition     = length(aws_sns_topic_subscription.security) == 2
    error_message = "the security email is subscribed in both the primary region and us-east-1."
  }
}
