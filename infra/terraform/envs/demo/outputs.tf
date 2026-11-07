output "public_base_url" {
  value = module.cell.public_base_url
}

output "effective_settings" {
  value = module.cell.effective_settings
}

output "deploy_config_parameter" {
  value = module.cell.deploy_config_parameter
}

output "ci_deploy_role_arn" {
  value = module.cell.ci_deploy_role_arn
}

output "repository_urls" {
  value = module.cell.repository_urls
}
