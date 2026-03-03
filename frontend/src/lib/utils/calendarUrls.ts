import type { Event } from '@/lib/types';

/**
 * Format a Date as YYYYMMDDTHHMMSS for Google Calendar.
 * Google Calendar requires dates in this format without timezone offset.
 */
function toGoogleDate(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * Format a Date as ISO 8601 string for Outlook (YYYY-MM-DDTHH:MM:SS).
 */
function toOutlookDate(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * Build a Google Calendar "Add Event" URL.
 * Opens in a new tab with the event pre-filled.
 */
export function getGoogleCalendarUrl(event: Event): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', event.title);
  params.set('dates', `${toGoogleDate(event.startDate)}/${toGoogleDate(event.endDate)}`);
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
