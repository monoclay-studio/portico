output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "public_base_url" {
  value = "https://${length(var.aliases) > 0 ? var.aliases[0] : aws_cloudfront_distribution.this.domain_name}"
}

output "web_bucket_name" {
  value = aws_s3_bucket.web.id
}

output "web_acl_arn" {
  value = local.waf_enabled ? aws_wafv2_web_acl.this[0].arn : null
}
