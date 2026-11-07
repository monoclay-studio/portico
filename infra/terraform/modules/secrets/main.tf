# Secrets and application keys for one cell.
#
# NO SECRET VALUE EVER ENTERS TERRAFORM STATE OR PLANS. Generated values come from `ephemeral` resources and are
# written through write-only attributes (`secret_string_wo`, Terraform >= 1.11): Terraform sends them to Secrets
# Manager once (version 1) and keeps neither the value nor a hash. Re-running `apply` never changes them; rotation
# is a runbook step outside Terraform (docs/runbooks/database-roles.md).
#
# - `secrets` KMS key: encrypts every Secrets Manager secret of the cell, including the RDS-managed master secret.
# - `field-encryption` KMS key: reserved for KMS envelope encryption of identity documents (kernel follow-up,
#   guests FOUNDATION_REQUESTS FR-3). The app does not call KMS yet; it reads the key material below.
# - Database logins: portico_owner (migrations), portico_app_blue/green (API), portico_worker_blue/green
#   (apps/worker; job-routing functions are granted to portico_worker only). Two logins per role allow
#   zero-downtime alternating rotation.
# - Application keys (kernel `fieldCryptoFromEnv`, rates `termsSealKeyFromEnv`, payments simulator). The first
#   three are IRREPLACEABLE: losing the field key makes every encrypted identity document unreadable; changing the
#   seal key invalidates every sealed booking term. They are never rotated by Terraform, deleted secrets stay
#   recoverable for `recovery_window_days`, and `replica_region` keeps a copy next to the cross-region backups.
# - Integration placeholders (Stripe Connect platform keys, Monoclay billing, Channex, operator token…): containers
#   only, NO VALUES. The owner adds values after authorization; tasks only receive them once
#   `injected_integration_secrets` lists them (ECS fails to start a task whose secret has no value).

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  root_arn = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"

  # name => what it is. env = the variable the application reads. All are generated, never typed by a person.
  app_keys = {
    field-key = {
      env         = "PORTICO_FIELD_KEY"
      description = "IRREPLACEABLE. Field-encryption key (base64) for identity documents, TOTP and SSO secrets. Never rotate without the kernel's key-rotation support."
      replicate   = true
    }
    blind-index-key = {
      env         = "PORTICO_BLIND_INDEX_KEY"
      description = "IRREPLACEABLE. Blind-index HMAC key (base64) for searchable encrypted fields. Distinct from the field key by construction."
      replicate   = true
    }
    terms-seal-key = {
      env         = "PORTICO_TERMS_SEAL_KEY"
      description = "IRREPLACEABLE. HMAC key (base64) that seals agreed booking terms (rates). Changing it invalidates every sealed term."
      replicate   = true
    }
    payments-simulator-signing-secret = {
      env         = "PAYMENTS_SIMULATOR_SIGNING_SECRET"
      description = "Signs payment-simulator webhooks (non-live organizations only). Shared by every api/worker task so a signature made by one verifies on another. Rotatable."
      replicate   = false
    }
  }
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
ephemeral "random_password" "db" {
  for_each = toset(["owner", "app_blue", "app_green", "worker_blue", "worker_green"])
  length   = 40
  special  = false
}

locals {
  base = "postgres://%s:%s@${var.db_host}:${var.db_port}/${var.db_name}?sslmode=verify-full"
  conn = { engine = "postgres", host = var.db_host, port = var.db_port, dbname = var.db_name }

  db_secret_descriptions = {
    owner  = "portico_owner login (migration task only). Keys: username, password, host, port, dbname, url."
    app    = "API login (active + standby role for alternating rotation). ECS injects key `url` as APP_DATABASE_URL into the api task."
    worker = "Worker login (portico_worker: app privileges + job-routing functions). ECS injects key `url` as APP_DATABASE_URL into the worker task."
  }
  # Ephemeral: only ever passed to write-only attributes.
  db_secret_values = {
    owner = merge(local.conn, {
      username = "portico_owner"
      password = ephemeral.random_password.db["owner"].result
      url      = format(local.base, "portico_owner", ephemeral.random_password.db["owner"].result)
    })
    app = merge(local.conn, {
      username         = "portico_app_blue"
      password         = ephemeral.random_password.db["app_blue"].result
      standby_username = "portico_app_green"
      standby_password = ephemeral.random_password.db["app_green"].result
      url              = format(local.base, "portico_app_blue", ephemeral.random_password.db["app_blue"].result)
    })
    worker = merge(local.conn, {
      username         = "portico_worker_blue"
      password         = ephemeral.random_password.db["worker_blue"].result
      standby_username = "portico_worker_green"
      standby_password = ephemeral.random_password.db["worker_green"].result
      url              = format(local.base, "portico_worker_blue", ephemeral.random_password.db["worker_blue"].result)
    })
  }
}

resource "aws_secretsmanager_secret" "db" {
  for_each                = local.db_secret_descriptions
  name                    = "${var.secret_path}/db/${each.key}"
  description             = each.value
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.recovery_window_days
}

resource "aws_secretsmanager_secret_version" "db" {
  for_each                 = local.db_secret_descriptions
  secret_id                = aws_secretsmanager_secret.db[each.key].id
  secret_string_wo         = jsonencode(local.db_secret_values[each.key])
  secret_string_wo_version = 1 # rotation happens outside Terraform (docs/runbooks/database-roles.md)
}

# ── Application keys ──────────────────────────────────────────────────────────────────────────────────────────
# Keys are base64 of 64 random alphanumeric characters (≈ 381 bits of entropy; canonical base64, 64 bytes decoded).
ephemeral "random_password" "app_key" {
  for_each = local.app_keys
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "app_key" {
  for_each                = local.app_keys
  name                    = "${var.secret_path}/app/${each.key}"
  description             = "${each.value.env}: ${each.value.description}"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.recovery_window_days

  dynamic "replica" {
    for_each = each.value.replicate && var.replica_region != null ? [var.replica_region] : []
    content {
      region = replica.value # AWS-managed key in the replica region; the region is a data-residency decision
    }
  }
}

resource "aws_secretsmanager_secret_version" "app_key" {
  for_each                 = local.app_keys
  secret_id                = aws_secretsmanager_secret.app_key[each.key].id
  secret_string_wo         = base64encode(ephemeral.random_password.app_key[each.key].result)
  secret_string_wo_version = 1 # NEVER bump for the irreplaceable keys: it would replace them (see header)
}

# ── Integration placeholders (no values, ever, in Terraform) ─────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "integration" {
  for_each                = var.integration_secrets
  name                    = "${var.secret_path}/integrations/${each.key}"
  description             = "PLACEHOLDER — ${each.value}. Value set manually by the owner after authorization; never stored in Terraform."
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.recovery_window_days
}
