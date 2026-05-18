# Weekly themes — design

**Status:** Implemented — PR #129 (`weekly-themes-design` branch)
**Date:** 2026-05-17

## Problem

Each Chautauqua season week has a theme published at
https://www.chq.org/things-to-do/events/weekly-themes/. The page is
overwritten when the institution rolls forward to the next year, so
once a season ends we can no longer recover that year's themes from
the site. The site has nothing in place today to capture or display
this information; users have to leave the calendar to find it.

We want to:

1. Capture the themes for each year once, store them durably in the
   repo, and never lose them.
2. Surface the theme for a given week in the UI without sacrificing
   screen real estate, particularly on mobile.

## Non-goals

- Automated re-scraping. Themes do not change inside a season — a
  manual, push-button run per year is enough.
- Admin UI for editing themes. If a scrape is wrong, the JSON file is
  edited in a follow-up PR.
- Surfacing themes inside individual event cards. May be a follow-up
  once the v1 placement is validated.
- A separate themes API or DynamoDB table. The dataset is ~9 entries
  per year; static JSON is the right tool.

## Storage

A static JSON file per year, checked into the repo and served by the
existing CloudFront distribution:

```
frontend/public/data/weekly-themes/2026.json
frontend/public/data/weekly-themes/2027.json
...
```

File shape:

```json
{
  "year": 2026,
  "scrapedAt": "2026-05-17T18:42:11.000Z",
  "source": "https://www.chq.org/things-to-do/events/weekly-themes/",
  "weeks": [
    {
      "number": 1,
      "title": "Building a Culture of Empathy",
      "description": "Long-form description as published…",
      "startDate": "2026-06-27",
      "endDate":   "2026-07-04"
    }
  ]
}
```

Notes:

- `startDate` / `endDate` are stored as published on chq.org (Sat–Sat
  overlapping). They are informational only — they are not used by the
  filter pipeline. The canonical season boundaries remain in
  `getChautauquaSeasonWeeks` (Saturday noon → Saturday noon).
- `description` may be empty if the source page has only a title for a
  given week.
- Past-year files stay in the repo forever. Future-year files are
  absent until that year is scraped — the frontend treats a 404 as
  "no themes available, render nothing extra".

Why this storage choice (vs. alternatives considered):

- **DynamoDB / API**: 9 rows per year, written once. The infra and
  Lambda cost would dwarf the payload. Rejected.
- **Bundled into `all-events.json`**: events refresh hourly via the
  ingest pipeline; themes are static yearly. Coupling them forces
  every ingest run to re-emit theme data and entangles two different
  cadences. Rejected.
- **`frontend/src/data/`** (compiled into the bundle): would work, but
  serving from `public/` keeps themes out of the JS bundle and lets us
  load them lazily.

## Scraper

A single TypeScript script at `backend/src/scripts/scrapeWeeklyThemes.ts`,
runnable two ways:

1. **GitHub Actions, push-button** — the primary path. New workflow
   `.github/workflows/scrape-weekly-themes.yml` triggered by
   `workflow_dispatch`. Inputs:
   - `year` (string, default: current year)
   - `dry_run` (boolean, default `false`) — when true, log the parsed
     JSON to the workflow output without committing.

   Steps:
   - Check out repo.
   - Set up Node (matches the build matrix — 24).
   - `npm ci` in repo root.
   - `npx ts-node backend/src/scripts/scrapeWeeklyThemes.ts --year=$YEAR --out=frontend/public/data/weekly-themes/$YEAR.json`.
   - If the file changed, commit on branch `chore/weekly-themes-$YEAR`
     and open a PR via `gh pr create`. The user reviews and merges
     normally — nothing lands on `main` without human approval.

   Permissions: `contents: write`, `pull-requests: write`.

2. **Local** — `npx ts-node backend/src/scripts/scrapeWeeklyThemes.ts --year=2026`
   for debugging or one-offs.

Implementation:

- Lives under the existing `backend` workspace at
  `backend/src/scripts/scrapeWeeklyThemes.ts`, with the parser/validator
  extracted to `backend/src/services/weeklyThemesScraper.ts` so it is
  covered by jest. `cheerio` and `ts-node` are already in `backend`'s
  dependency tree.
- Fetches the source page, locates each week block, extracts
  `number`, `title`, optional `description`, and the published
  `startDate` / `endDate`.
- Validates: exactly 9 weeks numbered 1-9, every week has a title,
  every week has parseable Sat-to-Sat dates in the requested year.
  Fails loudly if any check trips — better to fail and re-run than
  silently ship a half-scraped file.
- Writes the JSON with a stable key order and a trailing newline so
  diffs stay clean if re-run.

