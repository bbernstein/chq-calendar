/// <reference types="vitest/globals" />
import { render, screen, within, fireEvent, cleanup } from '@testing-library/preact';
import { EventCard, isChqOrgUrl } from '@/components/calendar/EventCard';
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

/** An event with a title and a time and nothing else worth expanding. */
const bareEvent: Event = {
  id: 'bare',
  title: 'Bare Event',
  startDate: '2026-07-15T14:00:00',
  endDate: '2026-07-15T15:00:00',
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

/** The disclosure control that the event name became. */
function titleButton(name: RegExp | string = /Interfaith Lecture/) {
  return screen.getByRole('button', { name });
}

describe('isChqOrgUrl', () => {
  it('accepts the bare apex host', () => {
    expect(isChqOrgUrl('https://chq.org')).toBe(true);
  });

  it('accepts a www URL with a path', () => {
    expect(isChqOrgUrl('https://www.chq.org/x')).toBe(true);
  });

  it('accepts any subdomain', () => {
    expect(isChqOrgUrl('https://tickets.chq.org/')).toBe(true);
  });

  it('rejects a host that merely ends in the same letters', () => {
    expect(isChqOrgUrl('https://notchq.org')).toBe(false);
  });

  it('rejects a look-alike host that only has chq.org as a prefix', () => {
    expect(isChqOrgUrl('https://chq.org.evil.com')).toBe(false);
  });

  it('rejects a malformed URL rather than throwing', () => {
    expect(isChqOrgUrl('garbage')).toBe(false);
  });
});

describe('EventCard title as the disclosure control', () => {
  it('clicking the event name toggles that event id', () => {
    const onToggleDescription = vi.fn();
    renderCard({ onToggleDescription });
    fireEvent.click(titleButton());
    expect(onToggleDescription).toHaveBeenCalledWith('e1');
  });

  it('the event name is a real <button>, so Enter and Space work without key handlers', () => {
    renderCard();
    const control = titleButton();
    expect(control.tagName).toBe('BUTTON');
    expect(control.getAttribute('type')).toBe('button');
  });

  it('the event name is not a link to event.url any more', () => {
    renderCard({ event: { ...baseEvent, url: 'https://www.chq.org/event/x' } });
    expect(screen.queryByRole('link', { name: /Interfaith Lecture/ })).toBeNull();
  });

  it('aria-expanded follows isExpanded and aria-controls names the rendered panel', () => {
    const { rerender } = renderCard();
    expect(titleButton().getAttribute('aria-expanded')).toBe('false');
    // Collapsed: the panel is unmounted, not merely hidden.
    const panelId = titleButton().getAttribute('aria-controls')!;
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId)).toBeNull();

    rerender(
      <EventCard
        event={baseEvent}
        index={0}
        isExpanded={true}
        onToggleDescription={vi.fn()}
        onToggleTag={vi.fn()}
        isTagSelected={() => false}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onDownloadICS={vi.fn()}
      />,
    );
    expect(titleButton().getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(panelId)).not.toBeNull();
  });

  it('there is no separate Show more / Show less control any more', () => {
    renderCard({ programLinks: PROGRAM_LINKS });
    expect(screen.queryByText(/Show more/)).toBeNull();
    cleanup();
    renderCard({ isExpanded: true });
    expect(screen.queryByText(/Show less/)).toBeNull();
  });

  it('the chevron is decorative and flips with the expanded state', () => {
    const { rerender } = renderCard();
    expect(within(titleButton()).getByText('▸').getAttribute('aria-hidden')).toBe('true');
    rerender(
      <EventCard
        event={baseEvent}
        index={0}
        isExpanded={true}
        onToggleDescription={vi.fn()}
        onToggleTag={vi.fn()}
        isTagSelected={() => false}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onDownloadICS={vi.fn()}
      />,
    );
    expect(within(titleButton()).getByText('▾')).toBeTruthy();
  });
});

describe('EventCard title with nothing to expand', () => {
  it('renders the name as plain text, not a button, when the event has no expandable content', () => {
    renderCard({ event: bareEvent });
    expect(screen.queryByRole('button', { name: /Bare Event/ })).toBeNull();
    expect(screen.getByText('Bare Event')).toBeTruthy();
  });

  it('renders no chevron when the event has no expandable content', () => {
    renderCard({ event: bareEvent });
    expect(screen.queryByText('▸')).toBeNull();
    expect(screen.queryByText('▾')).toBeNull();
  });

  it('a url alone makes the name expandable', () => {
    renderCard({ event: { ...bareEvent, url: 'https://www.chq.org/event/x' } });
    expect(screen.getByRole('button', { name: /Bare Event/ })).toBeTruthy();
  });

  it('non-week categories alone make the name expandable, but Week N alone does not', () => {
    const weekOnly = { ...bareEvent, categories: [{ name: 'Week 5' }] };
    renderCard({ event: weekOnly });
    expect(screen.queryByRole('button', { name: /Bare Event/ })).toBeNull();

    cleanup();
    renderCard({ event: { ...bareEvent, categories: [{ name: 'Week 5' }, { name: 'Lecture' }] } });
    expect(screen.getByRole('button', { name: /Bare Event/ })).toBeTruthy();
  });
});

