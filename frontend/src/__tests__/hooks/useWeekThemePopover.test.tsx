import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';
import { useWeekThemePopover } from '@/hooks/useWeekThemePopover';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { LONG_PRESS_MS } from '@/lib/constants';

const themes: Record<number, WeekTheme> = {
  2: {
    number: 2, title: 'A Life of Literature', description: 'Books.',
    startDate: '2026-07-04', endDate: '2026-07-10',
  },
};

/** The smallest thing that can host the hook: two week cells. */
function Host({ onActivate = vi.fn(), withThemes = true }) {
  const popover = useWeekThemePopover({
    themes: withThemes ? themes : undefined, onActivate,
  });
  return (
    <div>
      {[1, 2].map(week => (
        <button
          key={week}
          type="button"
          data-week={week}
          ref={el => popover.registerAnchor(week, el)}
          {...popover.handlers(week)}
        >
          {week}
        </button>
      ))}
      <span data-open={popover.isOpen ? 'true' : 'false'} />
      {popover.portal}
    </div>
  );
}

const cell = (week: number) => document.querySelector<HTMLElement>(`[data-week="${week}"]`)!;
const isOpen = () => document.querySelector('[data-open]')!.getAttribute('data-open');

describe('useWeekThemePopover', () => {
  it('opens a themed week on right-click and does not open the browser menu', () => {
    render(<Host />);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { cell(2).dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Week 2 theme' })).toBeTruthy();
    expect(isOpen()).toBe('true');
  });

  it("leaves an unthemed week's context menu alone", () => {
    // The season's themes file can be missing a week, or missing entirely.
    // Suppressing the browser menu for a popover that will never open takes
    // something away and gives nothing back.
    render(<Host />);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { cell(1).dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on Shift+F10, the keyboard equivalent of right-click', () => {
    render(<Host />);
    fireEvent.keyDown(cell(2), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Week 2 theme' })).toBeTruthy();
  });

  it('opens on a long press and does not then activate the week', () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    render(<Host onActivate={onActivate} />);
    fireEvent.touchStart(cell(2));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 10); });
    fireEvent.touchEnd(cell(2));
    expect(screen.getByRole('dialog', { name: 'Week 2 theme' })).toBeTruthy();
    expect(onActivate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('activates on a short tap of a themed week', () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    render(<Host onActivate={onActivate} />);
    fireEvent.touchStart(cell(2));
    act(() => { vi.advanceTimersByTime(50); });
    fireEvent.touchEnd(cell(2));
    expect(onActivate).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.useRealTimers();
  });

  it('activates an unthemed week on touchstart, with nothing to wait for', () => {
    const onActivate = vi.fn();
    render(<Host onActivate={onActivate} />);
    fireEvent.touchStart(cell(1));
    expect(onActivate).toHaveBeenCalledWith(1);
  });

  it('cancels a pending long press when the finger moves', () => {
    vi.useFakeTimers();
    render(<Host />);
    fireEvent.touchStart(cell(2));
    fireEvent.touchMove(cell(2));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 10); });
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.useRealTimers();
  });

  it('reports closed before anything opens, so a caller can defer to it', () => {
    // `WeekGrid` reads `isOpen` to decide whether Escape belongs to the theme
    // popover or to the grid. A hook that always reported open would make the
    // grid undismissable.
    render(<Host />);
    expect(isOpen()).toBe('false');
  });
});
