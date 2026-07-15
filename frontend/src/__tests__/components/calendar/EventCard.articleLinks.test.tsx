/// <reference types="vitest/globals" />
import { render, screen, within } from '@testing-library/preact';
import { EventCard } from '@/components/calendar/EventCard';
import type { Event } from '@/lib/types';
import type { ArticleLink } from '@/hooks/useArticleLinks';

const baseEvent: Event = {
  id: 'e1',
  title: 'Interfaith Lecture',
  description: 'A talk about peace.',
  startDate: '2026-07-15T14:00:00',
  endDate: '2026-07-15T15:00:00',
  location: 'Hall of Philosophy',
};

const LINKS: ArticleLink[] = [
  { title: 'Syeed to speak today', url: 'https://chqdaily.com/preview/', kind: 'preview', pubDate: '2026-07-15' },
  { title: 'Syeed spoke on peace', url: 'https://chqdaily.com/recap/', kind: 'recap', pubDate: '2026-07-16' },
];

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

describe('EventCard article links', () => {
  it('renders no newspaper affordance when there are no links', () => {
    renderCard();
    expect(screen.queryByTitle('Chautauquan Daily coverage')).toBeNull();
    expect(screen.queryByText('In the Chautauquan Daily')).toBeNull();
  });

  it('collapsed card shows the hint glyph inside the Show more control, not the titled links', () => {
    renderCard({ articleLinks: LINKS });
    // The glyph now sits inside the "Show more" disclosure control, signalling
    // that expanding reveals the articles (not up in the time/location line).
    const showMore = screen.getByRole('button', { name: /Show more/ });
    expect(within(showMore).getByTitle('Chautauquan Daily coverage')).toBeTruthy();
    expect(screen.queryByText('In the Chautauquan Daily')).toBeNull();
  });

  it('expanded card lists each article as a new-tab link with kind label', () => {
    renderCard({ articleLinks: LINKS, isExpanded: true });
    expect(screen.getByText('In the Chautauquan Daily')).toBeTruthy();
    const preview = screen.getByRole('link', { name: /Syeed to speak today/ }) as HTMLAnchorElement;
    expect(preview.href).toBe('https://chqdaily.com/preview/');
    expect(preview.target).toBe('_blank');
    expect(preview.rel).toContain('noopener');
    expect(screen.getByText('(recap)')).toBeTruthy();
    expect(screen.getByText('(preview)')).toBeTruthy();
  });

  it('event with article links but no description still gets the disclosure widget', () => {
    renderCard({
      event: { ...baseEvent, description: undefined, categories: undefined },
      articleLinks: LINKS,
    });
    expect(screen.getByText(/Show more/)).toBeTruthy();
  });
});
