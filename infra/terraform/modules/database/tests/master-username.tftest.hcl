# The role bootstrap and the restore drill refuse to continue when any portico_* role is privileged. The RDS master
# is privileged by design, so its name must never start with portico_ (it once defaulted to portico_master, which
# would have failed the first real bootstrap on RDS).
mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
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
  name_prefix           = "portico-prod-aps1-c01"
  engine                = "rds"
  engine_version        = "16.10"
  instance_class        = "db.t4g.small"
  availability_zones    = ["ap-south-1a", "ap-south-1b"]
  subnet_ids            = ["subnet-a", "subnet-b"]
  security_group_id     = "sg-db"
  secrets_kms_key_arn   = "arn:aws:kms:ap-south-1:123456789012:key/00000000-0000-0000-0000-000000000000"
  backup_retention_days = 14
}

run "default_master_is_not_a_portico_role" {
  command = plan
  assert {
    condition     = !startswith(var.master_username, "portico_")
    error_message = "the default master username must not use the portico_ prefix."
  }
}

run "portico_prefixed_master_refused" {
  command = plan
  variables {
    master_username = "portico_master"
  }
  expect_failures = [var.master_username]
}

run "no_bind_values_in_logs" {
  command = plan
  assert {
    condition     = output.parameters["log_parameter_max_length"] == "0" && output.parameters["log_parameter_max_length_on_error"] == "0" && output.parameters["log_error_verbosity"] == "terse"
    error_message = "Postgres must never log bind values or key values (guest PII; review P2-5)."
  }
}
