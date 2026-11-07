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
      protect     = true
    }
    blind-index-key = {
      env         = "PORTICO_BLIND_INDEX_KEY"
      description = "IRREPLACEABLE. Blind-index HMAC key (base64) for searchable encrypted fields. Distinct from the field key by construction."
      replicate   = true
      protect     = true
    }
    terms-seal-key = {
      env         = "PORTICO_TERMS_SEAL_KEY"
      description = "IRREPLACEABLE. HMAC key (base64) that seals agreed booking terms (rates). Changing it invalidates every sealed term."
      replicate   = true
      protect     = true
    }
    payments-simulator-signing-secret = {
      env         = "PAYMENTS_SIMULATOR_SIGNING_SECRET"
      description = "Signs payment-simulator webhooks (non-live organizations only). Shared by every api/worker task so a signature made by one verifies on another. Rotatable."
      replicate   = false
      protect     = false
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
# A DR cell passes `existing_app_key_secret_arns` (the replicas of the primary cell's keys) and generates only what
# is missing (the rotatable simulator secret) — new keys would make every encrypted field unreadable.
locals {
  existing      = var.existing_app_key_secret_arns == null ? {} : var.existing_app_key_secret_arns
  generated     = { for k, v in local.app_keys : k => v if !contains(keys(local.existing), v.env) }
  generated_raw = { for k, v in local.generated : k => v if !(var.protect_app_keys && v.protect) }
  generated_pro = { for k, v in local.generated : k => v if var.protect_app_keys && v.protect }
}

ephemeral "random_password" "app_key" {
  for_each = local.generated
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "app_key" {
  for_each                = local.generated_raw
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

# Production: identical, but Terraform refuses to destroy them (prevent_destroy cannot be conditional, hence the
# second resource) and a resource policy limits destruction and replacement to the break-glass role (below).
resource "aws_secretsmanager_secret" "app_key_protected" {
  for_each                = local.generated_pro
  name                    = "${var.secret_path}/app/${each.key}"
  description             = "${each.value.env}: ${each.value.description}"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 30

  dynamic "replica" {
    for_each = each.value.replicate && var.replica_region != null ? [var.replica_region] : []
    content {
      region = replica.value
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  app_key_secret_ids = merge(
    { for k, sec in aws_secretsmanager_secret.app_key : k => sec.id },
    { for k, sec in aws_secretsmanager_secret.app_key_protected : k => sec.id },
  )
  app_key_secret_arns = merge(
    { for k, sec in aws_secretsmanager_secret.app_key : local.app_keys[k].env => sec.arn },
    { for k, sec in aws_secretsmanager_secret.app_key_protected : local.app_keys[k].env => sec.arn },
    local.existing,
  )
}

resource "aws_secretsmanager_secret_version" "app_key" {
  for_each                 = local.generated
  secret_id                = local.app_key_secret_ids[each.key]
  secret_string_wo         = base64encode(ephemeral.random_password.app_key[each.key].result)
  secret_string_wo_version = 1 # NEVER bump for the irreplaceable keys: it would replace them (see header)
}

# ── Who may read or destroy the guest-money and encryption secrets (resource policies) ───────────────────────
# Invariant: no principal reachable from CI can read the application keys or the payment-provider keys. Only the
# api/worker execution roles (ECS injects the values at task start) and the break-glass role may call
# GetSecretValue; the deploy role has no Secrets Manager permission at all (modules/ci-deploy-role) and cannot pass
# these execution roles. Protected (production) secrets additionally refuse forced or short-window deletion and any
# replacement, re-staging, replica removal or policy change except by the break-glass role. The account root can
# still override a resource policy: CloudTrail alarms (envs/bootstrap) page on every such call.
locals {
  break_glass = length(var.key_admin_role_arns) > 0 ? var.key_admin_role_arns : ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/portico-key-break-glass"]
  # Terraform's own principal must stay a reader: refreshing a secret version calls GetSecretValue.
  terraform_principals = length(var.terraform_principal_arns) > 0 ? var.terraform_principal_arns : ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/portico-infra-admin"]
  readers              = concat(var.reader_role_arns, local.break_glass, local.terraform_principals)

  read_restriction = {
    Sid       = "OnlyExecutionRolesAndBreakGlassRead"
    Effect    = "Deny"
    Principal = "*"
    Action    = ["secretsmanager:GetSecretValue"]
    Resource  = "*"
    Condition = { ArnNotLike = { "aws:PrincipalArn" = local.readers } }
  }
  protection = [
    {
      Sid       = "NoForcedOrShortWindowDeletion"
      Effect    = "Deny"
      Principal = "*"
      Action    = ["secretsmanager:DeleteSecret"]
      Resource  = "*"
      Condition = { Bool = { "secretsmanager:ForceDeleteWithoutRecovery" = "true" } }
    },
    {
      Sid       = "NoShortRecoveryWindow"
      Effect    = "Deny"
      Principal = "*"
      Action    = ["secretsmanager:DeleteSecret"]
      Resource  = "*"
      Condition = { NumericLessThan = { "secretsmanager:RecoveryWindowInDays" = "30" } }
    },
    {
      Sid       = "OnlyBreakGlassReplacesOrDestroys"
      Effect    = "Deny"
      Principal = "*"
      Action = [
        "secretsmanager:DeleteSecret", "secretsmanager:PutSecretValue", "secretsmanager:UpdateSecret",
        "secretsmanager:UpdateSecretVersionStage", "secretsmanager:RotateSecret", "secretsmanager:CancelRotateSecret",
        "secretsmanager:RemoveRegionsFromReplication", "secretsmanager:StopReplicationToReplica",
        "secretsmanager:PutResourcePolicy", "secretsmanager:DeleteResourcePolicy",
      ]
      Resource  = "*"
      Condition = { ArnNotLike = { "aws:PrincipalArn" = local.break_glass } }
    },
  ]
  key_policy           = jsonencode({ Version = "2012-10-17", Statement = concat([local.read_restriction], local.protection) })
  key_policy_read_only = jsonencode({ Version = "2012-10-17", Statement = [local.read_restriction] })
}

resource "aws_secretsmanager_secret_policy" "app_key" {
  for_each   = local.generated
  secret_arn = local.app_key_secret_ids[each.key]
  policy     = contains(keys(local.generated_pro), each.key) ? local.key_policy : local.key_policy_read_only
  depends_on = [aws_secretsmanager_secret_version.app_key]
}

# ── Integration placeholders (no values, ever, in Terraform) ─────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "integration" {
  for_each                = var.integration_secrets
  name                    = "${var.secret_path}/integrations/${each.key}"
  description             = "PLACEHOLDER — ${each.value}. Value set manually by the owner after authorization; never stored in Terraform."
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = var.recovery_window_days
}

# Payment-provider keys move guest money: same read restriction as the application keys. (The owner still writes
# the value with PutSecretValue; reading it back is break-glass.)
resource "aws_secretsmanager_secret_policy" "integration" {
  for_each   = { for k, v in var.integration_secrets : k => v if startswith(k, "payments-") }
  secret_arn = aws_secretsmanager_secret.integration[each.key].arn
  policy     = jsonencode({ Version = "2012-10-17", Statement = [local.read_restriction] })
}
