import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateICS, downloadICS } from '@/lib/utils/icsHelpers';
import type { Event } from '@/lib/types';

/**
 * Check if a line at the given index is inside a VALARM block.
 */
function isInsideValarm(lines: string[], index: number): boolean {
  let insideValarm = false;
  for (let i = 0; i < index; i++) {
    if (lines[i] === 'BEGIN:VALARM') insideValarm = true;
    if (lines[i] === 'END:VALARM') insideValarm = false;
  }
  return insideValarm;
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-123',
    title: 'Test Event',
    description: 'A test description',
    startDate: '2026-07-15T14:00:00',
    endDate: '2026-07-15T15:30:00',
    location: 'Amphitheater',
    ...overrides,
  };
}

describe('generateICS', () => {
  it('generates valid ICS with all fields', () => {
    const event = makeEvent();
    const ics = generateICS(event);

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('SUMMARY:Test Event');
    expect(ics).toContain('LOCATION:Amphitheater');
    expect(ics).toContain('DESCRIPTION:A test description');
    expect(ics).toContain('UID:evt-123@chqcal.org');
  });

  it('includes correct PRODID', () => {
    const ics = generateICS(makeEvent());
    expect(ics).toContain('PRODID:-//CHQ Calendar//chqcal.org//EN');
  });

  it('formats dates correctly as DTSTART/DTEND', () => {
    const event = makeEvent({
      startDate: '2026-07-15T14:00:00',
      endDate: '2026-07-15T15:30:00',
    });
    const ics = generateICS(event);

    expect(ics).toContain('DTSTART:20260715T140000');
    expect(ics).toContain('DTEND:20260715T153000');
  });

  it('defaults end time to start + 1 hour when endDate equals startDate', () => {
    const event = makeEvent({
      startDate: '2026-07-15T14:00:00',
      endDate: '2026-07-15T14:00:00',
    });
    const ics = generateICS(event);

    expect(ics).toContain('DTSTART:20260715T140000');
    expect(ics).toContain('DTEND:20260715T150000');
  });

  it('includes 30-minute VALARM', () => {
    const ics = generateICS(makeEvent());

    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('END:VALARM');
    expect(ics).toContain('TRIGGER:-PT30M');
    expect(ics).toContain('ACTION:DISPLAY');
    expect(ics).toContain('DESCRIPTION:Reminder');
  });

  it('escapes special characters in text fields', () => {
    const event = makeEvent({
      title: 'Event with, comma; semicolon\nand newline',
      description: 'Line1\nLine2, with comma; and semicolon \\ backslash',
    });
    const ics = generateICS(event);

    expect(ics).toContain('SUMMARY:Event with\\, comma\\; semicolon\\nand newline');
    expect(ics).toContain(
      'DESCRIPTION:Line1\\nLine2\\, with comma\\; and semicolon \\\\ backslash',
    );
  });

  it('omits LOCATION when not provided', () => {
    const event = makeEvent({ location: undefined });
    const ics = generateICS(event);

    expect(ics).not.toContain('LOCATION');
  });

  it('omits DESCRIPTION when not provided', () => {
    const event = makeEvent({ description: undefined });
    const ics = generateICS(event);

    // VALARM contains DESCRIPTION:Reminder, so check that no DESCRIPTION line
    // exists in the VEVENT body (outside VALARM)
    const lines = ics.split('\r\n');
    const veventDescLines = lines.filter(
      (line, i) => line.startsWith('DESCRIPTION:') && !isInsideValarm(lines, i),
    );
    expect(veventDescLines).toHaveLength(0);
  });

  it('uses CRLF line endings', () => {
    const ics = generateICS(makeEvent());

    // Every line should end with \r\n
    const lines = ics.split('\r\n');
    // The last element after split will be empty string (trailing CRLF)
    expect(lines.length).toBeGreaterThan(1);
    // Ensure no bare \n without preceding \r (excluding escaped \\n in content)
    const withoutEscaped = ics.replace(/\\n/g, '');
    const bareNewlines = withoutEscaped.split('\n').length - 1;
    const crlfNewlines = withoutEscaped.split('\r\n').length - 1;
    expect(bareNewlines).toBe(crlfNewlines);
  });

  it('handles event with only required fields', () => {
    const event: Event = {
      id: 'min-1',
      title: 'Minimal Event',
      startDate: '2026-08-01T09:00:00',
      endDate: '2026-08-01T10:00:00',
    };
    const ics = generateICS(event);

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Minimal Event');
    expect(ics).toContain('UID:min-1@chqcal.org');
    expect(ics).not.toContain('LOCATION');
    // Check no DESCRIPTION outside of VALARM
    const lines = ics.split('\r\n');
    const veventDescLines = lines.filter(
      (line, i) => line.startsWith('DESCRIPTION:') && !isInsideValarm(lines, i),
    );
    expect(veventDescLines).toHaveLength(0);
  });
});

describe('downloadICS', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates and clicks anchor element to trigger download', () => {
    const createObjectURLMock = vi.fn((_obj: Blob | MediaSource) => 'blob:http://localhost/fake-url');
    const revokeObjectURLMock = vi.fn();
    globalThis.URL.createObjectURL = createObjectURLMock;
    globalThis.URL.revokeObjectURL = revokeObjectURLMock;

    const clickMock = vi.fn();
    const appendChildMock = vi.fn();
    const removeChildMock = vi.fn();

    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickMock,
      style: {},
    } as unknown as HTMLAnchorElement);

    vi.spyOn(document.body, 'appendChild').mockImplementation(appendChildMock);
    vi.spyOn(document.body, 'removeChild').mockImplementation(removeChildMock);

    const event = makeEvent();
    downloadICS(event);

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLMock.mock.calls[0][0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect((blobArg as Blob).type).toBe('text/calendar;charset=utf-8');

    expect(document.createElement).toHaveBeenCalledWith('a');
    expect(appendChildMock).toHaveBeenCalledTimes(1);
    expect(clickMock).toHaveBeenCalledTimes(1);
    expect(removeChildMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/fake-url');
  });

  it('sets download filename based on event title', () => {
    const createObjectURLMock = vi.fn(() => 'blob:http://localhost/fake-url');
    const revokeObjectURLMock = vi.fn();
    globalThis.URL.createObjectURL = createObjectURLMock;
    globalThis.URL.revokeObjectURL = revokeObjectURLMock;

    let downloadAttr = '';
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      get download() { return downloadAttr; },
      set download(val: string) { downloadAttr = val; },
      click: vi.fn(),
      style: {},
    } as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    vi.spyOn(document.body, 'removeChild').mockImplementation(vi.fn());

    downloadICS(makeEvent({ title: 'My Event Title' }));

    expect(downloadAttr).toBe('my-event-title.ics');
  });
});
