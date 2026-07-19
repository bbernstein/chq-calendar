# CloudFront Traffic Analytics (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture cookieless CloudFront traffic (unique/returning visitors, pageviews) via standard logging v2 → S3 (Parquet, partitioned) → Athena saved queries, all defined in Terraform, plus a runbook.

**Architecture:** CloudFront standard logging v2 delivers Parquet access logs to a private, ACL-disabled S3 bucket under Hive-partitioned paths. An AWS Glue table (partition projection) exposes them to Athena, where a set of named queries compute the metrics. Nothing is added to the app; no cookies are set (the cookie field is captured empty for forward-compat). Viewing is manual from the Athena console, documented in a runbook.

**Tech Stack:** Terraform (AWS provider `~> 6.0`), AWS CloudWatch Logs vended-logs delivery, S3, AWS Glue Data Catalog, Amazon Athena. Region `us-east-1`.

**Spec:** `docs/superpowers/specs/2026-07-19-cloudfront-traffic-analytics-design.md`

**Terraform note (adapted test cycle):** This plan is Terraform-only; there is no unit-test framework in `infrastructure/`. Each task's "test" is `terraform fmt` + `terraform validate` (deterministic, no AWS credentials needed). The end-to-end integration test is Task 6 (`terraform plan`/`apply` + Athena smoke queries), which is **user-gated** because it mutates the production CloudFront distribution's logging and creates real AWS resources.

## Global Constraints

- **Terraform only.** No frontend/backend/app code changes. No unit tests. (Spec §11.)
- **Never commit to `main`.** Work is on branch `feat/cloudfront-traffic-analytics` (already created). (CLAUDE.md.)
- **Region is `us-east-1`.** CloudFront logging-v2 delivery resources must be created there. (Spec §2; AWS requirement.)
- **All new resources live in one new file:** `infrastructure/traffic-analytics.tf`. Do **not** modify the `aws_cloudfront_distribution.frontend_distribution` block — logging v2 references its ARN externally.
- **Naming:** prefix resources/names with `var.app_name` (`chautauqua-calendar`), mirroring existing files.
- **`visitor_key` = `md5(c_ip ‖ '|' ‖ cs_user_agent)`.** `asn`/`c_country`/`ssl_*` are captured as reporting dimensions only — **never** folded into `visitor_key`. (Spec §6.)
- **Raw-log retention = 90 days**; Athena results = 30 days. (Spec §4, §8.)
- **Bucket is `BucketOwnerEnforced` (ACLs disabled)**, public access fully blocked; delivery authorized by bucket policy for `delivery.logs.amazonaws.com`. (Spec §4.)
- **`cs(Cookie)` is selected but empty today.** Fully populating cookie *values* also needs `IncludeCookies` on the distribution — deferred until a real session cookie exists (Spec §8, Open Follow-ups). Do not enable legacy `logging_config` on the distribution to force it.
- **Parquet column names are underscored** (`cs_user_agent`, `cs_cookie`, …) and typed **`string`**; the delivery `record_fields` use AWS API names (`cs(User-Agent)`, `cs(Cookie)`, …). (AWS Athena Parquet DDL reference.)

---

### Task 1: Secure log bucket (private, ACL-disabled, lifecycle) + delivery bucket policy

**Files:**
- Create: `infrastructure/traffic-analytics.tf`

**Interfaces:**
- Consumes: `var.app_name`, `var.aws_region` (existing vars in `infrastructure/main.tf`).
- Produces: `aws_s3_bucket.cf_logs` (bucket for logs + Athena results), `data.aws_caller_identity.current`, `random_id.cf_logs_suffix`. Objects land under prefix `cf/`; Athena results under `athena-results/`.

- [ ] **Step 1: Create `infrastructure/traffic-analytics.tf` with the bucket, security, lifecycle, and delivery policy**

```hcl
# infrastructure/traffic-analytics.tf
#
# CloudFront traffic analytics (Phase A): standard logging v2 -> S3 (Parquet,
# partitioned) -> Glue table -> Athena named queries.
# Design: docs/superpowers/specs/2026-07-19-cloudfront-traffic-analytics-design.md

data "aws_caller_identity" "current" {}

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
```

