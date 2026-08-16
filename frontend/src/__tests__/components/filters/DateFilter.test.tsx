import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { DateFilter } from '@/components/filters/DateFilter';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';

const seasonWeeks = getChautauquaSeasonWeeks(2026);

const weekDrag = {
  isDragging: false,
  handleWeekMouseDown: vi.fn(),
  handleWeekMouseEnter: vi.fn(),
  handleWeekMouseUp: vi.fn(),
  handleWeekTap: vi.fn(),
};

function renderFilter(overrides: Partial<Parameters<typeof DateFilter>[0]> = {}) {
  const setDateFilter = vi.fn();
  const setSelectedWeeks = vi.fn();
  render(
    <DateFilter
      dateFilter="next" setDateFilter={setDateFilter}
      selectedWeeks={[]} setSelectedWeeks={setSelectedWeeks}
      seasonWeeks={seasonWeeks}
      weekDrag={weekDrag}
      isWeekHighlighted={(_n, s) => s}
      showFavoritesOnly={false} onToggleFavoritesOnly={vi.fn()} favoriteCount={0}
      isCurrentYear
      {...overrides}
    />
  );
  return { setDateFilter, setSelectedWeeks };
}

describe('DateFilter scope buttons', () => {
  it('offers exactly the four converged scopes in the current year', () => {
    renderFilter();
    for (const label of ['Now', 'Today', 'All Season', 'All Year']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('no longer offers a This Week button', () => {
    renderFilter();
    expect(screen.queryByRole('button', { name: 'This Week' })).toBeNull();
  });

  it('hides only the time-relative scopes on an archived year', () => {
    renderFilter({ isCurrentYear: false, dateFilter: 'all' });
    expect(screen.queryByRole('button', { name: 'Now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
    // Season and All Year are absolute — they mean the same thing in 2019 as
    // they do this week, so hiding them would strand an archived season with
    // no scope control at all.
    expect(screen.getByRole('button', { name: 'All Season' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All Year' })).toBeTruthy();
  });

  it('selecting a scope clears any selected weeks', () => {
    const { setDateFilter, setSelectedWeeks } = renderFilter({ dateFilter: 'all', selectedWeeks: [4] });
    fireEvent.click(screen.getByRole('button', { name: 'All Season' }));
    expect(setDateFilter).toHaveBeenCalledWith('season');
    expect(setSelectedWeeks).toHaveBeenCalledWith([]);
  });

  it('re-pressing the active scope returns to All Year rather than doing nothing', () => {
    const { setDateFilter } = renderFilter({ dateFilter: 'today' });
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(setDateFilter).toHaveBeenCalledWith('all');
  });

  it('marks All Year active when no scope and no weeks are set', () => {
    renderFilter({ dateFilter: 'all', selectedWeeks: [] });
    expect(screen.getByRole('button', { name: 'All Year' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not mark All Year active while weeks are selected', () => {
    renderFilter({ dateFilter: 'all', selectedWeeks: [4] });
    expect(screen.getByRole('button', { name: 'All Year' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('no longer renders the static Selected: line', () => {
    renderFilter({ dateFilter: 'today' });
    expect(screen.queryByText(/^Selected:/)).toBeNull();
  });
});
