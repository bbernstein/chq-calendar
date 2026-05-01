# CHQ-Orbit Event Publisher Format — Design

**Status:** Draft for review
**Date:** 2026-05-01
**Author:** brainstorming session
**Scope:** Defines a JSON event-feed format that Chautauqua-orbit publishers can publish (as a static JSON file or embedded in HTML), plus the ingestion pipeline that pulls those feeds into chqcal.org.

---

## 1. Goals and non-goals

### Goals
- Let CHQ-orbit groups (denominational houses, lecture series, affiliated organizations) publish their events in a format chqcal.org can ingest automatically.
- Be authorable by non-technical publishers using either a JSON file, an HTML editor (with embedded JSON in HTML comments), or a simple submission API later on.
- Field names align with Schema.org `Event` where they overlap, so the format is recognizable to any web author and so a Schema.org JSON-LD adapter remains feasible later.
- Keep the on-the-wire format simple: every event is fully expanded (one JSON object per occurrence). No recurrence rules in the format itself.
- Provide explicit cancellation, stable identity, and last-modified timestamps so updates and removals are unambiguous.
- Allow tiered trust so we can onboard new publishers cautiously and graduate them to auto-ingest after they have proven reliable.

### Non-goals
- Not a general-purpose event format for the open internet. Scope is limited to publishers in the Chautauqua orbit; the format may use CHQ-specific concepts (canonical venues, the CHQ category vocabulary) without apology.
- Not a recurrence engine. Publishers expand recurring events themselves (a publisher-side helper tool may be built later, but it is out of scope here).
- Not a federated or real-time push system. Ingestion is a scheduled pull from registered publisher URLs.
- Not a redesign of the existing `Event` shape that the frontend consumes. This format feeds into the existing pipeline; the pipeline transforms feed events into the existing internal `EventData` / `Event` types.
- **Not a replacement for, or modification of, the existing chq.org primary events feed.** The publisher-feed pipeline is strictly additive — see §1.1.

### 1.1 Isolation guarantee: do not break the primary feed

The existing chq.org → `syncHandler` → DynamoDB → `all-events.json` pipeline is the authoritative source of CHQ programming and must not be affected by this work, either at runtime or during development. The publisher-feed pipeline is built as a parallel, additive layer with the following hard rules:

**Runtime isolation**

- **Separate Lambda.** The publisher-feed ingester is a new Lambda (working name `publisherIngestHandler`). The existing `syncHandler` is not modified to support publisher feeds and does not call into publisher-ingest code.
- **Separate DynamoDB partitioning.** Publisher events are stored under a distinct partition key prefix (e.g., `PUB#<publisherId>`) that does not collide with the partition keys used by primary chq.org events. The primary table schema is not modified.
- **Separate published cache file.** The frontend already fetches `/cache/calendar-cache/all-events.json`. That file continues to contain **only** the primary chq.org events, byte-for-byte unchanged in shape and ordering. Publisher events are written to a new sidecar file: `/cache/calendar-cache/publisher-events.json`. The frontend fetches both, then merges client-side at render time. This means a bug in publisher ingest cannot corrupt the primary cache — at worst, the sidecar file is missing or stale and the calendar falls back to primary-only.
- **Independent failure modes.** A failure in the publisher pipeline (parse error, DynamoDB throttle, threshold halt) cannot prevent primary-feed sync from running, and vice versa. They share no critical path.
- **Independent deploy cadence.** The publisher pipeline can be enabled, disabled, or rolled back via a feature flag without touching the primary pipeline.

**Frontend isolation**

- The frontend's existing fetch and parse path for `all-events.json` is unchanged.
- A new fetch for `publisher-events.json` is added, gated behind a build-time flag (e.g., `VITE_ENABLE_PUBLISHER_FEEDS`). When the flag is off, the frontend behaves exactly as it does today. When on, it fetches both files, merges, and renders. Merging is a small, well-tested function (concat + dedupe by `(sourcePublisherId, id)` for publisher events; primary events are passed through untouched).
- Publisher events carry `sourcePublisherId` and `sourcePublisherName` fields (per §4.6) so they are distinguishable in the data and in the UI; if filtering or rendering of publisher events fails, primary events are unaffected.

**Development isolation**

