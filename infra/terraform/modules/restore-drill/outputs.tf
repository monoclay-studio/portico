output "task_definition_family" {
  value = aws_ecs_task_definition.drill["drill"].family
}

output "schedule_name" {
  value = aws_scheduler_schedule.this["drill"].name
}

output "alarms" {
  description = "Alarm wiring, for tests and runbooks."
  value = {
    stale = {
      name               = aws_cloudwatch_metric_alarm.stale.alarm_name
      metric             = aws_cloudwatch_metric_alarm.stale.metric_name
      treat_missing_data = aws_cloudwatch_metric_alarm.stale.treat_missing_data
      threshold          = aws_cloudwatch_metric_alarm.stale.threshold
      period             = aws_cloudwatch_metric_alarm.stale.period
      actions            = aws_cloudwatch_metric_alarm.stale.alarm_actions
    }
    failure_actions      = aws_cloudwatch_metric_alarm.failure.alarm_actions
    task_stopped_pattern = local.task_stopped_pattern
    task_stopped_target  = aws_cloudwatch_event_target.task_stopped.arn
    schedules            = { for k, v in aws_scheduler_schedule.this : k => { mode = local.schedules[k].mode, image = "${var.repository_url}:${var.image_tag}", public_ip = var.assign_public_ip } }
  }
}
