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
    // Dates should be in ISO-like format YYYY-MM-DDTHH:MM:SS
    expect(url).toMatch(/startdt=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}/);
    expect(url).toMatch(/enddt=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}/);
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
