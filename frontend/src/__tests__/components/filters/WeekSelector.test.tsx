/// <reference types="vitest/globals" />
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { WeekSelector } from '@/components/filters/WeekSelector';
import type { SeasonWeek } from '@/lib/types';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';

const seasonWeeks: SeasonWeek[] = Array.from({ length: 9 }, (_, i) => ({
  number: i + 1,
  start: new Date(`2026-06-${27 + i}T12:00:00Z`),
  end: new Date(`2026-07-${4 + i}T12:00:00Z`),
  label: `Week ${i + 1}`,
}));

const themes: Record<number, WeekTheme> = {
  1: { number: 1, title: 'Icons and Instigators', description: 'A description.', startDate: '2026-06-27', endDate: '2026-07-04' },
  3: { number: 3, title: 'The 2026 Election', description: '', startDate: '2026-07-11', endDate: '2026-07-18' },
};

function noops() {
  return {
    isDragging: false,
    isWeekHighlighted: () => false,
    onMouseDown: vi.fn(),
    onMouseEnter: vi.fn(),
    onMouseUp: vi.fn(),
    onTap: vi.fn(),
  };
}

describe('WeekSelector — weekly theme integration', () => {
  it('extends the title attribute with theme text and dates when a theme is loaded', () => {
    render(
      <WeekSelector
        seasonWeeks={seasonWeeks}
        selectedWeeks={[]}
        size="sm"
        themes={themes}
        {...noops()}
      />
    );
    const week1 = screen.getByRole('button', { name: /^Week 1\b/i });
    expect(week1.getAttribute('title')).toContain('Icons and Instigators');
  });

  it('keeps the bare label as title when no theme is loaded for that week', () => {
    render(
      <WeekSelector
        seasonWeeks={seasonWeeks}
        selectedWeeks={[]}
        size="sm"
        themes={themes}
        {...noops()}
      />
    );
    const week7 = screen.getByRole('button', { name: /^Week 7\b/i });
    expect(week7.getAttribute('title')).toBe('Week 7');
  });

  it('opens the popover on right-click and shows the theme title and dates', () => {
    render(
      <WeekSelector
        seasonWeeks={seasonWeeks}
        selectedWeeks={[]}
        size="sm"
        themes={themes}
        {...noops()}
      />
    );
    const week1 = screen.getByRole('button', { name: /^Week 1\b/i });
    fireEvent.contextMenu(week1);
    expect(screen.getByRole('dialog', { name: /Week 1 theme/i })).toBeInTheDocument();
    expect(screen.getByText('Icons and Instigators')).toBeInTheDocument();
  });

  it('does not open a popover on right-click for a week with no theme', () => {
    render(
      <WeekSelector
        seasonWeeks={seasonWeeks}
        selectedWeeks={[]}
        size="sm"
        themes={themes}
        {...noops()}
      />
    );
    const week7 = screen.getByRole('button', { name: /^Week 7\b/i });
    fireEvent.contextMenu(week7);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the popover when Escape is pressed', () => {
    render(
      <WeekSelector
        seasonWeeks={seasonWeeks}
        selectedWeeks={[]}
        size="sm"
        themes={themes}
        {...noops()}
      />
    );
    const week1 = screen.getByRole('button', { name: /^Week 1\b/i });
    fireEvent.contextMenu(week1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the popover on long-press (touch hold)', () => {
    vi.useFakeTimers();
    try {
      render(
        <WeekSelector
          seasonWeeks={seasonWeeks}
          selectedWeeks={[]}
          size="sm"
          themes={themes}
          {...noops()}
        />
      );
      const week1 = screen.getByRole('button', { name: /^Week 1\b/i });
      fireEvent.touchStart(week1);
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not crash and renders normally when no themes prop is provided', () => {
    render(
      <WeekSelector
        seasonWeeks={seasonWeeks}
        selectedWeeks={[]}
        size="sm"
        {...noops()}
      />
    );
    const week1 = screen.getByRole('button', { name: /^Week 1\b/i });
    expect(week1.getAttribute('title')).toBe('Week 1');
  });
});
