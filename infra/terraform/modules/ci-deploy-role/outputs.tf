output "role_arn" {
  description = "Set as the GitHub Environment variable AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.deploy.arn
}

output "policy" {
  description = "The deploy permissions (decoded), for tests and reviews."
  value       = local.deploy_policy
}

output "trust_policy" {
  description = "The OIDC trust policy (decoded), for tests and reviews."
  value       = local.trust_policy
}
