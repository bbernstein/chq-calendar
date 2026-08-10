# Runbook — Chautauquan Daily Article Links

Pipeline: hourly EventBridge → `chautauqua-calendar-article-ingest` Lambda →
DynamoDB `chautauqua-calendar-articles` → S3 sidecar
`cache/calendar-cache/article-links-<year>.json` (5-min CloudFront cache) →
`useArticleLinks` hook → EventCard.

Spec: `docs/superpowers/specs/2026-07-15-chqdaily-article-links-design.md`.

## Manual trigger

    aws lambda invoke --function-name chautauqua-calendar-article-ingest \
      --cli-binary-format raw-in-base64-out \
      --payload '{}' /tmp/article-ingest-out.json

`--cli-binary-format raw-in-base64-out` is required on AWS CLI v2 for a
raw JSON `--payload` (the default binary format expects base64).

Optional payload `{"year": 2026}` targets a non-current season.

## Logs

    aws logs tail /aws/lambda/chautauqua-calendar-article-ingest --follow

Every successful run logs a one-line JSON summary
(`[article-ingest] summary: {fetched, upserted, articlesTotal, eventsTotal,
matchedEvents, linksPublished}`).

## Force a full rematch

Bump `MATCHER_VERSION` in `backend/src/services/articleMatcher.ts` (code
change + deploy), or delete the state object for a one-time rebuild:

    aws s3 rm s3://<cache-bucket>/internal/article-links/article-links-state-2026.json

`<cache-bucket>` is the private `chautauqua-calendar-cache-*` bucket
(CloudFront-OAC-only, `aws_s3_bucket.cache_bucket` in
`infrastructure/main.tf`) — not the public frontend bucket. The match
state (scores/reasons) must stay off any world-readable bucket.

## Reset the article archive (full re-backfill)

Delete the watermark row (`pk = META#watermark`) from the articles table;
the next run re-backfills from June 1. Article rows are upserted in place,
so no table wipe is needed.

## Failure behavior

Any fetch/S3/DDB error aborts the run before the watermark advances — the
previous sidecar stays live and the next hourly run re-covers the gap.
Errors appear in the Lambda's CloudWatch error metric.

## Local testing (no production impact)

The ingest Lambda does not run through the local docker Express backend
(`backend/src/server.ts` only wraps the calendar/admin handlers). Two
host-run scripts drive the real pipeline locally instead. Both fetch
chqdaily.com (read-only public data), read events from
`frontend/public/data/all-events-<year>.json`, and write the sidecar to
`frontend/public/data/article-links-<year>.json` so `npm run dev` in the
frontend renders it. Neither touches AWS or production.

**Fast path — file-backed, no docker:**

    cd backend && npm run ingest:articles:local -- 2026
    cd ../frontend && npm run dev   # expand a matched event (e.g. search "Chuck Todd")

The article archive + match state persist to gitignored dotfiles
(`frontend/public/data/.article-archive-*.json`,
`.article-links-state-*.json`), so re-running shows incremental behavior
(second run: `upserted 0, linksPublished false`).

**Full-fidelity path — real AWS SDK against local DynamoDB + S3:**

    docker compose up -d dynamodb localstack
    cd backend && npx ts-node src/scripts/runArticleIngestLocalAws.ts 2026

This exercises the real `ArticleStore` (DynamoDB), `EventSnapshotLoader`
and `ArticleLinksPublisher` (S3) — including the public/private two-bucket
split (state lands in a private bucket only). It seeds a local S3 bucket
from the on-disk events file, runs the pipeline, then downloads the
generated sidecar to `frontend/public/data/` for the frontend to display.
Stop the containers with `docker compose down` when done.

Reset local state: delete the dotfiles above (file-backed), or
`docker compose down` and re-up (AWS-backed, in-memory DynamoDB +
LocalStack reset on restart).

Only the Lambda handler's env-var wiring
(`backend/src/handlers/articleIngestHandler.ts`) is not exercised by these
scripts — it constructs the same services these wire by hand, and first
runs for real on deploy.
