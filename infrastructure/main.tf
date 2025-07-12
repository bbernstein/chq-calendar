terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
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

variable "app_name" {
  description = "Application name"
  type        = string
  default     = "chautauqua-calendar"
}

# DynamoDB Tables
resource "aws_dynamodb_table" "events_table" {
  name           = "${var.app_name}-events"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

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

  global_secondary_index {
    name     = "WeekIndex"
    hash_key = "week"
  }

  global_secondary_index {
    name     = "DateIndex"
    hash_key = "startDate"
  }

  tags = {
    Name        = "${var.app_name}-events"
    Environment = var.environment
  }
}

resource "aws_dynamodb_table" "data_sources_table" {
  name           = "${var.app_name}-data-sources"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  tags = {
    Name        = "${var.app_name}-data-sources"
    Environment = var.environment
  }
}

# S3 Bucket for Frontend
resource "aws_s3_bucket" "frontend_bucket" {
  bucket = "${var.app_name}-frontend-${var.environment}"
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
  bucket = aws_s3_bucket.frontend_bucket.id
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
    ]
  })
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

  enabled             = true
  default_root_object = "index.html"

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
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }
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

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.lambda_role.name
}

# Lambda Function
resource "aws_lambda_function" "calendar_generator" {
  filename         = "../backend/lambda-function.zip"
  function_name    = "${var.app_name}-generator"
  role            = aws_iam_role.lambda_role.arn
  handler         = "dist/calendarHandler.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 256

  environment {
    variables = {
      EVENTS_TABLE_NAME       = aws_dynamodb_table.events_table.name
      DATA_SOURCES_TABLE_NAME = aws_dynamodb_table.data_sources_table.name
      ENVIRONMENT            = var.environment
    }
  }
}

# API Gateway
resource "aws_api_gateway_rest_api" "calendar_api" {
  name = "${var.app_name}-api"
}

resource "aws_api_gateway_resource" "calendar_resource" {
  rest_api_id = aws_api_gateway_rest_api.calendar_api.id
  parent_id   = aws_api_gateway_rest_api.calendar_api.root_resource_id
  path_part   = "calendar"
}

resource "aws_api_gateway_method" "calendar_post" {
  rest_api_id   = aws_api_gateway_rest_api.calendar_api.id
  resource_id   = aws_api_gateway_resource.calendar_resource.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "calendar_integration" {
  rest_api_id = aws_api_gateway_rest_api.calendar_api.id
  resource_id = aws_api_gateway_resource.calendar_resource.id
  http_method = aws_api_gateway_method.calendar_post.http_method

  integration_http_method = "POST"
  type                   = "AWS_PROXY"
  uri                    = aws_lambda_function.calendar_generator.invoke_arn
}

resource "aws_lambda_permission" "api_gateway_lambda" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.calendar_generator.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.calendar_api.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "calendar_deployment" {
  depends_on = [
    aws_api_gateway_integration.calendar_integration,
  ]

  rest_api_id = aws_api_gateway_rest_api.calendar_api.id
  stage_name  = var.environment
}

# Outputs
output "frontend_url" {
  value = "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}"
}

output "api_url" {
  value = "https://${aws_api_gateway_rest_api.calendar_api.id}.execute-api.${var.aws_region}.amazonaws.com/${var.environment}"
}

output "s3_bucket_name" {
  value = aws_s3_bucket.frontend_bucket.bucket
}
