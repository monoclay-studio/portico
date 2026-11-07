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
  value = aws_secretsmanager_secret.db_owner.arn
}

output "db_app_secret_arn" {
  value = aws_secretsmanager_secret.db_app.arn
}

output "integration_secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.integration : k => s.arn }
}
