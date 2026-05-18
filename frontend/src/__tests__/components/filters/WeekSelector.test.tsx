/// <reference types="vitest/globals" />
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { WeekSelector } from '@/components/filters/WeekSelector';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';

const seasonWeeks = getChautauquaSeasonWeeks(2026);

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
    expect(week7.getAttribute('title')).toBe(seasonWeeks[6].label);
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

  it('does not invoke the selection handlers when a non-primary mouse button is pressed', () => {
    const handlers = {
      ...noops(),
      onMouseDown: vi.fn(),
      onMouseUp: vi.fn(),
    };
    render(
      <WeekSelector
        seasonWeeks={seasonWeeks}
        selectedWeeks={[]}
        size="sm"
        themes={themes}
        {...handlers}
      />
    );
    const week1 = screen.getByRole('button', { name: /^Week 1\b/i });
    fireEvent.mouseDown(week1, { button: 2 }); // right-click
    fireEvent.mouseUp(week1, { button: 2 });
    expect(handlers.onMouseDown).not.toHaveBeenCalled();
    expect(handlers.onMouseUp).not.toHaveBeenCalled();
  });

  it('opens the popover when Shift+F10 is pressed on a themed week', () => {
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
    fireEvent.keyDown(week1, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('dialog', { name: /Week 1 theme/i })).toBeInTheDocument();
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
    expect(week1.getAttribute('title')).toBe(seasonWeeks[0].label);
  });
});
