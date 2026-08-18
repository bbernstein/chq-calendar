import { chqParts } from '@/lib/utils/chqTime';

export const CACHE_EXPIRY_MS = 3600000; // 1 hour in milliseconds
export const USER_STATE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
export const LONG_PRESS_MS = 500;
/** How long the iOS-app promo banner stays hidden after the user dismisses it. */
export const IOS_PROMO_SNOOZE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days in milliseconds
/** Minimum iOS/iPadOS major version the native app supports (deployment target). */
export const IOS_MIN_VERSION = 18;
/**
 * The native app's App Store listing. Every promo surface is gated on this
 * being non-empty, so clearing it turns the whole feature off. It lives here
 * rather than in the /about page content so the calendar bundle doesn't pull
 * in that page's copy dataset just to read one URL.
 */
export const APP_STORE_URL = 'https://apps.apple.com/us/app/chqcalendar/id6797027562';
export const YEARS_MANIFEST_PATH = '/cache/calendar-cache/years.json';
/**
 * The default season year, turning over on October 1 — at Chautauqua.
 *
 * Read in Institution time so a reader east of Eastern does not see next
 * season a few hours early on September 30.
 */
export function getDefaultYear(): number {
  const { year, month } = chqParts(new Date());
  return month >= 10 ? year + 1 : year;
}

// Backward-compatible constant — will be removed once all consumers use getDefaultYear()
export const ACTIVE_YEAR = getDefaultYear();

export const locationShortcuts: Record<string, string> = {
  "Elizabeth S. Lenna Hall": "Lenna Hall",
  "AAHH African American Heritage House": "AAHH",
  "Fletcher Music Hall": "Fletcher Hall",
  "Smith Wilkes Hall": "Smith Wilkes",
  "Alumni Hall Ballroom": "Alumni Hall",
  "Chabad Jewish House": "Chabad House",
  "Fowler-Kellogg Art Center 2nd floor": "Fowler-Kellogg 2nd Floor",
  "Fowler-Kellogg Art Center: 1st Floor": "Fowler-Kellogg 1st Floor",
  "Everett Jewish Life Center": "Everett Jewish Center",
  "Hall of Christ: Sanctuary": "Hall of Christ",
  "Denominational Houses (Selected)": "Denominational Houses",
};

export const categoryShortcuts: Record<string, string> = {
  "Chautauqua Symphony Orchestra/Classical Concerts": "CSO",
  "Chautauqua Institution Program": "CHQ Program",
  "Chautauqua Literary and Scientific Circle (CLSC)": "CLSC",
  "Climate Change Initiative Program": "Climate Change Program",
};

export function getLocationDisplayName(location: string): string {
  return locationShortcuts[location] || location;
}

export function getCategoryDisplayName(category: string): string {
  return categoryShortcuts[category] || category;
}
