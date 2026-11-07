# Secrets and application keys for one cell.
#
# - `secrets` KMS key: encrypts every Secrets Manager secret of the cell, including the RDS-managed master secret.
# - `field-encryption` KMS key: envelope encryption of sensitive identity documents (CLAUDE.md §6). The app calls
#   GenerateDataKey/Decrypt with an encryption context; it never sees the key itself. (App side not built yet —
#   the variable contract is PORTICO_FIELD_KMS_KEY_ID; see infra/README.md "Findings".)
# - Database login secrets for portico_owner (migrations) and portico_app_blue/green (application). Initial
#   passwords are generated here and therefore exist in Terraform state (KMS-encrypted S3 state, restricted
#   access). Rotate both right after the first apply (docs/runbooks/database-roles.md) so the state copy is stale;
#   Terraform ignores later changes to the values. Upgrade path: Terraform >= 1.11 write-only attributes.
# - Integration placeholders (Stripe for Monoclay billing, Channex, operator token…): containers only, NO VALUES.
#   The owner adds values after authorization; tasks only receive them once `injected_integration_secrets` lists
#   them (ECS fails to start a task whose secret has no value).

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  root_arn = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"
}

data "aws_iam_policy_document" "key_admin" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.root_arn]
    }
  }
}

resource "aws_kms_key" "secrets" {
  description             = "${var.name_prefix} Secrets Manager secrets"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.key_admin.json
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${var.name_prefix}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

resource "aws_kms_key" "field" {
  description             = "${var.name_prefix} field-level envelope encryption (identity documents)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.key_admin.json
}

resource "aws_kms_alias" "field" {
  name          = "alias/${var.name_prefix}-field-encryption"
  target_key_id = aws_kms_key.field.key_id
}

# ── Database login secrets ────────────────────────────────────────────────────────────────────────────────────
# Alphanumeric only: values are embedded in postgres:// URLs without escaping. 40 chars ≈ 238 bits.
resource "random_password" "db" {
  for_each = toset(["owner", "app_blue", "app_green"])
  length   = 40
  special  = false
}

locals {
  base = "postgres://%s:%s@${var.db_host}:${var.db_port}/${var.db_name}?sslmode=verify-full"
  owner_secret = {
    engine   = "postgres"
    host     = var.db_host
    port     = var.db_port
    dbname   = var.db_name
    username = "portico_owner"
    password = random_password.db["owner"].result
    url      = format(local.base, "portico_owner", random_password.db["owner"].result)
  }
  app_secret = {
    engine           = "postgres"
    host             = var.db_host
    port             = var.db_port
    dbname           = var.db_name
    username         = "portico_app_blue"
    password         = random_password.db["app_blue"].result
    standby_username = "portico_app_green"
    standby_password = random_password.db["app_green"].result
    url              = format(local.base, "portico_app_blue", random_password.db["app_blue"].result)
  }
}

resource "aws_secretsmanager_secret" "db_owner" {
  name                    = "${var.secret_path}/db/owner"
  description             = "portico_owner login (migration task only). Keys: username, password, host, port, dbname, url."
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.recovery_window_days
}

resource "aws_secretsmanager_secret_version" "db_owner" {
  secret_id     = aws_secretsmanager_secret.db_owner.id
  secret_string = jsonencode(local.owner_secret)
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "db_app" {
  name                    = "${var.secret_path}/db/app"
  description             = "Application login (active + standby role for alternating rotation). ECS injects key `url` as APP_DATABASE_URL."
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.recovery_window_days
}

resource "aws_secretsmanager_secret_version" "db_app" {
  secret_id     = aws_secretsmanager_secret.db_app.id
  secret_string = jsonencode(local.app_secret)
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── Integration placeholders (no values, ever, in Terraform) ─────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "integration" {
  for_each                = var.integration_secrets
  name                    = "${var.secret_path}/integrations/${each.key}"
  description             = "PLACEHOLDER — ${each.value}. Value set manually by the owner after authorization; never stored in Terraform."
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.recovery_window_days
}
