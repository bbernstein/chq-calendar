# GitHub Actions IAM User and Policies for CI/CD

# Data sources to get existing resource ARNs
data "aws_caller_identity" "current" {}

# IAM User for GitHub Actions
resource "aws_iam_user" "github_actions" {
  name = "${var.app_name}-github-actions"
  path = "/service-accounts/"

  tags = {
    Name        = "${var.app_name}-github-actions"
    Environment = var.environment
    Purpose     = "GitHub Actions CI/CD"
  }
}

# IAM Policy for GitHub Actions
resource "aws_iam_policy" "github_actions" {
  name        = "${var.app_name}-github-actions-policy"
  description = "Policy for GitHub Actions to deploy Chautauqua Calendar application"
  path        = "/service-accounts/"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "LambdaDeployment"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration"
        ]
        Resource = aws_lambda_function.calendar_generator.arn
      },
      {
        Sid    = "S3FrontendDeployment"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [
          aws_s3_bucket.frontend_bucket.arn,
          "${aws_s3_bucket.frontend_bucket.arn}/*"
        ]
      },
      {
        Sid    = "CloudFrontInvalidation"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateInvalidation",
          "cloudfront:GetInvalidation",
          "cloudfront:ListInvalidations"
        ]
        Resource = aws_cloudfront_distribution.frontend_distribution.arn
      },
      {
        Sid    = "DynamoDBAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.events.arn,
          aws_dynamodb_table.data_sources.arn,
          aws_dynamodb_table.feedback.arn,
          "${aws_dynamodb_table.events.arn}/index/*",
          "${aws_dynamodb_table.data_sources.arn}/index/*",
          "${aws_dynamodb_table.feedback.arn}/index/*"
        ]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.app_name}*"
      }
    ]
  })

  tags = {
    Name        = "${var.app_name}-github-actions-policy"
    Environment = var.environment
  }
}

# Attach policy to user
resource "aws_iam_user_policy_attachment" "github_actions" {
  user       = aws_iam_user.github_actions.name
  policy_arn = aws_iam_policy.github_actions.arn
}

# Create access key for GitHub Actions
resource "aws_iam_access_key" "github_actions" {
  user = aws_iam_user.github_actions.name

  # The access key will be shown in Terraform output
  # In production, consider using AWS Secrets Manager or similar
}

# Output the access key information
output "github_actions_access_key_id" {
  description = "Access Key ID for GitHub Actions IAM user"
  value       = aws_iam_access_key.github_actions.id
  sensitive   = false
}

output "github_actions_secret_access_key" {
  description = "Secret Access Key for GitHub Actions IAM user"
  value       = aws_iam_access_key.github_actions.secret
  sensitive   = true
}

# Output all the values needed for GitHub Secrets
output "github_secrets" {
  description = "All values needed for GitHub repository secrets"
  value = {
    AWS_ACCESS_KEY_ID         = aws_iam_access_key.github_actions.id
    AWS_SECRET_ACCESS_KEY     = aws_iam_access_key.github_actions.secret
    AWS_REGION                = var.aws_region
    LAMBDA_FUNCTION_NAME      = aws_lambda_function.calendar_generator.function_name
    S3_BUCKET_NAME            = aws_s3_bucket.frontend_bucket.id
    CLOUDFRONT_DISTRIBUTION_ID = aws_cloudfront_distribution.frontend_distribution.id
    EVENTS_TABLE_NAME         = aws_dynamodb_table.events.name
    DATA_SOURCES_TABLE_NAME   = aws_dynamodb_table.data_sources.name
    FEEDBACK_TABLE_NAME       = aws_dynamodb_table.feedback.name
  }
  sensitive = true
}

# Output for easy copy-paste setup
output "github_secrets_setup_commands" {
  description = "Commands to set up GitHub secrets (use with GitHub CLI)"
  sensitive   = true
  value = <<-EOT
    # Set up GitHub secrets for repository
    # First install GitHub CLI: https://cli.github.com/
    
    gh secret set AWS_ACCESS_KEY_ID --body "${aws_iam_access_key.github_actions.id}"
    gh secret set AWS_SECRET_ACCESS_KEY --body "${aws_iam_access_key.github_actions.secret}"
    gh secret set AWS_REGION --body "${var.aws_region}"
    gh secret set LAMBDA_FUNCTION_NAME --body "${aws_lambda_function.calendar_generator.function_name}"
    gh secret set S3_BUCKET_NAME --body "${aws_s3_bucket.frontend_bucket.id}"
    gh secret set CLOUDFRONT_DISTRIBUTION_ID --body "${aws_cloudfront_distribution.frontend_distribution.id}"
    gh secret set EVENTS_TABLE_NAME --body "${aws_dynamodb_table.events.name}"
    gh secret set DATA_SOURCES_TABLE_NAME --body "${aws_dynamodb_table.data_sources.name}"
    gh secret set FEEDBACK_TABLE_NAME --body "${aws_dynamodb_table.feedback.name}"
  EOT
}

# Optional: Create a JSON file with the secrets for manual setup
resource "local_file" "github_secrets_json" {
  filename = "${path.module}/github-secrets.json"
  content = jsonencode({
    AWS_ACCESS_KEY_ID         = aws_iam_access_key.github_actions.id
    AWS_SECRET_ACCESS_KEY     = aws_iam_access_key.github_actions.secret
    AWS_REGION                = var.aws_region
    LAMBDA_FUNCTION_NAME      = aws_lambda_function.calendar_generator.function_name
    S3_BUCKET_NAME            = aws_s3_bucket.frontend_bucket.id
    CLOUDFRONT_DISTRIBUTION_ID = aws_cloudfront_distribution.frontend_distribution.id
    EVENTS_TABLE_NAME         = aws_dynamodb_table.events.name
    DATA_SOURCES_TABLE_NAME   = aws_dynamodb_table.data_sources.name
    FEEDBACK_TABLE_NAME       = aws_dynamodb_table.feedback.name
  })
  
  # Make sure this file is not committed to git
  provisioner "local-exec" {
    command = "echo 'github-secrets.json' >> ${path.module}/../.gitignore || true"
  }
}