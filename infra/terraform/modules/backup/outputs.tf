output "primary_vault_arn" {
  value = aws_backup_vault.primary.arn
}

output "dr_vault_arn" {
  value = local.dr_enabled ? aws_backup_vault.dr[0].arn : null
}

output "plan_id" {
  value = aws_backup_plan.this.id
}
