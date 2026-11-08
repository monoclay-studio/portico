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
  description = "Names and safe values (never secret values) per container: env, secret names, DB secret, commands, ordering. Used by tests and the runbooks."
  value = {
    api = {
      environment = sort([for e in local.api_containers[2].environment : e.name])
      values      = { for e in local.api_containers[2].environment : e.name => e.value if contains(["NODE_ENV", "PORTICO_DEPLOYMENT", "PORTICO_PROCESS"], e.name) }
      secrets     = sort([for e in local.api_secrets : e.name])
      database    = var.db_app_secret_arn
      image_tag   = var.release_tag
    }
    worker = {
      environment = sort([for e in local.worker_containers[0].environment : e.name])
      values      = { for e in local.worker_containers[0].environment : e.name => e.value if contains(["NODE_ENV", "PORTICO_DEPLOYMENT", "PORTICO_PROCESS"], e.name) }
      secrets     = sort([for e in local.worker_secrets : e.name])
      database    = var.db_worker_secret_arn
      image_tag   = var.release_tag
    }
    api_task_containers = [for c in local.api_containers : {
      name       = c.name
      essential  = c.essential
      depends_on = [for d in lookup(c, "dependsOn", []) : "${d.containerName}:${d.condition}"]
      command    = c.command
      node_env   = one([for e in c.environment : e.value if e.name == "NODE_ENV"])
      secrets    = sort([for e in c.secrets : e.name])
    }]
    every_command       = concat([for c in local.api_containers : c.command], [for c in local.worker_containers : c.command])
    trusted_proxy_cidrs = var.trusted_proxy_cidrs
  }
}
