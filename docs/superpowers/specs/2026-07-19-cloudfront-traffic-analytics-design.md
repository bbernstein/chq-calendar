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

> **CloudFront standard access logs → S3 → Athena (saved queries run from the console).**

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
              ┌──────────────────┐
              │    CloudFront    │  standard access logging enabled
              │  (distribution)  │───────────────┐
              └──────────────────┘               │ gzipped W3C logs
                       │                          │ (minutes–hours delay)
       serves HTML + /cache/*.json                ▼
                       │                 ┌──────────────────┐
                       ▼                 │  S3 log bucket    │  cf/ prefix
                    browser              │  (private, 90-day │  lifecycle-expire
                                         │   lifecycle)      │
                                         └──────────────────┘
                                                  │
                                    Glue catalog table over cf/ prefix
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
| Log bucket | Durable, private store for raw CF logs; auto-expires after 90d | — |
| `logging_config` on distribution | Turns on standard logging into the bucket | Log bucket |
| Glue table | Schema over the raw logs so Athena can read them | Log bucket layout |
| Athena workgroup | Isolated query context + results location | Log bucket, Glue table |
| Named queries | The metric definitions, one click each | Glue table |
| Runbook | Human procedure + how to read the numbers | Athena workgroup |

Everything except the runbook is Terraform in `infrastructure/`.

---

## 4. Log Capture (Terraform)

**Log bucket** — new private bucket `chautauqua-calendar-cf-logs-<random>`:

- `aws_s3_bucket_public_access_block` — all four blocks `true`.
- **Object Ownership = `BucketOwnerPreferred`** (`aws_s3_bucket_ownership_controls`)
  and an ACL granting the CloudFront log-delivery group `WRITE`/`READ_ACP`. Legacy
  standard logging delivers via ACL, so the bucket must permit ACLs — it cannot be
  `BucketOwnerEnforced`. This is the one place we deliberately keep ACLs on.
- `aws_s3_bucket_lifecycle_configuration` — expire objects under `cf/` after
  **90 days** (raw IPs/cookies do not accumulate indefinitely). A second rule expires
  `athena-results/` after e.g. 30 days.

**Distribution logging** — add to `frontend_distribution`:

```hcl
logging_config {
  bucket          = aws_s3_bucket.cf_logs.bucket_domain_name
  prefix          = "cf/"
  include_cookies = true
}
```

`include_cookies = true` is deliberate forward-compatibility: today the `cs(Cookie)`
field will be empty on every request (the app sets no cookies), but the field is then
already captured for a *future* iteration that introduces a session cookie — no
Terraform change needed later. CloudFront logs cookies on all paths regardless of
cache-behavior forwarding; see Privacy (§8) for why this is safe today.

---

## 5. Query Layer (Terraform)

- **Glue database** (`aws_glue_catalog_database`) e.g. `chq_cloudfront_logs`.
- **Glue table** (`aws_glue_catalog_table`) over `s3://<log-bucket>/cf/`, using the
  AWS-published CloudFront standard-log DDL: `LazySimpleSerDe`, `field.delim = '\t'`,
  `skip.header.line.count = '2'` (CloudFront prepends two `#Version`/`#Fields`
  comment lines). Columns: `date`, `time`, `x_edge_location`, `sc_bytes`, `c_ip`,
  `cs_method`, `cs_host`, `cs_uri_stem`, `sc_status`, `cs_referer`, `cs_user_agent`,
  `cs_uri_query`, `cs_cookie`, `x_edge_result_type`, … (full 33-field W3C set).
- **Athena workgroup** (`aws_athena_workgroup`) e.g. `chq-traffic` with
  `result_configuration.output_location = s3://<log-bucket>/athena-results/`.
- **Unpartitioned table.** Legacy standard logs encode the date in the *filename*,
  not the S3 path, so Hive partition projection is awkward. At this site's volume
  (a few MB/day) an unpartitioned full scan costs a fraction of a cent per query.
  If volume ever makes scans costly, switch to standard-logging-v2 with Hive-
  partitioned paths + partition projection. **YAGNI for Phase A.**
- **Named queries** (`aws_athena_named_query`, one per §7 query) so each is one
  click in the console.

---

## 6. Metric Definitions

**`visitor_key`** = `lower(to_hex(md5(to_utf8(concat(c_ip, '|', cs_user_agent)))))`.
Hashing means aggregate outputs never contain raw IPs. IP-only (`c_ip`) is a trivial
variant if ever wanted.

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

Each named query carries a comment header documenting its metric definition and the
optional bot-filter line, so the runbook and the SQL stay in sync.

---

## 8. Privacy & Retention

- **Cookies are indiscriminate but empty today.** `include_cookies = true` logs every
  cookie on every path — but the app sets none and admin auth travels in the
  `Authorization` header (not logged), so `cs(Cookie)` is `-` on every request. No
  tokens leak. The field is captured now purely so future session-cookie work needs no
  logging change.
- **Raw logs auto-expire after 90 days** (S3 lifecycle). Only whatever aggregates you
  choose to record persist longer.
- **Aggregates are hashed** (`visitor_key` = md5 of IP+UA); we only ever look at
  counts, never export raw IPs.
- **Log bucket is fully private** (public-access-block on; ACL grants only the
  CloudFront log-delivery group + bucket owner).

---

## 9. Cost

- **Standard logging:** free (no per-request charge).
- **S3 storage:** a few MB/day of gzipped logs → cents/month; capped by the 90-day
  lifecycle.
- **Athena:** $5/TB scanned. At MB-per-query this rounds to $0. Results bucket
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

- Terraform in `infrastructure/`: log bucket (+ ownership/ACL, public-access-block,
  lifecycle), `logging_config` on the distribution, Glue DB + table, Athena workgroup
  + results location, named queries, Athena-console URL output.
- Runbook `docs/runbooks/traffic-analytics.md`.

**Out of scope:**

- No frontend/backend/app code. No unit tests (Terraform-only change; validated via
  `terraform plan`/`terraform validate`).
- Phase B (CloudWatch custom metrics) and Phase C (admin-page dashboard) — deferred
  until a week of Phase-A data is reviewed.

**Verification:**

1. `terraform validate` and `terraform plan` are clean.
2. `terraform apply`.
3. Wait for the first log files to appear under `s3://<log-bucket>/cf/` (minutes–hours).
4. Run each named query in the Athena console; confirm sane, non-empty numbers.
5. Confirm `cs_cookie` is `-` (as expected) and no `Authorization`/token data appears.

---

## Open Follow-ups (post-Phase-A)

- Decide B vs C after reviewing a week of real data.
- If log volume grows enough to matter, migrate to standard-logging-v2 with Hive
  partitioning + Athena partition projection.
- When a real session cookie is introduced, the cookie field is already captured;
  add session-oriented queries then.
