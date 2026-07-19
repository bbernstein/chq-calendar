# CloudFront Traffic Analytics — Design (Approach A)

**Status:** Approved design, ready for implementation plan
**Date:** 2026-07-19
**Author:** brainstormed with Claude
**Scope:** Phase A only (log capture + Athena query layer + runbook). Phases B and C deferred.

---

## 1. Summary & Goal

We want to see how much traffic the Chautauqua Calendar site receives — specifically
**unique visitors, returning visitors, and pageviews** — for a static site served
entirely from CloudFront, with no application server to record page views, and
**without setting cookies** for tracking.

Today **none of this data exists.** There is no CloudFront access logging of any
kind, so there is no per-request record of client IPs, user-agents, or URLs. The
only frontend observability is the aggregate `AWS/CloudFront` CloudWatch dashboard
(`chautauqua-calendar-cloudfront-monitoring`), which reports total request counts
but *cannot* distinguish unique from returning visitors — standard metrics carry no
per-client identity.

To get visitor-level numbers we must begin capturing a per-request signal (viewer
IP + user-agent). This design does that with the lowest-effort, cookieless,
fully-in-AWS approach:

> **CloudFront standard logging v2 → S3 (Parquet, partitioned) → Athena (saved queries run from the console).**

This is **Phase A** of a staged plan. Phase A is a strict *subset* of the richer
options, so nothing here is throwaway:

- **Phase A (this doc):** capture logs + Athena named queries, run manually.
- **Phase B (deferred):** scheduled Lambda computes rollups → CloudWatch custom
  metrics → widgets on the existing dashboard.
- **Phase C (deferred):** scheduled Athena rollups → DynamoDB → endpoint in
  `adminHandler` → a dashboard page in the admin area.

B and C are revisited only after a week of real Phase-A data confirms the metric
definitions are meaningful.

---

## 2. Current State (verified 2026-07-19)

- **CloudFront access logging is OFF.** `aws_cloudfront_distribution.frontend_distribution`
  (`infrastructure/main.tf:401`) has no `logging_config` block, and there is no
  `aws_cloudfront_realtime_log_config` anywhere. No log S3 bucket exists.
- **Aggregate-only dashboard exists.** `aws_cloudwatch_dashboard.cloudfront_dashboard`
  (`infrastructure/main.tf:693`) shows Requests / BytesDownloaded / error rates /
  cache-hit rate from the `AWS/CloudFront` namespace. Useful for volume, useless for
  uniqueness.
- **CloudFront Functions already in use** (viewer-request): `api_rewrite` (strips
  `/api`, `/admin/api`) and `www_redirect` (apex → www). Establishes the edge-code
  pattern; not needed for Phase A.
- **The app is cookieless.** Admin auth stores a JWT in `localStorage` and sends it
  as an `Authorization: Bearer` header (`frontend/src/lib/auth.ts:12`); no
  `credentials: 'include'`; no `document.cookie` writes. Standard logs do not record
  the `Authorization` header.
- **Region:** `us-east-1` (single region). Terraform AWS provider `~> 6.0`.
- **Closest existing per-request data:** API Gateway access logs in CloudWatch
  (include `sourceIp`) — but they cover *API calls*, not page/content views, so they
  are not a substitute.

---

## 3. Architecture

```
                 viewer request
                       │
                       ▼
              ┌──────────────────┐        CloudWatch Logs vended-logs delivery
              │    CloudFront    │  ┌──────────────────────────────────────┐
              │  (distribution)  │──│ delivery source → destination →       │
              └──────────────────┘  │ delivery  (log_type = ACCESS_LOGS)    │
                       │            └──────────────────────────────────────┘
       serves HTML + /cache/*.json               │ Parquet, hive-partitioned
                       │                          │ cf/{yyyy}/{MM}/{dd}/  (min–hr delay)
                       ▼                          ▼
                    browser              ┌──────────────────┐
                                         │  S3 log bucket    │  BucketOwnerEnforced
                                         │  (private, no ACL │  (ACLs disabled),
                                         │   90-day lifecycle)│  bucket-policy delivery
                                         └──────────────────┘
                                                  │
                              Glue table (Parquet SerDe) + partition projection
                                                  │
                                                  ▼
                                         ┌──────────────────┐
                                         │      Athena      │  named queries,
                                         │   (workgroup)    │  run from console
                                         └──────────────────┘
                                                  │
                                       results → athena-results/ prefix
```

**Component boundaries (each independently understandable/testable):**

