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

  # AWS provider v6 regression: an untagged bucket returns NoSuchTagSet on the
  # GetBucketTagging read, which the provider misreads as "bucket deleted" and
  # then proposes recreating it. At least one tag keeps the tag set non-empty so
  # the read succeeds. Mirrors the frontend/cache buckets in main.tf (see PR #94).
  tags = {
    Name        = "${var.app_name}-cf-logs"
    Environment = var.environment
  }
}

# Explicit SSE-S3, matching the cache bucket convention (main.tf). This bucket
# holds raw client IPs + user-agents for 90 days, so encryption-at-rest is
# declared here rather than relying on the account-level default.
resource "aws_s3_bucket_server_side_encryption_configuration" "cf_logs" {
  bucket = aws_s3_bucket.cf_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
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
            "aws:SourceArn" = aws_cloudwatch_log_delivery_source.cf_access.arn
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

# --- Glue catalog: schema over the Parquet logs -------------------------------

resource "aws_glue_catalog_database" "cf_logs" {
  name = "chq_cloudfront_logs"
}

resource "aws_glue_catalog_table" "cf_logs" {
  name          = "access_logs"
  database_name = aws_glue_catalog_database.cf_logs.name
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL       = "TRUE"
    classification = "parquet"
    # Match Parquet columns by NAME, not position, so the record_fields order
    # (delivery) and this columns block can't silently misalign on a future edit.
    # Athena's Parquet name-matching is case-insensitive, so our lowercase Glue
    # names resolve the mixed-case Parquet names (cs_User_Agent, cs_Referer,
    # cs_Cookie). Verified against live delivered data.
    "parquet.column.index.access" = "false"
    "projection.enabled"          = "true"
    "projection.year.type"        = "integer"
    "projection.year.range"       = "2026,2035"
    "projection.month.type"       = "integer"
    "projection.month.range"      = "1,12"
    "projection.month.digits"     = "2"
    "projection.day.type"         = "integer"
    "projection.day.range"        = "1,31"
    "projection.day.digits"       = "2"
    "storage.location.template"   = "s3://${aws_s3_bucket.cf_logs.bucket}/cf/year=$${year}/month=$${month}/day=$${day}"
  }

  partition_keys {
    name = "year"
    type = "int"
  }
  partition_keys {
    name = "month"
    type = "int"
  }
  partition_keys {
    name = "day"
    type = "int"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.cf_logs.bucket}/cf/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    columns {
      name = "date"
      type = "string"
    }
    columns {
      name = "time"
      type = "string"
    }
    columns {
      name = "c_ip"
      type = "string"
    }
    columns {
      name = "cs_method"
      type = "string"
    }
    columns {
      name = "cs_uri_stem"
      type = "string"
    }
    columns {
      name = "sc_status"
      type = "string"
    }
    columns {
      name = "cs_referer"
      type = "string"
    }
    columns {
      name = "cs_user_agent"
      type = "string"
    }
    columns {
      name = "cs_cookie"
      type = "string"
    }
    columns {
      name = "x_edge_result_type"
      type = "string"
    }
    columns {
      name = "ssl_protocol"
      type = "string"
    }
    columns {
      name = "ssl_cipher"
      type = "string"
    }
    columns {
      name = "asn"
      type = "string"
    }
    columns {
      name = "c_country"
      type = "string"
    }
  }
}

# --- Shared SQL fragments (DRY'd across the 12 named queries below) -----------
#
# Optional bot filter: every content query below may have the following added
# after its WHERE predicate (uncomment/paste in the Athena console):
#   AND NOT regexp_like(cs_user_agent, '(?i)bot|spider|crawl|slurp|preview|monitor')
locals {
  # Boolean predicate placed after WHERE in every content query.
  cf_content_predicate = <<-SQL
    cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
  SQL

  # SQL expression: per-visitor hash key (client IP + user-agent).
  cf_visitor_key = "lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent))))"
}

# --- Athena workgroup + saved queries -----------------------------------------

resource "aws_athena_workgroup" "traffic" {
  name          = "${var.app_name}-traffic"
  force_destroy = true

  configuration {
    enforce_workgroup_configuration = true
    result_configuration {
      output_location = "s3://${aws_s3_bucket.cf_logs.bucket}/athena-results/"
    }
  }
}

output "traffic_analytics_athena_url" {
  # NOTE: output "description" must be a compile-time literal (no var/resource
  # interpolation allowed by Terraform) — select the workgroup named
  # aws_athena_workgroup.traffic.name (i.e. "<app_name>-traffic") in the console.
  description = "Athena console query editor. Select the \"<app_name>-traffic\" workgroup (aws_athena_workgroup.traffic.name) before running a named query."
  value       = "https://${var.aws_region}.console.aws.amazon.com/athena/home?region=${var.aws_region}#/query-editor"
}

# 01 — Pageviews by day, split into page loads vs. data pulls.
# COST NOTE: these one-click queries intentionally do NOT filter on the
# year/month/day partition columns, so they scan the full retention window.
# That is negligible at this volume, but to bound cost on a large/growing
# dataset add a partition predicate in the console, e.g.:
#   WHERE year = 2026 AND month = 7    -- prunes via partition projection
# See docs/runbooks/traffic-analytics.md ("Cost & retention").
resource "aws_athena_named_query" "pageviews_by_day" {
  name      = "01 - Pageviews by day (split by object)"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    -- Optional bot filter: add
    --   AND NOT regexp_like(cs_user_agent, '(?i)bot|spider|crawl|slurp|preview|monitor')
    SELECT
      "date" AS day,
      CASE WHEN cs_uri_stem LIKE '/cache/calendar-cache/%.json'
           THEN 'data-pull' ELSE 'page-load' END AS object_class,
      COUNT(*) AS pageviews
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate}
    GROUP BY 1, 2
    ORDER BY day DESC, object_class;
  SQL
}

