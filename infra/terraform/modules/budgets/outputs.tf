output "budget_name" {
  value = aws_budgets_budget.monthly.name
}

output "stop_actions_enabled" {
  value = local.stop_enabled
}
