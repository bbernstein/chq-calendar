# infrastructure/traffic-analytics.tf
#
# CloudFront traffic analytics (Phase A): standard logging v2 -> S3 (Parquet,
# partitioned) -> Glue table -> Athena named queries.
# Design: docs/superpowers/specs/2026-07-19-cloudfront-traffic-analytics-design.md

resource "random_id" "cf_logs_suffix" {
  byte_length = 4
}

# Private, ACL-disabled bucket for raw CloudFront logs (prefix cf/) and Athena
# query results (prefix athena-results/).
resource "aws_s3_bucket" "cf_logs" {
  bucket = "${var.app_name}-cf-logs-${random_id.cf_logs_suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "cf_logs" {
  bucket                  = aws_s3_bucket.cf_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ACLs fully disabled. Logging v2 delivers via bucket policy, not ACL.
resource "aws_s3_bucket_ownership_controls" "cf_logs" {
  bucket = aws_s3_bucket.cf_logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cf_logs" {
  bucket = aws_s3_bucket.cf_logs.id

  rule {
    id     = "expire-raw-logs"
    status = "Enabled"
    filter {
      prefix = "cf/"
    }
    expiration {
      days = 90
    }
  }

  rule {
    id     = "expire-athena-results"
    status = "Enabled"
    filter {
      prefix = "athena-results/"
    }
    expiration {
      days = 30
    }
  }
}

# Allow the CloudWatch Logs vended-logs delivery service to write logs under cf/.
# Scoped to this account + region delivery sources. The x-amz-acl condition is
# what the delivery service sends and is permitted under BucketOwnerEnforced.
resource "aws_s3_bucket_policy" "cf_logs" {
  bucket = aws_s3_bucket.cf_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AWSLogsDeliveryWrite"
        Effect    = "Allow"
        Principal = { Service = "delivery.logs.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.cf_logs.arn}/cf/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl"      = "bucket-owner-full-control"
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "aws:SourceArn" = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:delivery-source:*"
          }
        }
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.cf_logs]
}

# --- CloudFront standard logging v2 (vended-logs delivery) ---------------------

# One delivery source per distribution (CloudFront is global; managed in us-east-1).
resource "aws_cloudwatch_log_delivery_source" "cf_access" {
  name         = "${var.app_name}-cf-access-logs"
  log_type     = "ACCESS_LOGS"
  resource_arn = aws_cloudfront_distribution.frontend_distribution.arn
}

# Parquet output to the log bucket under the cf/ prefix. Using a prefix in the
# destination ARN suppresses CloudFront's default AWSLogs/<acct>/CloudFront/ path,
# giving the predictable base s3://<bucket>/cf/.
resource "aws_cloudwatch_log_delivery_destination" "cf_access_s3" {
  name          = "${var.app_name}-cf-access-logs-s3"
  output_format = "parquet"

  delivery_destination_configuration {
    destination_resource_arn = "${aws_s3_bucket.cf_logs.arn}/cf"
  }
}

# Field selection replaces legacy include_cookies. record_fields use AWS API field
# names (parenthesized); the Parquet columns become underscored (Task 3).
# cs(Cookie) is captured but empty today (no app cookies; IncludeCookies deferred).
resource "aws_cloudwatch_log_delivery" "cf_access" {
  delivery_source_name     = aws_cloudwatch_log_delivery_source.cf_access.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.cf_access_s3.arn

  record_fields = [
    "date",
    "time",
    "c-ip",
    "cs-method",
    "cs-uri-stem",
    "sc-status",
    "cs(Referer)",
    "cs(User-Agent)",
    "cs(Cookie)",
    "x-edge-result-type",
    "ssl-protocol",
    "ssl-cipher",
    "asn",
    "c-country",
  ]

  s3_delivery_configuration {
    suffix_path                 = "{yyyy}/{MM}/{dd}"
    enable_hive_compatible_path = true
  }

  depends_on = [aws_s3_bucket_policy.cf_logs]
}
