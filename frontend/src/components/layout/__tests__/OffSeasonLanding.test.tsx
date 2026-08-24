import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { OffSeasonLanding } from '../OffSeasonLanding';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import type { LandingState } from '@/lib/utils/landingState';

const opening = (year: number) => getChautauquaSeasonWeeks(year)[0].start;

const postSeason: LandingState = {
  kind: 'post-season',
  endedSeasonYear: 2026,
  nextSeasonYear: 2027,
  opening: opening(2027),
  daysUntil: 285,
};

function renderLanding(state: LandingState) {
  const onPreviewNextSeason = vi.fn();
  const onBrowseArchiveSeason = vi.fn();
  render(
    <OffSeasonLanding
      state={state}
      onPreviewNextSeason={onPreviewNextSeason}
      onBrowseArchiveSeason={onBrowseArchiveSeason}
    />
  );
  return { onPreviewNextSeason, onBrowseArchiveSeason };
}

describe('OffSeasonLanding', () => {
  it('renders nothing for in-season', () => {
    const { container } = render(
      <OffSeasonLanding
        state={{ kind: 'in-season' }}
        onPreviewNextSeason={vi.fn()}
        onBrowseArchiveSeason={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('names the post-season case and offers both ways forward', () => {
    renderLanding(postSeason);
    expect(screen.getByTestId('off-season-landing')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'See you next season' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview the 2027 season' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse the 2026 season' })).toBeInTheDocument();
  });

  it('states when the next season opens and how far off it is', () => {
    renderLanding(postSeason);
    // Read via textContent, not getByText: the line interpolates twice and
    // renders as three text nodes, which getByText will not match across.
    // "June 26" for 2027 — the Saturday before the 4th Sunday of June.
    expect(screen.getByTestId('off-season-countdown').textContent)
      .toMatch(/^The 2027 season begins [A-Z][a-z]+ \d{1,2}$/);
    expect(screen.getByText('285 days away')).toBeInTheDocument();
  });

  it('says "1 day away", not "1 days away"', () => {
    renderLanding({ ...postSeason, daysUntil: 1 });
    expect(screen.getByText('1 day away')).toBeInTheDocument();
  });

  it('omits the countdown and the preview button when no next year is announced', () => {
    renderLanding({
      kind: 'post-season',
      endedSeasonYear: 2026,
      nextSeasonYear: null,
      opening: null,
      daysUntil: null,
    });
    expect(screen.queryByTestId('off-season-countdown')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Preview the/ })).not.toBeInTheDocument();
    // The archive is still reachable — that is the whole point of the screen.
    expect(screen.getByRole('button', { name: 'Browse the 2026 season' })).toBeInTheDocument();
  });

  it('names the pre-season case and counts down to this year opening', () => {
    renderLanding({ kind: 'pre-season', opening: opening(2026), daysUntil: 42 });
    expect(screen.getByRole('heading', { name: 'Almost showtime' })).toBeInTheDocument();
    expect(screen.getByText('42 days away')).toBeInTheDocument();
    // The countdown names the year that is about to open, not a next one.
    expect(screen.getByTestId('off-season-countdown').textContent)
      .toMatch(/^The 2026 season begins [A-Z][a-z]+ \d{1,2}$/);
  });

  it('offers no buttons pre-season', () => {
    renderLanding({ kind: 'pre-season', opening: opening(2026), daysUntil: 42 });
    // Deliberate: there is no year-aware "browse a past season" action, so a
    // button labelled with last year would apply the scope to THIS year.
    // Mirrors LandingState.archiveYear === nil for .preSeason on iOS.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('reports the next year to preview, and asks for the archive without a year', () => {
    const { onPreviewNextSeason, onBrowseArchiveSeason } = renderLanding(postSeason);

    fireEvent.click(screen.getByRole('button', { name: 'Preview the 2027 season' }));
    expect(onPreviewNextSeason).toHaveBeenCalledWith(2027);

    fireEvent.click(screen.getByRole('button', { name: 'Browse the 2026 season' }));
    expect(onBrowseArchiveSeason).toHaveBeenCalledTimes(1);
  });
});