- [ ] **Step 2: Format and validate**

Run: `cd infrastructure && terraform fmt && terraform validate`
Expected: `Success! The configuration is valid.`

(If `terraform validate` reports the providers are not initialized, run `terraform init` once first — no new providers are introduced, so init should be a no-op or fast.)

- [ ] **Step 3: Commit**

```bash
git add infrastructure/traffic-analytics.tf
git commit -m "feat(analytics): private ACL-disabled log bucket + delivery policy"
```

---

### Task 2: CloudFront standard logging v2 delivery (source → destination → delivery)

**Files:**
- Modify: `infrastructure/traffic-analytics.tf` (append)

**Interfaces:**
- Consumes: `aws_s3_bucket.cf_logs`, `aws_s3_bucket_policy.cf_logs`, `aws_cloudfront_distribution.frontend_distribution` (existing, `infrastructure/main.tf:401`), `var.app_name`, `var.aws_region`.
- Produces: Parquet logs written to `s3://<bucket>/cf/year=YYYY/month=MM/day=DD/` (Hive-compatible paths). Delivered `record_fields` become the Glue table columns in Task 3.

- [ ] **Step 1: Append the delivery trio to `infrastructure/traffic-analytics.tf`**

```hcl
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
```

- [ ] **Step 2: Format and validate**

Run: `cd infrastructure && terraform fmt && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/traffic-analytics.tf
git commit -m "feat(analytics): enable CloudFront standard logging v2 to S3 (parquet)"
```

---

### Task 3: Glue database + partitioned Parquet table (partition projection)

**Files:**
- Modify: `infrastructure/traffic-analytics.tf` (append)

**Interfaces:**
- Consumes: `aws_s3_bucket.cf_logs`, the log layout `cf/year=…/month=…/day=…` from Task 2.
- Produces: Glue DB `chq_cloudfront_logs` and table `access_logs` with all-`string` columns and `year`/`month`/`day` projected partitions. Athena queries in Task 4 read `chq_cloudfront_logs.access_logs`.

- [ ] **Step 1: Append the Glue database and table**

Note: `$${year}` etc. escape Terraform interpolation so the literal `${year}` reaches Athena. All columns are `string` per the AWS Parquet DDL reference. Only the selected `record_fields` are declared (Athena matches Parquet columns by name).

```hcl
# --- Glue catalog: schema over the Parquet logs -------------------------------

resource "aws_glue_catalog_database" "cf_logs" {
  name = "chq_cloudfront_logs"
}

resource "aws_glue_catalog_table" "cf_logs" {
  name          = "access_logs"
  database_name = aws_glue_catalog_database.cf_logs.name
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL                    = "TRUE"
    classification              = "parquet"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2026,2035"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "storage.location.template" = "s3://${aws_s3_bucket.cf_logs.bucket}/cf/year=$${year}/month=$${month}/day=$${day}"
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
```

- [ ] **Step 2: Format and validate**

Run: `cd infrastructure && terraform fmt && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infrastructure/traffic-analytics.tf
git commit -m "feat(analytics): Glue database + partitioned parquet table for CF logs"
```

---

### Task 4: Athena workgroup, named queries, and console-URL output

**Files:**
- Modify: `infrastructure/traffic-analytics.tf` (append)

**Interfaces:**
- Consumes: `aws_s3_bucket.cf_logs`, `aws_glue_catalog_database.cf_logs`, `var.app_name`, `var.aws_region`.
- Produces: Athena workgroup `${var.app_name}-traffic`, 12 `aws_athena_named_query` resources, and output `traffic_analytics_athena_url`.

**Metric definitions used by every query (Spec §6):**
- Content-object predicate (page loads + data pulls, excluding admin/api/auth/assets):
  ```
  cs_method = 'GET'
  AND sc_status IN ('200','304')
  AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
       OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
  AND cs_uri_stem NOT LIKE '/admin%'
  AND cs_uri_stem NOT LIKE '/api%'
  AND cs_uri_stem NOT LIKE '/auth%'
  ```
- `visitor_key` = `lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent))))`.
- Each query carries a commented optional bot-filter line the user can uncomment in the console.

- [ ] **Step 1: Append the Athena workgroup and output**

