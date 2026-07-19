# Runbook: CloudFront Traffic Analytics

How to read site traffic (unique/returning visitors, pageviews) for chqcal.org.
Infrastructure: `infrastructure/traffic-analytics.tf`. Design:
`docs/superpowers/specs/2026-07-19-cloudfront-traffic-analytics-design.md`.

## What this measures

CloudFront standard logs (v2) are delivered as Parquet to a private S3 bucket and
queried in Athena. There is **no cookie and no client-side tracking** — counts come
purely from CloudFront request logs.

A **pageview** is a request for a content object: an HTML page **or** a
`/cache/calendar-cache/*.json` data file (the hourly data pull, which is the best
signal of a long-lived app actively fetching updates). Because the HTML and JSON are
each cached ~1 hour, a browser produces at most ~1 request/hour for them.

Two headline numbers:
- **Pageviews (raw)** — every content request, split into page loads vs. data pulls.
- **Active visits** — distinct (visitor, hour) pairs; dedupes the multiple JSON files
  fetched per app-hour. This is the ≤1/hour/browser proxy.

**Visitor** = `md5(client-IP + user-agent)`. **Returning** = a visitor seen on ≥2 days.

## How to run a query

1. Open the Athena console (the URL is in the Terraform output
   `traffic_analytics_athena_url`), region **us-east-1**.
2. In the workgroup selector (top right), choose **`chautauqua-calendar-traffic`**.
3. Open the **Saved queries** tab. You'll see queries `01`–`12`.
4. Click one to load it, then **Run**. Results appear below and are also written to
   `s3://<log-bucket>/athena-results/` (auto-deleted after 30 days).

Queries `01`–`12`:

| # | Query | Answers |
|---|-------|---------|
| 01 | Pageviews by day (split) | Daily page loads vs. data pulls |
| 02 | Pageviews by week (split) | Weekly page loads vs. data pulls |
| 03 | Active visits by day | Daily ≤1/hr/browser visits |
| 04 | Active visits by week | Weekly active visits |
| 05 | Unique visitors by day | Distinct visitors/day |
| 06 | Unique visitors by week | Distinct visitors/week |
| 07 | Unique visitors season-to-date | One season total |
| 08 | New vs returning by day | Daily new vs. returning split |
| 09 | Top pages | Most-requested content objects |
| 10 | Top referrers | Where visitors come from |
| 11 | Visitors by country | Geographic breakdown |
| 12 | Visitors by network/carrier (ASN) | How much "unique" is one carrier-NAT pool |

Each query has a commented **optional bot filter** line near the top — uncomment it in
the editor to exclude obvious crawlers before running.

## How to read the numbers (important caveats)

- **IP-based uniqueness is approximate.** Traffic is phone-heavy. Mobile **carrier NAT**
  makes many people share one IP (deflates unique counts); **dynamic IPs** make one
  person look like several across sessions (inflates unique counts, and breaks
  "returning" detection). Read these as **trends**, not precise headcounts. Query 12
  (ASN) helps gauge how much of a "unique" count is really one carrier pool.
- **Logs lag minutes–hours.** Today's numbers fill in over the next few hours; don't
  expect real-time.
- **Cookies are empty.** The `cs_cookie` column exists but is blank — the app sets no
  cookies. This is intentional forward-compat (see the design's Open Follow-ups for the
  first-party visitor-ID next step that would make returning-visitor counts reliable).

## Cost & retention

Logging is free; Parquet + partition projection keep Athena scans at ~$0 for this
volume. Raw logs auto-expire after 90 days; Athena results after 30 days.

## Troubleshooting

- **A query errors with `HIVE_BAD_DATA` (type incompatible with `string`):** a Glue
  column type doesn't match the Parquet data — most likely `asn`. Change that column's
  `type` in `infrastructure/traffic-analytics.tf` (`aws_glue_catalog_table.cf_logs`) and
  re-apply. See the plan's Task 6 for detail.
- **Queries return no rows and `aws s3 ls s3://<bucket>/cf/` is empty:** logs can lag
  minutes–hours after first enabling; if still empty after a few hours, verify the S3
  path matches the Glue table `location` (see plan Task 6, Step 4).
