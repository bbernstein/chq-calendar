import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { DayRail } from '@/components/calendar/DayRail';
import { dayChips } from '@/lib/utils/dayWindow';

const chips = dayChips(
  ['2026-07-04', '2026-07-05', '2026-07-06'],
  new Map([['2026-07-04', 12], ['2026-07-05', 1]]),
);

function renderRail(overrides: Partial<Parameters<typeof DayRail>[0]> = {}) {
  const props = {
    chips, anchorDay: '2026-07-05', todayKey: '2026-07-05',
    onSelectDay: vi.fn(), onStepDay: vi.fn(), onGoToToday: vi.fn(),
    ...overrides,
  };
  render(<DayRail {...props} />);
  return props;
}

describe('DayRail', () => {
  // role="group" with an aria-label, NOT role="menu" (a menu of navigation
  // targets is not a menu) and not a bare div with an aria-label (which
  // assistive technology drops). Both lessons are already recorded from
  // PR #228/#219.
  it('is a labelled group, not a menu', () => {
    renderRail();
    const rail = screen.getByRole('group', { name: /days/i });
    expect(rail).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('labels each chip by its target and event count', () => {
    renderRail();
    expect(screen.getByRole('button', { name: 'Go to Saturday, July 4, 12 events' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Monday, July 6, no events' })).toBeTruthy();
  });

  it('marks the anchor day as current', () => {
    renderRail();
    expect(screen.getByRole('button', { name: /July 5/ }).getAttribute('aria-current')).toBe('date');
    expect(screen.getByRole('button', { name: /July 4/ }).getAttribute('aria-current')).toBeNull();
  });

  it('reports the tapped day', () => {
    const { onSelectDay } = renderRail();
    fireEvent.click(screen.getByRole('button', { name: /July 6/ }));
    expect(onSelectDay).toHaveBeenCalledWith('2026-07-06');
  });

  it('steps one calendar day from the chevrons', () => {
    const { onStepDay } = renderRail();
    fireEvent.click(screen.getByRole('button', { name: 'Go to the previous day' }));
    expect(onStepDay).toHaveBeenCalledWith(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Go to the next day' }));
    expect(onStepDay).toHaveBeenCalledWith(1);
  });

  it('disables the chevrons at the ends of the navigable range', () => {
    renderRail({ anchorDay: '2026-07-04' });
    expect(screen.getByRole('button', { name: 'Go to the previous day' })
      .hasAttribute('disabled')).toBe(true);
    renderRail({ anchorDay: '2026-07-06' });
    const forward = screen.getAllByRole('button', { name: 'Go to the next day' }).pop()!;
    expect(forward.hasAttribute('disabled')).toBe(true);
  });

  it('offers ⟳ Now while the anchor is not today', () => {
    const { onGoToToday } = renderRail({ anchorDay: '2026-07-04', todayKey: '2026-07-05' });
    fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(onGoToToday).toHaveBeenCalled();
  });

  it('hides ⟳ Now once the anchor is already today', () => {
    renderRail({ anchorDay: '2026-07-05', todayKey: '2026-07-05' });
    expect(screen.queryByRole('button', { name: 'Go to today' })).toBeNull();
  });

  it('hides ⟳ Now entirely on an archived year', () => {
    renderRail({ anchorDay: '2026-07-04', todayKey: null });
    expect(screen.queryByRole('button', { name: 'Go to today' })).toBeNull();
  });

  it('moves focus along the rail with the arrow keys', () => {
    renderRail();
    const first = screen.getByRole('button', { name: /July 4/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 5');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 4');
  });

  it('jumps focus to today with Home', () => {
    renderRail({ todayKey: '2026-07-05' });
    const first = screen.getByRole('button', { name: /July 4/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'Home' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 5');
  });

  it('renders nothing when there are no days to show', () => {
    const { container } = render(
      <DayRail chips={[]} anchorDay={null} todayKey={null}
        onSelectDay={vi.fn()} onStepDay={vi.fn()} onGoToToday={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });
});
