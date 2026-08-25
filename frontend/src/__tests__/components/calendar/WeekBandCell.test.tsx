import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { WeekBandCell } from '@/components/calendar/WeekBandCell';
import { weekBandSegments, type WeekBandDestination } from '@/lib/utils/weekBands';
import { getChautauquaSeasonWeeks } from '@/lib/utils/dateHelpers';
import { RAIL_BAND_BLEED_PX, RAIL_WEEK_SEAM_PX } from '@/lib/utils/railMetrics';
import { UNREACHABLE_FILL_OPACITY } from '@/lib/utils/railBandPalette';

const weeks = getChautauquaSeasonWeeks(2026);
const segmentFor = (key: string) => weekBandSegments([key], weeks)[0];

const reachable = (...numbers: number[]) =>
  new Map<number, WeekBandDestination>(
    numbers.map(n => [n, { dayKey: '2026-07-25', label: `Go to Week ${n}, opens Saturday, July 25, 3 events` }]),
  );

function renderCell(overrides: Partial<Parameters<typeof WeekBandCell>[0]> = {}) {
  const props = {
    // '2026-06-30' is a solo week-1 day, and the only key rendered, so it is
    // also the labelled one.
    segment: segmentFor('2026-06-30'),
    destinations: reachable(1),
    bridgesLeading: false,
    bridgesTrailing: false,
    isTabStop: false,
    onSelectWeek: vi.fn(),
    ...overrides,
  };
  return { ...render(<WeekBandCell {...props} />), props };
}

// `container` from @testing-library/preact's RenderResult is typed as
// `Element`, not `HTMLElement` — unlike @testing-library/react.
const bars = (c: Element) => Array.from(c.querySelectorAll<HTMLElement>('[data-band-bar]'));

describe('WeekBandCell — the painted run', () => {
  it('draws one bar for an ordinary day', () => {
    const { container } = renderCell();
    expect(bars(container)).toHaveLength(1);
  });

  it('draws two bars split by the seam for a boundary Saturday', () => {
    // A shared Saturday carries BOTH weeks' tones, split down the middle —
    // that is what says "this day is in both" directly.
    const { container } = renderCell({
      segment: segmentFor('2026-07-04'), destinations: reachable(1, 2),
    });
    expect(bars(container)).toHaveLength(2);
    const run = container.querySelector<HTMLElement>('[data-band-run]')!;
    expect(run.style.gap).toBe(`${RAIL_WEEK_SEAM_PX}px`);
  });

  it('draws nothing outside the season', () => {
    const { container } = renderCell({ segment: segmentFor('2026-01-15'), destinations: new Map() });
    expect(bars(container)).toHaveLength(0);
    expect(container.querySelector('[data-band-run]')).toBeNull();
  });

  it('bleeds half a gutter only on a bridged side', () => {
    const { container } = renderCell({ bridgesLeading: true, bridgesTrailing: false });
    const run = container.querySelector<HTMLElement>('[data-band-run]')!;
    expect(run.style.left).toBe(`${-RAIL_BAND_BLEED_PX}px`);
    expect(run.style.right).toBe('0px');
  });

  it('never bleeds a cell that has no run to draw', () => {
    // `bridgesLeading`/`bridgesTrailing` are looked up by raw index; refusing
    // to bleed when this cell has no segment is what keeps a stale bridge
    // answer from painting a run over a day that has none.
    const { container } = renderCell({
      segment: null, destinations: new Map(), bridgesLeading: true, bridgesTrailing: true,
    });
    expect(container.querySelector('[data-band-run]')).toBeNull();
  });

  it('fades an unreachable week and only its own half of a shared Saturday', () => {
    // Reachability is per WEEK, not per segment, precisely so a shared
    // Saturday's two halves can disagree: it can close a week that still has
    // events and open one that has none.
    const { container } = renderCell({
      segment: segmentFor('2026-07-04'), destinations: reachable(1),
    });
    const [closing, opening] = bars(container);
    expect(closing.style.opacity).toBe('1');
    expect(opening.style.opacity).toBe(String(UNREACHABLE_FILL_OPACITY));
  });

  it('dims nothing when reachability is not known yet', () => {
    // An empty MAP means "no reachability information yet", not "nothing is
    // reachable" — the first paint must not flash a fully faded band.
    const { container } = renderCell({ destinations: new Map() });
    expect(bars(container)[0].style.opacity).toBe('1');
  });
});

