resource "aws_dynamodb_table" "publishers" {
  name         = "chq-publishers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_dynamodb_table" "publisher_events" {
  name         = "chq-publisher-events"
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
    hash_key        = "state"
    range_key       = "publisherId"
    projection_type = "ALL"
  }
}

resource "aws_iam_role" "publisher_ingest_role" {
  name = "chq-publisher-ingest-role"
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
  name = "chq-publisher-ingest-scoped"
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
          "dynamodb:TransactWriteItems"
        ],
        Resource = [
          aws_dynamodb_table.publishers.arn,
          aws_dynamodb_table.publisher_events.arn,
          "${aws_dynamodb_table.publisher_events.arn}/index/by-state"
        ]
      },
      {
        Effect   = "Allow",
        Action   = ["s3:PutObject"],
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/publisher-events-*.json"
      }
    ]
  })
}

resource "aws_lambda_function" "publisher_ingest" {
  filename      = "../backend/lambda-function.zip"
  function_name = "chq-publisher-ingest"
  role          = aws_iam_role.publisher_ingest_role.arn
  handler       = "dist/publisherIngestHandler.scheduledHandler"
  runtime       = "nodejs22.x"
  timeout       = 600
  memory_size   = 512

  environment {
    variables = {
      PUBLISHERS_TABLE_NAME       = aws_dynamodb_table.publishers.name
      PUBLISHER_EVENTS_TABLE_NAME = aws_dynamodb_table.publisher_events.name
      CACHE_S3_BUCKET             = aws_s3_bucket.frontend_bucket.bucket
      CACHE_S3_KEY_PREFIX         = "cache/calendar-cache"
    }
  }

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

resource "aws_cloudwatch_event_rule" "publisher_ingest_schedule" {
  name                = "chq-publisher-ingest-hourly"
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
