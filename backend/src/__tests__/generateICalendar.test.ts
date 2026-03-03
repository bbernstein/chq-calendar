import { generateICalendar } from '../handlers/calendarHandler';

// Minimal event matching the handler's Event interface
function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-100',
    title: 'Morning Lecture: Philosophy',
    description: 'A great lecture',
    startDate: '2026-07-15T14:00:00',
    endDate: '2026-07-15T15:30:00',
    location: 'Amphitheater',
    createdAt: '2026-01-01T00:00:00',
    updatedAt: '2026-01-01T00:00:00',
    ...overrides,
  };
}

describe('generateICalendar', () => {
  it('uses default calendar name when none provided', () => {
    const ics = generateICalendar([makeEvent()]);
    expect(ics).toContain('X-WR-CALNAME:Chautauqua Institution Calendar');
  });

  it('uses custom calendar name when provided', () => {
    const ics = generateICalendar([makeEvent()], 'CHQ: Morning Lecture: Philosophy');
    expect(ics).toContain('X-WR-CALNAME:CHQ: Morning Lecture: Philosophy');
    expect(ics).not.toContain('X-WR-CALNAME:Chautauqua Institution Calendar');
  });

  it('keeps description constant regardless of calendar name', () => {
    const withName = generateICalendar([makeEvent()], 'CHQ: Test');
    const withoutName = generateICalendar([makeEvent()]);
    const descLine = 'X-WR-CALDESC:Dynamic calendar for Chautauqua Institution 2026 season';
    expect(withName).toContain(descLine);
    expect(withoutName).toContain(descLine);
  });

  it('defaults end to start + 1 hour when equal', () => {
    const ics = generateICalendar([makeEvent({
      startDate: '2026-07-15T14:00:00',
      endDate: '2026-07-15T14:00:00',
    })]);
    expect(ics).toContain('DTSTART:20260715T140000');
    expect(ics).toContain('DTEND:20260715T150000');
  });

  it('includes event summary and location', () => {
    const ics = generateICalendar([makeEvent()]);
    expect(ics).toContain('SUMMARY:Morning Lecture: Philosophy');
    expect(ics).toContain('LOCATION:Amphitheater');
  });
});