| Component | Purpose | Depends on |
|-----------|---------|------------|
| Log bucket | Durable, private (ACLs disabled) store for CF logs; auto-expires after 90d | — |
| Bucket policy | Allows `delivery.logs.amazonaws.com` to write logs (no ACL) | Log bucket |
| Log-delivery trio (source/destination/delivery) | Turns on logging v2 into the bucket, in Parquet + partitioned | Log bucket, bucket policy |
| Glue table | Partitioned Parquet schema so Athena can read the logs | Log bucket layout |
| Athena workgroup | Isolated query context + results location | Log bucket, Glue table |
| Named queries | The metric definitions, one click each | Glue table |
| Runbook | Human procedure + how to read the numbers | Athena workgroup |

Everything except the runbook is Terraform in `infrastructure/`.

---

## 4. Log Capture (Terraform)

We use **CloudFront standard logging v2**, which delivers through the CloudWatch Logs
"vended logs" delivery pipeline. Unlike legacy logging (ACL-based), v2 delivers via a
**bucket policy**, so the bucket can disable ACLs entirely.

**Log bucket** — new private bucket `chautauqua-calendar-cf-logs-<random>`:

- `aws_s3_bucket_public_access_block` — all four blocks `true`.
- **Object Ownership = `BucketOwnerEnforced`** (`aws_s3_bucket_ownership_controls`) —
  **ACLs fully disabled.** No ACL grants anywhere.
- `aws_s3_bucket_policy` granting `delivery.logs.amazonaws.com` `s3:PutObject` into the
  `cf/` prefix, conditioned on `aws:SourceAccount` (the account id) and the delivery
  ARN (`aws:SourceArn`) to prevent cross-account log injection.
- `aws_s3_bucket_lifecycle_configuration` — expire objects under `cf/` after
  **90 days** (raw IPs/cookies do not accumulate indefinitely). A second rule expires
  `athena-results/` after e.g. 30 days.

