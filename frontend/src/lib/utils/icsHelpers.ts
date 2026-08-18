import type { Event } from '@/lib/types';
import { CHQ_ZONE, chqParts, chqDateAt, pad2 as p2, parseEventDate } from '@/lib/utils/chqTime';

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
 * Fold long ICS lines per RFC 5545 (max 75 octets per line).
 * Lines are folded with CRLF followed by a space.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  parts.push(line.substring(0, 75));
  let pos = 75;
  while (pos < line.length) {
    parts.push(' ' + line.substring(pos, pos + 74));
    pos += 74;
  }
  return parts.join('\r\n');
}

/**
 * Format an instant as an ICS local datetime, `YYYYMMDDTHHMMSS`, in
 * Institution time.
 */
function formatChqICSDate(d: Date): string {
  const { year, month, day, hour, minute, second } = chqParts(d);
  return `${year}${p2(month)}${p2(day)}T${p2(hour)}${p2(minute)}${p2(second)}`;
}

/**
 * An ICS local datetime, `YYYYMMDDTHHMMSS`, in Institution time.
 *
 * Paired with `DTSTART;TZID=America/New_York`, so the components written
 * here must be Chautauqua's wall clock — which is exactly the wall clock the
 * feed gave us. The round trip is therefore an identity, and this function
 * existed in a device-local form that was correct only because parsing was
 * device-local too.
 */
function formatICSDate(dateStr: string): string {
  return formatChqICSDate(parseEventDate(dateStr));
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
 * - DTSTART/DTEND use TZID=America/New_York for correct timezone display
 * - Includes VTIMEZONE block for America/New_York (EDT/EST)
 * - If endDate equals startDate, defaults to start + 1 hour
 * - Escapes special chars in text fields (newlines, commas, semicolons, backslashes)
 * - Folds long lines at 75 octets per RFC 5545
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
    // Default to start + 1 hour of Institution wall clock when endDate
    // equals startDate. This must add an hour to the *Institution* clock,
    // not to the absolute instant: on a DST transition day those disagree
    // (a skipped or repeated hour), and `Date.prototype.setHours` only ever
    // adds a device-local hour, which is exactly the device-dependence this
    // migration removes. `chqDateAt` re-derives the instant for the
    // adjusted wall-clock fields, so overflow (23:xx -> 24:xx) correctly
    // carries into the next Institution day, and a nonexistent wall time
    // (landing in a spring-forward gap) resolves the same way the rest of
    // the app resolves one.
    const p = chqParts(parseEventDate(event.startDate));
    const endInstant = chqDateAt(p.year, p.month, p.day, p.hour + 1, p.minute, p.second);
    dtEnd = formatChqICSDate(endInstant);
  } else {
    dtEnd = formatICSDate(event.endDate);
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CHQ Calendar//chqcal.org//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // VTIMEZONE for America/New_York (EDT/EST)
    'BEGIN:VTIMEZONE',
    `TZID:${CHQ_ZONE}`,
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${event.id}@chqcal.org`,
    `DTSTAMP:${formatICSTimestamp()}`,
    `DTSTART;TZID=${CHQ_ZONE}:${dtStart}`,
    `DTEND;TZID=${CHQ_ZONE}:${dtEnd}`,
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

  // Apply RFC 5545 line folding (75 octets max) and CRLF line endings
  return lines.map(foldLine).join('\r\n') + '\r\n';
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
