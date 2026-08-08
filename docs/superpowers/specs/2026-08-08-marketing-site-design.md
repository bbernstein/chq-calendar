# Marketing & guide site — design

**Date:** 2026-08-08
**Status:** Approved, ready for implementation planning

## Problem

CHQ Calendar ships on two platforms with a large feature surface, and most of
it is invisible on first launch. The iOS app has reminders, Home Screen and
Lock Screen widgets, a My Day planner built from starred events, a grounds
map, Siri/Shortcuts actions, and Spotlight indexing — none of which announce
themselves. The web app has adaptive date windows, week drag-selection,
weekly-theme popovers, recently-used filter chips, four different
calendar-export paths, and offline support, all of which a visitor discovers
only by accident.

There is also no page that explains what CHQ Calendar *is* across both
platforms. The App Store `marketingUrl` currently points at the calendar
itself, which drops a prospective user into a filtered event list with no
context.

## Goal

A small marketing and guide site at `/about/` that:

1. Serves as the App Store `marketingUrl` — a complete, self-contained
   experience for someone arriving from the App Store listing.
2. Is reachable from inside the web app, so existing users can discover
   features they are not using.
3. Documents **every** feature on both platforms, with emphasis on the ones
   that are not visually obvious.
4. Shows how a Chautauquan actually organizes a visit, not just a feature
   inventory.

## Non-goals

- No new domain, S3 bucket, or CloudFront distribution.
- No blog, changelog, or press section.
- No replacement for `/support` — that URL is registered with App Store
  Connect and stays exactly where it is.
- No paid-acquisition landing pages or conversion instrumentation.

## Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Location | `/about/` on chqcal.org | Reuses S3 + CloudFront, Tailwind, test harness, sitemap. Zero new infra. |
| Indexing | Indexed | Added to `PUBLIC_PATHS`; a deliberate step up from the prior low-profile SEO posture, accepted by the owner. |
| Visuals | Real screenshots, both platforms | Reuses the existing iOS capture pipeline output; adds a parallel web capture script. |
| Structure | Scenarios first, then full reference | Serves the skimmer and the completist without choosing between them. |
| Web entry point | `shared/links.json` | About becomes a quick link on the web header *and* the iOS toolbar. |
| iOS entry point | About screen link | New "Guide & Features" row above Privacy Policy. |
| `/support` | Kept, cross-linked | Trim its overlapping intro paragraph so the two pages do not restate each other. |

## Site map

| URL | Purpose |
|---|---|
| `/about/` | Top page. What CHQ Calendar is, platform chooser, cross-platform highlights, help links. **Becomes `marketingUrl`.** |
| `/about/iphone/` | iPhone & iPad guide. |
| `/about/web/` | Web app guide. |

Each page follows the established MPA pattern:

- `frontend/about/index.html` (+ `about/iphone/`, `about/web/`), using the
  `/support` template for canonical, description, OG, and Twitter meta.
- `frontend/src/entries/about.tsx`, `about-iphone.tsx`, `about-web.tsx`.
- `frontend/src/app/about/page.tsx`, `iphone/page.tsx`, `web/page.tsx`.
- Three new entries in `vite.config.ts` `rollupOptions.input`.

## Architecture

### Content as data

The three pages share almost all of their chrome and differ mainly in
content. Rather than three large page files, content lives in a typed module
and pages are thin renderers.

`frontend/src/app/about/aboutContent.ts`:

```ts
/** Section a feature is filed under; the exact set differs per platform
 *  and is declared alongside the content arrays below. */
export type FeatureGroup = string;

/** Points at a prepared WebP pair in /public/about/ (420w + 840w). */
export interface ScreenshotRef {
  base: string;   // e.g. 'ios-07-my-day' → ios-07-my-day-420.webp / -840.webp
  alt: string;
  width: number;  // intrinsic dimensions of the 840w variant,
  height: number; // set on the <img> to prevent layout shift
}

export interface Feature {
  id: string;           // stable key, used by the coverage test
  title: string;
  blurb: string;
  group: FeatureGroup;
  notObvious?: boolean; // renders a "worth knowing" marker
}

export interface Scenario {
  id: string;
  title: string;
  body: string[];       // paragraphs
  screenshot?: ScreenshotRef;
}

export const IOS_SCENARIOS: Scenario[];
export const IOS_FEATURES: Feature[];
export const WEB_SCENARIOS: Scenario[];
export const WEB_FEATURES: Feature[];
export const SHARED_HIGHLIGHTS: Feature[];  // top page
```

This is the load-bearing decision of the design. It makes "does the guide
document every feature?" an assertion a test can make, rather than something
that silently rots as the apps gain features.

### Components

All under `frontend/src/app/about/`:

| Component | Responsibility | Depends on |
|---|---|---|
| `AboutLayout.tsx` | Header (logo, cross-page nav), footer (disclaimer, Privacy/Support/Feedback) | — |
| `AboutNav.tsx` | Overview · iPhone & iPad · Web · Support, with current-page marking | — |
| `Scenario.tsx` | Renders one `Scenario`: heading, prose, screenshot; alternates sides on desktop | `Screenshot` |
| `FeatureReference.tsx` | Renders a `Feature[]` grouped by `group`, marking `notObvious` entries | — |
| `Screenshot.tsx` | `<img>` with `srcset`, explicit `width`/`height`, `loading="lazy"` below the fold | — |
| `PlatformCard.tsx` | Top-page chooser card (icon, name, one-liner, CTA) | — |

Each is independently testable and none reaches into another's internals.
Pages compose them and pass content from `aboutContent.ts`.

### Styling

Tailwind 4, matching the existing pages: `bg-gradient-to-br from-blue-50 to-indigo-100`
light / `from-gray-900 to-gray-800` dark, cards as `bg-white dark:bg-gray-800
rounded-lg shadow`. Dark mode via `prefers-color-scheme` only — no `.dark`
class is added to the DOM on this site, so any hand-authored CSS needs a
media query, as `/support` already does.

## Content

### `/about/` (top page)

1. **Hero** — one-line description of CHQ Calendar; canonical disclaimer
   immediately visible.
2. **Platform chooser** — two `PlatformCard`s: *iPhone & iPad* (App Store)
   and *Web* (open the calendar). Both note that features and data are the
   same, and that no account is needed anywhere.
3. **What it does, everywhere** — `SHARED_HIGHLIGHTS`: the whole season in
   one place, filter and search, save favorites, add to your own calendar,
   Chautauquan Daily and digital-program links, past and upcoming seasons,
   no accounts/ads/trackers.
4. **Getting help** — links to `/support` and `/feedback`.
5. **Footer** — disclaimer, Privacy · Support · Feedback.

### `/about/iphone/`

**Scenarios:**

- **Plan your day** — star events, open My Day, read the timeline, notice
  the overlap and walking-gap warnings.
- **Never miss what you starred** — the full chain: star an event → pick a
  reminder (30 min / 1 hour / night before) → set a default timing once →
  see it on the Home Screen or Lock Screen widget. This is the chain the
  owner specifically called out; it is stated explicitly rather than left
  for the reader to assemble.
- **Find your way** — the grounds map, venue tap-through to next events,
  walking directions, and the fact that no location permission is required.
- **Follow the season** — weeks and themes, categories and venues, search,
  and Daily coverage on event details.

**Feature reference,** grouped:

- *Browsing & finding* — every event grouped by day; search by name, venue,
  or presenter; filter by category, venue, and week; recently-used filters
  surface first; weekly theme badges.
- *Favorites & reminders* — star from list or detail; reminder timings; a
  default preset set in About › Reminders; local notifications only.
- *Widgets* — Next Up (Home small/medium, Lock rectangular/inline) and
  Starred (Home small, Lock rectangular); configurable by venue, category,
  or starred-only; off-season countdown instead of an empty widget.
- *My Day* — starred events on a timeline, overlap detection, walking-gap
  checks, updates as you star and unstar.
- *Map* — every venue plotted, next events per venue, filter the list to one
  venue, walking directions via Apple Maps.
- *Siri, Shortcuts & Spotlight* — "What's Next", "Today at Chautauqua",
  "Open Event"; system-wide Spotlight indexing of the season plus starred
  events.
- *Calendar & links* — add to your own calendar; Chautauquan Daily articles
  and digital programs on event details.
- *Anywhere* — loaded events readable offline; iPhone and iPad; off-season
  countdown, next season's announced events, browsable past seasons.
- *Privacy* — no account, no ads, no third-party trackers; filters,
  favorites, and reminders stay on device; calendar access is write-only.

Closes with an App Store link.

### `/about/web/`

**Scenarios:** *See what's on right now* · *Build your shortlist* (favorites
and favorites-only) · *Get it into your own calendar* · *Follow the season*.

**Feature reference,** grouped:

- *Finding* — search by name, venue, or presenter; category and venue
  filters with recently-used chips first; active-filter chips that clear
  individually.
- *Dates & weeks* — Today / This week / Next; the adaptive "next" window
  that grows to fill a useful number of events; "show next day"; week
  drag-selection across the strip; weekly theme popovers.
- *Events* — expandable descriptions; Chautauquan Daily article links;
  digital program links; venue and presenter detail.
- *Favorites* — star events, filter to favorites only, count badge.
- *Calendar export* — Google Calendar, Outlook, `.ics` download, and
  `webcal:` subscription.
- *Seasons* — year selector for past and upcoming seasons; off-season
  countdown banner.