```hcl
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
  description = "Athena console query editor (select the ${var.app_name}-traffic workgroup)"
  value       = "https://${var.aws_region}.console.aws.amazon.com/athena/home?region=${var.aws_region}#/query-editor"
}
```

- [ ] **Step 2: Append the 12 named queries**

```hcl
# 01 — Pageviews by day, split into page loads vs. data pulls.
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
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
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
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
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
        lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent)))) || '#' || substr("time",1,2)
      ) AS active_visits
    FROM chq_cloudfront_logs.access_logs
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
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
        lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent)))) || '#' || "date" || substr("time",1,2)
      ) AS active_visits
    FROM chq_cloudfront_logs.access_logs
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
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
      COUNT(DISTINCT lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent))))) AS unique_visitors
    FROM chq_cloudfront_logs.access_logs
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
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
      COUNT(DISTINCT lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent))))) AS unique_visitors
    FROM chq_cloudfront_logs.access_logs
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
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
      COUNT(DISTINCT lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent))))) AS unique_visitors_season
    FROM chq_cloudfront_logs.access_logs
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%';
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
        lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent)))) AS visitor_key,
        "date" AS day
      FROM chq_cloudfront_logs.access_logs
      WHERE cs_method = 'GET'
        AND sc_status IN ('200','304')
        AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
             OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
        AND cs_uri_stem NOT LIKE '/admin%'
        AND cs_uri_stem NOT LIKE '/api%'
        AND cs_uri_stem NOT LIKE '/auth%'
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
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
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
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
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
      COUNT(DISTINCT lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent))))) AS unique_visitors
    FROM chq_cloudfront_logs.access_logs
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
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
      COUNT(DISTINCT lower(to_hex(md5(to_utf8(c_ip || '|' || cs_user_agent))))) AS unique_visitors
    FROM chq_cloudfront_logs.access_logs
    WHERE cs_method = 'GET'
      AND sc_status IN ('200','304')
      AND (cs_uri_stem LIKE '%/' OR cs_uri_stem LIKE '%.html'
           OR cs_uri_stem LIKE '/cache/calendar-cache/%.json')
      AND cs_uri_stem NOT LIKE '/admin%'
      AND cs_uri_stem NOT LIKE '/api%'
      AND cs_uri_stem NOT LIKE '/auth%'
    GROUP BY 1
    ORDER BY unique_visitors DESC
    LIMIT 50;
  SQL
}
```

- [ ] **Step 3: Format and validate**

Run: `cd infrastructure && terraform fmt && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
git add infrastructure/traffic-analytics.tf
git commit -m "feat(analytics): Athena workgroup, 12 named queries, console URL output"
```

---

### Task 5: Runbook

**Files:**
- Create: `docs/runbooks/traffic-analytics.md`

**Interfaces:**
- Consumes: the Athena workgroup `${app_name}-traffic` and named queries from Task 4.
- Produces: operator documentation. No code dependency.

- [ ] **Step 1: Create `docs/runbooks/traffic-analytics.md` with this content**

````markdown
# Runbook: CloudFront Traffic Analytics

How to read site traffic (unique/returning visitors, pageviews) for chqcal.org.
Infrastructure: `infrastructure/traffic-analytics.tf`. Design:
`docs/superpowers/specs/2026-07-19-cloudfront-traffic-analytics-design.md`.

## What this measures

CloudFront standard logs (v2) are delivered as Parquet to a private S3 bucket and
queried in Athena. There is **no cookie and no client-side tracking** — counts come
purely from CloudFront request logs.

A **pageview** is a request for a content object: an HTML page **or** a
`/cache/calendar-cache/*.json` data file (the hourly data pull, which is the best
signal of a long-lived app actively fetching updates). Because the HTML and JSON are
each cached ~1 hour, a browser produces at most ~1 request/hour for them.

Two headline numbers:
- **Pageviews (raw)** — every content request, split into page loads vs. data pulls.
- **Active visits** — distinct (visitor, hour) pairs; dedupes the multiple JSON files
  fetched per app-hour. This is the ≤1/hour/browser proxy.

**Visitor** = `md5(client-IP + user-agent)`. **Returning** = a visitor seen on ≥2 days.

