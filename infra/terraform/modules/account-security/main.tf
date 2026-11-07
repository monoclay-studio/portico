# Account-level detective controls (review P2-11), one per AWS account, applied from envs/bootstrap:
#   - a multi-region CloudTrail trail with log-file validation into its own bucket (versioned, TLS-only, no public
#     access; a separate log-archive account is better once an AWS Organization exists);
#   - GuardDuty (high-severity findings page);
#   - EventBridge rules that page on destructive or security-relevant calls: KMS key deletion/disable, RDS delete,
#     Secrets Manager delete / replica removal / policy change / value change of the irreplaceable keys, AWS Backup
#     vault-lock or recovery-point deletion, bucket-policy changes on Portico buckets, CloudTrail stop/delete, any IAM
#     policy/user/key change, and any use of the root user. Global events (IAM, sign-in) arrive in us-east-1, so those
#     rules and their topic live there.
# These alarms are what makes the resource policies on the keys (modules/secrets) meaningful: the account root can
# still override any resource policy, but not silently.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  account   = data.aws_caller_identity.current.account_id
  partition = data.aws_partition.current.partition
  region    = data.aws_region.current.region

  # Regional management events worth a page (primary region).
  regional_patterns = {
    kms-key-deletion = {
      source = ["aws.kms"], detail-type = ["AWS API Call via CloudTrail"]
      detail = { eventName = ["ScheduleKeyDeletion", "DisableKey", "PutKeyPolicy", "DisableKeyRotation"] }
    }
    rds-delete = {
      source = ["aws.rds"], detail-type = ["AWS API Call via CloudTrail"]
      detail = { eventName = ["DeleteDBInstance", "DeleteDBCluster", "DeleteDBClusterSnapshot", "DeleteDBSnapshot", "ModifyDBClusterSnapshotAttribute", "ModifyDBSnapshotAttribute"] }
    }
    secrets-destructive = {
      source = ["aws.secretsmanager"], detail-type = ["AWS API Call via CloudTrail"]
      detail = { eventName = ["DeleteSecret", "RemoveRegionsFromReplication", "StopReplicationToReplica", "PutResourcePolicy", "DeleteResourcePolicy", "UpdateSecretVersionStage"] }
    }
    secrets-key-value-change = {
      # Any attempt (allowed or denied) to replace an irreplaceable key's value.
      source = ["aws.secretsmanager"], detail-type = ["AWS API Call via CloudTrail"]
      detail = { eventName = ["PutSecretValue", "UpdateSecret", "RotateSecret"], requestParameters = { secretId = [{ wildcard = "*/app/*-key*" }] } }
    }
    backup-destructive = {
      source = ["aws.backup"], detail-type = ["AWS API Call via CloudTrail"]
      detail = { eventName = ["DeleteBackupVaultLockConfiguration", "DeleteRecoveryPoint", "DeleteBackupVault", "PutBackupVaultAccessPolicy", "DeleteBackupPlan", "UpdateRecoveryPointLifecycle"] }
    }
    bucket-policy-changes = {
      source = ["aws.s3"], detail-type = ["AWS API Call via CloudTrail"]
      detail = { eventName = ["PutBucketPolicy", "DeleteBucketPolicy", "PutBucketObjectLockConfiguration", "PutBucketVersioning", "DeleteBucket", "PutBucketPublicAccessBlock", "DeletePublicAccessBlock"], requestParameters = { bucketName = [{ prefix = "portico-" }] } }
    }
    trail-tampering = {
      source = ["aws.cloudtrail"], detail-type = ["AWS API Call via CloudTrail"]
      detail = { eventName = ["StopLogging", "DeleteTrail", "UpdateTrail", "PutEventSelectors"] }
    }
    guardduty-high = {
      source = ["aws.guardduty"], detail-type = ["GuardDuty Finding"]
      detail = { severity = [{ numeric = [">=", 7] }] }
    }
    guardduty-disabled = {
      source = ["aws.guardduty"], detail-type = ["AWS API Call via CloudTrail"]
      detail = { eventName = ["DeleteDetector", "UpdateDetector", "DisassociateFromMasterAccount", "StopMonitoringMembers"] }
    }
  }

  # Global events (IAM, STS console sign-in) are delivered to us-east-1.
  global_patterns = {
    iam-changes = {
      source = ["aws.iam"], detail-type = ["AWS API Call via CloudTrail"]
      detail = { eventName = [
        "CreateUser", "DeleteUser", "CreateAccessKey", "UpdateAccessKey", "CreateLoginProfile", "UpdateLoginProfile",
        "AttachUserPolicy", "AttachRolePolicy", "AttachGroupPolicy", "PutUserPolicy", "PutRolePolicy", "PutGroupPolicy",
        "DetachRolePolicy", "DeleteRolePolicy", "CreatePolicyVersion", "SetDefaultPolicyVersion", "UpdateAssumeRolePolicy",
        "CreateRole", "DeleteRole", "AddUserToGroup", "CreateOpenIDConnectProvider", "UpdateOpenIDConnectProviderThumbprint",
        "DeactivateMFADevice", "DeleteVirtualMFADevice",
      ] }
    }
    root-activity = {
      detail-type = ["AWS Console Sign In via CloudTrail", "AWS API Call via CloudTrail"]
      detail      = { userIdentity = { type = ["Root"] } }
    }
  }
}

