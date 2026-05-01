# Publishing Events to chqcal.org

If you run an organization, group, or page in the Chautauqua orbit, you can publish your events to chqcal.org by serving a small JSON file (or by embedding a few HTML comments on a page you already have). We fetch your feed on a schedule and merge new and updated events into the calendar. You stay the author; we stay the aggregator.

This guide covers the minimum-viable setup, the field reference, and how to validate your feed locally before submitting.

## The Minimum-Viable Feed

Publish a JSON document that looks like this:

```json
{
  "formatVersion": "1.0",
  "publisher": {
    "id": "example-pub",
    "name": "Example Publisher",
    "contactEmail": "events@example.org"
  },
  "events": [
    {
      "id": "ev-2026-07-04-talk",
      "title": "Sample Talk on Civic Life",
      "startDate": "2026-07-04T18:00:00-04:00",
      "endDate":   "2026-07-04T19:00:00-04:00",
      "category": "Special Lectures",
      "venueId":  "hall-of-philosophy",
      "lastModified": "2026-05-01T12:00:00-04:00"
    }
  ]
}
```

A copy-pasteable version lives at [`examples/minimal-feed.json`](./examples/minimal-feed.json). A version using every optional field is at [`examples/full-feed.json`](./examples/full-feed.json).

## Field Reference

### Top level

| Field           | Required | Notes                                                                           |
|-----------------|----------|---------------------------------------------------------------------------------|
| `formatVersion` | yes      | Always `"1.0"` for now.                                                         |
| `publisher`     | yes      | See below.                                                                       |
| `events`        | yes      | An array. May be empty (means "no events right now").                            |

### `publisher`

| Field          | Required | Notes                                                          |
|----------------|----------|----------------------------------------------------------------|
| `id`           | yes      | A stable lowercase slug we register for you (`a-z0-9-` only).   |
| `name`         | yes      | Display name shown to readers.                                  |
| `contactEmail` | yes      | We email here if your feed breaks.                              |
| `url`          | optional | Link back to your homepage.                                     |

### `events[]`

| Field          | Required | Notes                                                                                                  |
|----------------|----------|--------------------------------------------------------------------------------------------------------|
| `id`           | yes      | Stable per-event identifier (any string). **Never reuse for a different event.**                       |
| `title`        | yes      | Plain text, no HTML.                                                                                   |
| `startDate`    | yes      | ISO 8601 with timezone offset, e.g. `2026-07-04T18:00:00-04:00`.                                       |
| `endDate`      | yes      | Same format. Must be ≥ `startDate`.                                                                     |
| `category`     | yes      | Must be one of the names listed in [`categories.json`](./categories.json).                              |
| `lastModified` | yes      | ISO 8601 with offset. Bump this when you change anything else about the event.                          |
| `status`       | optional | `"scheduled"` (default), `"cancelled"`, or `"rescheduled"`.                                             |
| `description`  | optional | Light HTML allowed: `<p>`, `<br>`, `<strong>`, `<em>`, `<a href>`, `<ul>`, `<ol>`, `<li>`. Rest stripped. |
| `venueId`      | one of   | Slug from [`venues.json`](./venues.json). **Use this when the event is at a known CHQ venue.**          |
| `venue`        | one of   | Free-form `{ name, address?, url? }` for venues we haven't catalogued.                                  |
| `tags`         | optional | Array of strings.                                                                                       |
| `presenter`    | optional | Speaker, performer, etc.                                                                                |
| `url`          | optional | Link to your event page.                                                                                |
| `cost`         | optional | Free-form ("Free with gate ticket", "$15", etc.).                                                       |
| `attachments`  | optional | Array of `{ url, type, isImage }`.                                                                      |

You must supply **either** `venueId` **or** `venue`, never both, never neither.

## Choosing a Category

See [`categories.json`](./categories.json) for the canonical list. Use the exact `name`, e.g. `"Chamber Music"`, not the slug. If nothing fits, email us — adding a category is a one-line change.

## Choosing a Venue

See [`venues.json`](./venues.json). Use the `id` (slug), e.g. `"hall-of-philosophy"`. If your event is somewhere not in the list, use the free-form `venue` object instead:

```json
"venue": { "name": "Smith Memorial Library", "address": "Bestor Plaza" }
```

## Date and Time Format

Always include a timezone offset. `2026-07-04T18:00:00` (no offset) is rejected. Chautauqua is `-04:00` from June through October (EDT) and `-05:00` the rest of the year (EST).

## The HTML-Embedded Variant

If you'd rather embed events into pages you already maintain, drop HTML comments. One `chq-publisher` comment per page identifies who you are; one or more `chq-event` comments carry the events:

```html
<!-- chq-publisher
{ "id": "example-pub", "name": "Example Publisher", "contactEmail": "events@example.org" }
-->

<article>
  <h2>Keynote: The Civic Imagination</h2>
  <!-- chq-event
  {
    "id": "ev-2026-07-04-keynote",
    "title": "Keynote: The Civic Imagination",
    "startDate": "2026-07-04T18:00:00-04:00",
    "endDate":   "2026-07-04T19:30:00-04:00",
    "category": "Special Lectures",
    "venueId":  "hall-of-philosophy",
    "lastModified": "2026-05-01T12:00:00-04:00"
  }
  -->
</article>
```

A full example is at [`examples/aggregator-page.html`](./examples/aggregator-page.html). You can also use a single `chq-events` comment containing `{ publisher, events: [...] }` if that's easier.

## Updating, Cancelling, and Rescheduling Events

- **Update**: change anything you like, then bump `lastModified`. We re-ingest on the next fetch.
- **Reschedule**: update `startDate` / `endDate` and bump `lastModified`. Optionally set `status: "rescheduled"` to surface a banner.
- **Cancel**: either drop the event from your feed (silent removal) or set `status: "cancelled"` so we show a "Cancelled" treatment.
- **Stable IDs**: never recycle an `id` for a different event. If it's a new event, give it a new `id`.

## Validating Locally

Run the validator against your file or URL:

```bash
npx -p @chq-calendar/publisher-format chq-validate-feed <path-or-url>
```

It prints `OK` plus the event count, or a list of errors with JSON-Pointer paths into the offending field. Fix and re-run until it's green; we run the same validator at ingest.

## Registering Your Publisher

The submission UI is still in flight. For now, email **events-aggregator@chqcal.org** with your proposed `publisher.id`, the URL of your feed (JSON or HTML), and a short description of your organization. We'll register the slug and start fetching.
