resource "aws_dynamodb_table" "publishers" {
  name         = "${var.app_name}-publishers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${var.app_name}-publishers"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "publisher_events" {
  name         = "${var.app_name}-publisher-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "publisherId"
  range_key    = "eventId"

  attribute {
    name = "publisherId"
    type = "S"
  }

  attribute {
    name = "eventId"
    type = "S"
  }

  attribute {
    name = "state"
    type = "S"
  }

  global_secondary_index {
    name            = "by-state"
    projection_type = "ALL"
    key_schema {
      attribute_name = "state"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "publisherId"
      key_type       = "RANGE"
    }
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${var.app_name}-publisher-events"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "publisher_ingest_runs" {
  name         = "${var.app_name}-publisher-ingest-runs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "publisherId"
  range_key    = "runAt"

  attribute {
    name = "publisherId"
    type = "S"
  }

  attribute {
    name = "runAt"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${var.app_name}-publisher-ingest-runs"
    Environment = var.environment
  }
}

resource "aws_iam_role" "publisher_ingest_role" {
  name = "${var.app_name}-publisher-ingest-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "publisher_ingest_basic" {
  role       = aws_iam_role.publisher_ingest_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "publisher_ingest_scoped" {
  name = "${var.app_name}-publisher-ingest-scoped"
  role = aws_iam_role.publisher_ingest_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:TransactWriteItems",
          "dynamodb:ConditionCheckItem"
        ],
        Resource = [
          aws_dynamodb_table.publishers.arn,
          aws_dynamodb_table.publisher_events.arn,
          "${aws_dynamodb_table.publisher_events.arn}/index/by-state",
          aws_dynamodb_table.publisher_ingest_runs.arn
        ]
      },
      {
        Effect   = "Allow",
        Action   = ["s3:PutObject", "s3:DeleteObject"],
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/publisher-events-*.json"
      },
      {
        Effect   = "Allow",
        Action   = ["s3:ListBucket"],
        Resource = aws_s3_bucket.frontend_bucket.arn,
        Condition = {
          StringLike = {
            "s3:prefix" = ["cache/calendar-cache/publisher-events-*"]
          }
        }
      },
      {
        # PublisherNotificationService (constructed in scheduledHandler) calls
        # SES via SesMailService for ingest-failure / ingest-recovery emails.
        # Without this grant the SDK call AccessDeniedExceptions and is
        # silently swallowed by guarded(), so emails would never deliver.
        # Same scope/shape as the portal Lambda's SES grant in publisher-portal.tf.
        Effect   = "Allow",
        Action   = ["ses:SendEmail"],
        Resource = "arn:aws:ses:${var.aws_region}:*:identity/${var.domain_name}"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "publisher_ingest" {
  name              = "/aws/lambda/${var.app_name}-publisher-ingest"
  retention_in_days = 14
}

resource "aws_lambda_function" "publisher_ingest" {
  filename      = "../backend/lambda-function.zip"
  function_name = "${var.app_name}-publisher-ingest"
  role          = aws_iam_role.publisher_ingest_role.arn
  handler       = "dist/publisherIngestHandler.scheduledHandler"
  runtime       = "nodejs24.x"
  timeout       = 600
  memory_size   = 512

  environment {
    variables = {
      PUBLISHERS_TABLE_NAME            = aws_dynamodb_table.publishers.name
      PUBLISHER_EVENTS_TABLE_NAME      = aws_dynamodb_table.publisher_events.name
      PUBLISHER_INGEST_RUNS_TABLE_NAME = aws_dynamodb_table.publisher_ingest_runs.name
      CACHE_S3_BUCKET                  = aws_s3_bucket.frontend_bucket.bucket
      CACHE_S3_KEY_PREFIX              = "cache/calendar-cache"
      SES_FROM_ADDRESS                 = "no-reply@${var.domain_name}"
      SITE_BASE_URL                    = "https://www.${var.domain_name}"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.publisher_ingest_basic,
    aws_iam_role_policy.publisher_ingest_scoped,
    aws_cloudwatch_log_group.publisher_ingest,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

resource "aws_cloudwatch_event_rule" "publisher_ingest_schedule" {
  name                = "${var.app_name}-publisher-ingest-hourly"
  description         = "Hourly trigger for publisher ingest pipeline"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "publisher_ingest_target" {
  rule      = aws_cloudwatch_event_rule.publisher_ingest_schedule.name
  target_id = "PublisherIngestTarget"
  arn       = aws_lambda_function.publisher_ingest.arn
}

resource "aws_lambda_permission" "publisher_ingest_allow_events" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.publisher_ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.publisher_ingest_schedule.arn
}

# The dedicated admin Lambda role (created in main.tf as `admin_lambda_role`)
# needs read/write access to the publisher tables for the admin endpoints in
# adminHandler.ts (Plan 3). Kept here so all publisher-related IAM stays
# grouped. The public calendar Lambda and sync handlers (still on the shared
# `lambda_role`) intentionally do not get these permissions.
resource "aws_iam_role_policy" "admin_publisher_access" {
  name = "${var.app_name}-admin-publisher-access"
  role = aws_iam_role.admin_lambda_role.name
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Action = [
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:TransactWriteItems",
        "dynamodb:ConditionCheckItem"
      ],
      Resource = [
        aws_dynamodb_table.publishers.arn,
        aws_dynamodb_table.publisher_events.arn,
        "${aws_dynamodb_table.publisher_events.arn}/index/by-state",
        aws_dynamodb_table.publisher_ingest_runs.arn
      ]
    }]
  })
}
