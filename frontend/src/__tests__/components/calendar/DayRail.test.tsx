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

// The day chip that carries `key`. Queried by `data-chip` rather than by
// accessible name: once the chevrons are labelled by target too, an
// adjacent-to-anchor day's own chip and the chevron pointing at it share the
// exact same accessible name, so a name-only query is ambiguous by design.
function chipButton(key: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-chip="${key}"]`)!;
}

// A chevron (not a day chip) with the given accessible name. Chevrons carry
// no `data-chip`, which is what distinguishes them from a same-named day
// chip when the chevron's target is adjacent to the anchor.
function chevronNamed(name: string): HTMLElement | undefined {
  return screen.queryAllByRole('button', { name }).find((btn) => !btn.hasAttribute('data-chip'));
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
    expect(chipButton('2026-07-04').getAttribute('aria-label')).toBe('Go to Saturday, July 4, 12 events');
    expect(chipButton('2026-07-06').getAttribute('aria-label')).toBe('Go to Monday, July 6, no events');
  });

  it('marks the anchor day as current', () => {
    renderRail();
    expect(chipButton('2026-07-05').getAttribute('aria-current')).toBe('date');
    expect(chipButton('2026-07-04').getAttribute('aria-current')).toBeNull();
  });

  it('reports the tapped day', () => {
    const { onSelectDay } = renderRail();
    fireEvent.click(chipButton('2026-07-06'));
    expect(onSelectDay).toHaveBeenCalledWith('2026-07-06');
  });

  // Chevrons are labelled by their target, not by direction — same rule as
  // the day chips (see DayRail's accessibility doc comment). At the default
  // anchor (July 5, the middle chip) the previous chevron's target is July 4
  // and the next chevron's target is July 6, so the chevrons are found here
  // by the adjacent chip's own label, filtered to exclude the day chip
  // itself via `chevronNamed`.
  it('steps one calendar day from the chevrons', () => {
    const { onStepDay } = renderRail();
    fireEvent.click(chevronNamed('Go to Saturday, July 4, 12 events')!);
    expect(onStepDay).toHaveBeenCalledWith(-1);
    fireEvent.click(chevronNamed('Go to Monday, July 6, no events')!);
    expect(onStepDay).toHaveBeenCalledWith(1);
  });

  // Proves the chevron label is derived from the *current* anchor position,
  // not a fixed chip: moving the anchor from July 5 to July 6 must move the
  // previous chevron's target from July 4 to July 5. An implementation that
  // always named the chevron after a fixed chip (e.g. always chips[0]) would
  // fail the second half — no un-labelled-as-a-chip button would carry
  // July 5's label once the anchor is on July 6.
  it('names the chevrons after the adjacent day, not a fixed direction', () => {
    renderRail({ anchorDay: '2026-07-05' });
    expect(chevronNamed('Go to Saturday, July 4, 12 events')).toBeTruthy();

    renderRail({ anchorDay: '2026-07-06' });
    expect(chevronNamed('Go to Sunday, July 5, 1 event')).toBeTruthy();
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
    const first = chipButton('2026-07-04');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 5');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('aria-label')).toContain('July 4');
  });

  it('jumps focus to today with Home', () => {
    renderRail({ todayKey: '2026-07-05' });
    const first = chipButton('2026-07-04');
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