## How to run a query

1. Open the Athena console (the URL is in the Terraform output
   `traffic_analytics_athena_url`), region **us-east-1**.
2. In the workgroup selector (top right), choose **`chautauqua-calendar-traffic`**.
3. Open the **Saved queries** tab. You'll see queries `01`–`12`.
4. Click one to load it, then **Run**. Results appear below and are also written to
   `s3://<log-bucket>/athena-results/` (auto-deleted after 30 days).

Queries `01`–`12`:

| # | Query | Answers |
|---|-------|---------|
| 01 | Pageviews by day (split) | Daily page loads vs. data pulls |
| 02 | Pageviews by week (split) | Weekly page loads vs. data pulls |
| 03 | Active visits by day | Daily ≤1/hr/browser visits |
| 04 | Active visits by week | Weekly active visits |
| 05 | Unique visitors by day | Distinct visitors/day |
| 06 | Unique visitors by week | Distinct visitors/week |
| 07 | Unique visitors season-to-date | One season total |
| 08 | New vs returning by day | Daily new vs. returning split |
| 09 | Top pages | Most-requested content objects |
| 10 | Top referrers | Where visitors come from |
| 11 | Visitors by country | Geographic breakdown |
| 12 | Visitors by network/carrier (ASN) | How much "unique" is one carrier-NAT pool |

Each query has a commented **optional bot filter** line near the top — uncomment it in
the editor to exclude obvious crawlers before running.

## How to read the numbers (important caveats)

- **IP-based uniqueness is approximate.** Traffic is phone-heavy. Mobile **carrier NAT**
  makes many people share one IP (deflates unique counts); **dynamic IPs** make one
  person look like several across sessions (inflates unique counts, and breaks
  "returning" detection). Read these as **trends**, not precise headcounts. Query 12
  (ASN) helps gauge how much of a "unique" count is really one carrier pool.
- **Logs lag minutes–hours.** Today's numbers fill in over the next few hours; don't
  expect real-time.
- **Cookies are empty.** The `cs_cookie` column exists but is blank — the app sets no
  cookies. This is intentional forward-compat (see the design's Open Follow-ups for the
  first-party visitor-ID next step that would make returning-visitor counts reliable).

## Cost & retention

Logging is free; Parquet + partition projection keep Athena scans at ~$0 for this
volume. Raw logs auto-expire after 90 days; Athena results after 30 days.
````

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/traffic-analytics.md
git commit -m "docs(analytics): runbook for reading CloudFront traffic in Athena"
```

---

### Task 6: Apply + end-to-end smoke verification (USER-GATED)

**This task mutates production** (turns on logging for the live distribution and creates AWS resources). Do **not** run it autonomously — confirm with the user, then run it together or hand them the commands. Requires AWS credentials for the account holding this infrastructure.

**Files:** none (apply + verification only).

- [ ] **Step 1: Plan and review**

Run: `cd infrastructure && terraform plan`
Expected: a plan that **creates** ~20 resources (bucket, PAB, ownership, lifecycle, bucket policy, `random_id`, delivery source/destination/delivery, Glue DB + table, Athena workgroup, 12 named queries, 1 output) and **changes/destroys nothing** on the existing distribution or other resources. Confirm no `~`/`-` on `aws_cloudfront_distribution.frontend_distribution`.

- [ ] **Step 2: Apply (with user confirmation)**

Run: `terraform apply`
Type `yes` only after the user approves the plan.

Contingency: if apply errors specifically on the `cs(Cookie)` record field (some accounts reject selecting it while distribution-level `IncludeCookies` is off), remove `"cs(Cookie)",` from `record_fields` in Task 2, drop the `cs_cookie` column from Task 3, re-apply, and note that the cookie field re-enters when the deferred first-party-ID work turns on `IncludeCookies`. This does not affect any Phase-A metric (the field is empty today).

- [ ] **Step 3: Confirm the bucket is locked down**

Run:
```bash
BUCKET=$(cd infrastructure && terraform output -raw traffic_analytics_athena_url >/dev/null; \
  aws s3api list-buckets --query "Buckets[?starts_with(Name,'chautauqua-calendar-cf-logs')].Name" --output text)
