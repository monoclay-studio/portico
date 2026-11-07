output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "api_service_name" {
  value = "api"
}

output "worker_service_name" {
  value = "worker"
}

output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "alb_arn_suffix" {
  value = aws_lb.api.arn_suffix
}

output "target_group_arn_suffix" {
  value = aws_lb_target_group.api.arn_suffix
}

output "origin_fqdn" {
  value = var.origin_fqdn
}

output "task_role_arns" {
  value = { for k, r in aws_iam_role.task : k => r.arn }
}

output "execution_role_arns" {
  value = { for k, r in aws_iam_role.execution : k => r.arn }
}

output "task_definition_families" {
  value = {
    api          = aws_ecs_task_definition.api.family
    worker       = aws_ecs_task_definition.worker.family
    migrate      = aws_ecs_task_definition.migrate.family
    db_bootstrap = aws_ecs_task_definition.db_bootstrap.family
  }
}

output "deploy_config_parameter" {
  value = aws_ssm_parameter.deploy_config.name
}

output "runtime_contract" {
  description = "Names (never values) of the environment variables and injected secrets per container, plus the secret each DB URL comes from. Used by tests and the runbooks."
  value = {
    api = {
      environment = sort([for e in concat(local.base_environment, [{ name = "PORT" }, { name = "DB_POOL_MAX" }, { name = "CORS_ORIGINS" }, { name = "TRUSTED_PROXY_CIDRS" }]) : e.name])
      secrets     = sort([for e in local.api_secrets : e.name])
      database    = var.db_app_secret_arn
    }
    worker = {
      environment = sort([for e in local.base_environment : e.name])
      secrets     = sort([for e in local.worker_secrets : e.name])
      database    = var.db_worker_secret_arn
    }
    trusted_proxy_cidrs = var.trusted_proxy_cidrs
  }
}
