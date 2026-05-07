terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.1"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Variables
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "jwt_secret" {
  description = "Secret key for JWT signing"
  type        = string
  sensitive   = true
}

variable "google_client_id" {
  description = "Google OAuth Client ID"
  type        = string
}

variable "google_client_secret" {
  description = "Google OAuth Client Secret"
  type        = string
  sensitive   = true
}

variable "admin_email_whitelist" {
  description = "Comma-separated list of admin emails"
  type        = string
}

variable "app_name" {
  description = "Application name"
  type        = string
  default     = "chautauqua-calendar"
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = "chqcal.org"
}

variable "recaptcha_secret_key" {
  description = "Google reCAPTCHA secret key for server-side verification"
  type        = string
  sensitive   = true
  default     = ""
}

variable "recaptcha_site_key" {
  description = "Google reCAPTCHA site key for client-side verification (public key)"
  type        = string
  default     = ""
}

# Post-deploy publisher-lifecycle smoke test secrets. Both default to empty
# so envs that don't run the smoke (local, staging, dev personal stacks)
# work unchanged — the corresponding backend code paths fall through to
# their normal behavior when the env var is empty.
#
# Production should set all three to the appropriate values. The signing
# key + bypass token should be high-entropy random (e.g. `openssl rand
# -hex 32`); the bbtest email is the dedicated smoke mailbox. Same values
# must be set as GitHub repo secrets:
#   - admin_smoke_signing_key   ↔ secrets.SMOKE_ADMIN_SIGNING_KEY
#   - captcha_bypass_token      ↔ secrets.SMOKE_CAPTCHA_BYPASS_TOKEN
#   - smoke_bbtest_email        ↔ secrets.SMOKE_BBTEST_EMAIL
# so deploy-production.yml can drive the smoke against the deployed stack.
variable "admin_smoke_signing_key" {
  description = "HS256 signing key for the post-deploy publisher-lifecycle smoke. Empty disables the smoke admin auth path."
  type        = string
  sensitive   = true
  default     = ""
}

variable "captcha_bypass_token" {
  description = "Bypass token for /publisher-apply/request CAPTCHA, sent via X-Smoke-Bypass header. Empty disables the bypass entirely."
  type        = string
  sensitive   = true
  default     = ""
}

variable "smoke_bbtest_email" {
  description = "Lambda-side gate for the smoke-only /smoke-reset-bbtest and /smoke-magic-token-by-email routes. Both routes refuse any request whose email body field does not match this value (defense-in-depth: a leaked admin_smoke_signing_key cannot mint actions for arbitrary emails). Empty disables both routes."
  type        = string
  sensitive   = true
  default     = ""
}

variable "cloudfront_cache_ttl" {
  description = "Default TTL (in seconds) for CloudFront cache behavior"
  type        = number
  default     = 3600 # 1 hour
}

# DynamoDB Tables
resource "aws_dynamodb_table" "events" {
  name         = "${var.app_name}-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "week"
    type = "N"
  }

  attribute {
    name = "startDate"
    type = "S"
  }

  attribute {
    name = "category"
    type = "S"
  }

  global_secondary_index {
    name            = "WeekIndex"
    projection_type = "ALL"
    key_schema {
      attribute_name = "week"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "startDate"
      key_type       = "RANGE"
    }
  }

  global_secondary_index {
    name            = "DateIndex"
    projection_type = "ALL"
    key_schema {
      attribute_name = "startDate"
      key_type       = "HASH"
    }
  }

  global_secondary_index {
    name            = "CategoryIndex"
    projection_type = "ALL"
    key_schema {
      attribute_name = "category"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "startDate"
      key_type       = "RANGE"
    }
  }

  tags = {
    Name        = "${var.app_name}-events"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "data_sources" {
  name         = "${var.app_name}-data-sources"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  tags = {
    Name        = "${var.app_name}-data-sources"
    Environment = var.environment
  }
}

# DynamoDB table for sync status tracking
resource "aws_dynamodb_table" "sync_status" {
  name         = "${var.app_name}-sync-status"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "type"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "N"
  }

  global_secondary_index {
    name            = "TypeIndex"
    projection_type = "ALL"
    key_schema {
      attribute_name = "type"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "timestamp"
      key_type       = "RANGE"
    }
  }

  tags = {
    Name        = "${var.app_name}-sync-status"
    Environment = var.environment
  }
}

# DynamoDB table for user feedback
resource "aws_dynamodb_table" "feedback" {
  name         = "${var.app_name}-feedback"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "N"
  }

  global_secondary_index {
    name            = "TimestampIndex"
    projection_type = "ALL"
    key_schema {
      attribute_name = "timestamp"
      key_type       = "HASH"
    }
  }

  tags = {
    Name        = "${var.app_name}-feedback"
    Environment = var.environment
  }
}

# Route 53 Hosted Zone
resource "aws_route53_zone" "main" {
  name = var.domain_name
}

# SSL Certificate
resource "aws_acm_certificate" "cert" {
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Certificate validation records
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.cert.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.main.zone_id
}

