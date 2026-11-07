output "task_definition_family" {
  value = aws_ecs_task_definition.drill.family
}

output "schedule_name" {
  value = aws_scheduler_schedule.monthly.name
}