- All publisher-pipeline code lives in clearly-named new files/modules. Existing files in the primary pipeline (`syncHandler.ts`, `eventTransformationService.ts`, etc.) may be **read** by the new code but are not modified except where explicitly required for shared types.
- New tests cover only publisher-pipeline behavior; existing primary-pipeline tests must continue to pass without modification.
- Any change to a shared type or shared utility that is touched by both pipelines is called out explicitly in the implementation plan and reviewed for primary-pipeline impact before merging.

**Verification gate**

- Before publisher events are surfaced on the live site, the implementation plan must include a verification step confirming that `all-events.json` is byte-equivalent to a pre-change baseline for at least one full primary-feed sync cycle. This is the single most important guard against silent regression of the primary feed.

## 2. The feed format

### 2.1 Top-level feed object

A feed is a JSON object with publisher metadata and an array of events:

```json
{
  "formatVersion": "1.0",
  "publisher": {
    "id": "everett-jewish-life-center",
    "name": "Everett Jewish Life Center",
    "contactEmail": "events@example.org",
    "url": "https://example.org"
  },
  "events": [ /* event objects */ ]
}
```

#### Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `formatVersion` | string | yes | Semver-style. Initial release is `"1.0"`. The ingester rejects unknown major versions. |
| `publisher` | object | yes | See §2.2. |
| `events` | array of event objects | yes | May be empty. Empty feed is valid and means "this publisher currently has no events"; it does **not** mean "cancel everything I previously published" — see §4.4 for cancellation semantics. |

### 2.2 Publisher object

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Stable identifier, lowercase kebab-case. Must match the registered publisher record on the ingest side. Mismatches cause the feed to be rejected. |
| `name` | string | yes | Human-readable publisher name. Displayed alongside events for attribution. |
| `contactEmail` | string | yes | Used by the ingester to notify the publisher of validation failures. |
| `url` | string | no | Publisher's homepage. |

### 2.3 Event object

```json
{
  "id": "ejlcc-shabbat-2026-07-04",
  "title": "Shabbat Service",
  "description": "Friday evening service led by Rabbi Jane Doe.",
  "startDate": "2026-07-04T18:00:00-04:00",
  "endDate":   "2026-07-04T19:30:00-04:00",
  "venueId": "everett-jewish-life-center",
  "category": "Worship",
  "tags": ["shabbat", "service"],
  "presenter": "Rabbi Jane Doe",
  "url": "https://example.org/events/shabbat-7-4",
  "cost": "Free",
  "attachments": [
    { "url": "https://example.org/img/poster.jpg", "type": "image/jpeg", "isImage": true }
  ],
  "status": "scheduled",
  "lastModified": "2026-05-01T12:00:00-04:00"
}
```

#### Event fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Publisher-stable. Unique within the publisher. The system stores `(publisherId, id)` as the global key. |
| `title` | string | yes | |
| `startDate` | ISO 8601 datetime with offset | yes | Timezone offset is **required** (e.g., `-04:00`). Naive timestamps are rejected. |
| `endDate` | ISO 8601 datetime with offset | yes | Must be ≥ `startDate`. |
| `category` | string | yes | Must be one value from the published CHQ category vocabulary (see §5). |
| `status` | enum | no | One of `"scheduled"`, `"cancelled"`, `"rescheduled"`. Defaults to `"scheduled"` if omitted. Optional and informational — see §2.4 and §4.4. |
| `lastModified` | ISO 8601 datetime with offset | yes | Updated by the publisher whenever any event field changes. The ingester uses this to detect updates without diffing. |
| `description` | string | no | Plain text or limited HTML (see §2.5). |
| `venueId` | string | no | One of the canonical CHQ venue IDs (see §5). Mutually exclusive with `venue`. |
| `venue` | object | no | Free-form venue: `{ name (required), address?, url? }`. Used for off-grounds locations. Mutually exclusive with `venueId`. |
| `tags` | array of strings | no | Free-form tags. |
| `presenter` | string | no | |
| `url` | string | no | Link to the publisher's page about this event. |
| `cost` | string | no | Free-form (e.g., `"Free"`, `"$15"`, `"Donation"`). |
| `attachments` | array of attachment objects | no | Each: `{ url, type (MIME), isImage }`. Same shape as the existing internal `Event.attachments`. |

#### Venue rule

Exactly one of `venueId` or `venue` may be present. Events with neither are rejected. Events with both are rejected.

#### Category rule

`category` must be a single string drawn from the published CHQ category vocabulary. The vocabulary is the source of truth at a documented URL (see §5); unknown values cause the event to be rejected.

