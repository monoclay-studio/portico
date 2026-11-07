output "instance_id" {
  value = aws_instance.host.id
}

output "instance_arn" {
  value = aws_instance.host.arn
}

output "public_dns" {
  description = "Origin hostname for CloudFront (the Elastic IP's public DNS name)."
  value       = aws_eip.host.public_dns
}

output "scheduler_role_arn" {
  description = "Role the start schedule uses; budget actions attach a deny policy to it to keep the host stopped."
  value       = var.schedule == null ? null : aws_iam_role.scheduler[0].arn
}

output "scheduler_role_name" {
  value = var.schedule == null ? null : aws_iam_role.scheduler[0].name
}

output "deploy_config_parameter" {
  value = aws_ssm_parameter.deploy_config.name
}

output "deploy_document_arn" {
  value = aws_ssm_document.deploy.arn
}
