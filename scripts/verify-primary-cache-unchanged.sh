#!/usr/bin/env bash
set -euo pipefail

BUCKET="${1:?usage: verify-primary-cache-unchanged.sh <bucket> [year]}"
KEY_PREFIX="cache/calendar-cache"
YEAR="${2:-2026}"
KEY="$KEY_PREFIX/all-events-$YEAR.json"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "Snapshot 1 of s3://$BUCKET/$KEY..."
aws s3 cp "s3://$BUCKET/$KEY" "$WORK/before.json"

echo "Triggering primary sync..."
aws lambda invoke --function-name chq-calendar-manual-sync "$WORK/primary.out" >/dev/null

echo "Triggering publisher ingest (the thing we're testing)..."
aws lambda invoke --function-name chq-publisher-ingest "$WORK/publisher.out" >/dev/null

# Give S3 a moment to be eventually-consistent.
sleep 10

echo "Snapshot 2..."
aws s3 cp "s3://$BUCKET/$KEY" "$WORK/after.json"

if cmp -s "$WORK/before.json" "$WORK/after.json"; then
  echo "PASS: $KEY is byte-equivalent before and after the publisher-ingest run."
else
  echo "FAIL: $KEY changed during the publisher-ingest run."
  diff <(jq -S . "$WORK/before.json") <(jq -S . "$WORK/after.json") | head -50
  exit 1
fi
