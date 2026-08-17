/**
 * All copy for the /about guide site, as data.
 *
 * Pages are thin renderers over these constants. Keeping content here (rather
 * than inline in JSX) is what lets `aboutContent.test.ts` and the page tests
 * assert that every feature we ship is actually documented — the guide going
 * stale as the apps gain features is the main failure mode this design guards
 * against.
 */

import { APP_STORE_URL } from '@/lib/constants';
import { externalLinks } from '@/lib/quickLinks';

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
 * Public App Store URL, defined in `@/lib/constants` so the calendar bundle can
 * read it without importing this page's copy. App Store Connect assigns the
 * numeric Apple ID at app-record creation, but the /app/id… URL only resolves
 * once a version is live. `PlatformCard` renders a "coming soon" state while
 * this is empty, so the site can ship before the app is approved; the iOS-app
 * promo surfaces are likewise gated on it being non-empty.
 */
export { APP_STORE_URL };

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

/**
 * Guide copy for the off-site Chautauqua Institution destinations both clients
 * surface — the web header's "Chautauqua" menu and the iOS More menu.
 *
 * Only the prose lives here. The destinations themselves, their order, and
 * their labels are read from `shared/links.json` via `externalLinks`, so this
 * file cannot disagree with the menus about what exists or what they are
 * called. Keyed by the `id` in that file; `aboutContent.test.ts` fails if any
 * `external` entry has no blurb, so a sixth link stays undocumented only until
 * the next test run.
 *
 * One table serves both platforms deliberately: the same five destinations
 * behind the same five labels, described two different ways, is precisely the
 * drift this file exists to prevent.
 */
const CHQ_BLURBS: Record<string, string> = {
  'programs':
    'Chautauqua’s digital programs for theatre and music performances — the same listings the 📖 marker on an individual event links into.',
  'questions':
    'Chautauqua’s Q-and-A portal, for putting a question to the Institution.',
  'captions':
    'Chautauqua’s live captioning. The link follows whichever session is being captioned, so between sessions it may report that none is running.',
  'bus-tram-tracker':
    'Where the buses and trams on the grounds are right now.',
  'chautauqua-fund':
    'Giving to the Chautauqua Fund, the Institution’s annual fund.',
};

/**
 * Headings the destinations file under, deliberately different per platform.
 *
 * iOS already has a "Calendar & links" group holding its other outbound links
 * (Daily coverage, digital programs), and these belong with them. The web
 * guide's nearest group is "Calendar export", which is about getting events
 * out of the calendar rather than linking away from it, so the web side gets
 * its own heading instead of a poor fit.
 *
 * Named constants rather than repeated literals: both carry punctuation — a
 * curly apostrophe, an ampersand — that is easy to retype slightly
 * differently, and a near-miss would silently split these across two headings
 * on the page.
 */
const WEB_CHQ_GROUP = 'Chautauqua’s own sites';
const IOS_CHQ_GROUP = 'Calendar & links';

/** Renders the shared destinations as one platform's feature entries. */
function chqDestinationFeatures(platform: Platform, group: string): Feature[] {
  return externalLinks.map((link) => ({
    id: `${platform}-chq-${link.id}`,
    group,
    title: link.title,
    blurb: CHQ_BLURBS[link.id],
  }));
}

export const SHARED_HIGHLIGHTS: Feature[] = [
  { id: 'shared-season', group: 'Everywhere', title: 'The whole season in one place',
    blurb: 'Over 1,500 events — lectures, concerts, worship, recreation — in a single list you can scroll.' },
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
    screenshot: { base: 'ios-09-reminder', alt: 'A starred event’s detail screen, with a “Remind me” row set to the default of 30 minutes before', ...IOS_SHOT },
  },
  {
    id: 'ios-find-your-way',
    title: 'Find your way on the grounds',
    body: [
      'The Map tab plots the venues events are actually held in — around fifty of them, hand-placed. Tap one to see what’s on there next, or to filter the whole event list down to that venue.',
      'Need directions? Hand off to Apple Maps for a walking route.',
      'None of this asks for your location.',
    ],
    screenshot: { base: 'ios-08-map', alt: 'The Map tab showing venues plotted across the Chautauqua grounds', ...IOS_SHOT },
  },
  {
    id: 'ios-follow-the-season',
    title: 'Follow the season',
    body: [
      'Every week at Chautauqua has a theme. Tap the “Wk 6” badge in any day header to read it, with a link out to chq.org for the full description.',
      'Filtering to that week is a separate step: tap the date button at the bottom of the list and pick the week from the strip — or choose Now, Today, All Season, or All Year during the current season.',
      'Narrow by category and venue on top of that, or search by name, venue, or presenter. The categories and venues you picked most recently move to the front of the list.',
      'Event details link out to Chautauquan Daily coverage and digital programs where they exist.',
    ],
    screenshot: { base: 'ios-02-filters', alt: 'The filter sheet with categories and venues', ...IOS_SHOT },
  },
];