describe('WeekBandCell — accessibility', () => {
  it('exposes exactly one button, on the labelled segment', () => {
    const { container } = renderCell();
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('button')!.textContent).toBe('Week 1');
  });

  it('names a reachable week by its destination', () => {
    const { container } = renderCell();
    expect(container.querySelector('button')!.getAttribute('aria-label'))
      .toBe('Go to Week 1, opens Saturday, July 25, 3 events');
  });

  it('carries the destination day as data-week-band-target when reachable', () => {
    // The browser check's 44px carve-out reads this attribute rather than
    // re-deriving `weekBandDestinations`' rule itself.
    const { container } = renderCell();
    expect(container.querySelector('button')!.getAttribute('data-week-band-target'))
      .toBe('2026-07-25');
  });

  it('states an unreachable week as a fact and refuses the tap', () => {
    const { container, props } = renderCell({ destinations: new Map([[9, {
      dayKey: '2026-08-24', label: 'x',
    }]]) });
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Week 1, no events');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // No destination to offer — the carve-out has nothing to point at either.
    expect(button.hasAttribute('data-week-band-target')).toBe(false);
    fireEvent.click(button);
    expect(props.onSelectWeek).not.toHaveBeenCalled();
  });

  it('hides an unlabelled segment from assistive technology', () => {
    // Sixty-odd mostly-unlabelled stops in front of a reader swiping the rail
    // is the thing this avoids — and an unlabelled element is itself what an
    // audit flags.
    // A segment rendered alone is always its own week's labelled day, so the
    // unlabelled shape is forced explicitly rather than relying on a fixture
    // accident that a later change to the fixture would quietly undo.
    const unlabelled = { ...segmentFor('2026-07-01'), labelledWeek: null };
    const { container } = renderCell({ segment: unlabelled });
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('[data-band-hit]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the pointer handler on the hidden segment', () => {
    // Hidden from a screen reader, still tappable by a thumb: the week's six
    // non-shared days are what carry its navigation.
    const unlabelled = { ...segmentFor('2026-07-01'), labelledWeek: null };
    const onSelectWeek = vi.fn();
    const { container } = render(
      <WeekBandCell segment={unlabelled} destinations={reachable(1)}
        bridgesLeading={false} bridgesTrailing={false} isTabStop={false} onSelectWeek={onSelectWeek} />
    );
    fireEvent.click(container.querySelector('[data-band-hit]')!);
    expect(onSelectWeek).toHaveBeenCalledWith(1);
  });

  it('never fires from a shared Saturday, which cannot mean one week', () => {
    const onSelectWeek = vi.fn();
    const { container } = render(
      <WeekBandCell segment={segmentFor('2026-07-04')} destinations={reachable(1, 2)}
        bridgesLeading={false} bridgesTrailing={false} isTabStop={false} onSelectWeek={onSelectWeek} />
    );
    fireEvent.click(container.querySelector('[data-band-hit]')!);
    expect(onSelectWeek).not.toHaveBeenCalled();
  });

  it('is the rail band\'s single tab stop when told it is', () => {
    const { container } = renderCell({ isTabStop: true });
    expect(container.querySelector('button')!.tabIndex).toBe(0);
    const { container: c2 } = renderCell({ isTabStop: false });
    expect(c2.querySelector('button')!.tabIndex).toBe(-1);
  });
});
