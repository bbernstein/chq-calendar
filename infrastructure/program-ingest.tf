# infrastructure/program-ingest.tf
#
# Digital program-links pipeline (docs/superpowers/specs/
# 2026-08-05-program-links-design.md). Mirrors article-ingest.tf minus
# DynamoDB: hourly EventBridge → Lambda → full scrape of audienceaccess.co
# → sidecar JSON on the frontend bucket's calendar-cache path.

resource "aws_iam_role" "program_ingest_role" {
  name = "${var.app_name}-program-ingest-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "program_ingest_basic" {
  role       = aws_iam_role.program_ingest_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "program_ingest_scoped" {
  name = "${var.app_name}-program-ingest-scoped"
  role = aws_iam_role.program_ingest_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
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
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/program-links-*.json"
      },
      {
        # Round-trip the private match state (cache bucket — CloudFront-OAC-
        # only, never world-readable; see aws_s3_bucket.cache_bucket).
        Effect   = "Allow",
        Action   = ["s3:GetObject", "s3:PutObject"],
        Resource = "${aws_s3_bucket.cache_bucket.arn}/internal/program-links/*"
      },
      {
        # S3 GetObject on a missing key returns 403 AccessDenied (not 404
        # NoSuchKey) when the caller lacks s3:ListBucket. loadState() and
        # the optional publisher-sidecar read in EventSnapshotLoader both
        # discriminate "missing" vs "real error" on err.name === 'NoSuchKey',
        # so without this grant a missing key aborts every run forever (the
        # state file can only be created by a successful run). See
        # article-ingest.tf's equivalent grant for the same reason.
        Effect   = "Allow",
        Action   = ["s3:ListBucket"],
        Resource = aws_s3_bucket.frontend_bucket.arn,
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "cache/calendar-cache/all-events-*",
              "cache/calendar-cache/publisher-events-*",
              "cache/calendar-cache/program-links-*"
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
            "s3:prefix" = ["internal/program-links/*"]
          }
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "program_ingest" {
  name              = "/aws/lambda/${var.app_name}-program-ingest"
  retention_in_days = 14
}

resource "aws_lambda_function" "program_ingest" {
  filename      = "../backend/lambda-function.zip"
  function_name = "${var.app_name}-program-ingest"
  role          = aws_iam_role.program_ingest_role.arn
  handler       = "dist/programIngestHandler.scheduledHandler"
  runtime       = "nodejs24.x"
  timeout       = 300
  memory_size   = 512

  environment {
    variables = {
      CACHE_S3_BUCKET     = aws_s3_bucket.frontend_bucket.bucket
      CACHE_S3_KEY_PREFIX = "cache/calendar-cache"
      STATE_S3_KEY_PREFIX = "internal/program-links"
      # Private cache bucket (CloudFront-OAC-only) for the match state —
      # scores/reasons must not live on the public-read frontend bucket.
      STATE_S3_BUCKET = aws_s3_bucket.cache_bucket.bucket
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.program_ingest_basic,
    aws_iam_role_policy.program_ingest_scoped,
    aws_cloudwatch_log_group.program_ingest,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

resource "aws_cloudwatch_event_rule" "program_ingest_schedule" {
  name                = "${var.app_name}-program-ingest-hourly"
  description         = "Hourly trigger for digital program-links pipeline"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "program_ingest_target" {
  rule      = aws_cloudwatch_event_rule.program_ingest_schedule.name
  target_id = "ProgramIngestTarget"
  arn       = aws_lambda_function.program_ingest.arn
}

resource "aws_lambda_permission" "program_ingest_allow_events" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.program_ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.program_ingest_schedule.arn
}
