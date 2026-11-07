# Primary PostgreSQL 16 database for one cell. Two engines behind one interface:
#
#   engine = "aurora"  Aurora PostgreSQL (resilient tier). Storage is replicated six ways across three AZs; with
#                      instance_count >= 2 a reader in another AZ is promoted automatically on failure.
#   engine = "rds"     RDS for PostgreSQL (lean tier). Single-AZ by default (multi_az = true adds a synchronous
#                      standby as an online modification). Automated backups + PITR either way.
#
# Common guarantees: encrypted with a customer-managed KMS key; TLS enforced by parameter group (rds.force_ssl);
# point-in-time recovery; deletion protection; final snapshot on delete; Postgres logs exported to a log group
# with retention; master password managed by RDS in Secrets Manager (never in Terraform state); the
# application never uses the master user — see infra/db/bootstrap-roles.mjs and docs/runbooks/database-roles.md.
#
# Upgrading lean → resilient changes the engine (RDS → Aurora). That is a planned migration (Aurora read replica
# of the RDS instance, then promote; minutes of write downtime), not a variable flip. A resilient cell can instead
# use engine = "rds" with multi_az = true, which IS an online change — see infra/README.md.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  is_aurora     = var.engine == "aurora"
  is_rds        = var.engine == "rds"
  is_serverless = local.is_aurora && var.instance_class == "db.serverless"
  identifier    = "${var.name_prefix}-pg"
  log_group     = local.is_aurora ? "/aws/rds/cluster/${local.identifier}/postgresql" : "/aws/rds/instance/${local.identifier}/postgresql"
}

# ── Encryption key ────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_kms_key" "db" {
  description             = "${var.name_prefix} database storage, snapshots and Performance Insights"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms.json
}

data "aws_iam_policy_document" "kms" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
  # Cross-account restore drills / DR copies: the recovery account may use the key through grants only.
  dynamic "statement" {
    for_each = length(var.recovery_account_ids) > 0 ? [1] : []
    content {
      sid       = "RecoveryAccountUse"
      actions   = ["kms:Decrypt", "kms:DescribeKey", "kms:CreateGrant", "kms:ReEncrypt*", "kms:GenerateDataKey*"]
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = [for id in var.recovery_account_ids : "arn:${data.aws_partition.current.partition}:iam::${id}:root"]
      }
    }
  }
}

resource "aws_kms_alias" "db" {
  name          = "alias/${var.name_prefix}-db"
  target_key_id = aws_kms_key.db.key_id
}

resource "aws_db_subnet_group" "this" {
  name        = local.identifier
  description = "Isolated data subnets for ${var.name_prefix}"
  subnet_ids  = var.subnet_ids
}

# Pre-create the Postgres log group so retention and encryption apply (RDS would otherwise create it with
# "never expire").
resource "aws_cloudwatch_log_group" "postgres" {
  name              = local.log_group
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
}

# ── Parameters (shared values) ────────────────────────────────────────────────────────────────────────────────
locals {
  # Static parameters are applied at creation and on the next reboot; dynamic ones immediately.
  parameters = [
    { name = "rds.force_ssl", value = "1", apply_method = "pending-reboot" },
    { name = "ssl_min_protocol_version", value = "TLSv1.2", apply_method = "pending-reboot" },
    { name = "log_min_duration_statement", value = tostring(var.log_min_duration_ms), apply_method = "immediate" },
    { name = "log_lock_waits", value = "1", apply_method = "immediate" },
    # DDL is logged for audit. Role passwords are sent as SCRAM verifiers by the bootstrap job, so plaintext
    # passwords never reach these logs.
    { name = "log_statement", value = "ddl", apply_method = "immediate" },
    { name = "log_temp_files", value = "10240", apply_method = "immediate" },
    { name = "idle_in_transaction_session_timeout", value = "300000", apply_method = "immediate" },
  ]
}

# ── Aurora ────────────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_rds_cluster_parameter_group" "this" {
  count       = local.is_aurora ? 1 : 0
  name        = "${local.identifier}-aurora16"
  family      = "aurora-postgresql16"
  description = "Portico: TLS enforced, slow-query and DDL logging"
  dynamic "parameter" {
    for_each = local.parameters
    content {
      name         = parameter.value.name
      value        = parameter.value.value
      apply_method = parameter.value.apply_method
    }
  }
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_rds_cluster" "this" {
  count                               = local.is_aurora ? 1 : 0
  cluster_identifier                  = local.identifier
  engine                              = "aurora-postgresql"
  engine_mode                         = "provisioned"
  engine_version                      = var.engine_version
  database_name                       = var.database_name
  master_username                     = var.master_username
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = var.secrets_kms_key_arn
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [var.security_group_id]
  db_cluster_parameter_group_name     = aws_rds_cluster_parameter_group.this[0].name
  storage_encrypted                   = true
  kms_key_id                          = aws_kms_key.db.arn
  storage_type                        = var.aurora_io_optimized ? "aurora-iopt1" : null
  backup_retention_period             = var.backup_retention_days
  preferred_backup_window             = var.backup_window
  preferred_maintenance_window        = var.maintenance_window
  copy_tags_to_snapshot               = true
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = !var.final_snapshot
  final_snapshot_identifier           = var.final_snapshot ? "${local.identifier}-final" : null
  iam_database_authentication_enabled = var.iam_auth_enabled
  enabled_cloudwatch_logs_exports     = ["postgresql"]
  allow_major_version_upgrade         = false
  apply_immediately                   = var.apply_immediately

  dynamic "serverlessv2_scaling_configuration" {
    for_each = local.is_serverless ? [1] : []
    content {
      min_capacity             = var.serverless_min_acu
      max_capacity             = var.serverless_max_acu
      seconds_until_auto_pause = var.serverless_min_acu == 0 ? var.serverless_auto_pause_seconds : null
    }
  }

  depends_on = [aws_cloudwatch_log_group.postgres]
}

