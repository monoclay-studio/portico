# Object storage for one cell.
#
#   documents  guest/hotel documents (invoices, confirmations, ID images — the latter also field-encrypted by the
#              app). SSE-KMS, versioned, browser access ONLY through short-lived presigned URLs.
#   exports    tenant exports and reports; short-lived by design (expire after `exports_expiration_days`).
#   backups    application-level backups (tenant exports kept for recovery, migration snapshots, restore-drill
#              evidence). Object Lock (governance) where enabled: ordinary credentials cannot delete them; an admin
#              with the bypass permission can (alarmed by envs/bootstrap; compliance mode is an owner decision).
#   logs       S3 server-access and load-balancer access logs. SSE-S3, because those AWS log-delivery services
#              cannot write to SSE-KMS buckets.
#
# Every bucket: public access blocked, ACLs disabled (BucketOwnerEnforced), TLS-only, versioned, lifecycle rules.
# Data buckets additionally deny uploads that name a different KMS key or a non-KMS algorithm, and deny requests
# whose signature is older than `presigned_url_max_age_seconds` — that caps the real lifetime of any presigned URL
# regardless of the expiry the issuer asked for.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_elb_service_account" "this" {}

locals {
  root_arn = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"
  data_buckets = {
    documents = { object_lock_days = 0 }
    exports   = { object_lock_days = 0 }
    backups   = { object_lock_days = var.backups_object_lock_days }
  }
}

resource "aws_kms_key" "storage" {
  description             = "${var.name_prefix} object storage (documents, exports, backups)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AccountAdministration"
      Effect    = "Allow"
      Principal = { AWS = local.root_arn }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })
}

resource "aws_kms_alias" "storage" {
  name          = "alias/${var.name_prefix}-storage"
  target_key_id = aws_kms_key.storage.key_id
}

# ── Data buckets ──────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_s3_bucket" "data" {
  for_each            = local.data_buckets
  bucket              = "${var.bucket_prefix}-${each.key}"
  force_destroy       = var.force_destroy
  object_lock_enabled = each.value.object_lock_days > 0
}

resource "aws_s3_bucket_ownership_controls" "data" {
  for_each = aws_s3_bucket.data
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  for_each                = aws_s3_bucket.data
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "data" {
  for_each = aws_s3_bucket.data
  bucket   = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  for_each = aws_s3_bucket.data
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.storage.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_object_lock_configuration" "backups" {
  count  = var.backups_object_lock_days > 0 ? 1 : 0
  bucket = aws_s3_bucket.data["backups"].id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = var.backups_object_lock_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.data]
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.data["documents"].id
  rule {
    id     = "tiering-and-noncurrent-cleanup"
    status = "Enabled"
    filter {}
    transition {
      days          = var.documents_ia_transition_days
      storage_class = "STANDARD_IA"
    }
    noncurrent_version_expiration {
      noncurrent_days = var.documents_noncurrent_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
  depends_on = [aws_s3_bucket_versioning.data]
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.data["exports"].id
  rule {
    id     = "short-lived-exports"
    status = "Enabled"
    filter {}
    expiration {
      days = var.exports_expiration_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
  depends_on = [aws_s3_bucket_versioning.data]
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.data["backups"].id
  rule {
    id     = "archive-then-expire"
    status = "Enabled"
    filter {}
    transition {
      days          = var.backups_glacier_ir_days
      storage_class = "GLACIER_IR"
    }
    expiration {
      days = var.backups_expiration_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
  depends_on = [aws_s3_bucket_versioning.data]
}

resource "aws_s3_bucket_cors_configuration" "documents" {
  count  = length(var.cors_allowed_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.data["documents"].id
  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["content-type", "content-md5", "x-amz-*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 600
  }
}

data "aws_iam_policy_document" "data" {
  for_each = aws_s3_bucket.data

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [each.value.arn, "${each.value.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyStaleSignatures"
    effect    = "Deny"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${each.value.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "NumericGreaterThan"
      variable = "s3:signatureAge"
      values   = [tostring(var.presigned_url_max_age_seconds * 1000)]
    }
  }

  statement {
    sid       = "DenyNonKmsEncryption"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${each.value.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEqualsIfExists"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }

  statement {
    sid       = "DenyForeignKmsKey"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${each.value.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEqualsIfExists"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [aws_kms_key.storage.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "data" {
  for_each   = aws_s3_bucket.data
  bucket     = each.value.id
  policy     = data.aws_iam_policy_document.data[each.key].json
  depends_on = [aws_s3_bucket_public_access_block.data]
}

resource "aws_s3_bucket_logging" "data" {
  for_each      = aws_s3_bucket.data
  bucket        = each.value.id
  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "s3/${each.key}/"
}

# ── Logs bucket (SSE-S3) ──────────────────────────────────────────────────────────────────────────────────────
resource "aws_s3_bucket" "logs" {
  bucket        = "${var.bucket_prefix}-logs"
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "expire-logs"
    status = "Enabled"
    filter {}
    expiration {
      days = var.access_logs_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
  depends_on = [aws_s3_bucket_versioning.logs]
}

data "aws_iam_policy_document" "logs" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
  statement {
    sid       = "S3ServerAccessLogs"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/s3/*"]
    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
  statement {
    sid       = "AlbAccessLogs"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.this.arn]
    }
  }
  statement {
    sid       = "AlbAccessLogsServicePrincipal"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"]
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket     = aws_s3_bucket.logs.id
  policy     = data.aws_iam_policy_document.logs.json
  depends_on = [aws_s3_bucket_public_access_block.logs]
}
