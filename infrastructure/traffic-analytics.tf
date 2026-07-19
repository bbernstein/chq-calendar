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
