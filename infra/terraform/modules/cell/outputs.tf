output "name_prefix" {
  value = local.name_prefix
}

output "tier" {
  value = var.tier
}

output "active" {
  value = var.active
}

output "effective_settings" {
  description = "Tier preset after overrides — what this cell actually runs."
  value = {
    az_count            = local.s.az_count
    nat_mode            = local.s.nat_mode
    interface_endpoints = local.s.interface_endpoints
    endpoint_az_count   = local.s.endpoint_az_count
    private_tasks       = local.private_tasks
    db                  = local.is_demo ? "postgres container on the demo host" : "${local.s.db_engine} ${local.s.db_instance_class} x${local.s.db_instance_count}${local.s.db_multi_az ? " multi-az" : ""}"
    db_backup_days      = local.s.db_backup_days
    waf_level           = local.s.waf_level
    aws_backup          = local.s.aws_backup
    api                 = local.s.api
    worker              = local.s.worker
    schedule            = local.schedule
  }
}

output "public_base_url" {
  value = one(module.edge[*].public_base_url)
}

output "deploy_config_parameter" {
  value = local.run_any ? "/portico/${local.name_prefix}/deploy-config" : null
}

output "ci_deploy_role_arn" {
  value = one(module.ci_deploy_role[*].role_arn)
}

output "repository_urls" {
  value = module.registry.repository_urls
}

output "nat_public_ips" {
  value = module.network.nat_public_ips
}

output "database_endpoint" {
  value = one(module.database[*].writer_endpoint)
}

output "oncall_topic_arn" {
  value = one(module.observability[*].oncall_topic_arn)
}

output "web_bucket_name" {
  value = one(module.edge[*].web_bucket_name)
}

output "distribution_id" {
  value = one(module.edge[*].distribution_id)
}

output "trusted_proxy_cidrs" {
  description = "TRUSTED_PROXY_CIDRS given to the API (ALB subnets + CloudFront origin-facing ranges; demo: CloudFront only)."
  value       = local.trusted_proxy_cidrs
}

output "runtime_contract" {
  description = "Environment and secret NAMES per container (managed tiers). No values."
  value       = one(module.compute[*].runtime_contract)
}

output "app_key_replica_region" {
  value = one(module.secrets[*].app_key_replica_region)
}

output "ci_deploy_policy" {
  description = "The deploy role's permissions (decoded)."
  value       = one(module.ci_deploy_role[*].policy)
}

output "secret_readers" {
  description = "Principals allowed to read the application keys and payment-provider secrets."
  value       = one(module.secrets[*].secret_readers)
}

output "protected_keys" {
  value = one(module.secrets[*].protected_keys)
}

output "key_policy" {
  description = "Resource policy on the protected application keys (decoded)."
  value       = one(module.secrets[*].key_policy)
}
