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
    renderLanding({ kind: 'pre-season', opening: opening(2026), daysUntil: 42, archiveYear: 2025 });
    expect(screen.getByRole('heading', { name: 'Almost showtime' })).toBeInTheDocument();
    expect(screen.getByText('42 days away')).toBeInTheDocument();
    // The countdown names the year that is about to open, not a next one.
    expect(screen.getByTestId('off-season-countdown').textContent)
      .toMatch(/^The 2026 season begins [A-Z][a-z]+ \d{1,2}$/);
  });

  // #186. This replaces an 'offers no buttons pre-season' test, which pinned
  // the dead end rather than a rule: a reader waiting for the next season was
  // shown a countdown and nothing else, with no way back to the season that
  // just ran. The archive button is now offered here too, and it names the
  // year `determineLandingState` found in the manifest — 2025 — never the
  // 2026 that is on screen.
  it('offers the archive season pre-season, naming the EARLIER year', () => {
    renderLanding({ kind: 'pre-season', opening: opening(2026), daysUntil: 42, archiveYear: 2025 });
    expect(screen.getByRole('button', { name: 'Browse the 2025 season' })).toBeInTheDocument();
    // The year on screen is 2026 and it must not be the year on the button.
    expect(screen.queryByRole('button', { name: 'Browse the 2026 season' })).not.toBeInTheDocument();
    // The preview button stays post-season-only: pre-season has no announced
    // year past the one already being counted down to.
    expect(screen.queryByRole('button', { name: /^Preview the/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Go to the/ })).not.toBeInTheDocument();
  });

  // `archiveYear: null` is what `determineLandingState` returns when the
  // manifest lists nothing below the selected year, and the button must then
  // be absent rather than labelled with a year whose feed does not exist.
  // Asserted as the total button count, because the surviving failure mode
  // here is a button rendered with a blank or NaN label, which no
  // name-matching query would find.
  it('offers no buttons pre-season when there is no earlier season to browse', () => {
    renderLanding({ kind: 'pre-season', opening: opening(2026), daysUntil: 42, archiveYear: null });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // The countdown itself is still there — this is a landing with no way
    // forward because there genuinely is none, not a blank screen.
    expect(screen.getByTestId('off-season-countdown')).toBeInTheDocument();
  });

  it('reports the archive year pre-season, not the year on screen', () => {
    const { onBrowseArchiveSeason } = renderLanding({
      kind: 'pre-season', opening: opening(2026), daysUntil: 42, archiveYear: 2025,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Browse the 2025 season' }));
    // The argument, not just the call: a handler invoked with 2026 would send
    // the reader to the season that has not started — the label/outcome
    // mismatch this whole payload exists to prevent.
    expect(onBrowseArchiveSeason).toHaveBeenCalledWith(2025);
  });

  // The bug this task exists to fix (#274 phase 4 task 10): an archived
  // year (e.g. 2025, picked from the header year menu mid-2026) has a
  // `nextSeasonYear` (2026) whose own season has already begun, so
  // `landingState.ts` now nulls its `opening`/`daysUntil` rather than
  // reporting a countdown that has already run negative. This asserts what
  // the reader should see instead: no countdown block, a heading that does
  // not promise a wait, and a button that reads as going to the season
  // rather than previewing one still ahead.
  it('for an archived year whose next season has already begun, shows no countdown and offers to go there', () => {
    renderLanding({
      kind: 'post-season',
      endedSeasonYear: 2025,
      nextSeasonYear: 2026,
      opening: null,
      daysUntil: null,
    });
    expect(screen.queryByTestId('off-season-countdown')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'The 2025 season has ended' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Go to the 2026 season' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Preview the/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse the 2025 season' })).toBeInTheDocument();
  });

  // Regression for #269: a season genuinely still ahead must keep the
  // original "See you next season" / "Preview the ..." copy — this is the
  // live post-season-wait path and must not be swept up by task 10's fix.
  it('still says "See you next season" and "Preview the ..." when the next season has not begun', () => {
    renderLanding(postSeason);
    expect(
      screen.getByRole('heading', { name: 'See you next season' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Preview the 2027 season' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('off-season-countdown')).toBeInTheDocument();
  });

  it('clicking "Go to the ..." reports the next year, same as "Preview the ..." does', () => {
    const { onPreviewNextSeason } = renderLanding({
      kind: 'post-season',
      endedSeasonYear: 2025,
      nextSeasonYear: 2026,
      opening: null,
      daysUntil: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Go to the 2026 season' }));
    expect(onPreviewNextSeason).toHaveBeenCalledWith(2026);
  });

  it('reports the next year to preview, and the ended year to browse', () => {
    const { onPreviewNextSeason, onBrowseArchiveSeason } = renderLanding(postSeason);

    fireEvent.click(screen.getByRole('button', { name: 'Preview the 2027 season' }));
    expect(onPreviewNextSeason).toHaveBeenCalledWith(2027);

    fireEvent.click(screen.getByRole('button', { name: 'Browse the 2026 season' }));
    // Post-season passes a year now too (#186) — `endedSeasonYear`, which is
    // already the selected one, so `page.tsx`'s year switch is a no-op here
    // and this arm behaves exactly as it did before.
    expect(onBrowseArchiveSeason).toHaveBeenCalledWith(2026);
  });
});
