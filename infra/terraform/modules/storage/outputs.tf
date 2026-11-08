output "kms_key_arn" {
  value = aws_kms_key.storage.arn
}

output "bucket_names" {
  value = merge({ for k, b in aws_s3_bucket.data : k => b.bucket }, { logs = aws_s3_bucket.logs.bucket })
}

output "bucket_arns" {
  value = merge({ for k, b in aws_s3_bucket.data : k => b.arn }, { logs = aws_s3_bucket.logs.arn })
}

output "logs_bucket_name" {
  value = aws_s3_bucket.logs.bucket
}
