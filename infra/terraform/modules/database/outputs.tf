output "engine" {
  value = var.engine
}

output "identifier" {
  description = "Aurora cluster identifier or RDS instance identifier."
  value       = local.identifier
}

output "arn" {
  description = "Cluster ARN (aurora) or instance ARN (rds) — what AWS Backup and restore drills target."
  value       = local.is_aurora ? aws_rds_cluster.this[0].arn : aws_db_instance.this[0].arn
}

output "writer_endpoint" {
  value = local.is_aurora ? aws_rds_cluster.this[0].endpoint : aws_db_instance.this[0].address
}

output "reader_endpoint" {
  value = local.is_aurora ? aws_rds_cluster.this[0].reader_endpoint : aws_db_instance.this[0].address
}

output "port" {
  value = 5432
}

output "database_name" {
  value = var.database_name
}

output "master_user_secret_arn" {
  description = "RDS-managed secret (keys: username, password). Used only by the role bootstrap task."
  value       = local.is_aurora ? aws_rds_cluster.this[0].master_user_secret[0].secret_arn : aws_db_instance.this[0].master_user_secret[0].secret_arn
}

output "kms_key_arn" {
  value = aws_kms_key.db.arn
}

output "subnet_group_name" {
  value = aws_db_subnet_group.this.name
}

output "instance_identifiers" {
  value = local.is_aurora ? aws_rds_cluster_instance.this[*].identifier : [local.identifier]
}

output "has_replicas" {
  value = local.is_aurora ? var.instance_count > 1 : var.multi_az
}
