output "log_group_names" {
  value = { for k, g in aws_cloudwatch_log_group.this : k => g.name }
}

output "log_group_arns" {
  value = { for k, g in aws_cloudwatch_log_group.this : k => g.arn }
}

output "logs_kms_key_arn" {
  value = aws_kms_key.logs.arn
}

output "oncall_topic_arn" {
  value = aws_sns_topic.oncall.arn
}

output "metric_namespace" {
  value = local.namespace
}

output "alarm_names" {
  value = concat([for a in aws_cloudwatch_metric_alarm.this : a.alarm_name], aws_cloudwatch_metric_alarm.api_5xx_rate[*].alarm_name)
}

output "oncall_publishers" {
  description = "Services allowed to publish to the on-call topic and use its key."
  value       = local.oncall_publishers
}