#### Date rules

- Both dates are required and must include a timezone offset.
- `endDate` must be greater than or equal to `startDate`.
- All-day events: encode as `T00:00:00` to `T23:59:59` in the publisher's local timezone. (No separate "all-day" flag in v1.0.)

### 2.4 Identity, updates, and removal

- **Identity:** `(publisherId, eventId)` is the global key. An event ID must be stable across publishes — the same occurrence keeps the same ID even if the title or time changes.
- **Updates:** when any field changes, the publisher updates `lastModified`. The ingester compares stored vs. incoming `lastModified` and applies the update if newer.
- **Reschedule (preferred path):** the publisher updates `startDate`/`endDate` (and bumps `lastModified`) on the same event ID, optionally setting `status: "rescheduled"` to communicate the change in the UI. The event keeps the same record.
- **Cancellation (preferred path):** the publisher sets `status: "cancelled"` and bumps `lastModified`. The event remains visible in the calendar with a "Cancelled" treatment.
- **Removal (default path):** if a publisher simply deletes an event from their feed, the ingester removes future events that are absent from the feed (see §4.4). Past events that are absent are left untouched (they are historical record). This means publishers who do not follow the "set status to cancelled" discipline still get correct behavior — silent deletion just propagates.
- The `status: "cancelled"` and `status: "rescheduled"` paths are **optional and informational**. Publishers who use them get a richer UI treatment (e.g., struck-through cards, "moved to …" banners). Publishers who don't get correct removal/update behavior automatically.

### 2.5 Description content

`description` is plain text by default. A limited subset of HTML is allowed: `<p>`, `<br>`, `<strong>`, `<em>`, `<a href>`, `<ul>`, `<ol>`, `<li>`. Any other tags are stripped at ingest time. `<script>` and event-handler attributes are always stripped (XSS hardening).

## 3. The HTML-embedded variant

Publishers who edit HTML pages (WordPress, hand-written sites) may embed feed JSON in HTML comments instead of serving a separate `.json` file.

### 3.1 Comment kinds

A page may contain any mix of:

- `<!-- chq-events ... -->` — a full feed object (with its own `publisher` block).
- `<!-- chq-event ... -->` — a single event object (no `publisher` field inside).
- `<!-- chq-publisher ... -->` — a page-level publisher object, used as fallback for loose `chq-event` comments.

Each comment's body is JSON. Whitespace inside the comment is permitted.

### 3.2 Combining rule

The parser produces a single combined feed by:

1. For every `chq-events` comment on the page, taking each event from its `events` array and attributing it to that feed's `publisher` block.
2. For every `chq-event` comment on the page, attributing the event to the page's `chq-publisher` comment.
3. Concatenating all of the above into one ordered events list.

### 3.3 Validation rules for HTML pages

- A page that contains any `chq-event` comment **must** contain exactly one `chq-publisher` comment. Otherwise the page is rejected.
- A page that contains only `chq-events` comments does not require a `chq-publisher` comment.
- A page may contain zero `chq-events` and zero `chq-event` comments; in that case it is treated as an empty feed (valid). See §4.4 for what an empty feed means (it does **not** cancel previously-published events).
- A page may have multiple `chq-events` comments. Each comment's `publisher.id` **must** match the registered publisher record for the URL being fetched. Blocks whose `publisher.id` does not match are rejected (this prevents a publisher from "vouching for" arbitrary other publishers via their page). Genuine multi-publisher aggregator pages are not supported in v1.0; they would require each contributing publisher to register their own URL separately.
- Comment bodies that fail JSON parsing cause that comment to be rejected with an admin notification, but other comments on the page are still processed.

### 3.4 Example

```html
<!-- chq-publisher
{ "id": "grounds-roundup", "name": "Grounds Roundup",
  "contactEmail": "editor@example.org" }
-->

<h2>Tonight at the Hall of Philosophy</h2>
<p>Lecture by …</p>
<!-- chq-event
{ "id": "lecture-2026-07-04", "title": "Evening Lecture",
  "startDate": "2026-07-04T19:30:00-04:00",
  "endDate":   "2026-07-04T20:30:00-04:00",
  "venueId": "hall-of-philosophy",
  "category": "Lecture", "status": "scheduled",
  "lastModified": "2026-05-01T12:00:00-04:00" }
-->

<h2>This week at EJLCC</h2>
<!-- chq-events
{ "formatVersion": "1.0",
  "publisher": { "id": "everett-jewish-life-center",
    "name": "Everett Jewish Life Center",
    "contactEmail": "events@example.org" },
  "events": [ /* … */ ] }
-->
```