Saturday handling at scrape time: chq.org lists weeks with
overlapping Sat–Sat ranges (the last day of one week is the first
day of the next). The scraper records the dates verbatim. No
de-duplication, no boundary fix-up — the dates are display data, not
filter data. The frontend's canonical week boundaries (Saturday noon)
are untouched.

## Frontend display (v1 — expected to iterate)

This is explicitly v1. The intent is to land something working and
mobile-testable, then refine after seeing it on a real device.

### Data hook

New hook `useWeeklyThemes(year: number)`:

- Fetches `/data/weekly-themes/${year}.json` on mount.
- Caches in a module-level `Map<number, Promise<...>>` so multiple
  consumers share one request.
- Returns `{ themes: Record<number, WeekTheme>, loading: boolean }`.
- 404 → returns `{}` (no error surface). A year without themes simply
  renders without the theme affordance.

### WeekSelector changes

`frontend/src/components/filters/WeekSelector.tsx`:

- Each numbered button keeps its existing tap-to-filter behavior.
- The `title` attribute extends to include the theme:
  `Week 1 — "Building a Culture of Empathy" (Jun 27–Jul 4)`. Free
  native tooltip on desktop.
- No visual indicator on themed buttons — they look identical to
  un-themed ones. Theme info is surfaced only when the user requests
  it (hover title, right-click, long-press, or `ContextMenu` /
  `Shift+F10` for keyboard users). This change from the original
  "dot or underline" sketch came out of mobile review.
- A new `WeekThemePopover` component:
  - Opens on **long-press** (touch) or **right-click / shift-click /
    keyboard menu** on a week button.
  - Anchored to the button on desktop; on mobile-narrow viewports
    becomes a bottom sheet to avoid awkward anchored positioning.
  - Content: `Week N`, theme title, description, Sat–Sat date range,
    "View on chq.org" link to the source.
  - Dismiss: tap outside, Esc, tap the same week again.

Short-tap on mobile keeps current behavior (filter to that week).
Long-press is the discoverability cost — we'll add a small ⓘ icon
inside the popover trigger if testing shows long-press is missed.

### Active filter chip

Originally this section proposed extending the chip text to
`Week 1 · "Building a Culture of Empathy"`. After mobile review the
chip was left as the bare `Week 1` form to keep the "Filtering by"
row compact on narrow viewports — the theme is reachable from the
WeekSelector tooltip / popover, so duplicating it on the chip wasn't
worth the screen real estate.

### EventList day headers (shipped)

Each day group's header now reads `Day, Month D, YYYY - Week N`. On
Saturdays — where the canonical Sat-noon-to-Sat-noon boundary splits
the calendar day across two season weeks — it reads
`Day, Month D, YYYY - Week N/M`, and the popover stacks both themes.
`groupEventsByDay` was restructured to return
`{ key, baseLabel, weekNumbers, events }` so `EventList` can render
the week portion via a `WeekBadge` with the same hover/long-press
popover affordances as the filter row.

### Where else themes could appear (deliberately deferred)

- Event cards (one-line theme attribution under the date).

Easy to add once we've validated the popover surface. Pushed past v1
to keep the diff small.

## Multi-year

The file-naming scheme (`{year}.json`) is consistent with the
existing `2026-03-03-multi-year-support-design.md` plan. The hook
takes `year` as an argument and is driven by the same season-year
inference as the rest of the calendar — no new year-routing logic.

## Testing

- **Scraper parser**: fixture HTML committed at
  `scripts/__fixtures__/weekly-themes-2026.html`. Test asserts the
  parser produces a golden JSON. A second fixture covers an edge case
  (missing description, alternate markup) to keep the parser honest.
- **Validation**: unit tests for the "exactly 9 weeks, all dated,
  all titled" guards.
- **`useWeeklyThemes`**: tests for success, 404, and shared-request
  memoization.
- **WeekSelector**: existing tests stay green; new tests cover
  `title` content includes theme text and that the popover opens on
  long-press / right-click and closes on outside-click and Esc.
- **ActiveFilters chip**: chip shows theme title when themes are
  loaded, falls back when not.

## Verification

Standard pre-commit verification per CLAUDE.md:

- `cd frontend && npm run build`
- `cd backend && npm run validate`
- Manual dev-server check at `http://localhost:3000` on a narrow
  viewport (DevTools mobile emulation) plus a real-device pass before
  we iterate.

## Rollout

1. Land the scraper script + workflow + tests (PR #1). No UI yet.
2. Run the workflow for 2026, review the resulting PR (#2), merge.
3. Land the frontend hook + WeekSelector + chip changes (PR #3).
4. Test on real mobile. Open follow-up PRs to iterate on placement
   if needed.

Steps 1 and 3 can ship in parallel — the frontend tolerates a
missing themes file.