# ── CloudTrail ────────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_s3_bucket" "trail" {
  bucket = var.trail_bucket_name
}

resource "aws_s3_bucket_public_access_block" "trail" {
  bucket                  = aws_s3_bucket.trail.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "trail" {
  bucket = aws_s3_bucket.trail.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "trail" {
  bucket = aws_s3_bucket.trail.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "trail" {
  bucket = aws_s3_bucket.trail.id
  rule {
    id     = "retention"
    status = "Enabled"
    filter {}
    expiration {
      days = var.trail_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

locals {
  trail_arn = "arn:${local.partition}:cloudtrail:${local.region}:${local.account}:trail/${var.name}-account"
  trail_bucket_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudTrailAclCheck"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:GetBucketAcl"
        Resource  = aws_s3_bucket.trail.arn
        Condition = { StringEquals = { "aws:SourceArn" = local.trail_arn } }
      },
      {
        Sid       = "CloudTrailWrite"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.trail.arn}/AWSLogs/${local.account}/*"
        Condition = { StringEquals = { "aws:SourceArn" = local.trail_arn, "s3:x-amz-acl" = "bucket-owner-full-control" } }
      },
      {
        Sid       = "TlsOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.trail.arn, "${aws_s3_bucket.trail.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  }
}

resource "aws_s3_bucket_policy" "trail" {
  bucket     = aws_s3_bucket.trail.id
  policy     = jsonencode(local.trail_bucket_policy)
  depends_on = [aws_s3_bucket_public_access_block.trail]
}

resource "aws_cloudtrail" "account" {
  name                          = "${var.name}-account"
  s3_bucket_name                = aws_s3_bucket.trail.id
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  depends_on                    = [aws_s3_bucket_policy.trail]
}

# ── GuardDuty ─────────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_guardduty_detector" "this" {
  enable                       = true
  finding_publishing_frequency = "FIFTEEN_MINUTES"
}

# ── Paging ────────────────────────────────────────────────────────────────────────────────────────────────────
locals {
  topic_regions = toset([local.region, var.global_region])
}

resource "aws_sns_topic" "security" {
  for_each          = local.topic_regions
  region            = each.key
  name              = "${var.name}-security"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_policy" "security" {
  for_each = local.topic_regions
  region   = each.key
  arn      = aws_sns_topic.security[each.key].arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "EventBridgePublishes"
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.security[each.key].arn
      Condition = { StringEquals = { "aws:SourceAccount" = local.account } }
    }]
  })
}

resource "aws_sns_topic_subscription" "security" {
  for_each  = { for pair in setproduct(local.topic_regions, var.security_emails) : "${pair[0]}/${pair[1]}" => { region = pair[0], email = pair[1] } }
  region    = each.value.region
  topic_arn = aws_sns_topic.security[each.value.region].arn
  protocol  = "email"
  endpoint  = each.value.email
}

locals {
  rules = merge(
    { for k, p in local.regional_patterns : k => { region = local.region, pattern = p } },
    { for k, p in local.global_patterns : k => { region = var.global_region, pattern = p } },
  )
}

resource "aws_cloudwatch_event_rule" "security" {
  for_each      = local.rules
  region        = each.value.region
  name          = "${var.name}-security-${each.key}"
  description   = "Page: ${each.key} (account security, review P2-11)"
  event_pattern = jsonencode(each.value.pattern)
}

resource "aws_cloudwatch_event_target" "security" {
  for_each = local.rules
  region   = each.value.region
  rule     = aws_cloudwatch_event_rule.security[each.key].name
  arn      = aws_sns_topic.security[each.value.region].arn
}
