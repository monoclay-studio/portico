# AWS Backup for one cell (resilient tier; optional elsewhere). Complements the database's own PITR window:
#
#   daily    02:00 Maldives time, kept `daily_retention_days`, copied to the DR region
#   monthly  1st of the month, kept `monthly_retention_days`, copied to the DR region
#
# Covers the primary database and the documents bucket (S3 backups need versioning — enabled by the storage
# module). The vault can be locked (governance mode) so a compromised admin credential cannot shorten retention
# or delete recovery points silently. Copies to the DR region make the "full region loss" TARGET possible
# (docs/runbooks/disaster-recovery.md); they cost cross-region transfer ($0.086/GB from ap-south-1, AWS price
# list 2026-11-05) plus storage in the DR region.
#
# Existence of backups is not evidence. Restores are: see modules/restore-drill.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  root_arn = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"
  key_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AccountAdministration"
      Effect    = "Allow"
      Principal = { AWS = local.root_arn }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })
  dr_enabled = var.dr_region != null
}

resource "aws_kms_key" "vault" {
  description             = "${var.name_prefix} AWS Backup vault"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = local.key_policy
}

resource "aws_backup_vault" "primary" {
  name        = "${var.name_prefix}-primary"
  kms_key_arn = aws_kms_key.vault.arn
}

resource "aws_backup_vault_lock_configuration" "primary" {
  count              = var.vault_lock ? 1 : 0
  backup_vault_name  = aws_backup_vault.primary.name
  min_retention_days = 7
  max_retention_days = var.monthly_retention_days
}

resource "aws_kms_key" "dr" {
  count                   = local.dr_enabled ? 1 : 0
  region                  = var.dr_region
  description             = "${var.name_prefix} AWS Backup DR vault"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = local.key_policy
}

resource "aws_backup_vault" "dr" {
  count       = local.dr_enabled ? 1 : 0
  region      = var.dr_region
  name        = "${var.name_prefix}-dr"
  kms_key_arn = aws_kms_key.dr[0].arn
}

resource "aws_backup_vault_lock_configuration" "dr" {
  count              = local.dr_enabled && var.vault_lock ? 1 : 0
  region             = var.dr_region
  backup_vault_name  = aws_backup_vault.dr[0].name
  min_retention_days = 7
  max_retention_days = var.monthly_retention_days
}

resource "aws_backup_plan" "this" {
  name = "${var.name_prefix}-plan"

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(0 21 * * ? *)"
    start_window      = 60
    completion_window = 360
    lifecycle {
      delete_after = var.daily_retention_days
    }
    dynamic "copy_action" {
      for_each = local.dr_enabled ? [1] : []
      content {
        destination_vault_arn = aws_backup_vault.dr[0].arn
        lifecycle {
          delete_after = var.daily_retention_days
        }
      }
    }
  }

  rule {
    rule_name         = "monthly"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(0 22 1 * ? *)"
    start_window      = 60
    completion_window = 720
    lifecycle {
      delete_after = var.monthly_retention_days
    }
    dynamic "copy_action" {
      for_each = local.dr_enabled ? [1] : []
      content {
        destination_vault_arn = aws_backup_vault.dr[0].arn
        lifecycle {
          delete_after = var.monthly_retention_days
        }
      }
    }
  }
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${var.name_prefix}-backup"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = toset([
    "service-role/AWSBackupServiceRolePolicyForBackup",
    "service-role/AWSBackupServiceRolePolicyForRestores",
    "AWSBackupServiceRolePolicyForS3Backup",
    "AWSBackupServiceRolePolicyForS3Restore",
  ])
  role       = aws_iam_role.backup.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/${each.key}"
}

resource "aws_backup_selection" "this" {
  name         = "${var.name_prefix}-data"
  plan_id      = aws_backup_plan.this.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = var.resource_arns
}

# Failed backup / copy jobs page on-call.
resource "aws_backup_vault_notifications" "primary" {
  count               = var.notification_topic_arn == null ? 0 : 1
  backup_vault_name   = aws_backup_vault.primary.name
  sns_topic_arn       = var.notification_topic_arn
  backup_vault_events = ["BACKUP_JOB_FAILED", "COPY_JOB_FAILED", "RESTORE_JOB_FAILED"]
}
