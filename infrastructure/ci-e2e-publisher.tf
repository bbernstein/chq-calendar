# CI end-to-end test publisher.
#
# Provisions a dedicated publisher row in the publishers table plus a static
# feed JSON in the frontend bucket. The deploy-production workflow flips this
# publisher's `enabled` flag on, triggers ingest, asserts the events appear in
# the sidecar, flips it off, triggers ingest again, and asserts they retract.
#
# Baseline state on disk: `enabled = false`. Terraform owns only the create —
# subsequent `enabled` changes from CI are ignored via `lifecycle.ignore_changes`
# so a CI run that fails between toggles doesn't get clobbered back to true on
# the next `terraform apply`.

variable "enable_ci_e2e_publisher" {
  description = "Provision the dedicated CI end-to-end test publisher and its static feed. Set to false in environments without an associated GitHub Actions workflow (e.g. preview accounts)."
  type        = bool
  default     = true
}

locals {
  ci_e2e_publisher_id = "ci-e2e-test"
  ci_e2e_feed_s3_key  = "cache/ci-e2e/feed.json"
  ci_e2e_created_at   = "2026-05-03T00:00:00.000Z"
}

# Static feed file. Served via CloudFront at /cache/ci-e2e/feed.json. The
# deploy workflow's `aws s3 sync out/ ... --delete --exclude "cache/*"` step
# already excludes the cache prefix, so the frontend deploy will not delete
# this object.
resource "aws_s3_object" "ci_e2e_feed" {
  count = var.enable_ci_e2e_publisher ? 1 : 0

  bucket        = aws_s3_bucket.frontend_bucket.id
  key           = local.ci_e2e_feed_s3_key
  source        = "${path.module}/ci-e2e-feed.json"
  etag          = filemd5("${path.module}/ci-e2e-feed.json")
  content_type  = "application/json"
  cache_control = "public, max-age=60"
}

# Publisher registry row. trustLevel=auto so reconcile applies the diff
# without a manual review queue. enabled=false baseline — the workflow flips
# it on for the duration of the test and back off in cleanup.
resource "aws_dynamodb_table_item" "ci_e2e_publisher" {
  count = var.enable_ci_e2e_publisher ? 1 : 0

  table_name = aws_dynamodb_table.publishers.name
  hash_key   = aws_dynamodb_table.publishers.hash_key

  item = jsonencode({
    id           = { S = local.ci_e2e_publisher_id }
    name         = { S = "[CI] End-to-end deploy test" }
    contactEmail = { S = "bernard+ci-e2e@thebernsteins.com" }
    sourceUrl    = { S = "https://www.chqcal.org/${local.ci_e2e_feed_s3_key}" }
    sourceType   = { S = "json" }
    trustLevel   = { S = "auto" }
    enabled      = { BOOL = false }
    createdAt    = { S = local.ci_e2e_created_at }
  })

  lifecycle {
    # The CI workflow toggles `enabled` and the ingest Lambda writes
    # lastFetchedAt / lastFetchStatus / lastFetchMessage. None of those should
    # cause a Terraform diff — Terraform owns the row's existence and its
    # static identifying fields, not its runtime state.
    ignore_changes = [item]
  }
}
