#!/usr/bin/env bash
set -euo pipefail

BUCKET="${1:?usage: verify-primary-cache-unchanged.sh <bucket> [year]}"
KEY_PREFIX="cache/calendar-cache"
YEAR="${2:-2026}"
KEY="$KEY_PREFIX/all-events-$YEAR.json"

# Override via env var when targeting a non-prod environment, e.g.:
#   PUBLISHER_INGEST_FUNCTION=chautauqua-calendar-staging-publisher-ingest \
#     scripts/verify-primary-cache-unchanged.sh <bucket>
PUBLISHER_INGEST_FUNCTION="${PUBLISHER_INGEST_FUNCTION:-chautauqua-calendar-publisher-ingest}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# This gate proves the publisher-ingest pipeline does NOT touch the primary
# all-events-${YEAR}.json file. It deliberately does not invoke the primary
# sync Lambda — running the primary sync would legitimately rewrite that file
# for reasons unrelated to publisher ingest, so its inclusion would invalidate
# the comparison. The script must be run during a window in which the primary
# sync schedule is quiet (e.g. between scheduled invocations).

echo "Snapshot 1 of s3://$BUCKET/$KEY..."
aws s3 cp "s3://$BUCKET/$KEY" "$WORK/before.json"

PRIMARY_LAST_MODIFIED_BEFORE=$(aws s3api head-object --bucket "$BUCKET" --key "$KEY" --query 'LastModified' --output text)
echo "Primary cache last modified before: $PRIMARY_LAST_MODIFIED_BEFORE"

echo "Triggering publisher ingest (the thing we're testing)..."
aws lambda invoke --function-name "$PUBLISHER_INGEST_FUNCTION" "$WORK/publisher.out" >/dev/null

# Give S3 a moment to be eventually-consistent.
sleep 10

echo "Snapshot 2..."
aws s3 cp "s3://$BUCKET/$KEY" "$WORK/after.json"

PRIMARY_LAST_MODIFIED_AFTER=$(aws s3api head-object --bucket "$BUCKET" --key "$KEY" --query 'LastModified' --output text)
echo "Primary cache last modified after:  $PRIMARY_LAST_MODIFIED_AFTER"

if [[ "$PRIMARY_LAST_MODIFIED_BEFORE" != "$PRIMARY_LAST_MODIFIED_AFTER" ]]; then
  echo "WARN: primary cache LastModified changed during the test window."
  echo "      A scheduled primary sync likely fired concurrently. The byte"
  echo "      comparison below cannot prove isolation under those conditions."
  echo "      Re-run the gate during a quiet primary-sync window."
fi

if cmp -s "$WORK/before.json" "$WORK/after.json"; then
  echo "PASS: $KEY is byte-equivalent before and after the publisher-ingest run."
else
  echo "FAIL: $KEY changed during the publisher-ingest run."
  diff <(jq -S . "$WORK/before.json") <(jq -S . "$WORK/after.json") | head -50
  exit 1
fi