export const IOS_FEATURES: Feature[] = [
  // Browsing & finding
  { id: 'ios-browse', group: 'Browsing & finding', title: 'Every event, grouped by day',
    blurb: 'Scroll the whole season, or narrow it to Now, Today, All Season, or All Year during the current season.' },
  { id: 'ios-search', group: 'Browsing & finding', title: 'Search by name, venue, or presenter',
    blurb: 'One search field covers all three.' },
  { id: 'ios-filters', group: 'Browsing & finding', title: 'Filter by category, venue, and week',
    blurb: 'Combine filters freely. Inside the Filters sheet, your search term, venues, categories, and the favorites toggle each show as a chip you can clear on its own; the date and week controls sit right above them and are cleared there.' },
  { id: 'ios-recent-filters', group: 'Browsing & finding', title: 'Recently used filters come first', notObvious: true,
    blurb: 'The categories and venues you picked most recently move to the front of the row, ahead of the rest.' },
  { id: 'ios-week-themes', group: 'Browsing & finding', title: 'Weekly themes', notObvious: true,
    blurb: 'Each week of the season has a theme — tap the “Wk 6” badge in a day header to read it and link out to chq.org.' },

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
  { id: 'ios-map', group: 'Map', title: 'The venues events are held in',
    blurb: 'The Map tab plots around fifty hand-placed venues where you’d actually find them.' },
  { id: 'ios-map-venue', group: 'Map', title: 'Tap a venue for what’s next', notObvious: true,
    blurb: 'See that venue’s upcoming events, or filter the whole list down to it.' },
  { id: 'ios-map-directions', group: 'Map', title: 'Walking directions',
    blurb: 'Hand off to Apple Maps for a walking route to any venue.' },
  { id: 'ios-map-no-permission', group: 'Map', title: 'No location permission needed',
    blurb: 'The map works without ever asking where you are.' },

  // Siri, Shortcuts & Spotlight
  { id: 'ios-siri', group: 'Siri, Shortcuts & Spotlight', title: 'Ask Siri what’s next', notObvious: true,
    blurb: 'Say “What’s next in CHQ Calendar” or “Today in CHQ Calendar” and Siri answers.' },
  { id: 'ios-shortcuts', group: 'Siri, Shortcuts & Spotlight', title: 'Open any event by name', notObvious: true,
    blurb: 'Say “Open an event in CHQ Calendar”, or name the event inside the phrase. The same Open Event action is available in the Shortcuts app.' },
  { id: 'ios-spotlight', group: 'Siri, Shortcuts & Spotlight', title: 'Find events from Spotlight', notObvious: true,
    blurb: 'Swipe down on the Home Screen and search — the season and your starred events are indexed.' },

  // Calendar & links
  { id: 'ios-calendar', group: IOS_CHQ_GROUP, title: 'Add to your own calendar',
    blurb: 'Send an event to the calendar app you already use.' },
  { id: 'ios-daily', group: IOS_CHQ_GROUP, title: 'Chautauquan Daily coverage', notObvious: true,
    blurb: 'Event details link to Daily articles about that event where they exist.' },
  { id: 'ios-programs', group: IOS_CHQ_GROUP, title: 'Digital programs', notObvious: true,
    blurb: 'Where a digital program has been published, the event links straight to it.' },
  { id: 'ios-chq-menu', group: IOS_CHQ_GROUP, title: 'Chautauqua’s own sites, in the More menu', notObvious: true,
    blurb: 'The More menu opens the Institution’s own services. They are Chautauqua’s, not part of this app, and each one opens in your browser.' },
  ...chqDestinationFeatures('ios', IOS_CHQ_GROUP),

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
      'Want more? Keep scrolling — the next day loads in on its own as you reach the end. Heading back the other way stays deliberate: a “Show earlier” button waits at the top, naming the day it’s about to add.',
      'Or jump straight to Now, Today, All Season, or All Year — or pick a week from the strip.',
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
      'On a computer, the calendar icon on any event opens a short “Add to calendar” menu: Apple Calendar, Google Calendar, or Outlook.',
      'Apple Calendar is a webcal subscription rather than a one-time copy, so if the event moves, your calendar moves with it. Google Calendar and Outlook open in a new tab with the event already filled in.',
      'On a phone or tablet there is no menu. The same button downloads a standard .ics calendar file straight away, which any calendar app can open.',
    ],
    screenshot: { base: 'web-05-calendar', alt: 'The “Add to calendar” menu open on an event, offering Apple Calendar, Google Calendar, and Outlook', ...WEB_SHOT },
  },
  {
    id: 'web-follow-the-season',
    title: 'Follow the season',
    body: [
      'On a computer, click and drag across the week strip to select a range of weeks at once. Shift-click extends a range from what you already have, and ⌘-click (Ctrl-click on Windows) adds or removes individual weeks. On a touchscreen, tap the weeks you want one at a time.',
      'Tap the underlined week label in any day header to read that week’s theme.',
      'Filter by category and venue on top of that — the ones you picked most recently appear as a row of shortcuts beside the Locations and Categories headings. Every filter you’ve applied shows as a chip you can clear on its own.',
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
  { id: 'web-recent-filters', group: 'Finding', title: 'Recently used filters, one click away', notObvious: true,
    blurb: 'The last categories and venues you picked appear as a row of shortcut pills beside the Locations and Categories headings, most recent first — the full list below keeps its own order.' },
  { id: 'web-active-chips', group: 'Finding', title: 'Active filter chips', notObvious: true,
    blurb: 'Everything you’ve applied shows as a chip — clear them one at a time or all at once.' },

  // Dates & weeks
  { id: 'web-date-quick', group: 'Dates & weeks', title: 'Now, Today, All Season, or All Year',
    blurb: 'Four scopes cover the questions people actually ask — and the same four the iPhone app uses, so your laptop and your phone speak the same vocabulary.' },
  { id: 'web-day-rail', group: 'Dates & weeks', title: 'A day rail under the week strip', notObvious: true,
    blurb: 'A strip of days that highlights whichever day you have scrolled to. Tap a day with something on it to jump there — the chevrons step the same way, always landing on the next day that has something. Empty days are shown but can’t be tapped.' },
  { id: 'web-go-to-today', group: 'Dates & weeks', title: '⟳ Now takes you back to today', notObvious: true,
    blurb: 'Wherever you have wandered in the season, one tap returns you to today without changing a single filter.' },
  { id: 'web-filters-toggle', group: 'Dates & weeks', title: 'A Filters button appears once you scroll', notObvious: true,
    blurb: 'Once you have scrolled, a Filters button appears on the day rail. Tap it and the search field and every filter come back — right over the list, without losing your place. Tap it again, or press Escape, to put them away.' },
  { id: 'web-adaptive', group: 'Dates & weeks', title: 'The “next” window grows to fit', notObvious: true,
    blurb: 'Instead of a fixed number of days, it widens until it has a useful number of events to show.' },
  { id: 'web-show-more', group: 'Dates & weeks', title: 'The list keeps going', notObvious: true,
    blurb: 'Scroll past the end of what you asked for and the next day loads on its own. Going backwards stays deliberate — a “Show earlier” button at the top names the day it is about to add.' },
  { id: 'web-week-strip', group: 'Dates & weeks', title: 'Pick weeks from the strip',
    blurb: 'Every week of the season, selectable directly.' },
  { id: 'web-week-drag', group: 'Dates & weeks', title: 'Drag to select a range of weeks', notObvious: true,
    blurb: 'On a computer, click and drag across the strip to select several weeks in one gesture. On a touchscreen, tap the weeks one at a time.' },
  { id: 'web-week-modifiers', group: 'Dates & weeks', title: 'Shift-click and ⌘-click the strip', notObvious: true,
    blurb: 'Shift-click extends a range out from the weeks already selected; ⌘-click (Ctrl-click on Windows) adds or removes a single week without disturbing the rest.' },
  { id: 'web-week-themes', group: 'Dates & weeks', title: 'Weekly theme popovers', notObvious: true,
    blurb: 'Tap the underlined week label in a day header to read the theme that week is programmed around.' },

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
  { id: 'web-calendar-menu', group: 'Calendar export', title: 'A menu on a computer',
    blurb: 'Click the calendar icon on any event and pick Apple Calendar, Google Calendar, or Outlook.' },
  { id: 'web-webcal', group: 'Calendar export', title: 'Apple Calendar subscribes, it doesn’t copy', notObvious: true,
    blurb: 'The Apple Calendar option hands off a webcal subscription, so the event stays in sync if its time or venue changes.' },
  { id: 'web-google', group: 'Calendar export', title: 'Google Calendar',
    blurb: 'Opens Google Calendar in a new tab with the event already filled in.' },
  { id: 'web-outlook', group: 'Calendar export', title: 'Outlook',
    blurb: 'The same, for Outlook.' },
  { id: 'web-ics', group: 'Calendar export', title: 'One tap on a phone or tablet', notObvious: true,
    blurb: 'Touch devices skip the menu — the calendar button downloads a standard .ics file straight away, which any calendar app can open.' },

  // Chautauqua's own sites
  { id: 'web-chq-menu', group: WEB_CHQ_GROUP, title: 'One menu in the header', notObvious: true,
    blurb: 'The “Chautauqua” button in the header collects the Institution’s own services. They are Chautauqua’s, not part of this calendar, so each one opens in a new tab.' },
  ...chqDestinationFeatures('web', WEB_CHQ_GROUP),

  // Seasons
  { id: 'web-year', group: 'Seasons', title: 'Past and upcoming seasons',
    blurb: 'Switch years from the header to look back — or ahead, once next season is announced.' },
  { id: 'web-countdown', group: 'Seasons', title: 'Countdown to opening day',
    blurb: 'Once the calendar has rolled forward to a season that hasn’t started yet, a banner counts down the days to its first event.' },

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
