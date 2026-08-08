# Marketing & Guide Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-page marketing and guide site at `/about/` that becomes the App Store `marketingUrl`, is reachable from inside both apps, and documents every feature on both platforms.

**Architecture:** Three new pages in the existing Vite MPA. All copy lives in a typed `aboutContent.ts` module so pages are thin renderers and "does the guide document every feature?" becomes a unit test. Screenshots are prepared by two `sharp`-based scripts — one reusing the existing App Store iOS captures, one capturing the web app — and committed as WebP so the build never depends on capture.

**Tech Stack:** Vite 7, Preact 10, TypeScript 5, Tailwind CSS 4, Vitest + `@testing-library/preact`, `sharp` (already a dependency), `playwright` (new devDependency, capture only), Swift 6 / Swift Testing for the iOS half.

**Spec:** `docs/superpowers/specs/2026-08-08-marketing-site-design.md`

## Global Constraints

- **Branch:** `feat/marketing-about-site`. Never commit to `main`.
- **Working directory:** all `npm` commands run from `frontend/` unless stated otherwise.
- **Node:** `>=24.0.0`.
- **Preact, not React.** Files that render JSX and wire DOM event handlers import hooks and React-shaped types from `'react'` — `@preact/preset-vite` aliases it to `preact/compat`, which installs the `onChange`→`onInput` normalization. Do not "fix" these to `preact/hooks`.
- **Path aliases:** `@/` → `frontend/src/`, `@shared` → `shared/`.
- **Tailwind 4**, `@import "tailwindcss"` syntax. Dark mode is `prefers-color-scheme` **only** — no `.dark` class is ever added to the DOM, so hand-authored CSS needs a `@media (prefers-color-scheme: dark)` block, never a `.dark X` selector.
- **Test discovery:** `src/**/*.test.{ts,tsx}` only. jsdom environment, globals enabled.
- **Coverage floor:** `.coverage-floor.json` `frontend.lines` is `74.3` and must not regress. `npm run build` runs `vitest run --coverage` and fails below the floor.
- **Canonical disclaimer:** the exact string in `docs/app-store/listing-fields.json` → `disclaimer`. It is asserted verbatim (on collapsed whitespace) by `frontend/src/__tests__/appStoreListing.test.ts`. Copy it character-for-character:
  > CHQ Calendar is an independent app and is not affiliated with, endorsed by, or sponsored by Chautauqua Institution. Event information is drawn from publicly posted listings; chq.org remains the authoritative source.
- **iOS id constraint:** `AboutInfoTests.quickLinksAreDistinctFromTheAboutSheetLinks` asserts `AboutInfo.links` ids and `AboutInfo.quickLinks` ids are **disjoint sets**. The quick link uses id `about`, so the About-sheet link **must** use id `guide`. Using `about` for both will fail the suite.
- **Verification before any commit:** `npm run validate` (type-check + lint) from `frontend/`, plus the tests named in the task.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `frontend/src/app/about/aboutContent.ts` | All copy and content types. No JSX. |
| `frontend/src/app/about/aboutContent.test.ts` | Content invariants (unique ids, non-empty copy). |
| `frontend/src/app/about/AboutLayout.tsx` | Page chrome: header, nav, footer, disclaimer. |
| `frontend/src/app/about/AboutNav.tsx` | Cross-page navigation with current-page marking. |
| `frontend/src/app/about/Screenshot.tsx` | Responsive `<img>` with srcset and fixed dimensions. |
| `frontend/src/app/about/Scenario.tsx` | Renders one `Scenario`. |
| `frontend/src/app/about/FeatureReference.tsx` | Renders a `Feature[]` grouped by `group`. |
| `frontend/src/app/about/PlatformCard.tsx` | Top-page platform chooser card. |
| `frontend/src/app/about/page.tsx` | `/about/` top page. |
| `frontend/src/app/about/iphone/page.tsx` | `/about/iphone/`. |
| `frontend/src/app/about/web/page.tsx` | `/about/web/`. |
| `frontend/src/app/about/*.test.tsx` | One test file per component/page. |
| `frontend/about/index.html`, `about/iphone/index.html`, `about/web/index.html` | HTML entries with canonical/OG meta. |
| `frontend/src/entries/about.tsx`, `about-iphone.tsx`, `about-web.tsx` | Mount points. |
| `frontend/scripts/prepare-about-screenshots.mjs` | iOS PNG → WebP at two widths. |
| `frontend/scripts/capture-web-screenshots.mjs` | Playwright capture of the web app → WebP. |
| `frontend/public/about/*.webp` | Committed image assets. |

**Modified:** `frontend/vite.config.ts` (3 inputs), `frontend/package.json` (scripts + playwright), `frontend/src/lib/sitemap.ts` (3 paths), `frontend/src/lib/sitemap.test.ts`, `frontend/src/__tests__/appStoreListing.test.ts`, `frontend/src/app/page.tsx` (footer), `frontend/src/app/support/page.tsx`, `shared/links.json`, `docs/app-store/listing-fields.json`, `ios/ChqCalendar/Features/About/AboutInfo.swift`, `ios/ChqCalendarTests/AboutInfoTests.swift`.

---

### Task 1: Content model and copy

The load-bearing task. Everything else renders this data.

**Files:**
- Create: `frontend/src/app/about/aboutContent.ts`
- Test: `frontend/src/app/about/aboutContent.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: types `Platform`, `ScreenshotRef`, `Feature`, `Scenario`, `PlatformInfo`; constants `SHARED_HIGHLIGHTS`, `IOS_SCENARIOS`, `IOS_FEATURES`, `WEB_SCENARIOS`, `WEB_FEATURES`, `PLATFORMS`, `DISCLAIMER`, `APP_STORE_URL`; helper `groupFeatures(features: Feature[]): Array<{ group: string; features: Feature[] }>`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/about/aboutContent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  SHARED_HIGHLIGHTS, IOS_SCENARIOS, IOS_FEATURES,
  WEB_SCENARIOS, WEB_FEATURES, PLATFORMS, groupFeatures,
} from './aboutContent';

const allFeatures = [...SHARED_HIGHLIGHTS, ...IOS_FEATURES, ...WEB_FEATURES];
const allScenarios = [...IOS_SCENARIOS, ...WEB_SCENARIOS];

describe('aboutContent', () => {
  it('gives every feature a unique id', () => {
    const ids = allFeatures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every scenario a unique id', () => {
    const ids = allScenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has non-empty title and blurb on every feature', () => {
    for (const f of allFeatures) {
      expect(f.title.trim(), `${f.id} title`).not.toBe('');
      expect(f.blurb.trim(), `${f.id} blurb`).not.toBe('');
    }
  });

  it('has at least one paragraph in every scenario', () => {
    for (const s of allScenarios) {
      expect(s.body.length, `${s.id} body`).toBeGreaterThan(0);
      expect(s.body.every((p) => p.trim() !== ''), `${s.id} paragraphs`).toBe(true);
    }
  });

  it('gives every screenshot a non-empty alt text and real dimensions', () => {
    const shots = allScenarios.flatMap((s) => (s.screenshot ? [s.screenshot] : []));
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      expect(shot.alt.trim(), `${shot.base} alt`).not.toBe('');
      expect(shot.width).toBeGreaterThan(0);
      expect(shot.height).toBeGreaterThan(0);
    }
  });

  it('covers both platforms with a guide link', () => {
    expect(PLATFORMS.map((p) => p.id).sort()).toEqual(['ios', 'web']);
    for (const p of PLATFORMS) {
      expect(p.guideHref.startsWith('/about/')).toBe(true);
    }
  });

  it('groups features preserving first-seen group order', () => {
    const grouped = groupFeatures([
      { id: 'a', title: 'A', blurb: 'a', group: 'One' },
      { id: 'b', title: 'B', blurb: 'b', group: 'Two' },
      { id: 'c', title: 'C', blurb: 'c', group: 'One' },
    ]);
    expect(grouped.map((g) => g.group)).toEqual(['One', 'Two']);
    expect(grouped[0].features.map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('documents the non-obvious iOS features the App Store description promises', () => {
    const ids = IOS_FEATURES.map((f) => f.id);
    for (const id of [
      'ios-reminders', 'ios-widget-next', 'ios-widget-starred', 'ios-my-day',
      'ios-map', 'ios-siri', 'ios-spotlight', 'ios-offseason',
    ]) {
      expect(ids, `missing ${id}`).toContain(id);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/app/about/aboutContent.test.ts`
Expected: FAIL — `Failed to resolve import "./aboutContent"`.

- [ ] **Step 3: Write the content module**

Create `frontend/src/app/about/aboutContent.ts`:

