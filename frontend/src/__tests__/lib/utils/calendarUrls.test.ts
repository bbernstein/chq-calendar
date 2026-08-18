import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getGoogleCalendarUrl, getOutlookCalendarUrl, getWebcalUrl, isDesktop } from '@/lib/utils/calendarUrls';
import type { Event } from '@/lib/types';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-123',
    title: 'Morning Lecture',
    description: 'A great lecture on philosophy',
    startDate: '2026-07-01T14:45:00Z',
    endDate: '2026-07-01T15:45:00Z',
    location: 'Amphitheater',
    ...overrides,
  };
}

describe('getGoogleCalendarUrl', () => {
  it('generates a URL with all fields', () => {
    const url = getGoogleCalendarUrl(makeEvent());
    expect(url).toContain('https://calendar.google.com/calendar/render');
    expect(url).toContain('action=TEMPLATE');
    expect(url).toContain('text=Morning+Lecture');
    expect(url).toContain('location=Amphitheater');
    expect(url).toContain('details=A+great+lecture+on+philosophy');
    // dates param should contain start/end in YYYYMMDDTHHMMSS format
    expect(url).toMatch(/dates=\d{8}T\d{6}%2F\d{8}T\d{6}/);
  });

  it('omits location when not provided', () => {
    const url = getGoogleCalendarUrl(makeEvent({ location: undefined }));
    expect(url).not.toContain('location=');
  });

  it('omits details when description is not provided', () => {
    const url = getGoogleCalendarUrl(makeEvent({ description: undefined }));
    expect(url).not.toContain('details=');
  });

  it('encodes special characters in title', () => {
    const url = getGoogleCalendarUrl(makeEvent({ title: 'Music & Art: A "Special" Show' }));
    expect(url).toContain('text=Music');
    // Should be URL-encoded
    expect(url).toContain('%26');
  });
});

describe('getOutlookCalendarUrl', () => {
  it('generates a URL with all fields', () => {
    const url = getOutlookCalendarUrl(makeEvent());
    expect(url).toContain('https://outlook.live.com/calendar/0/deeplink/compose');
    expect(url).toContain('subject=Morning+Lecture');
    expect(url).toContain('location=Amphitheater');
    expect(url).toContain('body=A+great+lecture+on+philosophy');
    // Dates should be in ISO-like format with Eastern offset YYYY-MM-DDTHH:MM:SS-04:00
    expect(url).toMatch(/startdt=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}-0[45]%3A00/);
    expect(url).toMatch(/enddt=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}-0[45]%3A00/);
  });

  it('omits location when not provided', () => {
    const url = getOutlookCalendarUrl(makeEvent({ location: undefined }));
    expect(url).not.toContain('location=');
  });

  it('omits body when description is not provided', () => {
    const url = getOutlookCalendarUrl(makeEvent({ description: undefined }));
    expect(url).not.toContain('body=');
  });
});

describe('getWebcalUrl', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // Mock window.location for testing
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('returns null when on localhost', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, hostname: 'localhost' },
    });
    expect(getWebcalUrl('evt-123')).toBeNull();
  });

  it('returns null when on 127.0.0.1', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, hostname: '127.0.0.1' },
    });
    expect(getWebcalUrl('evt-123')).toBeNull();
  });

  it('returns webcal URL when on production domain', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, hostname: 'www.chqcal.org' },
    });
    const url = getWebcalUrl('evt-123');
    expect(url).toBe('webcal://www.chqcal.org/api/calendar/events/evt-123');
  });
});

describe('isDesktop', () => {
  const mockMatchMedia = (matches: boolean) => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches,
      media: '(hover: hover) and (pointer: fine)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when matchMedia reports hover and fine pointer', () => {
    mockMatchMedia(true);
    expect(isDesktop()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith('(hover: hover) and (pointer: fine)');
  });

  it('returns false when matchMedia reports no hover', () => {
    mockMatchMedia(false);
    expect(isDesktop()).toBe(false);
  });
});

// Institution-anchored dates (F1): both providers must read `startDate`
// through `parseEventDate`/`chqParts` rather than device-local `Date`
// accessors, so naive feed timestamps and offset-bearing publisher
// timestamps (any zone) agree with each other and with the ICS export.
function makeTzEvent(startDate: string, endDate: string): Event {
  return { id: 'evt-tz', title: 'TZ Event', startDate, endDate };
}

function googleDatesParam(event: Event): string {
  const url = new URL(getGoogleCalendarUrl(event));
  return url.searchParams.get('dates') ?? '';
}

function outlookStartdt(event: Event): string {
  const url = new URL(getOutlookCalendarUrl(event));
  return url.searchParams.get('startdt') ?? '';
}

describe('getGoogleCalendarUrl institution-anchored dates', () => {
  it('sets ctz=America/New_York', () => {
    const url = new URL(getGoogleCalendarUrl(makeTzEvent('2026-07-27 12:45:00', '2026-07-27 13:45:00')));
    expect(url.searchParams.get('ctz')).toBe('America/New_York');
  });

  it('renders a naive feed timestamp as Institution wall time', () => {
    const dates = googleDatesParam(makeTzEvent('2026-07-27 12:45:00', '2026-07-27 13:45:00'));
    expect(dates.split('/')[0]).toBe('20260727T124500');
  });

  it('renders an offset-bearing timestamp already in Eastern unchanged', () => {
    const dates = googleDatesParam(makeTzEvent('2026-07-04T18:00:00-04:00', '2026-07-04T19:00:00-04:00'));
    expect(dates.split('/')[0]).toBe('20260704T180000');
  });

  it('converts an offset-bearing timestamp from a different zone to the Institution equivalent', () => {
    // 18:00+09:00 is 09:00Z, which is 05:00 EDT the same morning.
    const dates = googleDatesParam(makeTzEvent('2026-07-04T18:00:00+09:00', '2026-07-04T19:00:00+09:00'));
    expect(dates.split('/')[0]).toBe('20260704T050000');
  });
});

describe('getOutlookCalendarUrl institution-anchored dates', () => {
  it('appends the Institution EDT offset for a naive summer timestamp', () => {
    expect(outlookStartdt(makeTzEvent('2026-07-27 12:45:00', '2026-07-27 13:45:00')))
      .toBe('2026-07-27T12:45:00-04:00');
  });

  it('appends the Institution EST offset for a naive winter timestamp', () => {
    expect(outlookStartdt(makeTzEvent('2026-01-15 09:30:00', '2026-01-15 10:30:00')))
      .toBe('2026-01-15T09:30:00-05:00');
  });

  it('renders an offset-bearing timestamp already in Eastern as the same wall time it names, not shifted', () => {
    expect(outlookStartdt(makeTzEvent('2026-07-04T18:00:00-04:00', '2026-07-04T19:00:00-04:00')))
      .toBe('2026-07-04T18:00:00-04:00');
  });

  it('converts an offset-bearing timestamp from a different zone to the Institution equivalent', () => {
    // 18:00+09:00 is 09:00Z, which is 05:00 EDT the same morning.
    expect(outlookStartdt(makeTzEvent('2026-07-04T18:00:00+09:00', '2026-07-04T19:00:00+09:00')))
      .toBe('2026-07-04T05:00:00-04:00');
  });
});

describe('Google and Outlook agree with each other on the same event', () => {
  it('both name the same Institution wall time for a naive timestamp', () => {
    const event = makeTzEvent('2026-07-27 12:45:00', '2026-07-27 13:45:00');
    expect(googleDatesParam(event).split('/')[0]).toBe('20260727T124500');
    expect(outlookStartdt(event)).toBe('2026-07-27T12:45:00-04:00');
  });
});
