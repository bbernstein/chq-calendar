# Runbook — Digital Program Links

Pipeline: hourly EventBridge → `chautauqua-calendar-program-ingest` Lambda →
full scrape of audienceaccess.co (no DynamoDB, no watermark — every run is a
full re-scrape and full re-match) → S3 sidecar
`cache/calendar-cache/program-links-<year>.json` (frontend bucket, 5-min
CloudFront cache) → `useProgramLinks` hook → EventCard (web) /
`programLinks(for:)` (iOS).

Spec: `docs/superpowers/specs/2026-08-05-program-links-design.md`.

## Manual trigger

    aws lambda invoke --function-name chautauqua-calendar-program-ingest \
      --cli-binary-format raw-in-base64-out \
      --payload '{"year":2026}' /tmp/out.json

`--cli-binary-format raw-in-base64-out` is required on AWS CLI v2 for a raw
JSON `--payload` (the default binary format expects base64). `year`
defaults to the current year if omitted.

## Logs

    aws logs tail /aws/lambda/chautauqua-calendar-program-ingest --follow

Every successful run logs a one-line JSON summary
(`[program-ingest] summary: {programs, dated, undated, eventsTotal,
matchedEvents, linksPublished}`). On 2026-08-05 the corpus scraped 126
programs and matched 96 events.

## Force a full rematch

Every run is already a full re-scrape and full re-match (there's no
watermark to reset), so bumping `MATCHER_VERSION` in
`backend/src/services/programMatcher.ts` (code change + deploy) is the only
way to force a republish when the link set hasn't otherwise changed —
`computeProgramMatchState` treats a matcher-version bump as `linksChanged`
regardless of whether the matches themselves differ.

To rebuild the private state from scratch (debugging only — has no effect
on matching, since matching doesn't consult the previous state):

    aws s3 rm s3://<cache-bucket>/internal/program-links/program-links-state-2026.json

`<cache-bucket>` is the private `chautauqua-calendar-cache-*` bucket
(CloudFront-OAC-only, `aws_s3_bucket.cache_bucket` in
`infrastructure/main.tf`) — not the public frontend bucket. The match state
(scores/reasons) must stay off any world-readable bucket.

## Zero-programs abort (markup drift)

`AudienceAccessClient.fetchPrograms()` throws if either listing page
returns a non-2xx response, and `runProgramIngest` throws (without
publishing) if the combined scrape parses to **zero** programs. Either way
the Lambda invocation fails, the CloudWatch error metric fires, and the
previously published sidecar stays live — links never vanish because of a
transient outage or a markup change.

**Diagnosis:**

1. Confirm it's markup drift and not a transient outage — curl both
   listing pages directly:

       curl -s https://audienceaccess.co/CHQ | head -c 2000
       curl -s https://audienceaccess.co/past/CHQ | head -c 2000

   If both return normal-looking HTML but the Lambda still reports zero
   programs, the site's structure changed.

2. Compare the live markup against the selectors in
   `backend/src/services/audienceAccessClient.ts`:
   - Upcoming page (`/CHQ`): `.slide` blocks, with
     `a[href*="/show/CHQ-"]`, `.mobile-index-footer-show-name`,
     `.mobile-index-footer-show-date`.
   - Past page (`/past/CHQ`): `.mobile-past-events-feature-box` blocks,
     with `a[href*="/show/CHQ-"]`, `.mobile-past-events-feature-title`,
     `.mobile-past-events-feature-dates`.
   - A show is only kept if it has both a `show/CHQ-<id>` link and a
     non-empty title — a class-name rename on either the link or the
     title/date nodes silently drops all entries from that page.

3. Update the selectors in `audienceAccessClient.ts` and the captured HTML
   fixtures under `backend/src/__tests__/fixtures/` (`parseUpcomingPage`
   and `parsePastPage` are covered by
   `backend/src/__tests__/audienceAccessClient.test.ts`), deploy, and
   re-invoke manually to confirm a non-zero `programs` count in the
   summary log.

## Sidecar / state paths

- Public sidecar (frontend bucket):
  `cache/calendar-cache/program-links-<year>.json`
- Private match state (cache bucket, never world-readable):
  `internal/program-links/program-links-state-<year>.json`

## Failure behavior

Any fetch/parse/S3 error aborts the run before anything publishes — the
previous sidecar stays live and the next hourly run retries. Errors appear
in the Lambda's CloudWatch error metric.

## Local testing (no production impact)

The ingest Lambda does not run through the local docker Express backend.
`npm run ingest:programs:local` (bare `ts-node` under the hood — no docker
required) drives the real pipeline locally: it scrapes the real
audienceaccess.co listing pages (read-only, public), reads events from
`frontend/public/data/all-events-<year>.json`, and writes the sidecar to
`frontend/public/data/program-links-<year>.json` so `npm run dev` in the
frontend renders it. It never touches AWS.

    cd backend && npm run ingest:programs:local -- 2026
    cd ../frontend && npm run dev   # expand a matched event to see the link

The private match state persists to a gitignored dotfile
(`frontend/public/data/.program-links-state-<year>.json`) for debugging;
re-running always re-scrapes and re-matches from scratch (there's no
incremental skip to observe, unlike the article pipeline).

Only the Lambda handler's env-var wiring
(`backend/src/handlers/programIngestHandler.ts`) is not exercised by this
script — it constructs the same services the script wires by hand, and
first runs for real on deploy.