```ts
/**
 * All copy for the /about guide site, as data.
 *
 * Pages are thin renderers over these constants. Keeping content here (rather
 * than inline in JSX) is what lets `aboutContent.test.ts` and the page tests
 * assert that every feature we ship is actually documented — the guide going
 * stale as the apps gain features is the main failure mode this design guards
 * against.
 */

export type Platform = 'ios' | 'web';

/** Points at a prepared WebP pair in /public/about/ (420w/840w for iOS
 *  portrait shots, 640w/1280w for web shots). */
export interface ScreenshotRef {
  /** Filename stem, e.g. 'ios-07-my-day' → ios-07-my-day-840.webp */
  base: string;
  alt: string;
  /** Intrinsic size of the LARGER variant; set on the <img> to reserve space. */
  width: number;
  height: number;
}

export interface Feature {
  /** Stable key. Page tests assert each one is rendered. */
  id: string;
  title: string;
  blurb: string;
  group: string;
  /** Renders a "worth knowing" marker — features users rarely discover. */
  notObvious?: boolean;
}

export interface Scenario {
  id: string;
  title: string;
  body: string[];
  screenshot?: ScreenshotRef;
}

export interface PlatformInfo {
  id: Platform;
  name: string;
  tagline: string;
  guideHref: string;
  /** Where the "get it" button goes. Empty for iOS until the app is live. */
  ctaHref: string;
  ctaLabel: string;
}

/** Verbatim from docs/app-store/listing-fields.json → disclaimer.
 *  Asserted by frontend/src/__tests__/appStoreListing.test.ts. */
export const DISCLAIMER =
  'CHQ Calendar is an independent app and is not affiliated with, endorsed by, ' +
  'or sponsored by Chautauqua Institution. Event information is drawn from ' +
  'publicly posted listings; chq.org remains the authoritative source.';

/**
 * Public App Store URL. Empty until the app is released — App Store Connect
 * assigns the numeric Apple ID at app-record creation, but the /app/id… URL
 * only resolves once a version is live. `PlatformCard` renders a
 * "coming soon" state while this is empty, so shipping the site does not
 * depend on the app being approved first.
 */
export const APP_STORE_URL = '';

const IOS_SHOT = { width: 840, height: 1825 };   // iPhone 6.9 (1320×2868) scaled
const WEB_SHOT = { width: 1280, height: 900 };

export const PLATFORMS: PlatformInfo[] = [
  {
    id: 'ios',
    name: 'iPhone & iPad',
    tagline: 'Reminders, Home Screen widgets, a day planner, and a map of the grounds.',
    guideHref: '/about/iphone',
    ctaHref: APP_STORE_URL,
    ctaLabel: APP_STORE_URL ? 'Get it on the App Store' : 'Coming to the App Store',
  },
  {
    id: 'web',
    name: 'Web',
    tagline: 'The full calendar in any browser. Nothing to install, nothing to sign up for.',
    guideHref: '/about/web',
    ctaHref: '/',
    ctaLabel: 'Open the calendar',
  },
];

export const SHARED_HIGHLIGHTS: Feature[] = [
  { id: 'shared-season', group: 'Everywhere', title: 'The whole season in one place',
    blurb: 'Roughly 1,500 events — lectures, concerts, worship, recreation — in a single list you can scroll.' },
  { id: 'shared-filter', group: 'Everywhere', title: 'Filter and search',
    blurb: 'Narrow by category, venue, week, or date, or search by name, venue, or presenter.' },
  { id: 'shared-favorites', group: 'Everywhere', title: 'Save what you can’t miss',
    blurb: 'Star events to build a shortlist you can filter down to in one tap.' },
  { id: 'shared-calendar', group: 'Everywhere', title: 'Add to your own calendar',
    blurb: 'Send any event straight to the calendar you already use.' },
  { id: 'shared-daily', group: 'Everywhere', title: 'Read what the Daily wrote',
    blurb: 'Events link out to Chautauquan Daily coverage and digital programs where they exist.' },
  { id: 'shared-seasons', group: 'Everywhere', title: 'Past and upcoming seasons',
    blurb: 'Look back at previous years, or ahead once next season’s events are announced.' },
  { id: 'shared-privacy', group: 'Everywhere', title: 'No account, no ads, no trackers',
    blurb: 'Nothing to sign up for. Your filters and favorites stay on your device.' },
];

export const IOS_SCENARIOS: Scenario[] = [
  {
    id: 'ios-plan-your-day',
    title: 'Plan your day',
    body: [
      'Star the events you don’t want to miss — from the list, or from an event’s detail screen.',
      'Open the My Day tab and they’re laid out on a timeline in the order they happen. If two of them overlap, My Day says so. If you’ve left yourself twelve minutes to get from the Hall of Philosophy to the Amphitheater, it says that too.',
      'Star something else and the timeline rebuilds itself. There is nothing to save.',
    ],
    screenshot: { base: 'ios-07-my-day', alt: 'The My Day tab showing starred events on a timeline', ...IOS_SHOT },
  },
  {
    id: 'ios-never-miss',
    title: 'Never miss what you starred',
    body: [
      'A star does more than bookmark. Once an event is starred, you can set a reminder on it: thirty minutes before, an hour before, or the night before at 8 PM.',
      'Pick a default in About › Reminders and every event you star from then on uses that timing automatically.',
      'The same starred events feed the Home Screen and Lock Screen widgets, so what’s coming up is on your phone before you unlock it.',
    ],
    screenshot: { base: 'ios-09-reminder', alt: 'An event detail screen with the reminder options open', ...IOS_SHOT },
  },
  {
    id: 'ios-find-your-way',
    title: 'Find your way on the grounds',
    body: [
      'The Map tab plots every venue on the grounds. Tap one to see what’s on there next, or to filter the whole event list down to that venue.',
      'Need directions? Hand off to Apple Maps for a walking route.',
      'None of this asks for your location.',
    ],
    screenshot: { base: 'ios-08-map', alt: 'The Map tab showing venues plotted across the Chautauqua grounds', ...IOS_SHOT },
  },
  {
    id: 'ios-follow-the-season',
    title: 'Follow the season',
    body: [
      'Every week at Chautauqua has a theme. Tap a week’s badge to read it, then filter to that week to see everything programmed around it.',
      'Narrow by category and venue on top of that, or search by name, venue, or presenter. The filters you reach for most move to the front of the list.',
      'Event details link out to Chautauquan Daily coverage and digital programs where they exist.',
    ],
    screenshot: { base: 'ios-02-filters', alt: 'The filter sheet with categories and venues', ...IOS_SHOT },
  },
];

export const IOS_FEATURES: Feature[] = [
  // Browsing & finding
  { id: 'ios-browse', group: 'Browsing & finding', title: 'Every event, grouped by day',
    blurb: 'Scroll the whole season, or jump straight to a date.' },
  { id: 'ios-search', group: 'Browsing & finding', title: 'Search by name, venue, or presenter',
    blurb: 'One search field covers all three.' },
  { id: 'ios-filters', group: 'Browsing & finding', title: 'Filter by category, venue, and week',
    blurb: 'Combine filters freely; the active ones show as chips you can clear one at a time.' },
  { id: 'ios-recent-filters', group: 'Browsing & finding', title: 'Recently-used filters come first', notObvious: true,
    blurb: 'The categories and venues you actually use rise to the front of the list.' },
  { id: 'ios-week-themes', group: 'Browsing & finding', title: 'Weekly themes', notObvious: true,
    blurb: 'Each week of the season has a theme — tap the badge on any week to read it.' },

  // Favorites & reminders
  { id: 'ios-star', group: 'Favorites & reminders', title: 'Star from anywhere',
    blurb: 'Star an event from the list or from its detail screen.' },
  { id: 'ios-reminders', group: 'Favorites & reminders', title: 'Reminders for starred events', notObvious: true,
    blurb: 'Choose 30 minutes before, an hour before, or the night before at 8 PM.' },
  { id: 'ios-reminder-default', group: 'Favorites & reminders', title: 'Set a default timing once', notObvious: true,
    blurb: 'Pick a default in About › Reminders and every star you add uses it.' },
  { id: 'ios-local-notifications', group: 'Favorites & reminders', title: 'Local notifications only',
    blurb: 'Reminders are scheduled on your device. No push notifications, no server.' },

  // Widgets
  { id: 'ios-widget-next', group: 'Widgets', title: 'Next Up widget', notObvious: true,
    blurb: 'What’s on next on the grounds, on your Home Screen or Lock Screen.' },
  { id: 'ios-widget-starred', group: 'Widgets', title: 'Starred widget', notObvious: true,
    blurb: 'Your next starred event at a glance.' },
  { id: 'ios-widget-config', group: 'Widgets', title: 'Widgets you can narrow', notObvious: true,
    blurb: 'Point a widget at one venue, one category, or only the events you’ve starred.' },
  { id: 'ios-widget-offseason', group: 'Widgets', title: 'Off-season countdown',
    blurb: 'Outside the season, widgets count down to next season instead of going blank.' },

  // My Day
  { id: 'ios-my-day', group: 'My Day', title: 'Your starred events on a timeline',
    blurb: 'The My Day tab lays out everything you starred for a day, in the order it happens.' },
  { id: 'ios-my-day-overlap', group: 'My Day', title: 'Overlap warnings', notObvious: true,
    blurb: 'Two starred events at the same time get flagged before you’re standing in the wrong place.' },
  { id: 'ios-my-day-walking', group: 'My Day', title: 'Walking-time checks', notObvious: true,
    blurb: 'If two venues are further apart than the gap between events, My Day tells you.' },
  { id: 'ios-my-day-live', group: 'My Day', title: 'Updates as you star',
    blurb: 'Star or unstar anything and the timeline rebuilds itself.' },

  // Map
  { id: 'ios-map', group: 'Map', title: 'Every venue on the grounds',
    blurb: 'The Map tab plots each venue where you’d actually find it.' },
  { id: 'ios-map-venue', group: 'Map', title: 'Tap a venue for what’s next', notObvious: true,
    blurb: 'See that venue’s upcoming events, or filter the whole list down to it.' },
  { id: 'ios-map-directions', group: 'Map', title: 'Walking directions',
    blurb: 'Hand off to Apple Maps for a walking route to any venue.' },
  { id: 'ios-map-no-permission', group: 'Map', title: 'No location permission needed',
    blurb: 'The map works without ever asking where you are.' },

  // Siri, Shortcuts & Spotlight
  { id: 'ios-siri', group: 'Siri, Shortcuts & Spotlight', title: 'Ask Siri what’s next', notObvious: true,
    blurb: '“What’s Next” and “Today at Chautauqua” both work by voice.' },
  { id: 'ios-shortcuts', group: 'Siri, Shortcuts & Spotlight', title: 'Open any event by name', notObvious: true,
    blurb: 'The Open Event action works from Siri or from the Shortcuts app.' },
  { id: 'ios-spotlight', group: 'Siri, Shortcuts & Spotlight', title: 'Find events from Spotlight', notObvious: true,
    blurb: 'Swipe down on the Home Screen and search — the season and your starred events are indexed.' },

  // Calendar & links
  { id: 'ios-calendar', group: 'Calendar & links', title: 'Add to your own calendar',
    blurb: 'Send an event to the calendar app you already use.' },
  { id: 'ios-daily', group: 'Calendar & links', title: 'Chautauquan Daily coverage', notObvious: true,
    blurb: 'Event details link to Daily articles about that event where they exist.' },
  { id: 'ios-programs', group: 'Calendar & links', title: 'Digital programs', notObvious: true,
    blurb: 'Where a digital program has been published, the event links straight to it.' },

  // Anywhere
  { id: 'ios-offline', group: 'Anywhere', title: 'Works offline',
    blurb: 'Events you’ve already loaded stay readable without a connection.' },
  { id: 'ios-ipad', group: 'Anywhere', title: 'iPhone and iPad',
    blurb: 'Built for both, with a layout that uses the larger screen rather than stretching to it.' },
  { id: 'ios-offseason', group: 'Anywhere', title: 'Off-season, still useful',
    blurb: 'A countdown to next season, next season’s announced events, and browsable past seasons.' },

  // Privacy
  { id: 'ios-privacy', group: 'Privacy', title: 'No account, no ads, no trackers',
    blurb: 'Filters, favorites, and reminders stay on your device.' },
  { id: 'ios-calendar-writeonly', group: 'Privacy', title: 'Calendar access is write-only', notObvious: true,
    blurb: 'The app can add events you choose. It never reads your calendar.' },
];

export const WEB_SCENARIOS: Scenario[] = [
  {
    id: 'web-whats-on',
    title: 'See what’s on right now',
    body: [
      'The calendar opens on what’s coming up next, not on a wall of the whole season. The window sizes itself — it keeps widening until it has enough events to be worth reading.',
      'Want more? “Show another day” extends it a day at a time.',
      'Or jump to Today, This week, or any week of the season.',
    ],
    screenshot: { base: 'web-01-season', alt: 'The calendar showing upcoming events grouped by day', ...WEB_SHOT },
  },
  {
    id: 'web-shortlist',
    title: 'Build your shortlist',
    body: [
      'Star events as you browse. Then turn on the favorites filter and everything you haven’t starred disappears.',
      'Your stars are kept in your browser for 30 days. There is no account and nothing to sign in to.',
    ],
    screenshot: { base: 'web-04-favorites', alt: 'The calendar filtered to starred events only', ...WEB_SHOT },
  },
  {
    id: 'web-own-calendar',
    title: 'Get it into your own calendar',
    body: [
      'Any event can go straight into the calendar you already use: Google Calendar, Outlook, or a downloaded .ics file.',
      'You can also subscribe by webcal, so the event stays in sync rather than being copied once and forgotten.',
    ],
    screenshot: { base: 'web-05-calendar', alt: 'The add-to-calendar options on an event', ...WEB_SHOT },
  },
  {
    id: 'web-follow-the-season',
    title: 'Follow the season',
    body: [
      'Drag across the week strip to select a range of weeks at once. Tap a week’s badge to read its theme.',
      'Filter by category and venue on top of that — the ones you use most move to the front. Every filter you’ve applied shows as a chip you can clear on its own.',
      'A 📰 on an event means the Chautauquan Daily covered it. A 📖 means there’s a digital program.',
    ],
    screenshot: { base: 'web-03-filters', alt: 'The week strip and category filters in use', ...WEB_SHOT },
  },
];

export const WEB_FEATURES: Feature[] = [
  // Finding
  { id: 'web-search', group: 'Finding', title: 'Search by name, venue, or presenter',
    blurb: 'One field covers all three, and results narrow as you type.' },
  { id: 'web-category-venue', group: 'Finding', title: 'Category and venue filters',
    blurb: 'Pick as many as you like; they combine with everything else.' },
  { id: 'web-recent-filters', group: 'Finding', title: 'Recently-used filters come first', notObvious: true,
    blurb: 'The categories and venues you keep coming back to move to the front of the row.' },
  { id: 'web-active-chips', group: 'Finding', title: 'Active filter chips', notObvious: true,
    blurb: 'Everything you’ve applied shows as a chip — clear them one at a time or all at once.' },

  // Dates & weeks
  { id: 'web-date-quick', group: 'Dates & weeks', title: 'Today, this week, or what’s next',
    blurb: 'Three buttons cover the questions people actually ask.' },
  { id: 'web-adaptive', group: 'Dates & weeks', title: 'The “next” window grows to fit', notObvious: true,
    blurb: 'Instead of a fixed number of days, it widens until it has a useful number of events to show.' },
  { id: 'web-show-next-day', group: 'Dates & weeks', title: 'Show another day', notObvious: true,
    blurb: 'One click extends the window a day at a time, as far as you want to look.' },
  { id: 'web-week-strip', group: 'Dates & weeks', title: 'Pick weeks from the strip',
    blurb: 'Every week of the season, selectable directly.' },
  { id: 'web-week-drag', group: 'Dates & weeks', title: 'Drag to select a range of weeks', notObvious: true,
    blurb: 'Click and drag across the strip to select several weeks in one gesture.' },
  { id: 'web-week-themes', group: 'Dates & weeks', title: 'Weekly theme popovers', notObvious: true,
    blurb: 'Tap a week’s badge to read the theme that week is programmed around.' },

  // Events
  { id: 'web-expand', group: 'Events', title: 'Expandable descriptions',
    blurb: 'Open an event in place for the full description without losing your scroll position.' },
  { id: 'web-daily', group: 'Events', title: 'Chautauquan Daily coverage', notObvious: true,
    blurb: 'A 📰 marker means the Daily wrote about that event — click through to read it.' },
  { id: 'web-programs', group: 'Events', title: 'Digital programs', notObvious: true,
    blurb: 'A 📖 marker links to the event’s digital program.' },

  // Favorites
  { id: 'web-star', group: 'Favorites', title: 'Star events',
    blurb: 'Build a shortlist as you browse.' },
  { id: 'web-favorites-only', group: 'Favorites', title: 'Filter to favorites only', notObvious: true,
    blurb: 'One toggle hides everything you haven’t starred.' },

  // Calendar export
  { id: 'web-google', group: 'Calendar export', title: 'Google Calendar',
    blurb: 'Open an event straight into Google Calendar.' },
  { id: 'web-outlook', group: 'Calendar export', title: 'Outlook',
    blurb: 'The same, for Outlook.' },
  { id: 'web-ics', group: 'Calendar export', title: 'Download an .ics file',
    blurb: 'For any calendar app that reads standard files.' },
  { id: 'web-webcal', group: 'Calendar export', title: 'Subscribe by webcal', notObvious: true,
    blurb: 'Subscribe rather than copy, so the event stays in sync if it changes.' },

  // Seasons
  { id: 'web-year', group: 'Seasons', title: 'Past and upcoming seasons',
    blurb: 'Switch years from the header to look back — or ahead, once next season is announced.' },
  { id: 'web-countdown', group: 'Seasons', title: 'Off-season countdown',
    blurb: 'Between seasons, a banner counts down to opening day.' },

  // On your device
  { id: 'web-install', group: 'On your device', title: 'Install to your Home Screen', notObvious: true,
    blurb: 'Add chqcal.org to your Home Screen and it opens full-screen, like an app.' },
  { id: 'web-offline', group: 'On your device', title: 'Works offline', notObvious: true,
    blurb: 'Events you’ve already loaded stay readable without a connection.' },
  { id: 'web-autoupdate', group: 'On your device', title: 'Updates itself', notObvious: true,
    blurb: 'When a new version deploys, the site picks it up without you clearing anything.' },
  { id: 'web-dark', group: 'On your device', title: 'Dark mode follows your system',
    blurb: 'No setting to find — it matches whatever your device is already doing.' },

  // Privacy
  { id: 'web-privacy', group: 'Privacy', title: 'No accounts, no ads, no third-party trackers',
    blurb: 'Nothing to sign up for, and no advertising SDKs.' },
  { id: 'web-local-state', group: 'Privacy', title: 'Your filters stay local',
    blurb: 'Filters and favorites live in your browser for 30 days, not on a server.' },
];

/** Groups features for rendering, preserving first-seen group order. */
export function groupFeatures(features: Feature[]): Array<{ group: string; features: Feature[] }> {
  const order: string[] = [];
  const byGroup = new Map<string, Feature[]>();
  for (const feature of features) {
    if (!byGroup.has(feature.group)) {
      byGroup.set(feature.group, []);
      order.push(feature.group);
    }
    byGroup.get(feature.group)!.push(feature);
  }
  return order.map((group) => ({ group, features: byGroup.get(group)! }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/app/about/aboutContent.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Type-check and lint**

Run: `cd frontend && npm run validate`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/about/aboutContent.ts frontend/src/app/about/aboutContent.test.ts
git commit -m "feat(about): content model and copy for the guide site"
```