**Logging v2 delivery** — three CloudWatch Logs delivery resources (created in
`us-east-1`, where the distribution's global logs are managed):

```hcl
resource "aws_cloudwatch_log_delivery_source" "cf_access" {
  name         = "chq-cf-access-logs"
  resource_arn = aws_cloudfront_distribution.frontend_distribution.arn
  log_type     = "ACCESS_LOGS"
}

resource "aws_cloudwatch_log_delivery_destination" "cf_access_s3" {
  name          = "chq-cf-access-logs-s3"
  output_format = "parquet"
  delivery_destination_configuration {
    # `/cf` prefix on the destination ARN suppresses CloudFront's default
    # AWSLogs/<acct>/CloudFront/ path, giving the predictable base s3://<bucket>/cf/.
    destination_resource_arn = "${aws_s3_bucket.cf_logs.arn}/cf"
  }
}

resource "aws_cloudwatch_log_delivery" "cf_access" {
  delivery_source_name     = aws_cloudwatch_log_delivery_source.cf_access.name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.cf_access_s3.arn

  s3_delivery_configuration {
    suffix_path                 = "{yyyy}/{MM}/{dd}"
    enable_hive_compatible_path = true
  }

  # Field selection (v2 replaces legacy include_cookies): capture exactly what
  # the metrics need, plus a few cheap identity/segmentation signals. Field names
  # are the AWS API names — parenthesized fields log as underscored Parquet columns.
  record_fields = [
    "date", "time", "c-ip", "cs-method", "cs-uri-stem", "sc-status",
    "cs(Referer)", "cs(User-Agent)", "cs(Cookie)", "x-edge-result-type",
    # Identity / segmentation signals (near-zero cost, captured now):
    "asn", "c-country", "ssl-protocol", "ssl-cipher",
  ]
}
```

**Capturing cookies:** v2 replaces legacy's `include_cookies = true` with explicit
field selection — including `cs-cookie` in `record_fields` is the equivalent. Today
that field is empty on every request (the app sets no cookies), but it is captured now
so a *future* session-cookie iteration needs no delivery change. See Privacy (§8) for
why this is safe today. (Field selection is also a privacy win: we log only the fields
listed above, nothing more.)

**Extra identity/segmentation fields (folded in per design review):**

- **`asn`** — viewer's network/carrier (autonomous system number). The most useful
  extra signal for this phone-heavy traffic: it disambiguates many users behind one
  carrier-NAT IP and enables carrier/network breakdowns. Captured as a **reporting
  dimension**, *not* baked into `visitor_key` (see §6).
- **`c-country`** — viewer country (IP geolocation). Free geographic segmentation.
- **`ssl-protocol` / `ssl-cipher`** — coarse TLS-stack characteristics; captured now as
  low-value tiebreaker entropy for a possible future keying experiment, unused by the
  Phase-A metrics.

These are all standard-logging-v2 selectable fields — no functions, no extra infra.

---

## 5. Query Layer (Terraform)

- **Glue database** (`aws_glue_catalog_database`) e.g. `chq_cloudfront_logs`.
- **Glue table** (`aws_glue_catalog_table`) over `s3://<log-bucket>/cf/`, using the
  **Parquet SerDe** (`org.apache.hadoop.hive.ql.io.parquet.*`). Columns follow the v2
  Parquet field names for the selected `record_fields`: `date`, `time`, `c_ip`,
  `cs_method`, `cs_uri_stem`, `sc_status`, `cs_referer`, `cs_user_agent`, `cs_cookie`,
  `x_edge_result_type`, `asn`, `c_country`, `ssl_protocol`, `ssl_cipher` — all typed
  `string`. The Parquet footer emits mixed-case names for the parenthesized fields
  (`cs_Referer`, `cs_User_Agent`, `cs_Cookie`); the table sets
  `parquet.column.index.access = "false"` so Athena matches columns by name
  (case-insensitively) rather than by position.
- **Partitioned with partition projection.** Because v2 writes Hive-compatible paths
  (`cf/year=…/month=…/day=…` via `enable_hive_compatible_path`), the table declares
  `year`/`month`/`day` partition keys and uses Athena **partition projection**
  (`projection.enabled = true`, date-range projection) — so partitions are
  discovered with no crawler and no `MSCK REPAIR`. Adding a `year`/`month`/`day`
  predicate to a query then prunes the scan, keeping cost controllable as volume
  grows without any re-architecture.
- **Athena workgroup** (`aws_athena_workgroup`) e.g. `chq-traffic` with
  `result_configuration.output_location = s3://<log-bucket>/athena-results/`.
- **Named queries** (`aws_athena_named_query`, one per §7 query) so each is one
  click in the console. The Phase-A one-click queries do **not** filter on the
  `year`/`month`/`day` partition columns — they scan the full retention window,
  which is negligible at this volume. A partition predicate can be added in the
  console to prune scans if the dataset grows (documented in the runbook).

---

## 6. Metric Definitions

**`visitor_key`** = `lower(to_hex(md5(to_utf8(concat(c_ip, '|', cs_user_agent)))))`.
Hashing means aggregate outputs never contain raw IPs. IP-only (`c_ip`) is a trivial
variant if ever wanted.

The key stays **IP + UA only.** `asn`, `c_country`, and the `ssl_*` fields are captured
(§4) but are treated as **reporting dimensions** — you can group/segment by them (e.g.
"unique visitors by carrier") — *not* folded into `visitor_key`. Rationale (§ design
review): adding fingerprint entropy reduces NAT over-merging a little but makes the key
more volatile across sessions, which worsens the dominant mobile error (IP churn
over-splitting one user into many keys). The genuine fix for cross-session identity is
a persistent client-side ID, which is the designated deferred next step (§ Open
Follow-ups), not more passive entropy.

**Content object** — the requests that represent real user activity:

- an **HTML document**: `cs_uri_stem` ends in `/` or `.html`; **OR**
- a **data pull**: `cs_uri_stem LIKE '/cache/calendar-cache/%.json'`
  (covers `article-links-2026.json`, `years.json`, `publisher-events-2026.json`, and
  any future year-versioned data files).

In all cases: `cs_method = 'GET'`, `sc_status IN (200, 304)`, and **exclude**
`/api*`, `/admin/api*`, `/auth*`, admin HTML (`/admin*`), and static assets
(`.js/.css/.png/.svg/.ico/.woff*` etc.). Excluding `/admin*` keeps operator traffic
(just the site owner) out of public numbers.

Rationale for including data pulls: the site is a long-lived PWA. The HTML loads once
(and is cached ~1 hr), but an open app keeps fetching `/cache/calendar-cache/*.json`
every hour as the data refreshes. The JSON fetch is therefore the *truest* signal of
"a real user is actively getting updates," and is just as cache-bounded (≤1/hr/browser)
as the HTML.

**The two headline numbers** (a single active app-hour fetches ~2–3 JSON files, so a
raw per-request count inflates ~3× per browser-hour — hence two numbers, not one):

- **Pageviews (raw)** — count of content-object GETs, **split by object type**
  (HTML page load vs. each data file). This is literally "count the JSON fetches."
  Shows dynamic data-pull volume.
- **Active visits** — `COUNT(DISTINCT (visitor_key, date, hour))` over content
  objects. Dedupes the multi-file-per-hour inflation; **this is the ≤1/hr/browser
  proxy.** A phone left open pulling data for 6 hours = 6 active visits = "this user
  got updates 6 times."

**Visitor metrics:**

- **Unique visitors (period)** = `COUNT(DISTINCT visitor_key)` over content objects
  in a day / week / season-to-date window.
- **Returning visitors (period)** = visitor_keys appearing on **≥2 distinct dates**.
- **New vs returning (per day)** = for each day, split that day's visitor_keys by
  whether the key was seen on any earlier date.

**Optional bot filter:** a commented-out `AND NOT regexp_like(cs_user_agent,
'(?i)bot|spider|crawl|slurp|preview|monitor')` clause is included in each query so
obvious crawlers can be removed when reading the numbers.

---

## 7. Saved Query Set

All queries live in the `chq-traffic` workgroup against the Glue table. Shipped as
`aws_athena_named_query` resources:

1. **Pageviews by day (split HTML vs data-pull)** — `date`, object class, count.
2. **Pageviews by week (split)** — ISO week rollup.
3. **Active visits by day** — distinct `(visitor_key, date, hour)` per day.
4. **Active visits by week.**
5. **Unique visitors by day / week / season-to-date** — distinct `visitor_key`.
6. **New vs returning by day** — first-seen-date self-comparison.
7. **Top pages** — content object stems by request count.
8. **Top referrers** — `cs_referer` by count.
9. **Visitors by country** — unique visitors grouped by `c_country` (segmentation).
10. **Visitors by network/carrier** — unique visitors grouped by `asn`; useful for
    reading how much of the "unique" count is really one carrier-NAT pool on mobile.

Each named query carries a comment header documenting its metric definition and the
optional bot-filter line, so the runbook and the SQL stay in sync.

---

## 8. Privacy & Retention

- **Only selected fields are logged.** v2 `record_fields` captures exactly the 13
  fields listed in §4 (metrics + a few identity/segmentation signals) and nothing else.
  `asn`/`c_country` are network- and country-level, not personally identifying beyond
  the IP we already log.
- **Cookies are captured but empty today.** `cs-cookie` is in `record_fields`, but the
  app sets no cookies and admin auth travels in the `Authorization` header (not among
  the selected fields, and not logged), so the cookie field is empty on every request.
  No tokens leak. The field is captured now purely so future session-cookie work needs
  no delivery change.
- **Raw logs auto-expire after 90 days** (S3 lifecycle). Only whatever aggregates you
  choose to record persist longer.
- **Aggregates are hashed** (`visitor_key` = md5 of IP+UA); we only ever look at
  counts, never export raw IPs.
- **Log bucket is fully private with ACLs disabled** (`BucketOwnerEnforced`;
  public-access-block on all four). Delivery is authorized by a scoped bucket policy
  (`delivery.logs.amazonaws.com`, conditioned on source account + delivery ARN), not by
  an ACL.

---

## 9. Cost

- **Standard logging:** free (no per-request charge).
- **S3 storage:** a few MB/day of compressed Parquet → cents/month; capped by the
  90-day lifecycle. (There is a small CloudWatch vended-logs delivery charge per GB
  delivered — negligible at this volume.)
- **Athena:** $5/TB scanned. Columnar Parquet + partition projection means queries
  scan only the needed columns for the needed days, rounding to $0. Results bucket
  auto-expires.

Effectively free at this site's scale.

---

## 10. How You'll Use It

- **Runbook:** `docs/runbooks/traffic-analytics.md` — open Athena, select the
  `chq-traffic` workgroup, run a named query, read the result. Includes a "how to read
  these numbers" section restating the **IP-based-uniqueness-is-approximate** caveat:
  mobile carrier NAT makes users share an IP (deflates unique counts) and dynamic IPs
  make one user look like several (inflates). Good for trends, not precise headcounts.
- **Terraform output:** a deep-link Athena console URL for the workgroup (mirrors the
  existing `cloudfront_dashboard` URL output at `infrastructure/main.tf:1897`).

---

## 11. Scope & Verification

**In scope (Phase A):**

- Terraform in `infrastructure/`: log bucket (BucketOwnerEnforced, public-access-block,
  bucket policy, lifecycle), the logging-v2 delivery trio
  (source/destination/delivery), Glue DB + partitioned table, Athena workgroup +
  results location, named queries, Athena-console URL output.
- Runbook `docs/runbooks/traffic-analytics.md`.

**Out of scope:**

- No frontend/backend/app code. No unit tests (Terraform-only change; validated via
  `terraform plan`/`terraform validate`).
- Phase B (CloudWatch custom metrics) and Phase C (admin-page dashboard) — deferred
  until a week of Phase-A data is reviewed.

**Verification:**

1. `terraform validate` and `terraform plan` are clean.
2. `terraform apply`.
3. Wait for the first Parquet files to appear under the partitioned
   `s3://<log-bucket>/cf/…` path (minutes–hours).
4. Run each named query in the Athena console; confirm sane, non-empty numbers and
   that partition projection prunes correctly (query one day, check bytes scanned).
5. Confirm `cs_cookie` is empty (as expected) and no `Authorization`/token data appears.
6. Confirm the bucket has ACLs disabled (`BucketOwnerEnforced`) and is not public.

---

## Open Follow-ups (post-Phase-A)

### Designated next step — first-party visitor ID (cookie / localStorage)

Passive IP+UA (even with `asn`) cannot reliably track a mobile user across sessions —
IP churn splits one person into many keys. The **real fix, and the intended next step**,
is a persistent first-party visitor ID. This design is deliberately built so we can
switch to it **without re-architecting** the pipeline, *if and when the owner is
comfortable setting a cookie on user browsers*:

- **Invariant that must hold either way:** the hourly `/cache/calendar-cache/*.json`
  files stay **byte-identical and user-agnostic** — shared public data, cached and
  served the same to everyone. No visitor ID is *ever* injected into a response body,
  and the "content requests don't touch an application" boundary is preserved. The ID
  lives only on the *request* side and in the logs, never in shared content.
- **What gets added:** a small, random, non-PII visitor ID (e.g. a UUID) minted once
  per browser and persisted. Two clean placements, decided at that time:
  - **First-party cookie (primary planned approach).** Set once — by a viewer-response
    CloudFront Function or by client JS — scoped to the site domain. The browser then
    attaches it automatically to every same-origin request, so **it needs no change to
    how content is fetched**, and **the `cs-cookie` field is already in `record_fields`,
    so it flows into the logs the moment the cookie exists**. To keep the shared cache
    intact, the cache behaviors are configured to **exclude the cookie from the cache
    key** (do not vary on it) — CloudFront still *logs* the cookie while serving the
    same cached object to all users. Clean: the ID rides the request header, never the
    response.
  - **localStorage + a dedicated beacon (cookieless variant).** If we want to avoid
    cookies entirely, the client mints/reads a localStorage ID and sends it on its own
    **purpose-built beacon request** — e.g. `GET /px?v=<id>`, handled by a viewer-request
    CloudFront Function that returns `204` (no origin hit) and records the ID via
    `cf.logCustomData()` → `viewer-request-log-data`. This keeps the content requests
    pure and makes the tracking *explicit and separate* rather than piggybacked. The
    honest tradeoff vs. the cookie: it adds a small client snippet plus one beacon
    route/function — a bit more surface, but no cookie and no touching the JSON.
- **What changes downstream:** `visitor_key` switches from `md5(IP‖UA)` to the visitor
  ID (falling back to `md5(IP‖UA)` when the ID is absent — e.g. first-ever request or
  cookies disabled). Only the query definitions change; capture, bucket, table, and
  workgroup are untouched. **Unique** and especially **returning** visitor counts
  become reliable across IP changes.
- **Privacy posture to settle then:** the ID is random and app-scoped (no cross-site
  tracking); document it in a privacy note; the 90-day raw-log expiry still applies.

This is why cookies are captured now (empty today) and why the visitor-key logic is
isolated in the queries rather than the capture layer — the switch is a query change,
not a migration.

### Other deferred items

- **Decide B vs C** (CloudWatch custom metrics vs admin-page dashboard) after reviewing
  a week of real Phase-A data.
- **Optional — JA3/TLS fingerprint experiment.** *Only if* Phase-A data shows NAT
  over-merging is materially distorting unique counts, try logging a JA3 fingerprint
  via a CloudFront Function + `cf.logCustomData()` → `viewer-request-log-data` (fits our
  existing viewer-request functions; no Kinesis/Lambda@Edge). Note JA3 is a *group*
  fingerprint (browser+OS+TLS stack), not per-user — a NAT-disambiguation booster, not
  a substitute for the first-party ID above.
