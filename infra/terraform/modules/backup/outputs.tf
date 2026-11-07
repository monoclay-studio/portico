output "primary_vault_arn" {
  value = aws_backup_vault.primary.arn
}

output "dr_vault_arn" {
  value = local.dr_enabled ? aws_backup_vault.dr[0].arn : null
}

output "plan_id" {
  value = aws_backup_plan.this.id
}

output "missing_job_alarms" {
  value = { for k, a in aws_cloudwatch_metric_alarm.missing : k => { metric = a.metric_name, treat_missing_data = a.treat_missing_data, actions = a.alarm_actions } }
}