---

### Task 2: Screenshot preparation — iOS

**Files:**
- Create: `frontend/scripts/prepare-about-screenshots.mjs`
- Modify: `frontend/package.json` (add `about:screenshots:ios` script)
- Create (output, committed): `frontend/public/about/ios-*.webp`

**Interfaces:**
- Consumes: `docs/app-store/screenshots/review/iphone-6.9-*.png` (ten files).
- Produces: `frontend/public/about/ios-<id>-420.webp` and `-840.webp` for ids `01-season`, `02-filters`, `03-search`, `04-detail`, `05-articles`, `06-calendar`, `07-my-day`, `08-map`, `09-reminder`, `10-widget`. These filenames are what `ScreenshotRef.base` in Task 1 refers to.

- [ ] **Step 1: Write the script**

Create `frontend/scripts/prepare-about-screenshots.mjs`:

```js
/**
 * Downscales the App Store iOS captures into web-sized WebP for /about/.
 *
 * Source of truth is the existing App Store screenshot pipeline
 * (ios/Scripts/capture-screenshots.sh + compose-screenshots.py), which CI
 * already forces to be regenerated on any user-visible iOS change. Deriving
 * the guide's images from it means the iOS half of the site cannot silently
 * go stale.
 *
 * Outputs are committed, so `npm run build` never depends on this running.
 */
import sharp from 'sharp';
import { readdir, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = resolve(HERE, '../../docs/app-store/screenshots/review');
const OUT_DIR = resolve(HERE, '../public/about');
const WIDTHS = [420, 840];
const PREFIX = 'iphone-6.9-';

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SOURCE_DIR))
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.png'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No ${PREFIX}*.png found in ${SOURCE_DIR}. Run ios/Scripts/capture-screenshots.sh first.`);
  }

  for (const file of files) {
    const id = file.slice(PREFIX.length, -'.png'.length); // '01-season'
    for (const width of WIDTHS) {
      const out = resolve(OUT_DIR, `ios-${id}-${width}.webp`);
      await sharp(resolve(SOURCE_DIR, file))
        .resize({ width })
        .webp({ quality: 82 })
        .toFile(out);
      console.log(`ios-${id}-${width}.webp`);
    }
  }

  console.log(`\n${files.length} screenshots → ${files.length * WIDTHS.length} WebP files in public/about/`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `frontend/package.json`, add to `scripts`, after `"generate:icons"`:

```json
"about:screenshots:ios": "node scripts/prepare-about-screenshots.mjs"
```

- [ ] **Step 3: Run it**

Run: `cd frontend && npm run about:screenshots:ios`
Expected: 20 lines of output ending with `10 screenshots → 20 WebP files in public/about/`.

- [ ] **Step 4: Verify the output is web-sized**

Run: `ls -la frontend/public/about/ | head -8 && du -sh frontend/public/about/`
Expected: each `-840.webp` well under 150KB; the whole directory under ~1.5MB.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/prepare-about-screenshots.mjs frontend/package.json frontend/public/about/
git commit -m "feat(about): prepare iOS screenshots as web-sized WebP"
```

---

### Task 3: Screenshot capture — web app

**Files:**
- Create: `frontend/scripts/capture-web-screenshots.mjs`
- Modify: `frontend/package.json` (playwright devDependency + scripts)
- Create (output, committed): `frontend/public/about/web-*.webp`

**Interfaces:**
- Consumes: a running dev server (default `http://localhost:3000`), `sharp`.
- Produces: `frontend/public/about/web-<id>-640.webp` and `-1280.webp` for ids `01-season`, `02-search`, `03-filters`, `04-favorites`, `05-calendar`, `06-weeks`.

- [ ] **Step 1: Add playwright as a devDependency**

Run: `cd frontend && npm install --save-dev playwright@^1.50.0`

Then install the browser (one-time, not part of `npm ci`):

Run: `cd frontend && npx playwright install chromium`

- [ ] **Step 2: Write the capture script**

Create `frontend/scripts/capture-web-screenshots.mjs`:

```js
/**
 * Captures the web app for the /about/web guide.
 *
 * Runs against a dev server you start yourself (npm run dev), seeding
 * localStorage so each shot shows a specific, reproducible state rather than
 * whatever the calendar happens to open on. Keys and shapes below mirror
 * src/hooks/useFilterState.ts and src/hooks/useFavorites.ts — if those change,
 * this needs to change with them.
 *
 * Outputs are committed, so `npm run build` never depends on this running.
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, readFile, unlink } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../public/about');
const TMP = resolve(HERE, '../.about-capture.png');
const BASE_URL = process.env.ABOUT_CAPTURE_URL ?? 'http://localhost:3000';
const VIEWPORT = { width: 1280, height: 900 };
const WIDTHS = [640, 1280];

const FILTER_KEY = 'chq-calendar-user-state';
const FAVORITES_KEY = 'chq-calendar-favorites';

/** Matches the object written by useFilterState's persistence effect. */
const baseFilterState = {
  searchTerm: '', selectedTags: [], selectedLocations: [], dateFilter: 'next',
  selectedWeeks: [], expandedDescriptions: [], recentLocations: [],
  recentCategories: [], showFavoritesOnly: false,
};

const SHOTS = [
  { id: '01-season', filters: {} },
  { id: '02-search', filters: { searchTerm: 'lecture' } },
  { id: '03-filters', filters: { selectedTags: ['Lecture'], dateFilter: 'all', selectedWeeks: [3, 4] } },
  { id: '04-favorites', filters: { showFavoritesOnly: true, dateFilter: 'all' }, favorites: true },
  { id: '05-calendar', filters: {}, expandFirst: true },
  { id: '06-weeks', filters: { dateFilter: 'all', selectedWeeks: [2, 3, 4] } },
];

async function seed(page, shot, favoriteIds) {
  await page.addInitScript(
    ({ filterKey, favKey, filters, favorites, ids }) => {
      localStorage.setItem(filterKey, JSON.stringify({ ...filters, lastSaved: Date.now() }));
      if (favorites) {
        localStorage.setItem(favKey, JSON.stringify({ eventIds: ids, lastSaved: Date.now() }));
      }
    },
    {
      filterKey: FILTER_KEY, favKey: FAVORITES_KEY,
      filters: { ...baseFilterState, ...shot.filters },
      favorites: Boolean(shot.favorites), ids: favoriteIds,
    }
  );
}

/** Grabs real event ids from the loaded page so the favorites shot isn't empty. */
async function firstEventIds(page, count) {
  return page.evaluate((n) => {
    const nodes = document.querySelectorAll('[data-event-id]');
    return Array.from(nodes).slice(0, n).map((el) => el.getAttribute('data-event-id'));
  }, count);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  // First pass: load once with no seeding to learn real event ids.
  const probe = await browser.newContext({ viewport: VIEWPORT }).then((c) => c.newPage());
  await probe.goto(BASE_URL, { waitUntil: 'networkidle' });
  await probe.waitForSelector('[data-event-id]', { timeout: 30_000 });
  const favoriteIds = await firstEventIds(probe, 5);
  await probe.close();

  if (favoriteIds.length === 0) {
    throw new Error('No [data-event-id] elements found — is the dev server serving events?');
  }

  for (const shot of SHOTS) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await seed(page, shot, favoriteIds);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-event-id]', { timeout: 30_000 });

    if (shot.expandFirst) {
      await page.locator('[data-event-id]').first().click();
      await page.waitForTimeout(400);
    }

    await page.screenshot({ path: TMP });
    await context.close();

    const png = await readFile(TMP);
    for (const width of WIDTHS) {
      const out = resolve(OUT_DIR, `web-${shot.id}-${width}.webp`);
      await sharp(png).resize({ width }).webp({ quality: 82 }).toFile(out);
      console.log(`web-${shot.id}-${width}.webp`);
    }
  }

  await unlink(TMP).catch(() => {});
  await browser.close();
  console.log(`\n${SHOTS.length} shots → ${SHOTS.length * WIDTHS.length} WebP files in public/about/`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Add a stable capture hook to the event card**

The script selects on `[data-event-id]`. In
`frontend/src/components/calendar/EventCard.tsx`, the component's returned JSX
opens with this root `<div>`:

```tsx
    <div className={`event-card py-2 sm:py-3 ${index > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''} hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}>
```

Replace that line with:

```tsx
    <div data-event-id={event.id} className={`event-card py-2 sm:py-3 ${index > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''} hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}>
```

A data attribute does not change rendering, and it gives both the capture
script and future tests a stable handle on a card.

- [ ] **Step 4: Add the npm scripts**

In `frontend/package.json` `scripts`:

```json
"about:screenshots:web": "node scripts/capture-web-screenshots.mjs",
"about:screenshots": "npm run about:screenshots:ios && npm run about:screenshots:web"
```

- [ ] **Step 5: Run the capture**

In one terminal: `cd frontend && npm run dev`
In another: `cd frontend && npm run about:screenshots:web`
Expected: 12 lines ending with `6 shots → 12 WebP files in public/about/`.

- [ ] **Step 6: Eyeball the output**

Open `frontend/public/about/web-01-season-1280.webp` and confirm it shows a
populated event list, not a loading spinner or an empty state. If a shot is
empty, raise the `waitForTimeout` after navigation and re-run.

- [ ] **Step 7: Commit**

```bash
git add frontend/scripts/capture-web-screenshots.mjs frontend/package.json \
        frontend/package-lock.json frontend/src/components/calendar/EventCard.tsx \
        frontend/public/about/
git commit -m "feat(about): capture web app screenshots for the guide"
```

---

### Task 4: Page chrome — AboutLayout and AboutNav

**Files:**
- Create: `frontend/src/app/about/AboutNav.tsx`, `frontend/src/app/about/AboutLayout.tsx`
- Test: `frontend/src/app/about/AboutLayout.test.tsx`

**Interfaces:**
- Consumes: nothing from `aboutContent.ts` at runtime — the footer disclaimer is
  literal JSX prose (see the note in Step 4). Only the *test* imports
  `DISCLAIMER`, to assert the rendered text matches.
- Produces:
  - `AboutPageKey` — `'overview' | 'ios' | 'web'`
  - `AboutNav({ current }: { current: AboutPageKey })`
  - `AboutLayout({ title, subtitle, current, children }: { title: string; subtitle?: string; current: AboutPageKey; children: ReactNode })`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/about/AboutLayout.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { AboutLayout } from './AboutLayout';
import { DISCLAIMER } from './aboutContent';

describe('AboutLayout', () => {
  it('renders the page title and children', () => {
    render(<AboutLayout title="Guide" current="overview"><p>Body copy</p></AboutLayout>);
    expect(screen.getByRole('heading', { name: 'Guide', level: 1 })).toBeTruthy();
    expect(screen.getByText('Body copy')).toBeTruthy();
  });

  it('renders the optional subtitle', () => {
    render(<AboutLayout title="Guide" subtitle="How it works" current="overview"><p>x</p></AboutLayout>);
    expect(screen.getByText('How it works')).toBeTruthy();
  });

  it('links to all three guide pages plus support', () => {
    render(<AboutLayout title="Guide" current="overview"><p>x</p></AboutLayout>);
    const hrefs = Array.from(document.querySelectorAll('nav a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/about', '/about/iphone', '/about/web', '/support']));
  });

  it('marks the current page for assistive tech', () => {
    render(<AboutLayout title="Guide" current="ios"><p>x</p></AboutLayout>);
    expect(screen.getByRole('link', { current: 'page' }).getAttribute('href')).toBe('/about/iphone');
  });

  it('renders the canonical disclaimer in the footer', () => {
    render(<AboutLayout title="Guide" current="overview"><p>x</p></AboutLayout>);
    expect(document.body.textContent?.replace(/\s+/g, ' ')).toContain(DISCLAIMER);
  });

  it('links to feedback and privacy from the footer', () => {
    render(<AboutLayout title="Guide" current="overview"><p>x</p></AboutLayout>);
    const hrefs = Array.from(document.querySelectorAll('footer a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/privacy', '/support', '/feedback']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/app/about/AboutLayout.test.tsx`
Expected: FAIL — cannot resolve `./AboutLayout`.

- [ ] **Step 3: Write AboutNav**

Create `frontend/src/app/about/AboutNav.tsx`:

```tsx
/** Named `…Key` rather than `AboutPage` so it never reads as the page
 *  component of the same name exported from ./page.tsx. */
export type AboutPageKey = 'overview' | 'ios' | 'web';

const ITEMS: Array<{ key: AboutPageKey | 'support'; label: string; href: string }> = [
  { key: 'overview', label: 'Overview', href: '/about' },
  { key: 'ios', label: 'iPhone & iPad', href: '/about/iphone' },
  { key: 'web', label: 'Web', href: '/about/web' },
  { key: 'support', label: 'Support', href: '/support' },
];

export function AboutNav({ current }: { current: AboutPageKey }) {
  return (
    <nav aria-label="Guide sections" className="flex flex-wrap gap-1 sm:gap-2">
      {ITEMS.map((item) => {
        const isCurrent = item.key === current;
        return (
          <a
            key={item.key}
            href={item.href}
            aria-current={isCurrent ? 'page' : undefined}
            className={
              isCurrent
                ? 'px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white'
                : 'px-3 py-1.5 text-sm rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
            }
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Write AboutLayout**

Create `frontend/src/app/about/AboutLayout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { AboutNav, type AboutPageKey } from './AboutNav';

interface AboutLayoutProps {
  title: string;
  subtitle?: string;
  current: AboutPageKey;
  children: ReactNode;
}

export function AboutLayout({ title, subtitle, current, children }: AboutLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-800 shadow-lg">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <a href="/" className="flex items-center hover:opacity-80">
              <img
                src="/chq-calendar-icon-256.svg"
                alt="Chautauqua Calendar logo"
                width={32}
                height={32}
                className="w-8 h-8 mr-3"
              />
              <span className="text-xl font-bold text-gray-900 dark:text-white">
                CHQ Calendar
              </span>
            </a>
            <AboutNav current={current} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-3 text-lg text-gray-700 dark:text-gray-300 max-w-2xl">
            {subtitle}
          </p>
        )}
        <div className="mt-8 sm:mt-12 space-y-12 sm:space-y-16">{children}</div>
      </main>

      <footer className="bg-gray-800 text-white mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center">
          <p className="text-gray-400">
            &copy; {new Date().getFullYear()} Chautauqua Calendar by Bernie
          </p>
          <p className="text-gray-500 text-sm mt-3 max-w-2xl mx-auto">
            CHQ Calendar is an independent app and is not affiliated with, endorsed by, or
            sponsored by Chautauqua Institution. Event information is drawn from publicly
            posted listings; chq.org remains the authoritative source.
          </p>
          <p className="text-gray-400 text-sm mt-3">
            <a href="/privacy" className="hover:text-white underline">Privacy</a>
            <span className="mx-2" aria-hidden="true">·</span>
            <a href="/support" className="hover:text-white underline">Support</a>
            <span className="mx-2" aria-hidden="true">·</span>
            <a href="/feedback" className="hover:text-white underline">Feedback</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