## 4. Ingestion pipeline

### 4.1 Publisher registration

An admin registers a publisher record (stored in DynamoDB):

| Field | Type | Notes |
|---|---|---|
| `id` | string | Must match the `publisher.id` in the feed. |
| `name` | string | |
| `contactEmail` | string | For validation-failure notifications. |
| `sourceUrl` | string | The URL the ingester fetches. |
| `sourceType` | enum | `"json"` or `"html"`. |
| `trustLevel` | enum | `"auto"`, `"review"`, or `"flagged"`. New publishers default to `"review"`. |
| `enabled` | boolean | Allows pausing a publisher without deleting the record. |
| `lastFetchedAt` | datetime | Updated by the ingester. |
| `lastFetchStatus` | enum | `"ok"`, `"parse_error"`, `"validation_error"`, `"network_error"`. |

### 4.2 Fetch loop

A scheduled Lambda runs on a cadence (e.g., hourly during the season). For each enabled publisher:

1. HTTP GET the `sourceUrl`. Honor reasonable timeouts and HTTP caching headers.
2. If `sourceType: "json"`, parse the body as JSON.
3. If `sourceType: "html"`, extract all `chq-events`, `chq-event`, and `chq-publisher` comments and combine per §3.2.
4. Validate the resulting feed (§4.3).
5. Reconcile with stored events for this publisher (§4.4).
6. Record `lastFetchedAt` and `lastFetchStatus`.
7. On failure, send the `contactEmail` an admin-cc'd notification with the validation errors.

### 4.3 Validation

The feed is validated against a JSON Schema that codifies §2 and §3. Validation errors are collected per event; an event with errors is rejected, but other events in the same feed are still processed. Feed-level errors (missing `publisher`, wrong `formatVersion`, mismatched `publisher.id`) cause the entire fetch to be rejected.

In addition to schema checks, the ingester:

- Resolves `category` against the CHQ category vocabulary; unknown categories reject the event.
- Resolves `venueId` against the CHQ venue list; unknown venue IDs reject the event.
- Confirms `publisher.id` in the feed matches the registered publisher record.
- Confirms `endDate >= startDate`.
- Sanitizes `description` HTML per §2.5.

### 4.4 Reconciliation

For each event in the validated feed:

- If `(publisherId, eventId)` is not in storage → **new event**.
- If it is in storage and incoming `lastModified` is newer → **update**.
- If it is in storage and incoming `lastModified` is older or equal → **no-op**.

Then for each event stored under this publisher that is **absent** from the current feed:

- If `startDate < now` → **leave untouched.** The event is historical record. Publishers commonly prune past events from their listings, and that pruning must not affect the calendar's history.
- If `startDate >= now` → **mark for removal.** A publisher silently deleting a future event from their feed is the most common way they will signal "this isn't happening." We honor that.

#### Sanity threshold

Before applying the marked removals, the ingester checks a sanity threshold to catch accidents (empty file, broken CMS export, stub page returned by a misconfigured server):

- Let `R` = number of future events marked for removal in this fetch.
- Let `F` = number of future events stored for this publisher *before* this fetch.
- If `R > max(0.5 * F, 5)` → **halt reconciliation.** Storage is left untouched (no inserts, updates, or removals from this fetch are applied). The pending change set is recorded in the admin dashboard with a clear summary ("Publisher X's last fetch would remove N of M future events"), and the admin + publisher contact are notified. Subsequent fetches that produce the same removal set continue to be blocked until the admin explicitly approves in the dashboard, at which point the pending fetch is applied and normal cadence resumes.
- Otherwise → apply the removals normally.

#### Interaction with `status: "cancelled"` and `status: "rescheduled"`

These statuses remain valid and useful for publishers who want to actively communicate the change rather than silently remove. They are not required for correct behavior. Specifically:

- A publisher who sets `status: "cancelled"` keeps the event in their feed; the ingester applies the update and the calendar UI shows a cancelled treatment.
- A publisher who deletes the event from their feed produces the same end-user effect (event no longer on the calendar), but with no cancelled treatment — the event simply disappears.
- A publisher who reschedules by updating `startDate` on the same event ID gets a clean update; setting `status: "rescheduled"` lets the UI signal the change to users.

