> **Status:** Shipped via PR #64 (commit `db12dff`). Kept for architectural
> context — the October-1 year-rollover rule and tiered sync schedule
> described here are still load-bearing for current code.

# Multi-Year Season Support — Design Document

**Date:** 2026-03-03
**Status:** Approved

## Goal

Enable users to switch between Chautauqua season years (e.g., 2025, 2026, 2027) via the existing "Season" pill button in the header, while implementing tiered backend batch scheduling to keep data fresh at appropriate intervals.

## Default Year Rule

The default season year uses an October 1 turnover:

```typescript
function getDefaultYear(): number {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}
```

- Before Oct 1 of year N: default = N (current summer season)
- On/after Oct 1 of year N: default = N+1 (upcoming summer season)

Example: On March 3, 2026 → default is 2026. On Oct 1, 2026 → default becomes 2027.

## Available Years — Dynamic Discovery

Available years are determined dynamically based on what data exists, not a fixed window. The app has had data since the 2025 season and retains all past years as long as their cache files exist.

### Years Manifest

Backend generates `/cache/calendar-cache/years.json`:

```json
{
  "years": [2025, 2026, 2027],
  "defaultYear": 2026,
  "generated": "2026-03-03T12:00:00Z"
}
```

- Generated during cache warming after any sync operation
- Lists years that have a corresponding `all-events-{year}.json` file in S3
- Includes the computed `defaultYear` (Oct 1 rule, server-side)
- Frontend caches this with the same 1-hour TTL as event data
- Fallback: if manifest fails to load, use computed default year and try fetching directly

## Frontend Architecture

### Approach

URL-driven year selection with lazy loading per year. Selected year stored as `?year=` URL parameter for shareable links.

### New/Modified Files

**`constants.ts`** — Replace `ACTIVE_YEAR = 2026` with `getDefaultYear()` function. Add `YEARS_MANIFEST_URL` constant.

**New hook: `useAvailableYears.ts`** — Fetches the years manifest, returns `{ years, defaultYear, loading }`. Caches manifest in localStorage with 1-hour TTL.

**New hook: `useSelectedYear.ts`** — Reads `?year=` from URL, validates against available years, falls back to default. Returns `{ selectedYear, setSelectedYear, availableYears }`. `setSelectedYear` updates the URL param without page reload.

**`useEventData.ts`** — Accept `year` parameter instead of importing `ACTIVE_YEAR`. Constructs fetch URL with the passed year. localStorage cache keys become year-specific (e.g., `chq-calendar-events-2026`).

**`Header.tsx`** — Pill button becomes a dropdown trigger showing `{selectedYear} Season ▾`. Dropdown lists available years (descending), highlights current selection, labels default year.

**`page.tsx`** — Uses `useSelectedYear()` for the active year. Passes it to `useEventData()` and `getChautauquaSeasonWeeks()`. Countdown banner hidden when `selectedYear !== defaultYear`.

**`index.html` / `manifest.json`** — Remove hardcoded "2026" from title and descriptions.

### Year Switcher UI

- Existing pill button becomes clickable with a chevron indicator
- Click opens a dropdown below the pill
- Lists available years descending (newest first)
- Each item: `{year} Season` with checkmark on active year
- Default year labeled with "(current)" indicator
- Keyboard navigable with proper ARIA attributes
- Closes on outside click or Escape
- Mobile-friendly tap targets

### Filter State on Year Change

When switching years:
- Search text is preserved
- Selected categories, locations, and tags are checked against the new year's data
- Filters that exist in the new year are kept; filters with no matching events are dropped
- Week selection resets to "All" (season weeks differ by year)

### URL State

- Year stored as `?year=2025` query parameter
- Invalid or missing `?year=` falls back to default year
- Shareable and bookmarkable

### Loading State

- Pill immediately updates to show selected year
- Loading spinner/skeleton while fetching new year's data
- Filters update once data arrives

### Error Handling

- If `years.json` fails: fall back to computed default year, fetch `all-events-{defaultYear}.json` directly
- If year's data fails to load: show error, keep year selector functional for switching
- Invalid `?year=` param: silently use default year

## Backend — Batch Scheduling

### Tier 1: Full Refresh (On-Demand / Deploy)

- Triggered manually or on deployment
- Syncs ALL years: all past years with data + current + next
- Rebuilds complete DynamoDB dataset and all cache files
- Regenerates years manifest
- Only time past year data gets refreshed

### Tier 2: Hourly Sync (June–August Only, Near-Term)

- **Scope:** Current year, from 7 days in the past through 14 days ahead
- **Schedule:** `rate(60 minutes)`, active June 1 through August 31 only
- **Purpose:** People actively making plans during the season get fresh data quickly
- **Implementation:** Lambda fires hourly year-round but early-exits outside June–August (simpler than seasonal Terraform changes)

### Tier 3: Daily Sync (Distant Future + Next Year)

- **Scope:** Current year (all dates beyond 14 days out) + next year (all dates)
- **Schedule:** `cron(0 6 * * ? *)` (daily at 6 AM UTC)
- **Purpose:** Catch new events posted for later in the season or next year

### Cache Warming

After each sync tier:
- Regenerate `all-events-{year}.json` for all affected years
- Update `years.json` manifest with current list of years that have data

### Sync Handler Routing

The `scheduledSyncHandler` routes based on EventBridge detail-type:
- `"Hourly Sync"` → near-term sync (current year, -7d to +14d), skip if not June–August
- `"Daily Sync"` → distant future sync (current year 14d+) + next year (all dates)
- Weekly full sync removed (daily covers distant dates)

## Infrastructure Changes

### Terraform (`sync.tf`)

1. Re-enable hourly EventBridge rule with `rate(60 minutes)`
2. Remove hardcoded `ACTIVE_YEAR = "2026"` env var — Lambda computes at runtime using Oct 1 rule
3. No new Lambda functions needed

### S3/CloudFront

- No changes — cache files already use `all-events-{year}.json` naming
- New `years.json` manifest uses same `/cache/calendar-cache/` prefix
- CloudFront serves with existing caching rules

### DynamoDB

- No schema changes — events from all years coexist, filtered by `startDate` prefix

## Data Flow

```
App Load
  ├── Fetch years.json → discover available years
  ├── Read ?year= URL param → validate → selectedYear
  ├── Fetch all-events-{selectedYear}.json → events
  ├── Compute seasonWeeks for selectedYear
  ├── Build filter options from loaded events
  └── Render with year-aware components

Year Switch (dropdown selection)
  ├── Update URL: ?year={newYear}
  ├── Show loading state
  ├── Fetch all-events-{newYear}.json
  ├── Recompute seasonWeeks for newYear
  ├── Reconcile filters (keep compatible, drop incompatible)
  ├── Hide countdown if newYear ≠ defaultYear
  └── Re-render

Backend Sync (automated)
  ├── Hourly (Jun–Aug): current year, -7d to +14d
  ├── Daily: current year (distant) + next year
  ├── On Deploy: full refresh all years
  └── After sync: warm caches → update years.json
```

## UX Details

- **Week tabs:** Shown for all years (Week 1–9 adapt to selected year's season dates)
- **Countdown banner:** Only shown when selectedYear equals defaultYear and season hasn't started
- **Page title:** Dynamically set to include selected year (e.g., "Chautauqua Calendar | 2025 Season")
