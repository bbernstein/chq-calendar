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
