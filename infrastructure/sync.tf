# Data Sync Lambda Function
resource "aws_lambda_function" "data_sync" {
  filename         = "../backend/lambda-function.zip"
  function_name    = "chq-calendar-data-sync"
  role            = aws_iam_role.lambda_role.arn
  handler         = "dist/syncHandler.scheduledSyncHandler"
  runtime         = "nodejs18.x"
  timeout         = 900 # 15 minutes
  memory_size     = 1024

  environment {
    variables = {
      EVENTS_TABLE_NAME        = aws_dynamodb_table.events.name
      DATA_SOURCES_TABLE_NAME  = aws_dynamodb_table.data_sources.name
      SYNC_STATUS_TABLE_NAME   = aws_dynamodb_table.sync_status.name
      NODE_ENV                = "production"
      USE_NEW_API             = "true"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy.lambda_dynamodb,
    aws_cloudwatch_log_group.data_sync,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

# Manual Sync Lambda Function
resource "aws_lambda_function" "manual_sync" {
  filename         = "../backend/lambda-function.zip"
  function_name    = "chq-calendar-manual-sync"
  role            = aws_iam_role.lambda_role.arn
  handler         = "dist/syncHandler.manualSyncHandler"
  runtime         = "nodejs18.x"
  timeout         = 900 # 15 minutes
  memory_size     = 1024

  environment {
    variables = {
      EVENTS_TABLE_NAME        = aws_dynamodb_table.events.name
      DATA_SOURCES_TABLE_NAME  = aws_dynamodb_table.data_sources.name
      SYNC_STATUS_TABLE_NAME   = aws_dynamodb_table.sync_status.name
      NODE_ENV                = "production"
      USE_NEW_API             = "true"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy.lambda_dynamodb,
    aws_cloudwatch_log_group.manual_sync,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

# Sync Health Check Lambda Function
resource "aws_lambda_function" "sync_health" {
  filename         = "../backend/lambda-function.zip"
  function_name    = "chq-calendar-sync-health"
  role            = aws_iam_role.lambda_role.arn
  handler         = "dist/syncHandler.healthCheckHandler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      EVENTS_TABLE_NAME        = aws_dynamodb_table.events.name
      DATA_SOURCES_TABLE_NAME  = aws_dynamodb_table.data_sources.name
      SYNC_STATUS_TABLE_NAME   = aws_dynamodb_table.sync_status.name
      NODE_ENV                = "production"
      USE_NEW_API             = "true"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy.lambda_dynamodb,
    aws_cloudwatch_log_group.sync_health,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

# Sync Status Lambda Function
resource "aws_lambda_function" "sync_status" {
  filename         = "../backend/lambda-function.zip"
  function_name    = "chq-calendar-sync-status"
  role            = aws_iam_role.lambda_role.arn
  handler         = "dist/syncHandler.syncStatusHandler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      EVENTS_TABLE_NAME        = aws_dynamodb_table.events.name
      DATA_SOURCES_TABLE_NAME  = aws_dynamodb_table.data_sources.name
      SYNC_STATUS_TABLE_NAME   = aws_dynamodb_table.sync_status.name
      NODE_ENV                = "production"
      USE_NEW_API             = "true"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy.lambda_dynamodb,
    aws_cloudwatch_log_group.sync_status,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

# Sync List Lambda Function
resource "aws_lambda_function" "sync_list" {
  filename         = "../backend/lambda-function.zip"
  function_name    = "chq-calendar-sync-list"
  role            = aws_iam_role.lambda_role.arn
  handler         = "dist/syncHandler.syncListHandler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      EVENTS_TABLE_NAME        = aws_dynamodb_table.events.name
      DATA_SOURCES_TABLE_NAME  = aws_dynamodb_table.data_sources.name
      SYNC_STATUS_TABLE_NAME   = aws_dynamodb_table.sync_status.name
      NODE_ENV                = "production"
      USE_NEW_API             = "true"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic,
    aws_iam_role_policy.lambda_dynamodb,
    aws_cloudwatch_log_group.sync_list,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "data_sync" {
  name              = "/aws/lambda/chq-calendar-data-sync"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "manual_sync" {
  name              = "/aws/lambda/chq-calendar-manual-sync"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "sync_health" {
  name              = "/aws/lambda/chq-calendar-sync-health"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "sync_status" {
  name              = "/aws/lambda/chq-calendar-sync-status"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "sync_list" {
  name              = "/aws/lambda/chq-calendar-sync-list"
  retention_in_days = 14
}

# EventBridge Rules for Scheduled Syncs
resource "aws_cloudwatch_event_rule" "hourly_sync" {
  name                = "chq-calendar-hourly-sync"
  description         = "Trigger hourly sync for current events"
  schedule_expression = "rate(30 minutes)" # Every 30 minutes for current day events
}

resource "aws_cloudwatch_event_rule" "daily_sync" {
  name                = "chq-calendar-daily-sync"
  description         = "Trigger daily sync for upcoming events"
  schedule_expression = "cron(0 6 * * ? *)" # Daily at 6 AM UTC
}

resource "aws_cloudwatch_event_rule" "weekly_full_sync" {
  name                = "chq-calendar-weekly-sync"
  description         = "Trigger weekly full sync"
  schedule_expression = "cron(0 2 ? * SUN *)" # Weekly on Sunday at 2 AM UTC
}

# EventBridge Targets
resource "aws_cloudwatch_event_target" "hourly_sync" {
  rule      = aws_cloudwatch_event_rule.hourly_sync.name
  target_id = "HourlySyncTarget"
  arn       = aws_lambda_function.data_sync.arn

  input = jsonencode({
    "detail-type" = "Hourly Sync"
    "source"      = "chq-calendar.scheduler"
  })
}

resource "aws_cloudwatch_event_target" "daily_sync" {
  rule      = aws_cloudwatch_event_rule.daily_sync.name
  target_id = "DailySyncTarget"
  arn       = aws_lambda_function.data_sync.arn

  input = jsonencode({
    "detail-type" = "Daily Sync"
    "source"      = "chq-calendar.scheduler"
  })
}

resource "aws_cloudwatch_event_target" "weekly_full_sync" {
  rule      = aws_cloudwatch_event_rule.weekly_full_sync.name
  target_id = "WeeklyFullSyncTarget"
  arn       = aws_lambda_function.data_sync.arn

  input = jsonencode({
    "detail-type" = "Weekly Full Sync"
    "source"      = "chq-calendar.scheduler"
  })
}

# Lambda Permissions for EventBridge
resource "aws_lambda_permission" "allow_eventbridge_hourly" {
  statement_id  = "AllowExecutionFromEventBridgeHourly"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.data_sync.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.hourly_sync.arn
}

resource "aws_lambda_permission" "allow_eventbridge_daily" {
  statement_id  = "AllowExecutionFromEventBridgeDaily"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.data_sync.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_sync.arn
}

resource "aws_lambda_permission" "allow_eventbridge_weekly" {
  statement_id  = "AllowExecutionFromEventBridgeWeekly"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.data_sync.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.weekly_full_sync.arn
}

# API Gateway integration for manual sync
resource "aws_api_gateway_resource" "sync" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "sync"
}

resource "aws_api_gateway_method" "sync_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.sync.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sync_post" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.sync.id
  http_method = aws_api_gateway_method.sync_post.http_method

  integration_http_method = "POST"
  type                   = "AWS_PROXY"
  uri                    = aws_lambda_function.manual_sync.invoke_arn
}

resource "aws_lambda_permission" "api_gateway_manual_sync" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manual_sync.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

# Health check endpoint
resource "aws_api_gateway_resource" "sync_health" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.sync.id
  path_part   = "health"
}

resource "aws_api_gateway_method" "sync_health_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.sync_health.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sync_health_get" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.sync_health.id
  http_method = aws_api_gateway_method.sync_health_get.http_method

  integration_http_method = "POST"
  type                   = "AWS_PROXY"
  uri                    = aws_lambda_function.sync_health.invoke_arn
}

resource "aws_lambda_permission" "api_gateway_sync_health" {
  statement_id  = "AllowExecutionFromAPIGatewayHealth"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync_health.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

# API Gateway endpoints for sync status
resource "aws_api_gateway_resource" "sync_status" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.sync.id
  path_part   = "status"
}

resource "aws_api_gateway_resource" "sync_status_id" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.sync_status.id
  path_part   = "{syncId}"
}

resource "aws_api_gateway_method" "sync_status_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.sync_status_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sync_status_get" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.sync_status_id.id
  http_method = aws_api_gateway_method.sync_status_get.http_method

  integration_http_method = "POST"
  type                   = "AWS_PROXY"
  uri                    = aws_lambda_function.sync_status.invoke_arn
}

resource "aws_lambda_permission" "api_gateway_sync_status" {
  statement_id  = "AllowExecutionFromAPIGatewayStatus"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync_status.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

# API Gateway endpoint for sync list
resource "aws_api_gateway_method" "sync_list_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.sync.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sync_list_get" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.sync.id
  http_method = aws_api_gateway_method.sync_list_get.http_method

  integration_http_method = "POST"
  type                   = "AWS_PROXY"
  uri                    = aws_lambda_function.sync_list.invoke_arn
}

resource "aws_lambda_permission" "api_gateway_sync_list" {
  statement_id  = "AllowExecutionFromAPIGatewayList"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync_list.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

# CloudWatch Dashboard for Monitoring
resource "aws_cloudwatch_dashboard" "sync_monitoring" {
  dashboard_name = "chq-calendar-sync-monitoring"

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
            ["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.data_sync.function_name],
            [".", "Errors", ".", "."],
            [".", "Invocations", ".", "."],
          ]
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          title   = "Data Sync Lambda Metrics"
          period  = 300
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 6
        width  = 24
        height = 6

        properties = {
          query   = "SOURCE '/aws/lambda/chq-calendar-data-sync' | fields @timestamp, @message | sort @timestamp desc | limit 100"
          region  = var.aws_region
          title   = "Recent Sync Logs"
        }
      }
    ]
  })
}

# Outputs
output "sync_function_name" {
  description = "Name of the data sync Lambda function"
  value       = aws_lambda_function.data_sync.function_name
}

output "manual_sync_function_name" {
  description = "Name of the manual sync Lambda function"
  value       = aws_lambda_function.manual_sync.function_name
}

output "sync_health_function_name" {
  description = "Name of the sync health Lambda function"
  value       = aws_lambda_function.sync_health.function_name
}