describe('EventCard "Open on chq.org" link inside the panel', () => {
  it('labels a chq.org URL "Open on chq.org"', () => {
    renderCard({ event: { ...baseEvent, url: 'https://www.chq.org/event/x' }, isExpanded: true });
    const link = screen.getByRole('link', { name: /Open on chq\.org/ }) as HTMLAnchorElement;
    expect(link.href).toBe('https://www.chq.org/event/x');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');
  });

  it('labels a publisher URL "Open event page"', () => {
    renderCard({
      event: {
        ...baseEvent,
        url: 'https://example-publisher.org/events/42',
        sourcePublisherId: 'p1',
        sourcePublisherName: 'Example Publisher',
      },
      isExpanded: true,
    });
    expect(screen.getByRole('link', { name: /Open event page/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open on chq\.org/ })).toBeNull();
  });

  it('renders no such link when the event has no url', () => {
    renderCard({ isExpanded: true });
    expect(screen.queryByRole('link', { name: /Open on chq\.org/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Open event page/ })).toBeNull();
  });

  it('renders the link only when expanded', () => {
    renderCard({ event: { ...baseEvent, url: 'https://www.chq.org/event/x' } });
    expect(screen.queryByRole('link', { name: /Open on chq\.org/ })).toBeNull();
  });

  it('a cancelled event keeps the panel openable and keeps the chq.org link', () => {
    renderCard({
      event: { ...baseEvent, url: 'https://www.chq.org/event/x', status: 'cancelled' },
      isExpanded: true,
    });
    expect(screen.getByRole('button', { name: /Interfaith Lecture/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open on chq\.org/ })).toBeTruthy();
  });

  it('places the link last, after the Chautauquan Daily section', () => {
    renderCard({
      event: { ...baseEvent, url: 'https://www.chq.org/event/x' },
      programLinks: PROGRAM_LINKS,
      articleLinks: ARTICLE_LINKS,
      isExpanded: true,
    });
    const daily = screen.getByText('In the Chautauquan Daily');
    const link = screen.getByRole('link', { name: /Open on chq\.org/ });
    expect(daily.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('EventCard hint glyphs on the title line', () => {
  it('renders 📖 and 📰 inside the title control, not as separate focusable controls', () => {
    renderCard({ programLinks: PROGRAM_LINKS, articleLinks: ARTICLE_LINKS });
    const control = titleButton();
    const program = within(control).getByTitle('Digital program');
    const daily = within(control).getByTitle('Chautauquan Daily coverage');
    expect(program.tagName).toBe('SPAN');
    expect(daily.tagName).toBe('SPAN');
    expect(program.getAttribute('tabindex')).toBeNull();
    expect(daily.getAttribute('tabindex')).toBeNull();
    // Exactly one focusable control carries the title.
    expect(screen.queryAllByRole('button', { name: /Interfaith Lecture/ })).toHaveLength(1);
  });

  it('keeps the glyphs on the title line when expanded', () => {
    renderCard({ programLinks: PROGRAM_LINKS, articleLinks: ARTICLE_LINKS, isExpanded: true });
    const control = titleButton();
    expect(within(control).getByTitle('Digital program')).toBeTruthy();
    expect(within(control).getByTitle('Chautauquan Daily coverage')).toBeTruthy();
  });
});

/**
 * The panel body — description paragraphs and category chips — is the largest
 * mechanical part of #244: ~40 lines lifted out of the old collapsed/expanded
 * ternary into the new panel. Nothing else in this file looks at it, so
 * deleting either block wholesale would otherwise leave the suite green.
 */
describe('EventCard expanded panel body', () => {
  const CATEGORIED: Event = {
    ...baseEvent,
    description: 'First paragraph.\nSecond paragraph.',
    categories: [
      { name: 'Week 5' },
      { name: 'Lecture' },
      { name: 'Chautauqua Institution Program' },
    ],
  };

  it('renders the description text inside the open panel', () => {
    renderCard({ isExpanded: true });
    const panel = document.getElementById(titleButton().getAttribute('aria-controls')!)!;
    expect(within(panel).getByText('A talk about peace.')).toBeTruthy();
  });

  it('splits the description on newlines into separate paragraphs', () => {
    renderCard({ event: CATEGORIED, isExpanded: true });
    const panel = document.getElementById(titleButton().getAttribute('aria-controls')!)!;
    const paragraphs = Array.from(panel.querySelectorAll('p')).map(p => p.textContent);
    expect(paragraphs).toEqual(['First paragraph.', 'Second paragraph.']);
  });

  it('renders no description text when the event has none', () => {
    renderCard({
      event: { ...bareEvent, url: 'https://www.chq.org/event/x' },
      isExpanded: true,
    });
    const panel = document.getElementById(titleButton(/Bare Event/).getAttribute('aria-controls')!)!;
    expect(panel.querySelectorAll('p')).toHaveLength(0);
  });

  it('renders a category chip for each non-week category, under its display name', () => {
    renderCard({ event: CATEGORIED, isExpanded: true });
    const panel = document.getElementById(titleButton().getAttribute('aria-controls')!)!;
    expect(within(panel).getByRole('button', { name: 'Lecture' })).toBeTruthy();
    // "Chautauqua Institution Program" is shortened by getCategoryDisplayName.
    expect(within(panel).getByRole('button', { name: 'CHQ Program' })).toBeTruthy();
  });

  it('does not render a chip for a Week N category', () => {
    renderCard({ event: CATEGORIED, isExpanded: true });
    const panel = document.getElementById(titleButton().getAttribute('aria-controls')!)!;
    expect(within(panel).queryByRole('button', { name: 'Week 5' })).toBeNull();
  });

  it('clicking a category chip calls onToggleTag with the raw category name', () => {
    const onToggleTag = vi.fn();
    renderCard({ event: CATEGORIED, isExpanded: true, onToggleTag });
    const panel = document.getElementById(titleButton().getAttribute('aria-controls')!)!;
    fireEvent.click(within(panel).getByRole('button', { name: 'CHQ Program' }));
    // The raw name, not the shortened label — it is what the filter matches on.
    expect(onToggleTag).toHaveBeenCalledWith('Chautauqua Institution Program');
  });

  it('marks a selected category chip and leaves the others unselected', () => {
    renderCard({
      event: CATEGORIED,
      isExpanded: true,
      isTagSelected: (tag: string) => tag === 'Lecture',
    });
    const panel = document.getElementById(titleButton().getAttribute('aria-controls')!)!;
    expect(within(panel).getByRole('button', { name: 'Lecture' }).className).toMatch(/bg-blue-600/);
    expect(within(panel).getByRole('button', { name: 'CHQ Program' }).className).not.toMatch(/bg-blue-600/);
  });

  it('renders description before categories in document order', () => {
    renderCard({ event: CATEGORIED, isExpanded: true });
    const panel = document.getElementById(titleButton().getAttribute('aria-controls')!)!;
    const firstParagraph = within(panel).getByText('First paragraph.');
    const chip = within(panel).getByRole('button', { name: 'Lecture' });
    expect(firstParagraph.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/**
 * Two defects Copilot caught on PR #264, both introduced by #244 itself.
 */
describe('EventCard panel layout regressions (#264 review)', () => {
  /** The chips live in the panel's only `flex flex-wrap` container. */
  const chipContainers = (panel: HTMLElement) => panel.querySelectorAll('div.flex.flex-wrap');

  it('renders no empty category container when the panel has only a url', () => {
    // Before #244 a url alone never opened a panel, so an always-rendered
    // category div cost nothing. Now it does: this panel holds the link only,
    // and an empty `mb-2` container above it is a visible gap.
    renderCard({ event: { ...bareEvent, url: 'https://www.chq.org/event/x' }, isExpanded: true });
    const panel = document.getElementById(titleButton(/Bare Event/).getAttribute('aria-controls')!)!;
    expect(chipContainers(panel)).toHaveLength(0);
  });

  it('renders no empty category container when the event has only Week N categories', () => {
    renderCard({
      event: { ...bareEvent, url: 'https://www.chq.org/event/x', categories: [{ name: 'Week 5' }] },
      isExpanded: true,
    });
    const panel = document.getElementById(titleButton(/Bare Event/).getAttribute('aria-controls')!)!;
    expect(chipContainers(panel)).toHaveLength(0);
  });

  it('still renders the container when there is at least one non-week category', () => {
    renderCard({ event: { ...baseEvent, categories: [{ name: 'Lecture' }] }, isExpanded: true });
    const panel = document.getElementById(titleButton().getAttribute('aria-controls')!)!;
    expect(chipContainers(panel)).toHaveLength(1);
    expect(within(panel).getByRole('button', { name: 'Lecture' })).toBeTruthy();
  });

  it('does not turn a cancelled title blue on hover', () => {
    // The <h4> greys and strikes through a cancelled event; a blue hover on the
    // button inside it overrides that treatment on the way past.
    renderCard({
      event: { ...baseEvent, url: 'https://www.chq.org/event/x', status: 'cancelled' },
    });
    const control = titleButton();
    expect(control.className).not.toMatch(/hover:text-blue/);
    // The cancelled treatment itself is untouched, and still lives on the <h4>.
    expect(control.closest('h4')!.className).toMatch(/line-through/);
    expect(control.closest('h4')!.className).toMatch(/text-gray-500/);
  });

  it('keeps the blue hover on a title that is not cancelled', () => {
    renderCard({ event: { ...baseEvent, url: 'https://www.chq.org/event/x' } });
    expect(titleButton().className).toMatch(/hover:text-blue-700/);
  });
});
