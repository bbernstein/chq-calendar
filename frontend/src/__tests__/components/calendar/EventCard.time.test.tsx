/// <reference types="vitest/globals" />
import { render, screen } from '@testing-library/preact';
import { EventCard } from '@/components/calendar/EventCard';
import type { Event } from '@/lib/types';

const baseEvent: Event = {
  id: 'e1',
  title: 'Interfaith Lecture',
  description: 'A talk about peace.',
  startDate: '2026-07-15T14:00:00',
  endDate: '2026-07-15T15:00:00',
  location: 'Hall of Philosophy',
};

function renderCard(overrides: Partial<Parameters<typeof EventCard>[0]> = {}) {
  return render(
    <EventCard
      event={baseEvent}
      index={0}
      isExpanded={false}
      onToggleDescription={vi.fn()}
      onToggleTag={vi.fn()}
      isTagSelected={() => false}
      isFavorite={false}
      onToggleFavorite={vi.fn()}
      onDownloadICS={vi.fn()}
      {...overrides}
    />,
  );
}

// The pinned test TZ (America/New_York, see vitest.config.ts) makes device
// time and Institution time coincide, so this cannot by itself distinguish
// Institution-anchored formatting from the device-local code it replaced.
// It stands as a regression pin, not proof of the timezone fix.
describe('event time display', () => {
  it('shows the Institution wall time, unlabelled', () => {
    // 23:00Z is 7:00 PM EDT.
    renderCard({ event: { ...baseEvent, startDate: '2026-07-27 19:00:00' } });
    expect(screen.getByText(/7:00 PM/)).toBeTruthy();
    expect(screen.queryByText(/ET|EDT|EST/)).toBeNull();
  });
});