aws s3api get-bucket-ownership-controls --bucket "$BUCKET" \
  --query 'OwnershipControls.Rules[0].ObjectOwnership' --output text
aws s3api get-public-access-block --bucket "$BUCKET" \
  --query 'PublicAccessBlockConfiguration' --output json
```
Expected: ownership `BucketOwnerEnforced`; all four public-access-block flags `true`.

- [ ] **Step 4: Wait for the first logs, then confirm the S3 path matches the Glue table**

Logs appear within minutes–hours. Check:
```bash
aws s3 ls "s3://$BUCKET/cf/" --recursive | head
```
Expected: objects under `cf/year=YYYY/month=MM/day=DD/…parquet`.

**If the path is NOT `cf/year=…/month=…/day=…`** (e.g. AWS injected an `AWSLogs/…` prefix despite the destination-ARN prefix), update `aws_glue_catalog_table.cf_logs` `storage_descriptor.location` and the `storage.location.template` parameter to match the actual prefix, then `terraform apply` again. This is the one path that depends on AWS's delivery behavior; everything else is deterministic.

- [ ] **Step 5: Run the smoke queries in Athena**

In the Athena console (workgroup `chautauqua-calendar-traffic`):
1. Run `SELECT * FROM chq_cloudfront_logs.access_logs LIMIT 5;` — expect rows with populated `c_ip`, `cs_user_agent`, `cs_uri_stem`; `cs_cookie` = `-` (empty); `asn`/`c_country` populated.
2. Run saved query **05 - Unique visitors by day** — expect ≥1 row with a plausible count.
3. Run **03 - Active visits by day** — expect counts ≤ the raw pageviews for the same day.

Expected: queries succeed (no column-not-found / type errors) and return sane, non-empty numbers.

- [ ] **Step 6: Push the branch and open a PR (do not merge)**

```bash
git push -u origin feat/cloudfront-traffic-analytics
gh pr create --fill --base main
```
Report the PR URL to the user. Per project rules, the user requests the merge.

---

## Self-Review

**1. Spec coverage:**
- §3 architecture (logs→S3→Glue→Athena): Tasks 1–4. ✓
- §4 capture (BucketOwnerEnforced bucket, policy, lifecycle 90d, delivery trio, `include_cookies`→`cs(Cookie)` field, asn/country/ssl fields): Tasks 1–2. ✓
- §5 query layer (Glue DB + partitioned Parquet table + projection, Athena workgroup, results location, named queries): Tasks 3–4. ✓
- §6 metric definitions (content object incl. `/cache/*.json`, raw pageviews split, active visits visitor-hour dedup, unique, returning, `visitor_key`=md5(IP‖UA), admin excluded, optional bot filter, asn/country as dimensions): Task 4 queries + Global Constraints. ✓
- §7 saved-query set (pageviews day/week, active visits, unique day/week/season, new-vs-returning, top pages, top referrers, by country, by network): Task 4 (queries 01–12). ✓
- §8 privacy/retention (13→14 selected fields, cookie empty, 90d expiry, hashed aggregates, bucket private ACLs-off): Tasks 1–2, runbook. ✓
- §9 cost: runbook + design; no build action. ✓
- §10 usage (runbook + Athena console URL output): Tasks 4–5. ✓
- §11 scope/verification (Terraform + runbook only; plan/apply + first-logs smoke): Task 6. ✓
- Open Follow-ups (first-party ID as next step): out of scope by design; referenced in runbook. ✓

**2. Placeholder scan:** No TBD/TODO. The one AWS-behavior-dependent value (S3 path prefix) is handled as an explicit Step-4 verification-and-correct, not a placeholder. Column names/types, SerDe, projection, and provider schemas are all pinned from AWS docs. ✓

**3. Type/name consistency:** `record_fields` use AWS API names (`cs(User-Agent)`, `cs(Cookie)`); Glue columns and all SQL use underscored names (`cs_user_agent`, `cs_cookie`, `c_country`, `asn`). `visitor_key` expression is identical across all 12 queries. Database/table `chq_cloudfront_logs.access_logs` and workgroup `${app_name}-traffic` are referenced consistently. ✓
