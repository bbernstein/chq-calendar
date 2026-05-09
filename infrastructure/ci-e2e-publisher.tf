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
#
# Safety net: if a CI runner dies mid-test leaving enabled=true, the hourly
# publisher-ingest Lambda will auto-disable this row when it's been stale
# for more than ~1h. Staleness compares against lastFetchedAt, falling back
# to createdAt when no fetch has been recorded yet (covers the case of a
# runner that enabled the row but died before any successful ingest). See
# backend/src/handlers/publisherIngestHandler.ts (CI_E2E_STALE_THRESHOLD_MS,
# autoDisableStaleCiE2e) for the implementation.

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
    #
    # Tradeoff: aws_dynamodb_table_item exposes only the whole `item` JSON,
    # so this also silences drift on the static fields above (name,
    # contactEmail, sourceUrl, sourceType, trustLevel, createdAt). To
    # re-apply a change to any of those, replace the row explicitly:
    #     terraform apply -replace='aws_dynamodb_table_item.ci_e2e_publisher[0]'
    ignore_changes = [item]
  }
}

# ─── Post-deploy publisher-lifecycle smoke fixture ─────────────────────────
#
# Static feed used by scripts/smoke/publisher-lifecycle.test.ts. Unlike the
# ci-e2e publisher above, the smoke creates+deletes its publisher row each
# run (it's an apply→approve→...→disable lifecycle test, not a toggle test).
# What's static is just the feed itself + the publisher.id baked into it.
# The smoke route in adminHandler.ts honors a `publisherId` override field
# scoped to this exact id ("smoke-bbtest") so the row gets created with the
# id that matches the feed's publisher.id (otherwise the fetcher rejects on
# id mismatch).

locals {
  smoke_bbtest_feed_s3_key = "cache/smoke/bbtest-feed.json"
}

resource "aws_s3_object" "smoke_bbtest_feed" {
  # Mirror the count gate on `aws_s3_object.ci_e2e_feed`: in environments
  # where the CI/smoke infrastructure is deliberately disabled (preview
  # accounts), don't upload the smoke fixture either. The smoke route in
  # adminHandler.ts is unreachable in those environments anyway, so the S3
  # object would be unused dead weight.
  count = var.enable_ci_e2e_publisher ? 1 : 0

  bucket        = aws_s3_bucket.frontend_bucket.id
  key           = local.smoke_bbtest_feed_s3_key
  source        = "${path.module}/smoke-publisher-feed.json"
  etag          = filemd5("${path.module}/smoke-publisher-feed.json")
  content_type  = "application/json"
  cache_control = "public, max-age=60"
}
