output "secrets_kms_key_arn" {
  value = aws_kms_key.secrets.arn
}

output "field_encryption_key_arn" {
  value = aws_kms_key.field.arn
}

output "field_encryption_key_alias" {
  value = aws_kms_alias.field.name
}

output "db_owner_secret_arn" {
  value = aws_secretsmanager_secret.db["owner"].arn
}

output "db_app_secret_arn" {
  value = aws_secretsmanager_secret.db["app"].arn
}

output "db_worker_secret_arn" {
  value = aws_secretsmanager_secret.db["worker"].arn
}

output "app_key_secret_arns" {
  description = "ENV_VAR_NAME => secret ARN of the application keys (generated here, or the DR replicas passed in)."
  value       = local.app_key_secret_arns
}

output "key_policy" {
  description = "Resource policy on the application keys (decoded), for tests."
  value       = jsondecode(local.key_policy)
}

output "protected_keys" {
  value = keys(aws_secretsmanager_secret.app_key_protected)
}

output "integration_secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.integration : k => s.arn }
}

output "app_key_replica_region" {
  description = "Region holding replicas of the irreplaceable application keys (null = none)."
  value       = var.replica_region
}

output "secret_readers" {
  description = "Principals allowed to read the keys and payment secrets."
  value       = local.readers
}