resource "aws_rds_cluster_instance" "this" {
  count                                 = local.is_aurora ? var.instance_count : 0
  identifier                            = "${local.identifier}-${count.index + 1}"
  cluster_identifier                    = aws_rds_cluster.this[0].id
  engine                                = aws_rds_cluster.this[0].engine
  engine_version                        = aws_rds_cluster.this[0].engine_version
  instance_class                        = var.instance_class
  availability_zone                     = var.availability_zones[count.index % length(var.availability_zones)]
  db_subnet_group_name                  = aws_db_subnet_group.this.name
  publicly_accessible                   = false
  auto_minor_version_upgrade            = false
  ca_cert_identifier                    = var.ca_cert_identifier
  promotion_tier                        = count.index == 0 ? 0 : 1
  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_kms_key_id       = var.performance_insights_enabled ? aws_kms_key.db.arn : null
  performance_insights_retention_period = var.performance_insights_enabled ? 7 : null
  monitoring_interval                   = var.enhanced_monitoring_interval
  monitoring_role_arn                   = var.enhanced_monitoring_interval > 0 ? aws_iam_role.monitoring[0].arn : null
  preferred_maintenance_window          = var.maintenance_window
  copy_tags_to_snapshot                 = true
  apply_immediately                     = var.apply_immediately
}

# ── RDS for PostgreSQL ────────────────────────────────────────────────────────────────────────────────────────
resource "aws_db_parameter_group" "this" {
  count       = local.is_rds ? 1 : 0
  name        = "${local.identifier}-postgres16"
  family      = "postgres16"
  description = "Portico: TLS enforced, slow-query and DDL logging"
  dynamic "parameter" {
    for_each = local.parameters
    content {
      name         = parameter.value.name
      value        = parameter.value.value
      apply_method = parameter.value.apply_method
    }
  }
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "this" {
  count                                 = local.is_rds ? 1 : 0
  identifier                            = local.identifier
  engine                                = "postgres"
  engine_version                        = var.engine_version
  instance_class                        = var.instance_class
  db_name                               = var.database_name
  username                              = var.master_username
  manage_master_user_password           = true
  master_user_secret_kms_key_id         = var.secrets_kms_key_arn
  multi_az                              = var.multi_az
  availability_zone                     = var.multi_az ? null : var.availability_zones[0]
  db_subnet_group_name                  = aws_db_subnet_group.this.name
  vpc_security_group_ids                = [var.security_group_id]
  parameter_group_name                  = aws_db_parameter_group.this[0].name
  publicly_accessible                   = false
  storage_type                          = "gp3"
  allocated_storage                     = var.allocated_storage_gb
  max_allocated_storage                 = var.max_allocated_storage_gb
  storage_encrypted                     = true
  kms_key_id                            = aws_kms_key.db.arn
  backup_retention_period               = var.backup_retention_days
  backup_window                         = var.backup_window
  maintenance_window                    = var.maintenance_window
  copy_tags_to_snapshot                 = true
  delete_automated_backups              = false
  deletion_protection                   = var.deletion_protection
  skip_final_snapshot                   = !var.final_snapshot
  final_snapshot_identifier             = var.final_snapshot ? "${local.identifier}-final" : null
  iam_database_authentication_enabled   = var.iam_auth_enabled
  enabled_cloudwatch_logs_exports       = ["postgresql"]
  auto_minor_version_upgrade            = false
  allow_major_version_upgrade           = false
  ca_cert_identifier                    = var.ca_cert_identifier
  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_kms_key_id       = var.performance_insights_enabled ? aws_kms_key.db.arn : null
  performance_insights_retention_period = var.performance_insights_enabled ? 7 : null
  monitoring_interval                   = var.enhanced_monitoring_interval
  monitoring_role_arn                   = var.enhanced_monitoring_interval > 0 ? aws_iam_role.monitoring[0].arn : null
  apply_immediately                     = var.apply_immediately

  depends_on = [aws_cloudwatch_log_group.postgres]
}

# ── Enhanced monitoring (optional; OS metrics every N seconds) ───────────────────────────────────────────────
data "aws_iam_policy_document" "monitoring_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  count              = var.enhanced_monitoring_interval > 0 ? 1 : 0
  name               = "${local.identifier}-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume.json
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  count      = var.enhanced_monitoring_interval > 0 ? 1 : 0
  role       = aws_iam_role.monitoring[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}