```

Note: the disclaimer is written as literal JSX prose (not `{DISCLAIMER}`) so
the verbatim-duplication test in Task 8 can find it by reading the source file,
exactly as it does for `page.tsx` and `support/page.tsx` today.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/app/about/AboutLayout.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/about/AboutNav.tsx frontend/src/app/about/AboutLayout.tsx \
        frontend/src/app/about/AboutLayout.test.tsx
git commit -m "feat(about): shared page chrome for the guide site"
```

---

### Task 5: Presentation components

**Files:**
- Create: `frontend/src/app/about/Screenshot.tsx`, `Scenario.tsx`, `FeatureReference.tsx`, `PlatformCard.tsx`
- Test: `frontend/src/app/about/components.test.tsx`

**Interfaces:**
- Consumes: `ScreenshotRef`, `Scenario` (type), `Feature`, `PlatformInfo`, `groupFeatures` from `aboutContent.ts`.
- Produces:
  - `Screenshot({ shot, widths, priority }: { shot: ScreenshotRef; widths: [number, number]; priority?: boolean })`
  - `ScenarioBlock({ scenario, widths, flip }: { scenario: Scenario; widths: [number, number]; flip?: boolean })`
  - `FeatureReference({ features, heading }: { features: Feature[]; heading: string })`
  - `PlatformCard({ platform }: { platform: PlatformInfo })`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/about/components.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { Screenshot } from './Screenshot';
