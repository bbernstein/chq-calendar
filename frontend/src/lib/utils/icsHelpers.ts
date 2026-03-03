import type { Event } from '@/lib/types';

/**
 * Escape special characters in ICS text fields per RFC 5545.
 * Backslashes must be escaped first to avoid double-escaping.
 */
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Format a date string as an ICS local datetime: YYYYMMDDTHHMMSS
 */
function formatICSDate(dateStr: string): string {
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
 * Generate an ICS timestamp for DTSTAMP (current UTC time).
 */
function formatICSTimestamp(): string {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const seconds = String(d.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Generate an RFC 5545 compliant ICS calendar string for a single event.
 *
 * - DTSTART/DTEND formatted as YYYYMMDDTHHMMSS (local time, no timezone)
 * - If endDate equals startDate, defaults to start + 1 hour
 * - Escapes special chars in text fields (newlines, commas, semicolons, backslashes)
 * - Includes VALARM for 30-minute reminder
 * - UID format: {event.id}@chqcal.org
 * - PRODID: -//CHQ Calendar//chqcal.org//EN
 * - Uses CRLF line endings per RFC 5545
 * - Omits LOCATION if not provided
 * - Omits DESCRIPTION if not provided
 */
export function generateICS(event: Event): string {
  const dtStart = formatICSDate(event.startDate);

  let dtEnd: string;
  if (event.endDate === event.startDate) {
    // Default to start + 1 hour when endDate equals startDate
    const endDate = new Date(event.startDate);
    endDate.setHours(endDate.getHours() + 1);
    dtEnd = formatICSDate(endDate.toISOString());
  } else {
    dtEnd = formatICSDate(event.endDate);
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CHQ Calendar//chqcal.org//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@chqcal.org`,
    `DTSTAMP:${formatICSTimestamp()}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICSText(event.title)}`,
  ];

  if (event.location) {
    lines.push(`LOCATION:${escapeICSText(event.location)}`);
  }

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICSText(event.description)}`);
  }

  // 30-minute reminder alarm
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
  );

  lines.push('END:VEVENT', 'END:VCALENDAR');

  // RFC 5545 requires CRLF line endings
  return lines.join('\r\n') + '\r\n';
}

/**
 * Download an ICS file for an event. Creates a Blob with text/calendar MIME type,
 * creates a temporary anchor element, triggers a click to download, then revokes the URL.
 */
export function downloadICS(event: Event): void {
  const icsContent = generateICS(event);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${event.title.replace(/[^a-zA-Z0-9 ]/g, '-').replace(/\s+/g, '-').toLowerCase()}.ics`;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}