- *Living on your device* — install to Home Screen; offline reading of
  already-loaded events via the service worker; automatic update when a new
  version deploys; dark mode follows your system.
- *Privacy* — no accounts, no ads, no third-party trackers; filters and
  favorites are stored locally for 30 days.

Closes with a cross-link to `/about/iphone/`.

## Screenshots

Two scripts in `frontend/scripts/`, following the existing
`generate-icons.mjs` pattern (`sharp` is already a frontend dependency).

### `prepare-about-screenshots.mjs`

Reads the ten existing `docs/app-store/screenshots/review/iphone-6.9-*.png`
captures and emits `frontend/public/about/ios-<id>.webp` at 420w and 840w for
`srcset`. Because these derive from the App Store capture pipeline, which is
already regenerated and CI-guarded on every user-visible iOS change, the iOS
half of the site stays fresh without separate upkeep.

### `capture-web-screenshots.mjs`

Drives a headless browser against a local dev server, seeding filter and
favorite state through `localStorage` before each capture, and produces
roughly six shots (season list, filters in use, an expanded event with Daily
links, favorites-only, add-to-calendar, week strip) at desktop and mobile
widths. Output passes through the same `sharp` step to
`frontend/public/about/web-<id>.webp`.

This adds `playwright` as a devDependency. The npm package is small; Chromium
downloads only on an explicit `npx playwright install chromium`, so ordinary
`npm ci` is unaffected. The alternative — capturing once by hand — was
rejected because it goes stale silently, which is the exact failure mode the
project's App Store screenshot guard exists to prevent.

Both are wired to `npm run about:screenshots`. **Outputs are committed**, so
`npm run build` never depends on the capture step and CI needs no browser.

## Entry points and cross-links

| File | Change |
|---|---|
| `shared/links.json` | Add `{ "id": "about", "title": "About", "url": "https://www.chqcal.org/about", "webPath": "/about" }` as the first quick link |
| `frontend/src/lib/quickLinks.ts` | No change — reads the JSON |
| `ios/.../About/AboutInfo.swift` | Matching `quickLinks` entry; new `links` entry "Guide & Features" → `/about/iphone`, above Privacy Policy |
| `frontend/src/app/page.tsx` | Add About to the calendar footer link row |
| `frontend/src/app/support/page.tsx` | Add "New here? → guide"; trim the overlapping intro paragraph |
| `docs/app-store/listing-fields.json` | `marketingUrl` → `https://www.chqcal.org/about` |
| `frontend/src/lib/sitemap.ts` | `PUBLIC_PATHS` += `/about`, `/about/iphone`, `/about/web` |
| `frontend/vite.config.ts` | Three new `rollupOptions.input` entries |

## Testing

- **Render tests** per page — expected sections present, platform links point
  at the right URLs, disclaimer rendered.
- **Feature-coverage test** — every `Feature.id` in `IOS_FEATURES` and
  `WEB_FEATURES` must appear in the rendered output of its page. Guards
  against a feature being added to the data and dropped from the view, and
  against the App Store description promising something the guide omits.
- **Disclaimer verbatim test** — extend the `sources` array in
  `frontend/src/__tests__/appStoreListing.test.ts` to the new pages.
- **`marketingUrl` assertion** — update from `https://www.chqcal.org` to
  `https://www.chqcal.org/about` in the same file.
- **`sitemap.test.ts`** — updated for the three new paths.
- **iOS `AboutInfoTests`** — the existing `quickLinksMatchSharedLinksJson`
  test covers the toolbar entry; add coverage for the new About-screen link.
- **Coverage floor** — `.coverage-floor.json` must not regress.

## Consequences to plan for

Editing `ios/ChqCalendar/Features/About/AboutInfo.swift` trips
`.github/workflows/app-store-assets.yml`, and the new toolbar quick link *is*
visible in the `01-season` shot. This genuinely requires regenerating
screenshots (`ios/Scripts/capture-screenshots.sh` then
`ios/Scripts/compose-screenshots.py`) rather than a `[skip-screenshots]`
opt-out. That needs Xcode and simulators, so it is sequenced as the final
implementation step and run once, cleanly.

Changing `marketingUrl` is an App Store Connect metadata edit. Like the
description and screenshots, it takes effect with the next version
submission — which is already being prepared, so this rides along rather
than forcing its own review cycle.

## Risks

| Risk | Mitigation |
|---|---|
| Guide drifts from the apps as features change | Feature-coverage test; iOS screenshots ride the existing CI-guarded pipeline |
| Page weight from screenshots | WebP at two widths, lazy loading below the fold, explicit dimensions to avoid layout shift |
| Header button row becomes crowded with a sixth quick link | About goes first; the mobile "More" menu already collapses the row |
| Higher search visibility draws CHQ attention before outreach | Accepted explicitly by the owner; disclaimer is prominent on every new page |