import { ScenarioBlock } from './Scenario';
import { FeatureReference } from './FeatureReference';
import { PlatformCard } from './PlatformCard';
import type { Feature, PlatformInfo, Scenario, ScreenshotRef } from './aboutContent';

const shot: ScreenshotRef = { base: 'ios-07-my-day', alt: 'My Day timeline', width: 840, height: 1825 };

describe('Screenshot', () => {
  it('builds a srcset from the two prepared widths', () => {
    render(<Screenshot shot={shot} widths={[420, 840]} />);
    const img = screen.getByAltText('My Day timeline') as HTMLImageElement;
    expect(img.getAttribute('srcset')).toBe(
      '/about/ios-07-my-day-420.webp 420w, /about/ios-07-my-day-840.webp 840w'
    );
    expect(img.getAttribute('src')).toBe('/about/ios-07-my-day-840.webp');
  });

  it('sets intrinsic dimensions so the page does not shift as images load', () => {
    render(<Screenshot shot={shot} widths={[420, 840]} />);
    const img = screen.getByAltText('My Day timeline');
    expect(img.getAttribute('width')).toBe('840');
    expect(img.getAttribute('height')).toBe('1825');
  });

  it('lazy-loads by default and eagerly when marked priority', () => {
    const { unmount } = render(<Screenshot shot={shot} widths={[420, 840]} />);
    expect(screen.getByAltText('My Day timeline').getAttribute('loading')).toBe('lazy');
    unmount();
    render(<Screenshot shot={shot} widths={[420, 840]} priority />);
    expect(screen.getByAltText('My Day timeline').getAttribute('loading')).toBe('eager');
  });
});

