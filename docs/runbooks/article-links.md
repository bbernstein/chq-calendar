# Runbook — Chautauquan Daily Article Links

Pipeline: hourly EventBridge → `chautauqua-calendar-article-ingest` Lambda →
DynamoDB `chautauqua-calendar-articles` → S3 sidecar
`cache/calendar-cache/article-links-<year>.json` (5-min CloudFront cache) →
`useArticleLinks` hook → EventCard.

Spec: `docs/superpowers/specs/2026-07-15-chqdaily-article-links-design.md`.

## Manual trigger

    aws lambda invoke --function-name chautauqua-calendar-article-ingest \
      --payload '{}' /tmp/article-ingest-out.json

Optional payload `{"year": 2026}` targets a non-current season.

## Logs

    aws logs tail /aws/lambda/chautauqua-calendar-article-ingest --follow

Every successful run logs a one-line JSON summary
(`[article-ingest] summary: {fetched, upserted, articlesTotal, eventsTotal,
matchedEvents, linksPublished}`).

## Force a full rematch

Bump `MATCHER_VERSION` in `backend/src/services/articleMatcher.ts` (code
change + deploy), or delete the state object for a one-time rebuild:

    aws s3 rm s3://<frontend-bucket>/internal/article-links/article-links-state-2026.json

## Reset the article archive (full re-backfill)

Delete the watermark row (`pk = META#watermark`) from the articles table;
the next run re-backfills from June 1. Article rows are upserted in place,
so no table wipe is needed.

## Failure behavior

Any fetch/S3/DDB error aborts the run before the watermark advances — the
previous sidecar stays live and the next hourly run re-covers the gap.
Errors appear in the Lambda's CloudWatch error metric.