# 02 — Pageviews by ISO week, split by object class.
resource "aws_athena_named_query" "pageviews_by_week" {
  name      = "02 - Pageviews by week (split by object)"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    SELECT
      date_trunc('week', date_parse("date", '%Y-%m-%d')) AS week_start,
      CASE WHEN cs_uri_stem LIKE '/cache/calendar-cache/%.json'
           THEN 'data-pull' ELSE 'page-load' END AS object_class,
      COUNT(*) AS pageviews
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate}
    GROUP BY 1, 2
    ORDER BY week_start DESC, object_class;
  SQL
}

# 03 — Active visits by day = distinct (visitor, hour) pairs. The <=1/hr/browser proxy.
resource "aws_athena_named_query" "active_visits_by_day" {
  name      = "03 - Active visits by day (visitor-hour)"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    SELECT
      "date" AS day,
      COUNT(DISTINCT
        ${local.cf_visitor_key} || '#' || substr("time",1,2)
      ) AS active_visits
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate}
    GROUP BY 1
    ORDER BY day DESC;
  SQL
}

# 04 — Active visits by week = distinct (visitor, day, hour).
resource "aws_athena_named_query" "active_visits_by_week" {
  name      = "04 - Active visits by week (visitor-hour)"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    SELECT
      date_trunc('week', date_parse("date", '%Y-%m-%d')) AS week_start,
      COUNT(DISTINCT
        ${local.cf_visitor_key} || '#' || "date" || substr("time",1,2)
      ) AS active_visits
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate}
    GROUP BY 1
    ORDER BY week_start DESC;
  SQL
}

# 05 — Unique visitors by day.
resource "aws_athena_named_query" "unique_visitors_by_day" {
  name      = "05 - Unique visitors by day"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    SELECT
      "date" AS day,
      COUNT(DISTINCT ${local.cf_visitor_key}) AS unique_visitors
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate}
    GROUP BY 1
    ORDER BY day DESC;
  SQL
}

# 06 — Unique visitors by week.
resource "aws_athena_named_query" "unique_visitors_by_week" {
  name      = "06 - Unique visitors by week"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    SELECT
      date_trunc('week', date_parse("date", '%Y-%m-%d')) AS week_start,
      COUNT(DISTINCT ${local.cf_visitor_key}) AS unique_visitors
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate}
    GROUP BY 1
    ORDER BY week_start DESC;
  SQL
}

# 07 — Unique visitors season-to-date (single number).
resource "aws_athena_named_query" "unique_visitors_season" {
  name      = "07 - Unique visitors season-to-date"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    SELECT
      COUNT(DISTINCT ${local.cf_visitor_key}) AS unique_visitors_season
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate};
  SQL
}

# 08 — New vs returning by day (returning = visitor seen on an earlier date).
resource "aws_athena_named_query" "new_vs_returning_by_day" {
  name      = "08 - New vs returning by day"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    WITH visits AS (
      SELECT DISTINCT
        ${local.cf_visitor_key} AS visitor_key,
        "date" AS day
      FROM chq_cloudfront_logs.access_logs
      WHERE ${local.cf_content_predicate}
    ),
    first_seen AS (
      SELECT visitor_key, MIN(day) AS first_day FROM visits GROUP BY visitor_key
    )
    SELECT
      v.day,
      COUNT_IF(v.day = f.first_day) AS new_visitors,
      COUNT_IF(v.day > f.first_day) AS returning_visitors
    FROM visits v
    JOIN first_seen f USING (visitor_key)
    GROUP BY v.day
    ORDER BY v.day DESC;
  SQL
}

# 09 — Top pages by request count.
resource "aws_athena_named_query" "top_pages" {
  name      = "09 - Top pages"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    SELECT cs_uri_stem AS page, COUNT(*) AS requests
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate}
    GROUP BY 1
    ORDER BY requests DESC
    LIMIT 50;
  SQL
}

# 10 — Top referrers ('-' means no referrer).
resource "aws_athena_named_query" "top_referrers" {
  name      = "10 - Top referrers"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    SELECT cs_referer AS referrer, COUNT(*) AS requests
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate}
      AND cs_referer <> '-'
    GROUP BY 1
    ORDER BY requests DESC
    LIMIT 50;
  SQL
}

# 11 — Unique visitors by country (segmentation dimension).
resource "aws_athena_named_query" "visitors_by_country" {
  name      = "11 - Visitors by country"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    SELECT c_country AS country,
      COUNT(DISTINCT ${local.cf_visitor_key}) AS unique_visitors
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate}
    GROUP BY 1
    ORDER BY unique_visitors DESC;
  SQL
}

# 12 — Unique visitors by network/carrier (ASN). Reads how much of "unique" is one carrier-NAT pool.
resource "aws_athena_named_query" "visitors_by_network" {
  name      = "12 - Visitors by network/carrier (ASN)"
  database  = aws_glue_catalog_database.cf_logs.name
  workgroup = aws_athena_workgroup.traffic.name
  query     = <<-SQL
    SELECT asn,
      COUNT(DISTINCT ${local.cf_visitor_key}) AS unique_visitors
    FROM chq_cloudfront_logs.access_logs
    WHERE ${local.cf_content_predicate}
    GROUP BY 1
    ORDER BY unique_visitors DESC
    LIMIT 50;
  SQL
}
