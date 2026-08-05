# Digital Program Links — Design (issue #165)

**Date:** 2026-08-05
**Status:** Approved design, pending implementation plan
**Issue:** [#165 — Add link to programs for events that have them](https://github.com/bbernstein/chq-calendar/issues/165)

## Problem

programs.chq.org (hosted at audienceaccess.co) publishes digital program
books for many Chautauqua events — CSO concerts, theatre productions,
opera, dance, School of Music recitals. The calendar should link each
event to its program, on both the web app and the iOS app, the same way
chqdaily article links work today.

Some programs cover a single performance (a dated recital); others cover
a recurring production (a theatre run spanning weeks), where one program
serves every performance of that title.

## Source data

Two server-rendered HTML pages, no API:

- Upcoming: `https://audienceaccess.co/CHQ`
- Past: `https://audienceaccess.co/past/CHQ` (spans 2021 → present,
  ~240 shows)

Each entry provides:

- **Show URL / ID** — `https://audienceaccess.co/show/CHQ-<numericId>`.
  Numeric IDs are assigned chronologically.
- **Title** — e.g. "School of Music: Double Bass Recital",
  "for colored girls who have considered suicide/when the rainbow is enuf".
- **Date text** — inconsistent. Observed forms:
  - Single date: `August 04, 2026`
  - Range: `July 18 - 21, 2026`, possibly cross-month
    (`June 28 - July 26, 2026`)
  - Arbitrary text: `by Sharyn Rothstein`,
    `CTC's 2026 Acting Conservatory … performance` (mostly theatre)

Show detail pages bury dates in free-form prose — not reliably
parseable. The matcher works from the listing pages only.

Markup anchors (subject to drift; parser tests use captured fixtures):
upcoming page entries live in `.slide` blocks with
`.mobile-index-footer-show-name` / `.mobile-index-footer-show-date`;
past page entries in `.mobile-past-events-feature-box` with
`.mobile-past-events-feature-title` / `.mobile-past-events-feature-dates`.
The parser should key off links matching `show/CHQ-\d+` and their
adjacent title/date nodes rather than exact class names where practical.

## Architecture

A separate slim vertical slice cloned from the chqdaily article-ingest
pattern, minus the parts programs don't need:

- **No DynamoDB, no watermark.** The full corpus is ~240 shows across
  two pages; every hourly run is a full re-scrape and full re-match.
- Same two-bucket publishing split: public sidecar on the frontend
  bucket, private match state (scores/reasons) on the private cache
  bucket under `internal/program-links/`.
- Publish only when links change (canonical comparison excludes
  scores), like the article publisher.

```
EventBridge (rate 1 hour)
  → programIngestHandler.scheduledHandler({year?})
    → audienceAccessClient: fetch + parse both pages → Program[]
    → eventSnapshotLoader (reused as-is): all-events-<year>.json
      + publisher-events-<year>.json
    → programMatcher.computeProgramMatchState
    → programLinksPublisher: sidecar (if changed) + private state
```

## Components (backend)

New files under `backend/src/`, each mirroring its article-links
counterpart:

### `services/audienceAccessClient.ts`

- Fetches both listing pages (10s timeout each), parses with cheerio
  (already a backend dependency).
- Output per show, deduped by show ID (a show can appear on both pages
  during the past/upcoming transition; either copy is equivalent):

  ```ts
  interface Program {
    showId: string;        // "CHQ-16781"
    url: string;           // https://audienceaccess.co/show/CHQ-16781
    title: string;
    dateText: string;      // raw text from the listing
    startDate: string | null;  // YYYY-MM-DD, parsed from dateText
    endDate: string | null;    // == startDate for single dates
    source: 'upcoming' | 'past';
  }
  ```

- Date parsing handles: `MMMM d, yyyy`; `MMMM d - d, yyyy`;
  `MMMM d - MMMM d, yyyy`. Anything else → null dates (not an error).

### `services/programMatcher.ts`

- `export const MATCHER_VERSION = 1;` — bump forces full recompute and
  republish, same semantics as the article matcher.
- Uses `textNormalize.ts` helpers for title normalization.

**Dated programs** (startDate/endDate parsed):

1. Date gate: event's start date (date part) must fall within
   `[startDate, endDate]`.
2. Title similarity: normalized token overlap between program title and
   event title; threshold `TITLE_THRESHOLD = 0.6`. Similarity uses the
   shared scoring (token Jaccard, with a containment shortcut scoring 0.9
   when the shorter normalized title, ≥10 chars, is contained in the
   other) — the same scoring the matcher applies to undated programs below;
   for dated programs the date gate still applies first.

**Undated programs** (null dates; mostly theatre runs):

1. Eligibility fence: the program's numeric show ID must be ≥ the
   minimum numeric ID among programs whose parsed dates fall in the
   target year. IDs are chronological, so this excludes prior-season
   programs (the past page reaches back to 2021) without needing dates.
   Edge case: if *no* program has a parsed date in the target year, no
   undated program is eligible that run.
2. Stricter title similarity: `UNDATED_TITLE_THRESHOLD = 0.8` or
   normalized-containment (one normalized title contains the other).
3. Matches every event of that title in the season — this is the
   recurring-production behavior the issue calls for.

**Selection:** at most **one** program link per event; highest score
wins, ties broken by higher show ID (newer program). Precision over
recall throughout — an event with no confident match gets no link.

State shape (private file, mirrors `MatchState`):

```ts
interface ProgramMatchState {
  matcherVersion: number;
  programs: Record<string, string>;   // showId -> content hash (title|dateText)
  eventFingerprints: Record<string, string>;
  matches: { eventId: string; showId: string; score: number; reasons: string[] }[];
}
```

(With full re-match each run, hashes/fingerprints exist for debugging
and change detection, not incremental skipping.)

### `services/programLinksPublisher.ts`

- Public: `${publicPrefix}/program-links-${year}.json` → prod
  `cache/calendar-cache/program-links-2026.json`,
  `ContentType: application/json`, `CacheControl: public, max-age=300`.
- Private: `${statePrefix}/program-links-state-${year}.json` → prod
  `internal/program-links/program-links-state-2026.json`.
- `NoSuchKey` treated as "missing", not an error (requires the scoped
  `s3:ListBucket` grants — see Infrastructure).

Public sidecar schema:

```json
{
  "generatedAt": "2026-08-05T12:00:00Z",
  "matcherVersion": 1,
  "links": {
    "<eventId>": [
      { "title": "Best For Baby", "url": "https://audienceaccess.co/show/CHQ-16426" }
    ]
  }
}
```

Array-valued per event for consistency with `article-links` consumers,
though the matcher caps at one entry.

### `services/programIngestRunner.ts` + `handlers/programIngestHandler.ts`

- Runner: scrape → load snapshot → match → publish-if-changed → save
  state-if-changed. One-line summary log:
  `[program-ingest] summary: {programs, dated, undated, eventsTotal, matchedEvents, linksPublished}`.
- Handler: pure wiring from env vars (`CACHE_S3_BUCKET`,
  `CACHE_S3_KEY_PREFIX`, `STATE_S3_BUCKET`,
  `STATE_S3_KEY_PREFIX` default `internal/program-links`); manual invoke
  accepts `{ "year": 2026 }`, defaults to current year.

### `scripts/runProgramIngestLocal.ts`

Local runner that scrapes the real pages, matches against a local events
snapshot, and writes `frontend/public/data/program-links-2026.json` so
the dev server renders real links. npm script `ingest:programs:local`.

## Error handling

- Either page fails to fetch, or parses to **zero** shows → abort the
  run without publishing. The previous sidecar stays live; links never
  vanish because of a transient scrape failure or a markup change.
- Markup drift that breaks parsing shows up as the zero-shows abort plus
  the summary log; the runbook covers diagnosis.
- Frontends treat a missing sidecar (404) as empty links — no error UI.

## Web frontend

- Extract the body of `useArticleLinks` into an internal generic
  `useSidecarLinks(filePrefix, year)` (module-level inflight/resolved
  caches, 404-cached-as-empty, DEV base `/data` vs prod
  `/cache/calendar-cache`). `useArticleLinks` and the new
  `useProgramLinks` become thin typed wrappers. No behavior change to
  article links.
- `ProgramLink` type: `{ title: string; url: string }`.
- `page.tsx`: call `useProgramLinks(selectedYear)`, pass `programLinks`
  through `EventList` → `EventCard` alongside `articleLinks`.
- `EventCard`:
  - Expanded: a "Digital Program" row (📖 + program title, external
    link) rendered **above** the "In the Chautauquan Daily" list.
  - Collapsed: 📖 joins 📰 on the Show-more badge.
  - A program link alone (no description, no articles) forces the
    expander to render, same as article links do today.

## iOS app

Mirrors the article-links plumbing exactly:

- `Models/Sidecars.swift`: `ProgramLink { title: String; url: URL }` and
  `ProgramLinksFile` decoding `links` through `LossyArray<ProgramLink>`.
- `Data/CalendarAPI.swift`: `RemoteResource.programLinks(year:)`, path
  `/cache/calendar-cache/program-links-<year>.json`, cache key
  `program-links-<year>`.
- `Data/EventRepository.swift`: `programLinks` field on
  `CalendarSnapshot`; third parallel best-effort sidecar fetch
  (`async let`, same 3s `sidecarTimeout`, ETag-conditional,
  cache-fallback; never blocks or fails the events load).
- `App/AppModel.swift`: `programLinks(for eventID:) -> [ProgramLink]`.
- `Features/Detail/EventDetailView.swift`: "Digital Program" section
  (SF Symbol `book`, program title, opens in browser), placed above the
  Daily section, with a DEBUG scroll anchor like `article-links`.
- `Features/Calendar/EventRow.swift`: small `book` badge next to the
  existing `newspaper` badge.
- Test fixture `ios/ChqCalendarTests/Fixtures/program-links-sample.json`.

**App Store rule:** the iOS change visibly touches `Features/Detail` and
`Features/Calendar`, so the PR must regenerate screenshots via
`ios/Scripts/capture-screenshots.sh` + `compose-screenshots.py`, or
record the explicit `[skip-screenshots: …]` opt-out if no covered shot
displays an event with a program link.

## Infrastructure & deploy

- `infrastructure/program-ingest.tf`:
  - IAM role + scoped policy: `s3:GetObject` on `all-events-*.json` /
    `publisher-events-*.json`; `s3:GetObject`+`PutObject` on
    `program-links-*.json` (frontend bucket) and
    `internal/program-links/*` (cache bucket); two `s3:ListBucket`
    grants with `s3:prefix` conditions so missing keys return
    `NoSuchKey` (404) instead of `AccessDenied` (403) — without these
    the first run can never bootstrap.
  - `aws_lambda_function.program_ingest`: handler
    `dist/programIngestHandler.scheduledHandler`, `nodejs24.x`,
    timeout 300s, memory 512MB. No DynamoDB table.
  - Log group `/aws/lambda/${var.app_name}-program-ingest`, 14 days.
  - EventBridge rule `rate(1 hour)` + target + lambda permission.
- `infrastructure/github-actions.tf`: add a `LambdaInvokeProgramIngest`
  statement for the deploy role.
- `backend/package.json` `build:prod`: add an esbuild line for
  `programIngestHandler` (`--external:@aws-sdk/client-s3` only).
- `.github/workflows/deploy-production.yml`: two steps cloned from the
  article ones — "Deploy program-ingest Lambda" (get-function guard,
  minimal `package_temp` with `@aws-sdk/client-s3`, zip,
  `update-function-code`, wait) and a `continue-on-error`
  fire-and-forget "Trigger program-links ingest" invoke after deploy.

## Testing

- **Backend** (counts toward the coverage floor):
  - `audienceAccessClient.test.ts` — parser against captured HTML
    fixtures of both pages (`__tests__/fixtures/`); date-text parsing
    table (single, same-month range, cross-month range, junk).
  - `programMatcher.test.ts` — dated single-date match, range match
    (recurring CSO-style), undated theatre run matching multiple
    performances, show-ID fence excluding an old undated program,
    threshold edges, one-link-per-event with tie-break, no-confident-
    match yields nothing.
  - `programLinksPublisher.test.ts`, `programIngestRunner.test.ts` —
    cloned from article equivalents (publish-only-on-changed, abort on
    zero shows, NoSuchKey bootstrap).
- **Web**: `useSidecarLinks`/`useProgramLinks` hook tests (including
  no-regression coverage for `useArticleLinks` after the refactor);
  `EventCard.programLinks.test.tsx` for row, badge, and
  expander-forcing.
- **iOS**: decode tests (valid, lossy/malformed entry, unknown fields),
  `EventRepository` fetch-fallback test, `AppModel` accessor test.

## Out of scope

- No admin/review UI — fully automatic, like article links.
- No per-performance program pages, PDFs, or program content ingestion —
  link out only.
- No matching for years before the current season.
- No embedding/AI matching (same deferral as chqdaily Phase 2).
