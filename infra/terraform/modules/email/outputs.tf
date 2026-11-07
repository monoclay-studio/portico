output "identity_arn" {
  value = aws_sesv2_email_identity.domain.arn
}

output "configuration_set_name" {
  value = aws_sesv2_configuration_set.this.configuration_set_name
}

output "configuration_set_arn" {
  value = aws_sesv2_configuration_set.this.arn
}

output "dkim_tokens" {
  description = "Publish as <token>._domainkey CNAMEs when DNS is not in Route 53."
  value       = aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens
}
