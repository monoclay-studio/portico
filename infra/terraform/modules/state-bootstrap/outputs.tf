output "bucket_name" {
  value = aws_s3_bucket.state.bucket
}

output "kms_key_arn" {
  value = aws_kms_key.state.arn
}

output "backend_config_example" {
  description = "Paste into envs/<env>/backend.hcl (one key per environment and cell)."
  value       = <<-EOT
    bucket         = "${aws_s3_bucket.state.bucket}"
    key            = "portico/<environment>/<cell>/terraform.tfstate"
    region         = "<region>"
    use_lockfile   = true
    kms_key_id     = "${aws_kms_key.state.arn}"
    encrypt        = true
  EOT
}
