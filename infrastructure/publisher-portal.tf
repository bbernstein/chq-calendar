# ─────────────────────────────────────────────────────────────────────────
# Publisher Portal Phase B prerequisites
#
# Provisions infrastructure required by the email magic-link auth + apply
# flow described in docs/plans/2026-05-03-publisher-portal-design.md.
#
# After `terraform apply` succeeds:
#
#   1. Generate a signing secret:
#        openssl rand -base64 32
#
#   2. AWS Console → Secrets Manager → chqcal/publisher-jwt-secret →
#      "Retrieve secret value" → "Edit" → paste the value as plaintext →
#      Save. The secret VALUE is intentionally not managed by Terraform so
#      it never lands in tfstate. Rotation = repeat steps 1–2.
#
#   3. Capture the two outputs (publisher_jwt_secret_arn,
#      publisher_magic_tokens_table_name) — Phase B Lambda code will read
#      both via env vars wired in at code-implementation time.
# ─────────────────────────────────────────────────────────────────────────

# Secrets Manager: PUBLISHER_JWT_SECRET
#
# Holds the HMAC signing key for publisher magic-link JWTs (separate from the
# admin JWT_SECRET so a publisher token compromise can't impersonate admins).
resource "aws_secretsmanager_secret" "publisher_jwt_secret" {
  name                    = "chqcal/publisher-jwt-secret"
  description             = "HMAC signing secret for publisher magic-link JWTs"
  recovery_window_in_days = 7

  tags = {
    Name        = "chqcal/publisher-jwt-secret"
    Environment = var.environment
  }
}

# DynamoDB: publisher magic-link tokens
#
# Stores hashed one-time tokens issued by /api/publisher-apply/request and
# /api/publisher-auth/request. Tokens are short-lived (15 min); DynamoDB TTL
# on `expiresAt` cleans them up automatically. Raw tokens are NEVER stored —
# only their SHA-256 hash, so a table-leak does not enable account takeover.
resource "aws_dynamodb_table" "publisher_magic_tokens" {
  name         = "${var.app_name}-publisher-magic-tokens"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tokenHash"

  attribute {
    name = "tokenHash"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # Tokens are ephemeral and reissuable; PITR would just protect short-lived
  # ciphertext. Skip it.
  point_in_time_recovery {
    enabled = false
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${var.app_name}-publisher-magic-tokens"
    Environment = var.environment
  }
}

# IAM: extend the admin Lambda role with publisher-portal permissions.
#
# Phase A's /publisher-test endpoint already runs on aws_lambda_function.admin_handler
# (delegated via adminHandler.ts → publisherPortalHandler.ts). Phase B routes will
# extend the same handler, so we attach to the same `lambda_role`.
resource "aws_iam_role_policy" "publisher_portal_access" {
  name = "${var.app_name}-publisher-portal-access"
  role = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect   = "Allow",
        Action   = ["secretsmanager:GetSecretValue"],
        Resource = aws_secretsmanager_secret.publisher_jwt_secret.arn
      },
      {
        Effect = "Allow",
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:UpdateItem"
        ],
        Resource = aws_dynamodb_table.publisher_magic_tokens.arn
      },
      {
        # Scope SES SendEmail to the verified domain identity. SESv2 SendEmail
        # (used by mailService.ts via @aws-sdk/client-sesv2) maps to the
        # `ses:SendEmail` IAM action, so granting that single action is
        # sufficient. `ses:SendRawEmail` is a v1-only action the code does
        # not call — least-privilege, omit it.
        Effect   = "Allow",
        Action   = ["ses:SendEmail"],
        Resource = "arn:aws:ses:${var.aws_region}:*:identity/${var.domain_name}"
      }
    ]
  })
}

# Outputs — Phase B Lambda env-var wiring will reference these.
output "publisher_jwt_secret_arn" {
  value       = aws_secretsmanager_secret.publisher_jwt_secret.arn
  description = "ARN of the publisher JWT signing secret in Secrets Manager"
}

output "publisher_magic_tokens_table_name" {
  value       = aws_dynamodb_table.publisher_magic_tokens.name
  description = "DynamoDB table holding hashed publisher magic-link tokens"
}