describe('ScenarioBlock', () => {
  const scenario: Scenario = {
    id: 's1', title: 'Plan your day',
    body: ['First paragraph.', 'Second paragraph.'],
    screenshot: shot,
  };

  it('renders the title and every paragraph', () => {
    render(<ScenarioBlock scenario={scenario} widths={[420, 840]} />);
    expect(screen.getByRole('heading', { name: 'Plan your day', level: 2 })).toBeTruthy();
    expect(screen.getByText('First paragraph.')).toBeTruthy();
    expect(screen.getByText('Second paragraph.')).toBeTruthy();
  });

  it('renders the screenshot when present', () => {
    render(<ScenarioBlock scenario={scenario} widths={[420, 840]} />);
    expect(screen.getByAltText('My Day timeline')).toBeTruthy();
  });

  it('omits the image entirely when the scenario has no screenshot', () => {
    render(<ScenarioBlock scenario={{ ...scenario, screenshot: undefined }} widths={[420, 840]} />);
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('FeatureReference', () => {
  const features: Feature[] = [
    { id: 'f1', group: 'Alpha', title: 'One', blurb: 'First feature.' },
    { id: 'f2', group: 'Alpha', title: 'Two', blurb: 'Second feature.', notObvious: true },
    { id: 'f3', group: 'Beta', title: 'Three', blurb: 'Third feature.' },
  ];

  it('renders a section per group with its heading', () => {
    render(<FeatureReference features={features} heading="Every feature" />);
    expect(screen.getByRole('heading', { name: 'Every feature', level: 2 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Alpha', level: 3 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Beta', level: 3 })).toBeTruthy();
  });

  it('renders every feature title and blurb', () => {
    render(<FeatureReference features={features} heading="Every feature" />);
    for (const f of features) {
      expect(screen.getByText(f.title), f.id).toBeTruthy();
      expect(screen.getByText(f.blurb), f.id).toBeTruthy();
    }
  });

  it('tags each feature with its id so page tests can assert coverage', () => {
    render(<FeatureReference features={features} heading="Every feature" />);
    expect(document.querySelector('[data-feature-id="f2"]')).toBeTruthy();
  });

  it('marks the non-obvious features', () => {
    render(<FeatureReference features={features} heading="Every feature" />);
    const marked = document.querySelectorAll('[data-not-obvious="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('data-feature-id')).toBe('f2');
  });
});

describe('PlatformCard', () => {
  const platform: PlatformInfo = {
    id: 'web', name: 'Web', tagline: 'In any browser.',
    guideHref: '/about/web', ctaHref: '/', ctaLabel: 'Open the calendar',
  };

  it('links to the guide and the call to action', () => {
    render(<PlatformCard platform={platform} />);
    expect(screen.getByRole('link', { name: 'Open the calendar' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Web guide/ }).getAttribute('href')).toBe('/about/web');
  });

  it('renders the CTA as disabled text when there is no destination yet', () => {
    render(<PlatformCard platform={{ ...platform, ctaHref: '', ctaLabel: 'Coming to the App Store' }} />);
    expect(screen.queryByRole('link', { name: 'Coming to the App Store' })).toBeNull();
    expect(screen.getByText('Coming to the App Store')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/app/about/components.test.tsx`
Expected: FAIL — cannot resolve `./Screenshot`.

- [ ] **Step 3: Write Screenshot**

Create `frontend/src/app/about/Screenshot.tsx`:

```tsx
import type { ScreenshotRef } from './aboutContent';

interface ScreenshotProps {
  shot: ScreenshotRef;
  /** The two prepared widths, small first. Must match the emitted WebP files. */
  widths: [number, number];
  /** Above-the-fold images load eagerly; everything else lazily. */
  priority?: boolean;
}

export function Screenshot({ shot, widths, priority }: ScreenshotProps) {
  const [small, large] = widths;
  return (
    <img
      src={`/about/${shot.base}-${large}.webp`}
      srcSet={`/about/${shot.base}-${small}.webp ${small}w, /about/${shot.base}-${large}.webp ${large}w`}
      sizes="(min-width: 768px) 50vw, 100vw"
      alt={shot.alt}
      width={shot.width}
      height={shot.height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className="w-full h-auto rounded-xl shadow-lg ring-1 ring-black/5 dark:ring-white/10"
    />
  );
}
```

- [ ] **Step 4: Write ScenarioBlock**

Create `frontend/src/app/about/Scenario.tsx`:

```tsx
import type { Scenario } from './aboutContent';
import { Screenshot } from './Screenshot';

interface ScenarioBlockProps {
  scenario: Scenario;
  widths: [number, number];
  /** Puts the screenshot on the left instead of the right, for alternation. */
  flip?: boolean;
}

export function ScenarioBlock({ scenario, widths, flip }: ScenarioBlockProps) {
  return (
    <section
      className={`flex flex-col gap-6 md:gap-10 md:items-center ${
        flip ? 'md:flex-row-reverse' : 'md:flex-row'
      }`}
    >
      <div className="md:flex-1">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          {scenario.title}
        </h2>
        <div className="mt-4 space-y-4 text-gray-700 dark:text-gray-300">
          {scenario.body.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      </div>
      {scenario.screenshot && (
        <div className="md:flex-1 md:max-w-sm mx-auto w-full">
          <Screenshot shot={scenario.screenshot} widths={widths} />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Write FeatureReference**

Create `frontend/src/app/about/FeatureReference.tsx`:

```tsx
import { groupFeatures, type Feature } from './aboutContent';

interface FeatureReferenceProps {
  features: Feature[];
  heading: string;
}

export function FeatureReference({ features, heading }: FeatureReferenceProps) {
  return (
    <section>
      <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
        {heading}
      </h2>
      <p className="mt-3 text-gray-600 dark:text-gray-400">
        Everything the app does. A ★ marks the ones people usually don’t find on their own.
      </p>
      <div className="mt-8 space-y-10">
        {groupFeatures(features).map(({ group, features: groupFeatureList }) => (
          <div key={group}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
              {group}
            </h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {groupFeatureList.map((feature) => (
                <div
                  key={feature.id}
                  data-feature-id={feature.id}
                  data-not-obvious={feature.notObvious ? 'true' : undefined}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow p-4"
                >
                  <dt className="font-medium text-gray-900 dark:text-white">
                    {feature.notObvious && (
                      <span className="text-blue-600 dark:text-blue-400 mr-1" title="Worth knowing" aria-label="Worth knowing">
                        ★
                      </span>
                    )}
                    {feature.title}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    {feature.blurb}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Write PlatformCard**

Create `frontend/src/app/about/PlatformCard.tsx`:

```tsx
import type { PlatformInfo } from './aboutContent';

export function PlatformCard({ platform }: { platform: PlatformInfo }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col">
      <h3 className="text-xl font-bold text-gray-900 dark:text-white">{platform.name}</h3>
      <p className="mt-2 text-gray-700 dark:text-gray-300 flex-1">{platform.tagline}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {platform.ctaHref ? (
          <a
            href={platform.ctaHref}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            {platform.ctaLabel}
          </a>
        ) : (
          <span className="px-4 py-2 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-md">
            {platform.ctaLabel}
          </span>
        )}
        <a
          href={platform.guideHref}
          className="text-sm font-medium text-blue-600 dark:text-blue-400 underline hover:no-underline"
        >
          {platform.name} guide →
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/app/about/components.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/about/Screenshot.tsx frontend/src/app/about/Scenario.tsx \
        frontend/src/app/about/FeatureReference.tsx frontend/src/app/about/PlatformCard.tsx \
        frontend/src/app/about/components.test.tsx
git commit -m "feat(about): scenario, feature reference, and platform card components"
```

---

### Task 6: The three pages

**Files:**
- Create: `frontend/src/app/about/page.tsx`, `about/iphone/page.tsx`, `about/web/page.tsx`
- Create: `frontend/src/entries/about.tsx`, `about-iphone.tsx`, `about-web.tsx`
- Create: `frontend/about/index.html`, `about/iphone/index.html`, `about/web/index.html`
- Modify: `frontend/vite.config.ts`
- Test: `frontend/src/app/about/pages.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1, 4, 5.
- Produces: default-exported `AboutPage`, `AboutIphonePage`, `AboutWebPage`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/about/pages.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import AboutPage from './page';
import AboutIphonePage from './iphone/page';
import AboutWebPage from './web/page';
import {
  IOS_FEATURES, WEB_FEATURES, SHARED_HIGHLIGHTS,
  IOS_SCENARIOS, WEB_SCENARIOS, PLATFORMS,
} from './aboutContent';

describe('/about top page', () => {
  it('offers a card for every platform', () => {
    render(<AboutPage />);
    for (const p of PLATFORMS) {
      expect(screen.getByRole('heading', { name: p.name, level: 3 }), p.id).toBeTruthy();
    }
  });

  it('renders every shared highlight', () => {
    render(<AboutPage />);
    for (const f of SHARED_HIGHLIGHTS) {
      expect(document.querySelector(`[data-feature-id="${f.id}"]`), f.id).toBeTruthy();
    }
  });

  it('points at support and feedback for help', () => {
    render(<AboutPage />);
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/support', '/feedback']));
  });
});

describe('/about/iphone', () => {
  it('renders every iOS scenario', () => {
    render(<AboutIphonePage />);
    for (const s of IOS_SCENARIOS) {
      expect(screen.getByRole('heading', { name: s.title, level: 2 }), s.id).toBeTruthy();
    }
  });

  // The point of the whole content-as-data design: a feature we ship but
  // forget to document fails here rather than shipping a stale guide.
  it('documents every iOS feature', () => {
    render(<AboutIphonePage />);
    for (const f of IOS_FEATURES) {
      expect(document.querySelector(`[data-feature-id="${f.id}"]`), `undocumented: ${f.id}`).toBeTruthy();
    }
  });

  it('does not leak web-only features onto the iOS page', () => {
    render(<AboutIphonePage />);
    expect(document.querySelector('[data-feature-id="web-webcal"]')).toBeNull();
  });

  it('cross-links to the web guide', () => {
    render(<AboutIphonePage />);
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/about/web');
  });
});

describe('/about/web', () => {
  it('renders every web scenario', () => {
    render(<AboutWebPage />);
    for (const s of WEB_SCENARIOS) {
      expect(screen.getByRole('heading', { name: s.title, level: 2 }), s.id).toBeTruthy();
    }
  });

  it('documents every web feature', () => {
    render(<AboutWebPage />);
    for (const f of WEB_FEATURES) {
      expect(document.querySelector(`[data-feature-id="${f.id}"]`), `undocumented: ${f.id}`).toBeTruthy();
    }
  });

  it('does not leak iOS-only features onto the web page', () => {
    render(<AboutWebPage />);
    expect(document.querySelector('[data-feature-id="ios-widget-next"]')).toBeNull();
  });

  it('cross-links to the iOS guide', () => {
    render(<AboutWebPage />);
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/about/iphone');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/app/about/pages.test.tsx`
Expected: FAIL — cannot resolve `./page`.

- [ ] **Step 3: Write the top page**

Create `frontend/src/app/about/page.tsx`:

```tsx
import { AboutLayout } from './AboutLayout';
import { PlatformCard } from './PlatformCard';
import { FeatureReference } from './FeatureReference';
import { PLATFORMS, SHARED_HIGHLIGHTS } from './aboutContent';

export default function AboutPage() {
  return (
    <AboutLayout
      title="A calendar for the whole Chautauqua season"
      subtitle="CHQ Calendar gathers every publicly posted event of the season into one place you can search, filter, and plan around — on your phone or in your browser."
      current="overview"
    >
      <section>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          Pick where you’re starting
        </h2>
        <p className="mt-3 text-gray-600 dark:text-gray-400">
          Same events, same season, no account either way. The iPhone and iPad app
          adds reminders, widgets, a day planner, and a map of the grounds.
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {PLATFORMS.map((platform) => (
            <PlatformCard key={platform.id} platform={platform} />
          ))}
        </div>
      </section>

      <FeatureReference features={SHARED_HIGHLIGHTS} heading="What it does, everywhere" />

      <section>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          Need a hand?
        </h2>
        <p className="mt-3 text-gray-700 dark:text-gray-300">
          If something looks wrong — a bad date, a broken link, a missing event —
          or you just have a question, our{' '}
          <a href="/support" className="text-blue-600 dark:text-blue-400 underline hover:no-underline">
            support page
          </a>{' '}
          explains where to start, and the{' '}
          <a href="/feedback" className="text-blue-600 dark:text-blue-400 underline hover:no-underline">
            feedback form
          </a>{' '}
          reaches us directly. Every submission gets read.
        </p>
      </section>
    </AboutLayout>
  );
}
```

- [ ] **Step 4: Write the iOS page**

Create `frontend/src/app/about/iphone/page.tsx`:

```tsx
import { AboutLayout } from '../AboutLayout';
import { ScenarioBlock } from '../Scenario';
import { FeatureReference } from '../FeatureReference';
import { IOS_FEATURES, IOS_SCENARIOS, PLATFORMS } from '../aboutContent';

const WIDTHS: [number, number] = [420, 840];

export default function AboutIphonePage() {
  const ios = PLATFORMS.find((p) => p.id === 'ios')!;

  return (
    <AboutLayout
      title="CHQ Calendar for iPhone & iPad"
      subtitle="Everything on the web, plus reminders, Home Screen widgets, a day planner, and a map of the grounds."
      current="ios"
    >
      {IOS_SCENARIOS.map((scenario, i) => (
        <ScenarioBlock key={scenario.id} scenario={scenario} widths={WIDTHS} flip={i % 2 === 1} />
      ))}

      <FeatureReference features={IOS_FEATURES} heading="Every feature" />

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Get the app</h2>
        <p className="mt-3 text-gray-700 dark:text-gray-300">
          Free, with no account and no ads.
        </p>
        <div className="mt-5">
          {ios.ctaHref ? (
            <a
              href={ios.ctaHref}
              className="inline-block px-5 py-2.5 font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              {ios.ctaLabel}
            </a>
          ) : (
            <span className="inline-block px-5 py-2.5 font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-md">
              {ios.ctaLabel}
            </span>
          )}
        </div>
        <p className="mt-5 text-sm text-gray-600 dark:text-gray-400">
          Prefer your browser? The{' '}
          <a href="/about/web" className="text-blue-600 dark:text-blue-400 underline hover:no-underline">
            web app
          </a>{' '}
          has the same events and needs no installation.
        </p>
      </section>
    </AboutLayout>
  );
}
```

- [ ] **Step 5: Write the web page**

Create `frontend/src/app/about/web/page.tsx`:

```tsx
import { AboutLayout } from '../AboutLayout';
import { ScenarioBlock } from '../Scenario';
import { FeatureReference } from '../FeatureReference';
import { WEB_FEATURES, WEB_SCENARIOS } from '../aboutContent';

const WIDTHS: [number, number] = [640, 1280];

export default function AboutWebPage() {
  return (
    <AboutLayout
      title="CHQ Calendar on the web"
      subtitle="The full season in any browser. Nothing to install, nothing to sign up for."
      current="web"
    >
      {WEB_SCENARIOS.map((scenario, i) => (
        <ScenarioBlock key={scenario.id} scenario={scenario} widths={WIDTHS} flip={i % 2 === 1} />
      ))}

      <FeatureReference features={WEB_FEATURES} heading="Every feature" />

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Open the calendar</h2>
        <p className="mt-3 text-gray-700 dark:text-gray-300">
          No account, no ads, and it works on any device with a browser.
        </p>
        <div className="mt-5">
          <a
            href="/"
            className="inline-block px-5 py-2.5 font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Open the calendar
          </a>
        </div>
        <p className="mt-5 text-sm text-gray-600 dark:text-gray-400">
          On an iPhone or iPad? The{' '}
          <a href="/about/iphone" className="text-blue-600 dark:text-blue-400 underline hover:no-underline">
            native app
          </a>{' '}
          adds reminders, widgets, a day planner, and a grounds map.
        </p>
      </section>
    </AboutLayout>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/app/about/pages.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 7: Write the three entry files**

Create `frontend/src/entries/about.tsx`:

```tsx
import { render } from 'preact';
import '@/app/globals.css';
import AboutPage from '@/app/about/page';

render(<AboutPage />, document.getElementById('root')!);
```

Create `frontend/src/entries/about-iphone.tsx`:

```tsx
import { render } from 'preact';
import '@/app/globals.css';
import AboutIphonePage from '@/app/about/iphone/page';

render(<AboutIphonePage />, document.getElementById('root')!);
```

Create `frontend/src/entries/about-web.tsx`:

```tsx
import { render } from 'preact';
import '@/app/globals.css';
import AboutWebPage from '@/app/about/web/page';

render(<AboutWebPage />, document.getElementById('root')!);
```

- [ ] **Step 8: Write the three HTML entries**

Create `frontend/about/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>About &amp; Guide | Chautauqua Calendar</title>
    <meta name="description" content="What CHQ Calendar does on iPhone, iPad, and the web — an unofficial guide to every event of the Chautauqua Institution summer season." />
    <link rel="canonical" href="https://www.chqcal.org/about" />
    <meta property="og:title" content="About &amp; Guide | Chautauqua Calendar" />
    <meta property="og:description" content="What CHQ Calendar does on iPhone, iPad, and the web — an unofficial guide to every event of the Chautauqua Institution summer season." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://www.chqcal.org/about" />
    <meta property="og:image" content="https://www.chqcal.org/icon-512.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="About &amp; Guide | Chautauqua Calendar" />
    <meta name="twitter:description" content="What CHQ Calendar does on iPhone, iPad, and the web — an unofficial guide to every event of the Chautauqua Institution summer season." />
    <link rel="icon" type="image/svg+xml" href="/chq-calendar-icon-256.svg" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.json" />
  </head>
  <body class="antialiased">
    <div id="root"></div>
    <script type="module" src="/src/entries/about.tsx"></script>
  </body>
</html>
```

Create `frontend/about/iphone/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CHQ Calendar for iPhone &amp; iPad | Chautauqua Calendar</title>
    <meta name="description" content="Reminders, Home Screen widgets, a My Day planner, and a map of the grounds — every feature of the CHQ Calendar iPhone and iPad app." />
    <link rel="canonical" href="https://www.chqcal.org/about/iphone" />
    <meta property="og:title" content="CHQ Calendar for iPhone &amp; iPad | Chautauqua Calendar" />
    <meta property="og:description" content="Reminders, Home Screen widgets, a My Day planner, and a map of the grounds — every feature of the CHQ Calendar iPhone and iPad app." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://www.chqcal.org/about/iphone" />
    <meta property="og:image" content="https://www.chqcal.org/icon-512.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="CHQ Calendar for iPhone &amp; iPad | Chautauqua Calendar" />
    <meta name="twitter:description" content="Reminders, Home Screen widgets, a My Day planner, and a map of the grounds — every feature of the CHQ Calendar iPhone and iPad app." />
    <link rel="icon" type="image/svg+xml" href="/chq-calendar-icon-256.svg" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.json" />
  </head>
  <body class="antialiased">
    <div id="root"></div>
    <script type="module" src="/src/entries/about-iphone.tsx"></script>
  </body>
</html>
```

Create `frontend/about/web/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CHQ Calendar on the web | Chautauqua Calendar</title>
    <meta name="description" content="Search, filters, weekly themes, favorites, and calendar export — every feature of the CHQ Calendar web app." />
    <link rel="canonical" href="https://www.chqcal.org/about/web" />
    <meta property="og:title" content="CHQ Calendar on the web | Chautauqua Calendar" />
    <meta property="og:description" content="Search, filters, weekly themes, favorites, and calendar export — every feature of the CHQ Calendar web app." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://www.chqcal.org/about/web" />
    <meta property="og:image" content="https://www.chqcal.org/icon-512.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="CHQ Calendar on the web | Chautauqua Calendar" />
    <meta name="twitter:description" content="Search, filters, weekly themes, favorites, and calendar export — every feature of the CHQ Calendar web app." />
    <link rel="icon" type="image/svg+xml" href="/chq-calendar-icon-256.svg" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.json" />
  </head>
  <body class="antialiased">
    <div id="root"></div>
    <script type="module" src="/src/entries/about-web.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Register the pages in Vite**

In `frontend/vite.config.ts`, inside `build.rollupOptions.input`, add after the
`support` line:

```ts
        about: resolve(__dirname, 'about/index.html'),
        'about-iphone': resolve(__dirname, 'about/iphone/index.html'),
        'about-web': resolve(__dirname, 'about/web/index.html'),
```

- [ ] **Step 10: Verify the build produces all three pages**

Run: `cd frontend && npm run build && ls out/about out/about/iphone out/about/web`
Expected: an `index.html` in each of the three directories.

- [ ] **Step 11: Smoke-test in the dev server**

Run: `cd frontend && npm run dev`, then visit `http://localhost:3000/about`.
Verify: nav moves between all three pages, screenshots render, dark mode
follows your system setting, and no console errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/app/about/ frontend/src/entries/about*.tsx \
        frontend/about/ frontend/vite.config.ts
git commit -m "feat(about): overview, iPhone, and web guide pages"
```

---

### Task 7: Web app entry points and cross-links

**Files:**
- Modify: `shared/links.json`, `frontend/src/app/page.tsx`, `frontend/src/app/support/page.tsx`, `frontend/src/lib/sitemap.ts`, `frontend/src/lib/sitemap.test.ts`

**Interfaces:**
- Consumes: the `/about` routes from Task 6.
- Produces: an `about` entry in `shared/links.json` that Task 9's Swift change must mirror exactly.

- [ ] **Step 1: Write the failing sitemap test**

In `frontend/src/lib/sitemap.test.ts`, add inside the existing `describe`:

```ts
  it('includes the about guide pages used as the App Store marketing URL', () => {
    expect(PUBLIC_PATHS).toContain('/about');
    expect(PUBLIC_PATHS).toContain('/about/iphone');
    expect(PUBLIC_PATHS).toContain('/about/web');
    const xml = buildSitemapXml(PUBLIC_PATHS);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/about</loc>`);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/about/iphone</loc>`);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/about/web</loc>`);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/sitemap.test.ts`
Expected: FAIL — `expected [...] to contain '/about'`.

- [ ] **Step 3: Add the paths to the sitemap**

In `frontend/src/lib/sitemap.ts`, replace the `PUBLIC_PATHS` line with:

```ts
export const PUBLIC_PATHS = [
  '/', '/about', '/about/iphone', '/about/web', '/feedback', '/privacy', '/support',
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/sitemap.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add About to the shared quick links**

In `shared/links.json`, insert as the **first** entry of `quickLinks`:

```json
    { "id": "about", "title": "About", "url": "https://www.chqcal.org/about", "webPath": "/about" },
```

No change is needed in `frontend/src/lib/quickLinks.ts` or
`Header.test.tsx` — both are already driven off the JSON.

- [ ] **Step 6: Verify the header picks it up automatically**

Run: `cd frontend && npx vitest run src/components/layout/__tests__/Header.test.tsx`
Expected: PASS, with new `About` cases appearing in the `it.each` output
(13 tests rather than 11).

- [ ] **Step 7: Add About to the calendar footer**

In `frontend/src/app/page.tsx`, in the footer's link row, add About before
Privacy so the row reads About · Privacy · Support · Feedback:

```tsx
            <a href="/about" className="hover:text-white underline">About</a>
            <span className="mx-2" aria-hidden="true">·</span>
            <a href="/privacy" className="hover:text-white underline">Privacy</a>
```

- [ ] **Step 8: Cross-link and de-duplicate the support page**

In `frontend/src/app/support/page.tsx`, replace the opening `<p>` (the
"CHQ Calendar is an independent, unofficial guide…" paragraph, which now
duplicates the /about overview) with a pointer:

```tsx
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            CHQ Calendar is an independent, unofficial guide to the
            Chautauqua Institution&rsquo;s summer season, available as a
            website and as a native iOS app. New here? The{' '}
            <a className="link" href="/about">
              guide
            </a>{' '}
            walks through everything both versions can do.
          </p>
```

Leave the rest of the page — including the `About This App` section carrying
the canonical disclaimer — untouched.

- [ ] **Step 9: Run the full frontend suite**

Run: `cd frontend && npm run test`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add shared/links.json frontend/src/lib/sitemap.ts frontend/src/lib/sitemap.test.ts \
        frontend/src/app/page.tsx frontend/src/app/support/page.tsx
git commit -m "feat(about): link the guide from the header, footer, support page, and sitemap"
```

---

### Task 8: App Store listing metadata

**Files:**
- Modify: `docs/app-store/listing-fields.json`, `frontend/src/__tests__/appStoreListing.test.ts`

**Interfaces:**
- Consumes: the `/about` route from Task 6, `AboutLayout.tsx` from Task 4.
- Produces: `marketingUrl` = `https://www.chqcal.org/about`.

- [ ] **Step 1: Update the failing assertions**

In `frontend/src/__tests__/appStoreListing.test.ts`, change the URL test:

```ts
  it('uses the chqcal.org URLs App Store Connect requires', () => {
    // The marketing URL points at the guide, not the calendar itself — a
    // visitor arriving from the App Store listing needs context before they
    // get dropped into a filtered event list.
    expect(fields.marketingUrl).toBe('https://www.chqcal.org/about');
    expect(fields.supportUrl).toBe('https://www.chqcal.org/support');
    expect(fields.privacyPolicyUrl).toBe('https://www.chqcal.org/privacy');
  });
```

And extend the disclaimer `sources` array:

```ts
  const sources = [
    'frontend/src/app/privacy/page.tsx',
    'frontend/src/app/support/page.tsx',
    'frontend/src/app/page.tsx',
    'frontend/src/app/about/AboutLayout.tsx',
    'ios/ChqCalendar/Features/About/AboutInfo.swift',
  ];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/appStoreListing.test.ts`
Expected: FAIL on the marketing URL assertion — expected
`https://www.chqcal.org/about`, received `https://www.chqcal.org`. The
disclaimer case for `AboutLayout.tsx` should already pass, since Task 4
wrote the disclaimer as literal prose.

- [ ] **Step 3: Update the listing field**

In `docs/app-store/listing-fields.json`, change `marketingUrl` to
`https://www.chqcal.org/about`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/appStoreListing.test.ts`
Expected: PASS.

- [ ] **Step 5: Document where the URL goes**

In `docs/app-store/listing-copy.md`, add a short paragraph under `## Rationale`:

```markdown
**Why `marketingUrl` points at `/about` rather than the calendar.** The
marketing URL is the one link in the listing a prospective user follows
*before* deciding to install. Pointing it at the calendar dropped them into a
filtered event list with no explanation of what the app is or what it can do.
`/about` explains the app across both platforms and routes them to the
platform-specific guide, which is also where the features that are invisible
on first launch — reminders, widgets, My Day, the grounds map, Siri and
Spotlight — are actually documented.
```

- [ ] **Step 6: Commit**

```bash
git add docs/app-store/listing-fields.json docs/app-store/listing-copy.md \
        frontend/src/__tests__/appStoreListing.test.ts
git commit -m "feat(about): point the App Store marketing URL at the guide"
```

---

### Task 9: iOS entry points

**Files:**
- Modify: `ios/ChqCalendar/Features/About/AboutInfo.swift`
- Modify: `ios/ChqCalendarTests/AboutInfoTests.swift`

**Interfaces:**
- Consumes: the `about` entry added to `shared/links.json` in Task 7.
- Produces: `AboutInfo.quickLinks` with `about` first; `AboutInfo.links` with a `guide` entry first.

**Critical:** `quickLinksAreDistinctFromTheAboutSheetLinks` asserts the two id
sets are disjoint. The quick link is `about`, so the About-sheet link **must**
be `guide`.

- [ ] **Step 1: Update the failing tests**

In `ios/ChqCalendarTests/AboutInfoTests.swift`, update `quickLinksMatchTheWebHeader`:

```swift
    @Test func quickLinksMatchTheWebHeader() {
        #expect(AboutInfo.quickLinks.map(\.id) == ["about", "feedback", "programs", "questions", "bus-tram-tracker", "chautauqua-fund"])
        #expect(AboutInfo.quickLinks.map(\.title) == ["About", "Feedback", "Programs", "Questions", "Bus & Tram Tracker", "Chautauqua Fund"])
        #expect(AboutInfo.quickLinks.map { $0.url.absoluteString } == [
            "https://www.chqcal.org/about",
            "https://www.chqcal.org/feedback",
            "https://programs.chq.org/",
            "https://questions.chq.org/",
            "https://busandtramtracker.chq.org",
            "https://giving.chq.org/",
        ])
    }
```

And add a new test after `linksCoverPrivacySupportAndChqOrg`:

```swift
    /// The About sheet is the only in-app route to the guide site, so the
    /// link has to be present and has to point at the iOS-specific page
    /// rather than the cross-platform overview.
    @Test func linksLeadWithTheGuide() {
        let first = try #require(AboutInfo.links.first)
        #expect(first.id == "guide")
        #expect(first.title == "Guide & Features")
        #expect(first.url.absoluteString == "https://www.chqcal.org/about/iphone")
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ios && xcodebuild test -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:ChqCalendarTests/AboutInfoTests 2>&1 | tail -30`
Expected: FAIL on `quickLinksMatchTheWebHeader` and `linksLeadWithTheGuide`.

- [ ] **Step 3: Add the guide link to the About sheet**

In `ios/ChqCalendar/Features/About/AboutInfo.swift`, replace the `links` array:

```swift
    static let links: [Link] = [
        Link(id: "guide", title: "Guide & Features", url: URL(string: "https://www.chqcal.org/about/iphone")!),
        Link(id: "privacy", title: "Privacy Policy", url: URL(string: "https://www.chqcal.org/privacy")!),
        Link(id: "support", title: "Support", url: URL(string: "https://www.chqcal.org/support")!),
        Link(id: "chq", title: "Chautauqua Institution", url: URL(string: "https://www.chq.org")!),
    ]
```

- [ ] **Step 4: Add the About quick link**

In the same file, insert as the first element of `quickLinks`:

```swift
        Link(id: "about", title: "About", url: URL(string: "https://www.chqcal.org/about")!),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ios && xcodebuild test -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:ChqCalendarTests/AboutInfoTests 2>&1 | tail -30`
Expected: PASS, including `quickLinksMatchSharedLinksJson` (which reads
`shared/links.json` directly) and `quickLinksAreDistinctFromTheAboutSheetLinks`.

- [ ] **Step 6: Run the full iOS suite**

Run: `cd ios && xcodebuild test -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | tail -20`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add ios/ChqCalendar/Features/About/AboutInfo.swift ios/ChqCalendarTests/AboutInfoTests.swift
git commit -m "feat(ios): link the guide site from the About screen and toolbar"
```

---

### Task 10: Regenerate App Store screenshots

Task 9 adds a visible "About" item to the toolbar quick links, which appears
in the `01-season` shot. `.github/workflows/app-store-assets.yml` requires the
manifest to have changed since the merge-base, and this is a real pixel change
— a `[skip-screenshots]` opt-out would be inaccurate here.

**Requires:** macOS with Xcode and the simulators named in
`ios/Scripts/screenshot-plan.json` (`iPhone 17 Pro Max`, `iPad Pro 13-inch (M5)`).

**Files:**
- Modify: `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/*`
- Re-run: `frontend/scripts/prepare-about-screenshots.mjs` (the guide's iOS images derive from these)

- [ ] **Step 1: Capture**

Run: `ios/Scripts/capture-screenshots.sh`
Expected: completes without error, writing new raw captures.

- [ ] **Step 2: Compose**

Run: `python3 ios/Scripts/compose-screenshots.py`
Expected: updated `docs/app-store/screenshots.manifest.json` and refreshed
`docs/app-store/screenshots/review/` copies.

- [ ] **Step 3: Confirm the manifest actually changed**

Run: `git diff --stat docs/app-store/screenshots.manifest.json`
Expected: a non-empty diff. If it is empty, the CI guard will fail — check
that the capture picked up the new toolbar item.

- [ ] **Step 4: Verify the toolbar shows About**

Open `docs/app-store/screenshots/review/iphone-6.9-01-season.png` and confirm
the About quick link is visible.

- [ ] **Step 5: Refresh the guide's derived images**

Run: `cd frontend && npm run about:screenshots:ios`
Expected: 20 WebP files rewritten.

- [ ] **Step 6: Commit**

```bash
git add docs/app-store/screenshots.manifest.json docs/app-store/screenshots/review/ \
        frontend/public/about/
git commit -m "chore(ios): regenerate App Store screenshots for the About toolbar link"
```

---

### Task 11: Full verification and pull request

- [ ] **Step 1: Frontend build (runs validate + tests + coverage)**

Run: `cd frontend && npm run build`
Expected: passes, including the `74.3` line-coverage floor.

- [ ] **Step 2: Backend validate and build**

Run: `cd backend && npm run validate && npm run build`
Expected: passes. (Nothing in this change touches the backend; this confirms
no accidental breakage.)

- [ ] **Step 3: Confirm the sitemap output**

Run: `cd frontend && grep -c '<url>' out/sitemap.xml`
Expected: `7`.

- [ ] **Step 4: Manual smoke test**

Run: `cd frontend && npm run dev`

Verify:
- `/about` — both platform cards, shared highlights, support and feedback links
- `/about/iphone` — four scenarios with screenshots, full feature reference, ★ markers
- `/about/web` — four scenarios with screenshots, full feature reference
- `/` — About appears in the header (desktop and the mobile "More" menu) and in the footer
- `/support` — the guide link resolves
- Dark mode follows the system setting on all three new pages
- No console errors

- [ ] **Step 5: Check page weight**

In DevTools, hard-reload `/about/iphone` and read the transferred total.
Expected: under ~1.5MB with images. If materially higher, lower the
`webp({ quality })` in the prepare script and re-run.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin feat/marketing-about-site
gh pr create --title "feat: marketing and guide site at /about" --body "$(cat <<'EOF'
## Summary

Adds a three-page marketing and guide site at `/about/` that becomes the App
Store Marketing URL and is reachable from inside both apps.

- `/about` — what CHQ Calendar is, platform chooser, shared highlights
- `/about/iphone` — scenarios plus a complete iOS feature reference
- `/about/web` — the same for the web app

Most of the app's surface is invisible on first launch. The guide documents
every feature on both platforms and marks the ones people rarely discover.

## Notable decisions

- Copy lives in a typed `aboutContent.ts`, so "is every feature documented?"
  is an enforced test rather than a hope.
- The iOS screenshots derive from the existing App Store capture pipeline, so
  the guide cannot silently go stale as the app changes.
- `marketingUrl` now points at `/about` instead of the calendar itself. This
  takes effect with the next version submission.
- The App Store download button renders a "coming soon" state until
  `APP_STORE_URL` in `aboutContent.ts` is filled in — the app is not yet live.

## Verification

- `npm run build` (frontend) — validate, tests, and the 74.3 coverage floor
- `npm run validate && npm run build` (backend)
- Full iOS test suite
- App Store screenshots regenerated for the new About toolbar item

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XH7x2XG2HZKjRkUXnjnS9X
EOF
)"
```

- [ ] **Step 7: Confirm CI is green**

Run: `gh pr checks --watch`
Expected: all checks pass, including `app-store-assets`.

---

## Post-merge follow-ups

Not part of this plan, but worth tracking:

1. **Fill in `APP_STORE_URL`** in `aboutContent.ts` once the app is live. The
   value is `https://apps.apple.com/app/id<APPLE_ID>`, where `<APPLE_ID>` is
   the numeric Apple ID on the App Information page in App Store Connect.
2. **Enter the new Marketing URL** in App Store Connect with the next version
   submission, per `docs/app-store/RELEASE_CHECKLIST.md`.
3. **Submit `/about` to Google Search Console** for indexing, using the
   existing GSC runbook.