### 4.5 Trust tiers

For each new or updated event:

- `trustLevel: "auto"` → the event is written to the publisher sidecar cache (`publisher-events.json`, see §1.1) and goes live immediately.
- `trustLevel: "review"` → the event is written to a pending queue. It does not appear in the publisher sidecar cache until an admin approves it in the dashboard. Approval moves it to the sidecar cache.
- `trustLevel: "flagged"` → same as `"review"`, but the queue UI flags this publisher visibly (e.g., a recently-onboarded source whose feeds have been correct but is still being watched).

Admins can change a publisher's `trustLevel` at any time. Promoting a publisher from `"review"` to `"auto"` does not retroactively auto-approve queued events.

In all three cases, the primary `all-events.json` is **never** modified by this pipeline.

### 4.6 Mapping into the internal Event shape

Feed events are transformed into the existing internal `Event` shape at ingest time so the frontend can render publisher events with the same components used for primary events. They are **stored separately** (publisher DynamoDB partition and `publisher-events.json` sidecar — see §1.1) and only merged into a single render-time list in the browser. The internal shape is reused for code reuse; the data paths remain isolated.

| Feed field | Internal field | Notes |
|---|---|---|
| `id` | `id` | Stored as `(publisherId, id)` to avoid collisions across publishers. |
| `title` | `title` | |
| `description` | `description` | After HTML sanitization. |
| `startDate` | `startDate` | |
| `endDate` | `endDate` | |
| `venueId` | `venue.id`, `venue.name`, `venue.address` | Looked up from the canonical venue list. |
| `venue` | `venue` | Pass-through for off-grounds. |
| `category` | `category`, `categories` | Single category string promoted into `categories: [{ name }]` for parity with existing data. |
| `tags` | `tags` | |
| `presenter` | `presenter` | |
| `url` | `url` | |
| `attachments` | `attachments` | Same shape, pass-through. |
| `status` | new internal field `status` | Existing pipeline does not currently model cancellation — adding the field is in scope of the implementation plan. |
| `lastModified` | `lastModified` | |
| (publisher attribution) | new internal fields `sourcePublisherId`, `sourcePublisherName` | Used for on-card attribution. |

## 5. Reference artifacts publishers will need

To make the format genuinely usable by non-technical publishers, the following ship alongside it (as documentation under `docs/publisher/` and as files under a stable URL on chqcal.org):

- **Authoring guide** (`docs/publisher/AUTHORING.md`) — short walkthrough of how to publish a JSON file or embed comments in an HTML page, with copy-pasteable examples.
- **CHQ category vocabulary** (`docs/publisher/categories.json`) — the canonical list of allowed `category` values. Derived from the existing event dataset; not invented in this spec.
- **CHQ venue list** (`docs/publisher/venues.json`) — the canonical list of `venueId` values with display names and addresses. Derived from the existing on-grounds venue data; not invented in this spec.
- **JSON Schema** (`docs/publisher/feed.schema.json`) — programmatic validation, suitable for use in publisher CI or in editors with JSON-Schema integration.
- **HTML snippet template** — a copy-pasteable HTML block showing the embedded-comment variant.

The contents of `categories.json` and `venues.json` are produced by a one-time script that introspects the existing data; the implementation plan covers that step. They are not enumerated in this spec because they are derived data, not design decisions.

## 6. Submission flow (later)

A future "submission" UI for publishers is out of scope for v1.0 of the format but is anticipated. The format is designed so that a submission API can simply accept the same JSON shape (POST a feed, get back a validation report). No format changes will be required to support a submission API later.

## 7. Open questions and follow-ups

- **Category and venue lists:** must be produced from existing data before publishers can write valid feeds. First task in the implementation plan.
- **Cancellation UI:** how `status: "cancelled"` and `status: "rescheduled"` render in the existing event cards is a UI-side decision, not a format decision. Out of scope here; the format provides the data.
- **Image hosting:** `attachments[].url` may point to a publisher's own server. We may want to mirror images to our CDN at ingest time to insulate against link rot and to control image dimensions/perf. Not required by the format; an ingestion-side enhancement.
- **Aggregator pages:** v1.0 disallows a single page from carrying events on behalf of multiple registered publishers (see §3.3). If we later have legitimate aggregator-page use cases, we can add a "delegation" mechanism (e.g., the registered publisher's record lists which other publisher IDs it is allowed to host). Out of scope for v1.0.
