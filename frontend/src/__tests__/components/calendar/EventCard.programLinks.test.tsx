/// <reference types="vitest/globals" />
import { render, screen, within } from '@testing-library/preact';
import { EventCard } from '@/components/calendar/EventCard';
import type { Event } from '@/lib/types';
import type { ArticleLink } from '@/hooks/useArticleLinks';
import type { ProgramLink } from '@/hooks/useProgramLinks';

const baseEvent: Event = {
  id: 'e1',
  title: 'Interfaith Lecture',
  description: 'A talk about peace.',
  startDate: '2026-07-15T14:00:00',
  endDate: '2026-07-15T15:00:00',
  location: 'Hall of Philosophy',
};

const PROGRAM_LINKS: ProgramLink[] = [
  { title: 'Best for Baby: Digital Program', url: 'https://audienceaccess.co/best-for-baby/' },
];

const ARTICLE_LINKS: ArticleLink[] = [
  { title: 'Syeed to speak today', url: 'https://chqdaily.com/preview/', kind: 'preview', pubDate: '2026-07-13' },
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

describe('EventCard program links', () => {
  it('expanded card renders a "Digital Program" heading and a new-tab link with the title', () => {
    renderCard({ programLinks: PROGRAM_LINKS, isExpanded: true });
    expect(screen.getByText('Digital Program')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Best for Baby: Digital Program/ }) as HTMLAnchorElement;
    expect(link.href).toBe('https://audienceaccess.co/best-for-baby/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');
  });

  it('collapsed card shows the 📖 badge inside the title control', () => {
    renderCard({ programLinks: PROGRAM_LINKS });
    const title = screen.getByRole('button', { name: /Interfaith Lecture/ });
    expect(within(title).getByTitle('Digital program')).toBeTruthy();
  });

  it('event with no description, categories, or articleLinks but WITH programLinks still gets an expandable title', () => {
    renderCard({
      event: { ...baseEvent, description: undefined, categories: undefined },
      programLinks: PROGRAM_LINKS,
    });
    expect(screen.getByRole('button', { name: /Interfaith Lecture/ })).toBeTruthy();
  });

  it('expanded card with both programLinks and articleLinks renders "Digital Program" before "In the Chautauquan Daily" in document order', () => {
    renderCard({ programLinks: PROGRAM_LINKS, articleLinks: ARTICLE_LINKS, isExpanded: true });
    const programHeading = screen.getByText('Digital Program');
    const articleHeading = screen.getByText('In the Chautauquan Daily');
    expect(
      programHeading.compareDocumentPosition(articleHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('card without programLinks renders neither the heading nor the 📖 badge', () => {
    renderCard({ isExpanded: true });
    expect(screen.queryByText('Digital Program')).toBeNull();
    expect(screen.queryByTitle('Digital program')).toBeNull();
  });
});
