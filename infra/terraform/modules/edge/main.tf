# Edge for one cell: a single CloudFront distribution that
#   - serves the web apps (backoffice SPA today; staff PWA / guest later) from a private S3 bucket via Origin Access
#     Control, with SPA routing done by a CloudFront Function (NOT custom error pages, which would also turn API
#     404/403 responses into index.html);
#   - proxies /v1/* and /health/* to the cell's origin (ALB over HTTPS, or the demo host over HTTP), uncached, with
#     a secret X-Origin-Verify header the origin requires;
#   - optionally sits behind AWS WAF (managed rule groups + rate limits);
#   - optionally answers on custom hostnames (ACM certificate in us-east-1 + Route 53 aliases).
# Same-origin API calls mean the SPA needs no CORS in the browser.
#
# CloudFront-scoped WAF and certificates must live in us-east-1; with AWS provider v6 that is expressed with the
# per-resource `region` argument instead of a second provider configuration.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  custom_domain = length(var.aliases) > 0
  waf_enabled   = var.waf_level != "none"
  api_origin_id = "api-origin"
  web_origin_id = "web-bucket"

  # AWS managed policies (IDs are global constants published by AWS).
  cache_policy_disabled             = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  cache_policy_optimized            = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  origin_request_all_viewer_no_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
}

# ── Web bucket (static assets are public by nature; SSE-S3 keeps OAC simple) ─────────────────────────────────
resource "aws_s3_bucket" "web" {
  bucket        = "${var.bucket_prefix}-web"
  force_destroy = true
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    id     = "old-builds"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
  depends_on = [aws_s3_bucket_versioning.web]
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name_prefix}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "web" {
  statement {
    sid       = "CloudFrontReadOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.web.arn, "${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket     = aws_s3_bucket.web.id
  policy     = data.aws_iam_policy_document.web.json
  depends_on = [aws_s3_bucket_public_access_block.web]
}

# ── SPA routing + security headers ───────────────────────────────────────────────────────────────────────────
resource "aws_cloudfront_function" "spa_routing" {
  name    = "${var.name_prefix}-spa-routing"
  runtime = "cloudfront-js-2.0"
  comment = "Serve index.html for client-side routes (paths without a file extension)."
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      if (request.uri.indexOf('.') === -1) {
        request.uri = '/index.html';
      }
      return request;
    }
  JS
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${var.name_prefix}-security-headers"
  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    content_security_policy {
      content_security_policy = var.content_security_policy
      override                = false
    }
  }
}

# ── Certificate (us-east-1) ───────────────────────────────────────────────────────────────────────────────────
resource "aws_acm_certificate" "this" {
  count                     = local.custom_domain ? 1 : 0
  region                    = "us-east-1"
  domain_name               = var.aliases[0]
  subject_alternative_names = slice(var.aliases, 1, length(var.aliases))
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

# Keyed by the configured hostnames (known at plan time); record details come from the certificate at apply time.
locals {
  dvo = local.custom_domain ? { for o in aws_acm_certificate.this[0].domain_validation_options : o.domain_name => o } : {}
}

resource "aws_route53_record" "validation" {
  for_each        = toset(var.aliases)
  zone_id         = var.route53_zone_id
  name            = local.dvo[each.key].resource_record_name
  type            = local.dvo[each.key].resource_record_type
  records         = [local.dvo[each.key].resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count                   = local.custom_domain ? 1 : 0
  region                  = "us-east-1"
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

# ── Distribution ──────────────────────────────────────────────────────────────────────────────────────────────
resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  comment             = "${var.name_prefix} web apps + API"
  price_class         = var.price_class
  aliases             = var.aliases
  default_root_object = "index.html"
  web_acl_id          = local.waf_enabled ? aws_wafv2_web_acl.this[0].arn : null

  origin {
    origin_id                = local.web_origin_id
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = local.api_origin_id
    domain_name = var.origin_domain_name
    custom_origin_config {
      origin_protocol_policy   = var.origin_protocol
      http_port                = var.origin_http_port
      https_port               = 443
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
    custom_header {
      name  = "X-Origin-Verify"
      value = var.origin_verify_secret
    }
  }

  default_cache_behavior {
    target_origin_id           = local.web_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_optimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_routing.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = ["/v1/*", "/health/*"]
    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = local.api_origin_id
      viewer_protocol_policy     = "https-only"
      allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = local.cache_policy_disabled
      origin_request_policy_id   = local.origin_request_all_viewer_no_host
      response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.custom_domain ? null : true
    acm_certificate_arn            = local.custom_domain ? aws_acm_certificate_validation.this[0].certificate_arn : null
    ssl_support_method             = local.custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.custom_domain ? "TLSv1.2_2021" : "TLSv1"
  }
}

resource "aws_route53_record" "alias" {
  for_each = local.custom_domain ? { for pair in setproduct(var.aliases, ["A", "AAAA"]) : "${pair[0]}-${pair[1]}" => { name = pair[0], type = pair[1] } } : {}
  zone_id  = var.route53_zone_id
  name     = each.value.name
  type     = each.value.type
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}
