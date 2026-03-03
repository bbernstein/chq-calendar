import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { CalendarPopup } from '@/components/calendar/CalendarPopup';
import type { Event } from '@/lib/types';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-456',
    title: 'Symphony Concert',
    description: 'An evening of classical music',
    startDate: '2026-07-05T00:15:00Z',
    endDate: '2026-07-05T02:00:00Z',
    location: 'Amphitheater',
    ...overrides,
  };
}

function makeDOMRect(): DOMRect {
  return {
    top: 100,
    right: 300,
    bottom: 130,
    left: 250,
    width: 50,
    height: 30,
    x: 250,
    y: 100,
    toJSON: () => ({}),
  };
}

describe('CalendarPopup', () => {
  let onClose: () => void;

  beforeEach(() => {
    onClose = vi.fn() as unknown as () => void;
    // Mock window.location for webcal URL (localhost = dev mode)
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, hostname: 'localhost' },
    });
  });

  it('renders three calendar options', () => {
    render(
      <CalendarPopup event={makeEvent()} buttonRect={makeDOMRect()} onClose={onClose} />
    );
    // Portal renders into document.body, not the test container
    const menuItems = document.body.querySelectorAll('[role="menuitem"]');
    expect(menuItems.length).toBe(3);
  });

  it('renders "Add to calendar" header', () => {
    const { getByText } = render(
      <CalendarPopup event={makeEvent()} buttonRect={makeDOMRect()} onClose={onClose} />
    );
    expect(getByText('Add to calendar')).toBeTruthy();
  });

  it('renders Google Calendar link with target="_blank"', () => {
    const { getByText } = render(
      <CalendarPopup event={makeEvent()} buttonRect={makeDOMRect()} onClose={onClose} />
    );
    const googleLink = getByText('Google Calendar').closest('a');
    expect(googleLink).toBeTruthy();
    expect(googleLink!.getAttribute('target')).toBe('_blank');
    expect(googleLink!.getAttribute('href')).toContain('calendar.google.com');
  });

  it('renders Outlook link with target="_blank"', () => {
    const { getByText } = render(
      <CalendarPopup event={makeEvent()} buttonRect={makeDOMRect()} onClose={onClose} />
    );
    const outlookLink = getByText('Outlook').closest('a');
    expect(outlookLink).toBeTruthy();
    expect(outlookLink!.getAttribute('target')).toBe('_blank');
    expect(outlookLink!.getAttribute('href')).toContain('outlook.live.com');
  });

  it('renders Apple Calendar as a button in dev mode (localhost)', () => {
    const { getByText } = render(
      <CalendarPopup event={makeEvent()} buttonRect={makeDOMRect()} onClose={onClose} />
    );
    // In dev mode, Apple Calendar should be a button (not a link) since webcal:// won't work
    const appleOption = getByText('Apple Calendar (.ics)');
    expect(appleOption.closest('button')).toBeTruthy();
  });

  it('closes on Escape key', () => {
    render(
      <CalendarPopup event={makeEvent()} buttonRect={makeDOMRect()} onClose={onClose} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has role="menu" on the popup container', () => {
    render(
      <CalendarPopup event={makeEvent()} buttonRect={makeDOMRect()} onClose={onClose} />
    );
    // Portal renders into document.body, not the test container
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
  });
});