# Certificate validation
resource "aws_acm_certificate_validation" "cert_validation" {
  certificate_arn         = aws_acm_certificate.cert.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# S3 Bucket for Frontend
resource "aws_s3_bucket" "frontend_bucket" {
  bucket = "${var.app_name}-frontend-${var.environment}"

  # AWS provider v6 regression: the bucket read calls GetBucketTagging,
  # and a `NoSuchTagSet` response makes the provider treat the bucket as
  # deleted — causing `terraform plan` to propose recreating it. Declaring
  # at least one tag keeps the live tag set non-empty so the read succeeds.
  # See PR #94 for the diagnostic trail.
  tags = {
    Name        = "${var.app_name}-frontend-${var.environment}"
    Environment = var.environment
  }
}


resource "aws_s3_bucket_website_configuration" "frontend_website" {
  bucket = aws_s3_bucket.frontend_bucket.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "error.html"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend_pab" {
  bucket = aws_s3_bucket.frontend_bucket.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "frontend_bucket_policy" {
  bucket     = aws_s3_bucket.frontend_bucket.id
  depends_on = [aws_s3_bucket_public_access_block.frontend_pab]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend_bucket.arn}/*"
      },
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend_distribution.arn
          }
        }
      }
    ]
  })
}

# CloudFront Function for API path rewriting
resource "aws_cloudfront_function" "api_rewrite" {
  name    = "api-path-rewrite"
  runtime = "cloudfront-js-1.0"
  comment = "Rewrite /api/* paths to remove /api prefix"
  publish = true
  code    = file("${path.module}/cloudfront-function.js")
}

# CloudFront Function for redirecting non-www to www
resource "aws_cloudfront_function" "www_redirect" {
  name    = "www-redirect"
  runtime = "cloudfront-js-1.0"
  comment = "Redirect non-www domain to www"
  publish = true
  code    = file("${path.module}/cloudfront-redirect-function.js")
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "frontend_distribution" {
  origin {
    domain_name = aws_s3_bucket_website_configuration.frontend_website.website_endpoint
    origin_id   = "S3-${aws_s3_bucket.frontend_bucket.bucket}"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # API Gateway origin for backend API
  origin {
    domain_name = "${aws_api_gateway_rest_api.main.id}.execute-api.${var.aws_region}.amazonaws.com"
    origin_id   = "API-${aws_api_gateway_rest_api.main.id}"
    origin_path = "/${aws_api_gateway_stage.calendar_stage.stage_name}"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Admin API Gateway origin for OAuth and admin endpoints
  origin {
    domain_name = "${aws_api_gateway_rest_api.admin.id}.execute-api.${var.aws_region}.amazonaws.com"
    origin_id   = "ADMIN-API-${aws_api_gateway_rest_api.admin.id}"
    origin_path = "/${aws_api_gateway_stage.admin_stage.stage_name}"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # S3 Cache origin for serving cached calendar data
  origin {
    domain_name              = aws_s3_bucket.cache_bucket.bucket_regional_domain_name
    origin_id                = "S3-CACHE-${aws_s3_bucket.cache_bucket.bucket}"
    origin_access_control_id = aws_cloudfront_origin_access_control.cache_origin_access_control.id
  }

  # Frontend S3 REST API origin for direct file access (cache files)
  origin {
    domain_name              = aws_s3_bucket.frontend_bucket.bucket_regional_domain_name
    origin_id                = "S3-REST-${aws_s3_bucket.frontend_bucket.bucket}"
    origin_access_control_id = aws_cloudfront_origin_access_control.cache_origin_access_control.id
  }

  enabled             = true
  default_root_object = "index.html"
  aliases             = [var.domain_name, "www.${var.domain_name}"]

  # Publisher-portal endpoints — routed to the ADMIN API origin (where the
  # admin Lambda lives) rather than the main API. The main API only defines
  # /calendar, /feedback, /sync; the admin API has a {proxy+} catch-all that
  # forwards anything to admin_handler, which dispatches `/publisher-test`,
  # `/publisher-apply/*`, and `/publisher-auth/*` BEFORE its admin auth
  # check. The api_rewrite function strips `/api` so the admin API sees
  # `/publisher-test` etc.
  #
  # MUST come before the `/api/*` block so CloudFront picks this more-
  # specific pattern first.
  #
  # No caching: every request is dynamic (rate-limit state, magic-token
  # consumption, etc.).
  ordered_cache_behavior {
    path_pattern           = "/api/publisher-*"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    target_origin_id       = "ADMIN-API-${aws_api_gateway_rest_api.admin.id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = true
      # Authorization is forwarded in anticipation of Phase C authenticated
      # publisher endpoints (status page, feed management). The Phase A/B
      # routes are public — no auth header is sent today — but adding it now
      # avoids a broken-by-default Phase C deploy.
      headers = ["Authorization", "Content-Type"]
      cookies {
        forward = "none"
      }
    }

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_rewrite.arn
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # API behavior for /api/* paths with caching (Layer 2: CloudFront CDN)
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    target_origin_id       = "API-${aws_api_gateway_rest_api.main.id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type"]
      cookies {
        forward = "none"
      }
    }

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_rewrite.arn
    }

    # Enable caching for API responses (Layer 2: CloudFront CDN)
    min_ttl     = 0
    default_ttl = var.cloudfront_cache_ttl
    max_ttl     = 86400 # 24 hour max cache
  }

  # Cache behavior for S3 cached data at /cache/*
  # ordered_cache_behavior {
  #   path_pattern           = "/cache/*"
  #   allowed_methods        = ["GET", "HEAD", "OPTIONS"]
  #   cached_methods         = ["GET", "HEAD", "OPTIONS"]
  #   target_origin_id       = "S3-REST-${aws_s3_bucket.frontend_bucket.bucket}"
  #   compress               = true
  #   viewer_protocol_policy = "redirect-to-https"

  #   forwarded_values {
  #     query_string = false
  #     headers      = ["Origin", "Access-Control-Request-Headers", "Access-Control-Request-Method"]
  #     cookies {
  #       forward = "none"
  #     }
  #   }

  #   # Cache for 1 hour on edge and browser
  #   min_ttl     = 0
  #   default_ttl = 3600  # 1 hour
  #   max_ttl     = 3600  # 1 hour
  # }

  # Admin API behavior for /auth/* and /admin/* paths
  ordered_cache_behavior {
    path_pattern           = "/auth/*"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    target_origin_id       = "ADMIN-API-${aws_api_gateway_rest_api.admin.id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type"]
      cookies {
        forward = "none"
      }
    }

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_rewrite.arn
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  ordered_cache_behavior {
    path_pattern           = "/admin/api/*"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    target_origin_id       = "ADMIN-API-${aws_api_gateway_rest_api.admin.id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type", "X-Auth-Token"]
      cookies {
        forward = "none"
      }
    }

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_rewrite.arn
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.frontend_bucket.bucket}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_redirect.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cert_validation.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name        = "${var.app_name}-distribution"
    Environment = var.environment
  }
}

# CloudWatch Monitoring for CloudFront
# CloudFront automatically publishes metrics to CloudWatch, but we can add alarms

resource "aws_cloudwatch_metric_alarm" "cloudfront_error_rate" {
  alarm_name          = "${var.app_name}-cloudfront-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "4xxErrorRate"
  namespace           = "AWS/CloudFront"
  period              = "300"
  statistic           = "Average"
  threshold           = "5"
  alarm_description   = "This metric monitors CloudFront 4xx error rate"
  alarm_actions       = [] # Add SNS topic ARN here if you want notifications

  dimensions = {
    DistributionId = aws_cloudfront_distribution.frontend_distribution.id
  }

  tags = {
    Name        = "${var.app_name}-cloudfront-error-alarm"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "cloudfront_origin_latency" {
  alarm_name          = "${var.app_name}-cloudfront-origin-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "OriginLatency"
  namespace           = "AWS/CloudFront"
  period              = "300"
  statistic           = "Average"
  threshold           = "5000" # 5 seconds
  alarm_description   = "This metric monitors CloudFront origin latency"
  alarm_actions       = [] # Add SNS topic ARN here if you want notifications

  dimensions = {
    DistributionId = aws_cloudfront_distribution.frontend_distribution.id
  }

  tags = {
    Name        = "${var.app_name}-cloudfront-latency-alarm"
    Environment = var.environment
  }
}

# CloudWatch Dashboard for CloudFront monitoring
resource "aws_cloudwatch_dashboard" "cloudfront_dashboard" {
  dashboard_name = "${var.app_name}-cloudfront-monitoring"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", aws_cloudfront_distribution.frontend_distribution.id],
            [".", "BytesDownloaded", ".", "."],
            [".", "BytesUploaded", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          title   = "CloudFront Traffic"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/CloudFront", "4xxErrorRate", "DistributionId", aws_cloudfront_distribution.frontend_distribution.id],
            [".", "5xxErrorRate", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          title   = "CloudFront Error Rates"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/CloudFront", "CacheHitRate", "DistributionId", aws_cloudfront_distribution.frontend_distribution.id],
            [".", "OriginLatency", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          title   = "CloudFront Performance"
          period  = 300
        }
      }
    ]
  })
}

# IAM Role for Lambda
resource "aws_iam_role" "lambda_role" {
  name = "${var.app_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.lambda_role.name
}

# DynamoDB permissions for Lambda
resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "${var.app_name}-lambda-dynamodb-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem"
        ]
        Resource = [
          aws_dynamodb_table.events.arn,
          "${aws_dynamodb_table.events.arn}/index/*",
          aws_dynamodb_table.data_sources.arn,
          "${aws_dynamodb_table.data_sources.arn}/index/*",
          aws_dynamodb_table.sync_status.arn,
          "${aws_dynamodb_table.sync_status.arn}/index/*",
          aws_dynamodb_table.feedback.arn,
          "${aws_dynamodb_table.feedback.arn}/index/*"
        ]
      }
    ]
  })
}

# IAM policy for Lambda to access S3 cache bucket
resource "aws_iam_role_policy" "lambda_s3_cache" {
  name = "${var.app_name}-lambda-s3-cache-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.frontend_bucket.arn
      }
    ]
  })
}

# Dedicated IAM role for the admin Lambda. Split out from the shared
# `lambda_role` so admin-only privileges (publisher-portal access, the
# publisher-ingest invoke permission added for /admin/publishers/'s "Run
# ingest now" button, and admin-publisher table access) don't leak to the
# public calendar Lambda or the sync handlers — they only need to invoke
# from the admin function. The trust policy is identical to lambda_role.
resource "aws_iam_role" "admin_lambda_role" {
  name = "${var.app_name}-admin-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "admin_lambda_basic" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.admin_lambda_role.name
}

# Admin handler reads/writes the feedback table for the admin feedback
# dashboard. It does NOT use the events / data_sources / sync_status tables
# (those are only touched by the public calendar handler and the sync
# handlers), so we don't replicate the broader lambda_dynamodb policy.
resource "aws_iam_role_policy" "admin_lambda_feedback" {
  name = "${var.app_name}-admin-lambda-feedback-policy"
  role = aws_iam_role.admin_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem"
        ]
        Resource = [
          aws_dynamodb_table.feedback.arn,
          "${aws_dynamodb_table.feedback.arn}/index/*"
        ]
      }
    ]
  })
}

# IAM policy allowing the admin Lambda (and only the admin Lambda) to invoke
# the publisher-ingest Lambda. Used by the admin "Run ingest now" button on
# /admin/publishers/. Async (Event) invocation only — see
# POST /publishers/run-ingest in adminHandler.ts. Attached to admin_lambda_role
# rather than the shared lambda_role so the public calendar handler and the
# sync handlers (which share lambda_role) don't inherit invoke rights.
resource "aws_iam_role_policy" "lambda_invoke_publisher_ingest" {
  name = "${var.app_name}-lambda-invoke-publisher-ingest-policy"
  role = aws_iam_role.admin_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.publisher_ingest.arn
      }
    ]
  })
}

# Lambda Function for Calendar/Public endpoints
resource "aws_lambda_function" "calendar_generator" {
  filename      = "../backend/lambda-function.zip"
  function_name = "${var.app_name}-generator"
  role          = aws_iam_role.lambda_role.arn
  handler       = "dist/calendarHandler.handler"
  runtime       = "nodejs24.x"
  timeout       = 30
  memory_size   = 256

  environment {
    variables = {
      EVENTS_TABLE_NAME        = aws_dynamodb_table.events.name
      DATA_SOURCES_TABLE_NAME  = aws_dynamodb_table.data_sources.name
      SYNC_STATUS_TABLE_NAME   = aws_dynamodb_table.sync_status.name
      FEEDBACK_TABLE_NAME      = aws_dynamodb_table.feedback.name
      ENVIRONMENT              = var.environment
      USE_NEW_API              = "true"
      RECAPTCHA_SECRET_KEY     = var.recaptcha_secret_key
      CACHE_S3_BUCKET          = aws_s3_bucket.cache_bucket.bucket
      CACHE_MEMORY_TTL_MINUTES = "60"
      CACHE_S3_TTL_MINUTES     = "60"
      CACHE_S3_KEY_PREFIX      = "calendar-cache"
    }
  }
}

# Lambda Function for Admin/OAuth endpoints
resource "aws_lambda_function" "admin_handler" {
  filename      = "../backend/lambda-function.zip"
  function_name = "${var.app_name}-admin"
  role          = aws_iam_role.admin_lambda_role.arn
  handler       = "dist/adminHandler.handler"
  runtime       = "nodejs24.x"
  timeout       = 30
  memory_size   = 256

  environment {
    variables = {
      FEEDBACK_TABLE_NAME         = aws_dynamodb_table.feedback.name
      ENVIRONMENT                 = var.environment
      JWT_SECRET                  = var.jwt_secret
      GOOGLE_CLIENT_ID            = var.google_client_id
      GOOGLE_CLIENT_SECRET        = var.google_client_secret
      ADMIN_EMAIL_WHITELIST       = var.admin_email_whitelist
      ADMIN_API_URL               = "https://admin-api.${var.domain_name}"
      PUBLISHERS_TABLE_NAME       = aws_dynamodb_table.publishers.name
      PUBLISHER_EVENTS_TABLE_NAME = aws_dynamodb_table.publisher_events.name
      # Admin "Run ingest now" button on /admin/publishers/ async-invokes
      # this function via lambda:InvokeFunction.
      PUBLISHER_INGEST_FUNCTION_NAME = aws_lambda_function.publisher_ingest.function_name
      # Phase B publisher portal: magic-link apply + login flow.
      # Resources defined in publisher-portal.tf.
      PUBLISHER_JWT_SECRET_ARN         = aws_secretsmanager_secret.publisher_jwt_secret.arn
      PUBLISHER_MAGIC_TOKEN_TABLE_NAME = aws_dynamodb_table.publisher_magic_tokens.name
      SES_FROM_ADDRESS                 = "no-reply@${var.domain_name}"
      SITE_BASE_URL                    = "https://www.${var.domain_name}"
      # Phase D: DynamoDB-backed sliding-window rate limiter for the
      # publisher-test + apply/login endpoints. When unset (e.g. local
      # tests with no DDB), the handler falls back to an in-memory limiter.
      PUBLISHER_RATE_LIMIT_TABLE_NAME = aws_dynamodb_table.publisher_rate_limit.name
      # reCAPTCHA v3 secret for the publisher-apply form (and any future
      # captcha-gated endpoints on this Lambda). Same secret used by the
      # calendar Lambda for the public feedback form. When unset, the shared
      # captchaService fails closed in prod and is permissive in dev/test.
      RECAPTCHA_SECRET_KEY = var.recaptcha_secret_key
      # Post-deploy publisher-lifecycle smoke (scripts/smoke/...). All three
      # vars MUST be unset (or empty) outside production — when empty, the
      # backend code paths reject every smoke-bot token, ignore every bypass
      # header, and 403 the email-keyed smoke routes, so the smoke surface
      # is permanently inert.
      ADMIN_SMOKE_SIGNING_KEY = var.admin_smoke_signing_key
      CAPTCHA_BYPASS_TOKEN    = var.captcha_bypass_token
      SMOKE_BBTEST_EMAIL      = var.smoke_bbtest_email
    }
  }
}

# API Gateway for Calendar/Public endpoints
resource "aws_api_gateway_rest_api" "main" {
  name = "${var.app_name}-api"
}

# API Gateway for Admin endpoints
resource "aws_api_gateway_rest_api" "admin" {
  name = "${var.app_name}-admin-api"
}

resource "aws_api_gateway_resource" "calendar_resource" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "calendar"
}

resource "aws_api_gateway_method" "calendar_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.calendar_resource.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "calendar_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.calendar_resource.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "calendar_options" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.calendar_resource.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "calendar_get_integration" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.calendar_resource.id
  http_method = aws_api_gateway_method.calendar_get.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.calendar_generator.invoke_arn
}

resource "aws_api_gateway_integration" "calendar_integration" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.calendar_resource.id
  http_method = aws_api_gateway_method.calendar_post.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.calendar_generator.invoke_arn
}

resource "aws_api_gateway_integration" "calendar_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.calendar_resource.id
  http_method = aws_api_gateway_method.calendar_options.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.calendar_generator.invoke_arn
}

# Single event ICS endpoint: /calendar/events/{id}
resource "aws_api_gateway_resource" "calendar_events_resource" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.calendar_resource.id
  path_part   = "events"
}

resource "aws_api_gateway_resource" "calendar_event_id_resource" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.calendar_events_resource.id
  path_part   = "{id}"
}

resource "aws_api_gateway_method" "calendar_event_id_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.calendar_event_id_resource.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "calendar_event_id_options" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.calendar_event_id_resource.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "calendar_event_id_get_integration" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.calendar_event_id_resource.id
  http_method             = aws_api_gateway_method.calendar_event_id_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.calendar_generator.invoke_arn
}

resource "aws_api_gateway_integration" "calendar_event_id_options_integration" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.calendar_event_id_resource.id
  http_method             = aws_api_gateway_method.calendar_event_id_options.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.calendar_generator.invoke_arn
}

# Feedback API Gateway resources
resource "aws_api_gateway_resource" "feedback_resource" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "feedback"
}

resource "aws_api_gateway_method" "feedback_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.feedback_resource.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "feedback_options" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.feedback_resource.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "feedback_integration" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.feedback_resource.id
  http_method = aws_api_gateway_method.feedback_post.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.calendar_generator.invoke_arn
}

resource "aws_api_gateway_integration" "feedback_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.feedback_resource.id
  http_method = aws_api_gateway_method.feedback_options.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.calendar_generator.invoke_arn
}

# Admin API Gateway resources
# OAuth endpoints
resource "aws_api_gateway_resource" "auth_resource" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_rest_api.admin.root_resource_id
  path_part   = "auth"
}

resource "aws_api_gateway_resource" "auth_google_resource" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_resource.auth_resource.id
  path_part   = "google"
}

resource "aws_api_gateway_resource" "auth_google_callback_resource" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_resource.auth_google_resource.id
  path_part   = "callback"
}

# Admin feedback endpoints
resource "aws_api_gateway_resource" "admin_resource" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_rest_api.admin.root_resource_id
  path_part   = "admin"
}

resource "aws_api_gateway_resource" "admin_feedback_resource" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_resource.admin_resource.id
  path_part   = "feedback"
}

# OAuth methods
resource "aws_api_gateway_method" "auth_google_get" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.auth_google_resource.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "auth_google_callback_get" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.auth_google_callback_resource.id
  http_method   = "GET"
  authorization = "NONE"
}

# Admin feedback methods
resource "aws_api_gateway_method" "admin_feedback_get" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.admin_feedback_resource.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "admin_feedback_patch" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.admin_feedback_resource.id
  http_method   = "PATCH"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "admin_feedback_delete" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.admin_feedback_resource.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "admin_feedback_options" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.admin_feedback_resource.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

# OAuth integrations
resource "aws_api_gateway_integration" "auth_google_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.auth_google_resource.id
  http_method = aws_api_gateway_method.auth_google_get.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_api_gateway_integration" "auth_google_callback_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.auth_google_callback_resource.id
  http_method = aws_api_gateway_method.auth_google_callback_get.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

# Admin feedback integrations
resource "aws_api_gateway_integration" "admin_feedback_get_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.admin_feedback_resource.id
  http_method = aws_api_gateway_method.admin_feedback_get.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_api_gateway_integration" "admin_feedback_patch_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.admin_feedback_resource.id
  http_method = aws_api_gateway_method.admin_feedback_patch.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_api_gateway_integration" "admin_feedback_delete_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.admin_feedback_resource.id
  http_method = aws_api_gateway_method.admin_feedback_delete.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_api_gateway_integration" "admin_feedback_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.admin_feedback_resource.id
  http_method = aws_api_gateway_method.admin_feedback_options.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

# Bulk feedback operations
resource "aws_api_gateway_resource" "admin_feedback_bulk_resource" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_resource.admin_feedback_resource.id
  path_part   = "bulk"
}

resource "aws_api_gateway_method" "admin_feedback_bulk_patch" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.admin_feedback_bulk_resource.id
  http_method   = "PATCH"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "admin_feedback_bulk_options" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.admin_feedback_bulk_resource.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "admin_feedback_bulk_patch_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.admin_feedback_bulk_resource.id
  http_method = aws_api_gateway_method.admin_feedback_bulk_patch.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_api_gateway_integration" "admin_feedback_bulk_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.admin_feedback_bulk_resource.id
  http_method = aws_api_gateway_method.admin_feedback_bulk_options.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_lambda_permission" "api_gateway_lambda" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.calendar_generator.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "admin_api_gateway_lambda" {
  statement_id  = "AllowExecutionFromAdminAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.admin.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "calendar_deployment" {
  depends_on = [
    aws_api_gateway_integration.calendar_get_integration,
    aws_api_gateway_integration.calendar_integration,
    aws_api_gateway_integration.calendar_options_integration,
    aws_api_gateway_integration.calendar_event_id_get_integration,
    aws_api_gateway_integration.calendar_event_id_options_integration,
    aws_api_gateway_integration.feedback_integration,
    aws_api_gateway_integration.feedback_options_integration,
  ]

  rest_api_id = aws_api_gateway_rest_api.main.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.calendar_resource.id,
      aws_api_gateway_method.calendar_get.id,
      aws_api_gateway_method.calendar_post.id,
      aws_api_gateway_method.calendar_options.id,
      aws_api_gateway_integration.calendar_get_integration.id,
      aws_api_gateway_integration.calendar_integration.id,
      aws_api_gateway_integration.calendar_options_integration.id,
      aws_api_gateway_resource.calendar_events_resource.id,
      aws_api_gateway_resource.calendar_event_id_resource.id,
      aws_api_gateway_method.calendar_event_id_get.id,
      aws_api_gateway_method.calendar_event_id_options.id,
      aws_api_gateway_integration.calendar_event_id_get_integration.id,
      aws_api_gateway_integration.calendar_event_id_options_integration.id,
      aws_api_gateway_resource.feedback_resource.id,
      aws_api_gateway_method.feedback_post.id,
      aws_api_gateway_method.feedback_options.id,
      aws_api_gateway_integration.feedback_integration.id,
      aws_api_gateway_integration.feedback_options_integration.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Direct feedback resource for CloudFront /admin/api/feedback -> /feedback routing
resource "aws_api_gateway_resource" "direct_feedback_resource" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_rest_api.admin.root_resource_id
  path_part   = "feedback"
}

resource "aws_api_gateway_method" "direct_feedback_get" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.direct_feedback_resource.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "direct_feedback_patch" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.direct_feedback_resource.id
  http_method   = "PATCH"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "direct_feedback_delete" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.direct_feedback_resource.id
  http_method   = "DELETE"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "direct_feedback_options" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.direct_feedback_resource.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "direct_feedback_get_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.direct_feedback_resource.id
  http_method = aws_api_gateway_method.direct_feedback_get.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_api_gateway_integration" "direct_feedback_patch_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.direct_feedback_resource.id
  http_method = aws_api_gateway_method.direct_feedback_patch.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_api_gateway_integration" "direct_feedback_delete_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.direct_feedback_resource.id
  http_method = aws_api_gateway_method.direct_feedback_delete.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_api_gateway_integration" "direct_feedback_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.direct_feedback_resource.id
  http_method = aws_api_gateway_method.direct_feedback_options.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

# Direct bulk feedback operations for CloudFront /admin/api/feedback/bulk -> /feedback/bulk routing
resource "aws_api_gateway_resource" "direct_feedback_bulk_resource" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_resource.direct_feedback_resource.id
  path_part   = "bulk"
}

resource "aws_api_gateway_method" "direct_feedback_bulk_patch" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.direct_feedback_bulk_resource.id
  http_method   = "PATCH"
  authorization = "NONE"
}

resource "aws_api_gateway_method" "direct_feedback_bulk_options" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.direct_feedback_bulk_resource.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "direct_feedback_bulk_patch_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.direct_feedback_bulk_resource.id
  http_method = aws_api_gateway_method.direct_feedback_bulk_patch.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_api_gateway_integration" "direct_feedback_bulk_options_integration" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.direct_feedback_bulk_resource.id
  http_method = aws_api_gateway_method.direct_feedback_bulk_options.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

# Catch-all proxy for admin API. Routes any unmatched path (e.g. the publisher
# admin endpoints added in Plan 3) to the admin Lambda, which dispatches by
# event.path internally. More-specific resources (e.g. /feedback, /auth/*)
# take precedence under API Gateway's path-resolution rules.
resource "aws_api_gateway_resource" "admin_proxy" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  parent_id   = aws_api_gateway_rest_api.admin.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "admin_proxy_any" {
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  resource_id   = aws_api_gateway_resource.admin_proxy.id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "admin_proxy_any" {
  rest_api_id = aws_api_gateway_rest_api.admin.id
  resource_id = aws_api_gateway_resource.admin_proxy.id
  http_method = aws_api_gateway_method.admin_proxy_any.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.admin_handler.invoke_arn
}

resource "aws_api_gateway_deployment" "admin_deployment" {
  depends_on = [
    aws_api_gateway_integration.auth_google_integration,
    aws_api_gateway_integration.auth_google_callback_integration,
    aws_api_gateway_integration.admin_feedback_get_integration,
    aws_api_gateway_integration.admin_feedback_patch_integration,
    aws_api_gateway_integration.admin_feedback_delete_integration,
    aws_api_gateway_integration.admin_feedback_options_integration,
    aws_api_gateway_integration.admin_feedback_bulk_patch_integration,
    aws_api_gateway_integration.admin_feedback_bulk_options_integration,
    aws_api_gateway_integration.direct_feedback_get_integration,
    aws_api_gateway_integration.direct_feedback_patch_integration,
    aws_api_gateway_integration.direct_feedback_delete_integration,
    aws_api_gateway_integration.direct_feedback_options_integration,
    aws_api_gateway_integration.direct_feedback_bulk_patch_integration,
    aws_api_gateway_integration.direct_feedback_bulk_options_integration,
    aws_api_gateway_integration.admin_proxy_any,
  ]

  rest_api_id = aws_api_gateway_rest_api.admin.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.auth_resource.id,
      aws_api_gateway_resource.auth_google_resource.id,
      aws_api_gateway_resource.auth_google_callback_resource.id,
      aws_api_gateway_method.auth_google_get.id,
      aws_api_gateway_method.auth_google_callback_get.id,
      aws_api_gateway_integration.auth_google_integration.id,
      aws_api_gateway_integration.auth_google_callback_integration.id,
      aws_api_gateway_resource.admin_resource.id,
      aws_api_gateway_resource.admin_feedback_resource.id,
      aws_api_gateway_method.admin_feedback_get.id,
      aws_api_gateway_method.admin_feedback_patch.id,
      aws_api_gateway_method.admin_feedback_delete.id,
      aws_api_gateway_method.admin_feedback_options.id,
      aws_api_gateway_integration.admin_feedback_get_integration.id,
      aws_api_gateway_integration.admin_feedback_patch_integration.id,
      aws_api_gateway_integration.admin_feedback_delete_integration.id,
      aws_api_gateway_integration.admin_feedback_options_integration.id,
      aws_api_gateway_resource.admin_feedback_bulk_resource.id,
      aws_api_gateway_method.admin_feedback_bulk_patch.id,
      aws_api_gateway_method.admin_feedback_bulk_options.id,
      aws_api_gateway_integration.admin_feedback_bulk_patch_integration.id,
      aws_api_gateway_integration.admin_feedback_bulk_options_integration.id,
      aws_api_gateway_resource.direct_feedback_resource.id,
      aws_api_gateway_method.direct_feedback_get.id,
      aws_api_gateway_method.direct_feedback_patch.id,
      aws_api_gateway_method.direct_feedback_delete.id,
      aws_api_gateway_method.direct_feedback_options.id,
      aws_api_gateway_integration.direct_feedback_get_integration.id,
      aws_api_gateway_integration.direct_feedback_patch_integration.id,
      aws_api_gateway_integration.direct_feedback_delete_integration.id,
      aws_api_gateway_integration.direct_feedback_options_integration.id,
      aws_api_gateway_resource.direct_feedback_bulk_resource.id,
      aws_api_gateway_method.direct_feedback_bulk_patch.id,
      aws_api_gateway_method.direct_feedback_bulk_options.id,
      aws_api_gateway_integration.direct_feedback_bulk_patch_integration.id,
      aws_api_gateway_integration.direct_feedback_bulk_options_integration.id,
      aws_api_gateway_resource.admin_proxy.id,
      aws_api_gateway_method.admin_proxy_any.id,
      aws_api_gateway_integration.admin_proxy_any.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "calendar_stage" {
  deployment_id = aws_api_gateway_deployment.calendar_deployment.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  stage_name    = var.environment

  xray_tracing_enabled = true

  depends_on = [aws_api_gateway_account.main]

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.main_api_gateway_logs.arn
    format = jsonencode({
      requestId         = "$context.requestId"
      extendedRequestId = "$context.extendedRequestId"
      ip                = "$context.identity.sourceIp"
      caller            = "$context.identity.caller"
      user              = "$context.identity.user"
      requestTime       = "$context.requestTime"
      httpMethod        = "$context.httpMethod"
      resourcePath      = "$context.resourcePath"
      status            = "$context.status"
      protocol          = "$context.protocol"
      responseLength    = "$context.responseLength"
      error             = "$context.error.message"
      integrationError  = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_api_gateway_stage" "admin_stage" {
  deployment_id = aws_api_gateway_deployment.admin_deployment.id
  rest_api_id   = aws_api_gateway_rest_api.admin.id
  stage_name    = var.environment

  xray_tracing_enabled = true

  depends_on = [aws_api_gateway_account.main]

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.admin_api_gateway_logs.arn
    format = jsonencode({
      requestId         = "$context.requestId"
      extendedRequestId = "$context.extendedRequestId"
      ip                = "$context.identity.sourceIp"
      caller            = "$context.identity.caller"
      user              = "$context.identity.user"
      requestTime       = "$context.requestTime"
      httpMethod        = "$context.httpMethod"
      resourcePath      = "$context.resourcePath"
      status            = "$context.status"
      protocol          = "$context.protocol"
      responseLength    = "$context.responseLength"
      error             = "$context.error.message"
      integrationError  = "$context.integrationErrorMessage"
    })
  }
}

# IAM role for API Gateway CloudWatch logging
resource "aws_iam_role" "api_gateway_cloudwatch" {
  name = "${var.app_name}-api-gateway-cloudwatch-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "apigateway.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "api_gateway_cloudwatch" {
  name = "${var.app_name}-api-gateway-cloudwatch-policy"
  role = aws_iam_role.api_gateway_cloudwatch.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents",
          "logs:GetLogEvents",
          "logs:FilterLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

# API Gateway account configuration to enable CloudWatch logging
resource "aws_api_gateway_account" "main" {
  cloudwatch_role_arn = aws_iam_role.api_gateway_cloudwatch.arn

  depends_on = [aws_iam_role_policy.api_gateway_cloudwatch]
}

# CloudWatch Log Group for Main API Gateway
resource "aws_cloudwatch_log_group" "main_api_gateway_logs" {
  name              = "/aws/apigateway/${var.app_name}-main"
  retention_in_days = 7
}

# CloudWatch Log Group for Admin API Gateway
resource "aws_cloudwatch_log_group" "admin_api_gateway_logs" {
  name              = "/aws/apigateway/${var.app_name}-admin"
  retention_in_days = 7
}

# Route 53 DNS Records
resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend_distribution.domain_name
    zone_id                = aws_cloudfront_distribution.frontend_distribution.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "root" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend_distribution.domain_name
    zone_id                = aws_cloudfront_distribution.frontend_distribution.hosted_zone_id
    evaluate_target_health = false
  }
}

# Outputs
output "frontend_url" {
  value = "https://www.${var.domain_name}"
}

output "domain_name" {
  value = var.domain_name
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.frontend_distribution.domain_name
}

# CloudFront Origin Access Control for S3 cache bucket
resource "aws_cloudfront_origin_access_control" "cache_origin_access_control" {
  name                              = "${var.app_name}-cache-oac"
  description                       = "OAC for S3 cache bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# S3 bucket for caching calendar data (Layer 4: S3 File Cache)
resource "aws_s3_bucket" "cache_bucket" {
  bucket = "chautauqua-calendar-cache-${random_string.bucket_suffix.result}"
  tags = {
    Name        = "Chautauqua Calendar Cache"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_versioning" "cache_bucket_versioning" {
  bucket = aws_s3_bucket.cache_bucket.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cache_bucket_lifecycle" {
  bucket = aws_s3_bucket.cache_bucket.id

  rule {
    id     = "cache_cleanup"
    status = "Enabled"

    filter {
      prefix = "" # Apply to all objects
    }

    expiration {
      days = 7 # Delete cache files older than 7 days
    }

    noncurrent_version_expiration {
      noncurrent_days = 1 # Delete non-current versions after 1 day
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cache_bucket_encryption" {
  bucket = aws_s3_bucket.cache_bucket.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CORS configuration for S3 cache bucket
resource "aws_s3_bucket_cors_configuration" "cache_bucket_cors" {
  bucket = aws_s3_bucket.cache_bucket.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# S3 bucket policy for CloudFront Origin Access Control
resource "aws_s3_bucket_policy" "cache_bucket_policy" {
  bucket = aws_s3_bucket.cache_bucket.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.cache_bucket.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend_distribution.arn
          }
        }
      },
      {
        Sid    = "AllowCloudFrontListBucket"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.cache_bucket.arn
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend_distribution.arn
          }
        }
      }
    ]
  })
}

# Block public access to the cache bucket (only CloudFront should access it)
# Note: block_public_policy and restrict_public_buckets must be false for OAC
resource "aws_s3_bucket_public_access_block" "cache_bucket_pab" {
  bucket = aws_s3_bucket.cache_bucket.id

  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

# Random suffix to ensure bucket name uniqueness
resource "random_string" "bucket_suffix" {
  length  = 8
  special = false
  upper   = false
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend_distribution.id
}

output "cloudfront_dashboard_url" {
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.cloudfront_dashboard.dashboard_name}"
  description = "URL to CloudWatch dashboard for CloudFront monitoring"
}

output "name_servers" {
  value       = aws_route53_zone.main.name_servers
  description = "Name servers for the domain - configure these with your domain registrar"
}

output "api_url" {
  value = "https://${aws_api_gateway_rest_api.main.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_api_gateway_stage.calendar_stage.stage_name}"
}

output "admin_api_url" {
  value = "https://${aws_api_gateway_rest_api.admin.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_api_gateway_stage.admin_stage.stage_name}"
}

output "s3_bucket_name" {
  value = aws_s3_bucket.frontend_bucket.bucket
}

output "cache_s3_bucket_name" {
  value       = aws_s3_bucket.cache_bucket.bucket
  description = "S3 bucket name for calendar caching"
}
