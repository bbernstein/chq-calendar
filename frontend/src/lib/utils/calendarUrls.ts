import type { Event } from '@/lib/types';
import { CHQ_ZONE, chqParts, pad2 as p2, parseEventDate } from '@/lib/utils/chqTime';

/**
 * Format a Date as YYYYMMDDTHHMMSS for Google Calendar, in Institution wall
 * time. Google Calendar requires dates in this format without a timezone
 * offset; the popup's `ctz=America/New_York` param (set below) is what tells
 * Google how to interpret it.
 */
function toGoogleDate(dateStr: string): string {
  const { year, month, day, hour, minute, second } = chqParts(parseEventDate(dateStr));
  return `${year}${p2(month)}${p2(day)}T${p2(hour)}${p2(minute)}${p2(second)}`;
}

/**
 * The Institution's UTC offset (e.g. `-04:00`) at the instant `d` names,
 * derived from the instant itself rather than a hardcoded DST rule. The
 * second-Sunday-of-March / first-Sunday-of-November calculation this
 * replaced only ever encoded the *current* US rule and would go wrong
 * silently the day that rule changes; comparing the Institution wall clock
 * to the same instant's UTC components is correct on both sides of every
 * transition without knowing the rule at all.
 */
function chqOffset(d: Date): string {
  const p = chqParts(d);
  const wallAsUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const diffMinutes = Math.round((wallAsUTC - d.getTime()) / 60000);
  const sign = diffMinutes < 0 ? '-' : '+';
  const abs = Math.abs(diffMinutes);
  return `${sign}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`;
}

/**
 * Format a Date as ISO 8601 string with the Institution's offset, for
 * Outlook. Outlook interprets naive times in the user's account timezone,
 * so the offset is appended to ensure correct display regardless of where
 * the reader's Outlook account is set.
 */
function toOutlookDate(dateStr: string): string {
  const d = parseEventDate(dateStr);
  const { year, month, day, hour, minute, second } = chqParts(d);
  return `${year}-${p2(month)}-${p2(day)}T${p2(hour)}:${p2(minute)}:${p2(second)}${chqOffset(d)}`;
}

/**
 * Build a Google Calendar "Add Event" URL.
 * Opens in a new tab with the event pre-filled.
 * Uses ctz=America/New_York so Google interprets local times as Eastern.
 */
export function getGoogleCalendarUrl(event: Event): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', event.title);
  params.set('dates', `${toGoogleDate(event.startDate)}/${toGoogleDate(event.endDate)}`);
  params.set('ctz', CHQ_ZONE);
  if (event.location) {
    params.set('location', event.location);
  }
  if (event.description) {
    params.set('details', event.description);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Build an Outlook.com "Add Event" deep link URL.
 * Opens in a new tab with the event pre-filled.
 */
export function getOutlookCalendarUrl(event: Event): string {
  const params = new URLSearchParams();
  params.set('rru', 'addevent');
  params.set('subject', event.title);
  params.set('startdt', toOutlookDate(event.startDate));
  params.set('enddt', toOutlookDate(event.endDate));
  if (event.location) {
    params.set('location', event.location);
  }
  if (event.description) {
    params.set('body', event.description);
  }
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/**
 * Build a webcal:// URL for adding an event to Apple Calendar.
 * Returns null in dev mode since webcal:// can't reach localhost.
 */
export function getWebcalUrl(eventId: string): string | null {
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return null;
  }
  return `webcal://www.chqcal.org/api/calendar/events/${eventId}`;
}

/**
 * Detect if the current device is a desktop (has a fine pointer and hover capability).
 * Returns false on mobile/tablet devices with touch-only input.
 */
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
