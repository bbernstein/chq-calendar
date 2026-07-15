# infrastructure/article-ingest.tf
#
# Chautauquan Daily article-links pipeline (docs/superpowers/specs/
# 2026-07-15-chqdaily-article-links-design.md). Mirrors the
# publisher-ingest wiring: hourly EventBridge → Lambda → DynamoDB archive
# → sidecar JSON on the frontend bucket's calendar-cache path.

resource "aws_dynamodb_table" "articles" {
  name         = "${var.app_name}-articles"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${var.app_name}-articles"
    Environment = var.environment
  }
}

resource "aws_iam_role" "article_ingest_role" {
  name = "${var.app_name}-article-ingest-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "article_ingest_basic" {
  role       = aws_iam_role.article_ingest_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "article_ingest_scoped" {
  name = "${var.app_name}-article-ingest-scoped"
  role = aws_iam_role.article_ingest_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Scan"
        ],
        Resource = aws_dynamodb_table.articles.arn
      },
      {
        # Read the event snapshot (primary + publisher sidecar).
        Effect = "Allow",
        Action = ["s3:GetObject"],
        Resource = [
          "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/all-events-*.json",
          "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/publisher-events-*.json"
        ]
      },
      {
        # Publish the public sidecar (frontend bucket).
        Effect   = "Allow",
        Action   = ["s3:GetObject", "s3:PutObject"],
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/article-links-*.json"
      },
      {
        # Round-trip the private match state (cache bucket — CloudFront-OAC-
        # only, never world-readable; see aws_s3_bucket.cache_bucket).
        Effect   = "Allow",
        Action   = ["s3:GetObject", "s3:PutObject"],
        Resource = "${aws_s3_bucket.cache_bucket.arn}/internal/article-links/*"
      },
      {
        # S3 GetObject on a missing key returns 403 AccessDenied (not 404
        # NoSuchKey) when the caller lacks s3:ListBucket. loadState() and
        # the optional publisher-sidecar read in EventSnapshotLoader both
        # discriminate "missing" vs "real error" on err.name === 'NoSuchKey',
        # so without this grant a missing key aborts every run forever (the
        # state file can only be created by a successful run). See
        # publisher-ingest.tf's equivalent grant for the same reason.
        Effect   = "Allow",
        Action   = ["s3:ListBucket"],
        Resource = aws_s3_bucket.frontend_bucket.arn,
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "cache/calendar-cache/all-events-*",
              "cache/calendar-cache/publisher-events-*",
              "cache/calendar-cache/article-links-*"
            ]
          }
        }
      },
      {
        # Same 403-vs-404 fix for the private state object on the cache bucket.
        Effect   = "Allow",
        Action   = ["s3:ListBucket"],
        Resource = aws_s3_bucket.cache_bucket.arn,
        Condition = {
          StringLike = {
            "s3:prefix" = ["internal/article-links/*"]
          }
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "article_ingest" {
  name              = "/aws/lambda/${var.app_name}-article-ingest"
  retention_in_days = 14
}

resource "aws_lambda_function" "article_ingest" {
  filename      = "../backend/lambda-function.zip"
  function_name = "${var.app_name}-article-ingest"
  role          = aws_iam_role.article_ingest_role.arn
  handler       = "dist/articleIngestHandler.scheduledHandler"
  runtime       = "nodejs24.x"
  timeout       = 300
  memory_size   = 512

  environment {
    variables = {
      ARTICLES_TABLE_NAME = aws_dynamodb_table.articles.name
      CACHE_S3_BUCKET     = aws_s3_bucket.frontend_bucket.bucket
      CACHE_S3_KEY_PREFIX = "cache/calendar-cache"
      STATE_S3_KEY_PREFIX = "internal/article-links"
      # Private cache bucket (CloudFront-OAC-only) for the match state —
      # scores/reasons must not live on the public-read frontend bucket.
      STATE_S3_BUCKET = aws_s3_bucket.cache_bucket.bucket
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.article_ingest_basic,
    aws_iam_role_policy.article_ingest_scoped,
    aws_cloudwatch_log_group.article_ingest,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

resource "aws_cloudwatch_event_rule" "article_ingest_schedule" {
  name                = "${var.app_name}-article-ingest-hourly"
  description         = "Hourly trigger for chqdaily article-links pipeline"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "article_ingest_target" {
  rule      = aws_cloudwatch_event_rule.article_ingest_schedule.name
  target_id = "ArticleIngestTarget"
  arn       = aws_lambda_function.article_ingest.arn
}

resource "aws_lambda_permission" "article_ingest_allow_events" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.article_ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.article_ingest_schedule.arn
}
