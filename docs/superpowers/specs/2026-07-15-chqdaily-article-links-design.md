# Chautauquan Daily Article Links — Design Spec

**Date:** 2026-07-15
**Status:** Approved design, pending implementation plan
**Issue:** [#134](https://github.com/bbernstein/chq-calendar/issues/134)

## Summary

Link calendar events to their coverage in The Chautauquan Daily
(chqdaily.com). An hourly Lambda ingests articles from the paper's
WordPress REST API (metadata **and full body text**), matches them to
events with a deterministic heuristic scorer, and publishes an
`article-links-<year>.json` sidecar to the existing calendar-cache
path on S3/CloudFront. The frontend fetches the sidecar and renders
newspaper links on event cards.

**Phasing.** This spec covers Phase 1 (heuristic matching, complete
end-to-end loop). AI-model matching and embedding/vector deep-matching
are Phase 2: the article archive already stores full body text so
Phase 2 needs no re-ingestion, and the matcher's `matcherVersion`
mechanism gives Phase 2 a clean upgrade path. No vector database, LLM
calls, or admin review UI in Phase 1.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Phasing | Heuristic-only v1; AI + embeddings deferred to Phase 2 |
| Backfill | Full season backfill via WP REST API + durable archive |
| Article types | Link both previews and recaps, distinguished in UI |
| Body content | Full body stored in v1 (from `content.rendered`, no page crawl) |
| Recompute | Incremental: only changed articles/events are rematched |
| Quality bar | Confidence threshold only; scores stored privately; no admin UI |
| UI | Titled links in expanded section + small hint icon on collapsed card |
| Architecture | New hourly Lambda mirroring the publisher-ingest pattern |

## Verified facts (checked 2026-07-15)

- `https://chqdaily.com/wp-json/wp/v2/posts` is live, paginated, and
  returns `id`, `date`, `modified`, `link`, `title.rendered`,
  `excerpt.rendered`, **full untruncated `content.rendered`**, and
  numeric `categories[]` / `tags[]` IDs (resolvable via
  `/wp/v2/categories` and `/wp/v2/tags`).
- Category names frequently include the venue literally
  ("Amphitheater", "Hall of Philosophy", "Strohl Art Center") plus
  type markers like "Lecture Recap".
- Article bodies/excerpts carry time-of-day references
  ("10:45 a.m. today", "8 p.m. tonight").
- The RSS feed (`/feed/`) holds only ~16 items — that is why ingestion
  uses the REST API instead.
- Publisher-ingest precedent: hourly EventBridge rule
  (`rate(1 hour)`), sidecar published to
  `cache/calendar-cache/publisher-events-<year>.json` in the frontend
  bucket with `CacheControl: public, max-age=300`.

## Architecture

```
WP REST API (chqdaily.com/wp-json/wp/v2)
        │  hourly (EventBridge rate(1 hour))
        ▼
articleIngestHandler (new Lambda)
  1. Fetch posts new or modified since watermark (full body included)
     (+ one-time season backfill)
  2. Resolve category/tag IDs → names (taxonomy map)
  3. Upsert changed articles into DynamoDB (metadata + body text)
  4. Load events (all-events.json + publisher sidecar); fingerprint each
  5. Incremental match: rescore only pairs involving changed
     articles or changed events; reuse stored matches otherwise
  6. Persist match state; publish matches ≥ threshold to
     cache/calendar-cache/article-links-<year>.json
        │  CloudFront, max-age=300
        ▼
Frontend: useArticleLinks(year) → Map<eventId, ArticleLink[]> → EventCard
```

The frontend is fully decoupled: a missing or stale sidecar means
event cards simply render no article links.

## Ingestion & storage

### Fetching

- Incremental pull each run:
  `GET /wp-json/wp/v2/posts?modified_after=<watermark>&per_page=100&page=N`,
  sequential pagination.
- One-time backfill from `2026-06-01` (pre-season coverage) on first
  run — same code path, just an old watermark.
- Taxonomy maps refreshed each run from `/wp/v2/categories` and
  `/wp/v2/tags` (paginated; cheap).
- Politeness/safety: sequential requests, hard page cap per run, 10s
  per-request timeout, descriptive User-Agent
  (`chqcal.org article-linker`), and the repo's existing `urlGuard`
  conventions where applicable.
- The watermark advances only after a fully successful run, so a
  failure re-covers the gap next hour.

### Body capture

Full article body comes from `content.rendered` in the same REST
response — no separate page crawl. It is HTML-stripped to plain text
and stored. Fallback: if `content.rendered` is empty for a post,
fetch the article page directly and extract the body. Bodies are
stored now primarily for Phase 2 (embeddings/AI); the v1 matcher uses
body text only for venue and time-of-day mentions.

### DynamoDB

New table `chautauqua-calendar-articles`:

| Item | Attributes |
|---|---|
| `ARTICLE#<wpPostId>` | title, link, pubDate, modified, categories[] (names), tags[] (names), excerptText, bodyText, contentHash, firstSeenAt |
| `META#watermark` | lastSuccessfulFetch ISO timestamp |

`contentHash` = hash of the matcher-relevant fields (title, bodyText,
categories, tags, excerptText, pubDate). A `modified` bump with an
unchanged `contentHash` (layout-only edit) does **not** mark the
article dirty.

### Match state (private S3 JSON)

A single private S3 object (same bucket, non-public prefix) holding:
`matcherVersion`, per-article contentHashes, per-event fingerprints,
and every above-threshold match with its score and reasons. S3 rather
than DynamoDB to avoid the 400KB item ceiling and keep one read/write
per run. Scores/reasons are never exposed publicly.

## Incremental matching

- **Event fingerprint** = hash of matcher-relevant event fields
  (title, startDate, venue/location, category, presenter,
  description).
- Per run, dirty pairs =
  `(changed articles × all events) ∪ (changed events × all articles)`.
  Only dirty pairs are rescored; all other stored matches carry over
  unchanged. Articles/events that disappeared are dropped from state.
- `matcherVersion` is stored in the match state. Bumping it (scoring
  weight changes, alias-map changes, threshold changes) forces a
  one-time full recompute so improvements apply retroactively.

## Matching engine

Pure deterministic TypeScript module (`articleMatcher.ts`) — no I/O,
fully unit-testable. Weights, threshold, alias map, and per-event cap
are constants co-versioned with `matcherVersion`.

### Stage 0 — date gate

A pair is considered only when the event's start date falls within
`[pubDate − 3 days, pubDate + 7 days]`. Everything else scores 0
immediately (prunes the vast majority of pairs; the Daily covers
events within days).

### Stage 1 — signals (weighted sum, normalized 0–1)

| Signal | How | Weight |
|---|---|---|
| Venue | Article categories or body mention the event's venue after normalization via alias map ("Amp" → "Amphitheater", "Hall of Philosophy", "Lenna Hall", …). Venue names appear literally as WP categories → high precision. | strong |
| People/title | Proper-noun overlap between article title + tags and event title + presenter (normalized last-name token matching). | strong |
| Time-of-day | Body/excerpt contains the event's start time as printed ("10:45 a.m.") together with "today"/"tonight" on a pubDate matching the event date. Near-unique key when it fires. | very strong |
| Category alignment | Article category ("Interfaith Lecture", "Opera") maps to event category. | moderate |
| Date proximity | Small boost the closer pubDate is to the event date — tiebreaker between recurring events. | weak |

### Stage 2 — decide & classify

- Keep matches scoring ≥ threshold (tunable constant, initial value
  chosen during implementation against real fixtures).
- Cap: top 4 articles per event.
- Classify each link: **recap** if an article category/tag contains
  "Recap" or pubDate is after the event ended; **preview** otherwise.

### Known hard case

Recurring slots — nine weeks of "10:45 a.m. Morning Lecture,
Amphitheater" — are the main confusion risk. The tight date gate,
person-name overlap, and date-proximity tiebreaker exist specifically
for this; test fixtures must include consecutive same-venue same-time
events with distinct speakers.

## Published sidecar format

`cache/calendar-cache/article-links-<year>.json`:

```json
{
  "generatedAt": "2026-07-15T14:00:00Z",
  "matcherVersion": 1,
  "links": {
    "91653": [
      {
        "title": "Najeeba Syeed speaks 'from the broken heart of democracy'…",
        "url": "https://chqdaily.com/2026/07/…",
        "kind": "recap",
        "pubDate": "2026-07-14"
      }
    ]
  }
}
```

Keys are event IDs. Arrays ordered previews first, then by pubDate.
The sidecar is rewritten only when its content hash actually changed,
to limit CloudFront churn.

## Frontend

- **`useArticleLinks(year)` hook** — same shape as `useWeeklyThemes`:
  single fetch of the sidecar, graceful empty-map fallback on
  404/parse/network error. The calendar never breaks if the sidecar
  is absent.
- **EventCard, expanded ("show more") section** — an "In the
  Chautauquan Daily" block listing each linked article as a newspaper
  icon + article title, opening in a new tab
  (`target="_blank" rel="noopener noreferrer"`), with a subtle
  preview/recap distinction (label or ordering).
- **EventCard, collapsed** — a small newspaper glyph near the
  existing metadata when the event has ≥1 link, hinting there is
  coverage to expand. Inline SVG, dark-mode aware, consistent with
  existing icon usage.

## Error handling & operations

- Any fetch failure aborts the run without advancing the watermark
  and without publishing a partial sidecar — the previous sidecar
  stays live (same "stale is fine" stance as the events cache).
- WP API shape drift (missing/renamed fields on an item): skip that
  item, log, continue.
- Errors surface in CloudWatch logs and the Lambda error metric, with
  an alarm mirroring publisher-ingest's.
- Manual trigger playbook = invoke the Lambda by hand (same as
  publisher ingest). No admin UI in Phase 1.

## Testing

- **Unit (backend):** matcher against fixture articles/events
  captured from the real WP API — venue aliasing, recurring-lecture
  disambiguation, recap/preview classification, threshold boundaries,
  date-gate edges, dirty-pair selection, fingerprint/contentHash
  stability, HTML stripping.
- **Integration (backend):** handler with mocked WP API + DynamoDB,
  following the existing integration-test patterns — backfill
  pagination, watermark advance and hold-on-failure, no-op run
  (nothing changed → no sidecar write), incremental rematch on
  article edit and on event change.
- **Frontend:** `useArticleLinks` tests (success, 404, malformed
  JSON) and EventCard tests (no links, one link, multiple links,
  collapsed hint icon, new-tab attributes).
- CI coverage floors (`.coverage-floor.json`) apply to all new code.

## Phase 2 (explicitly out of scope, designed for)

- Embedding-based matching over stored bodies for events the
  heuristics can't match; an LLM "mini model" scoring fallback.
- Both slot in as additional scoring stages behind `matcherVersion`;
  the article archive already holds the body text they need.
- Admin review surface for low-confidence matches — only if
  real-world precision demands it.
