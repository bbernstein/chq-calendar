import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Header, type HeaderFiltersToggleProps } from '@/components/layout/Header';
import { installResizeObserverMock } from '@/__tests__/helpers/resizeObserver';

/**
 * The Filters toggle's move from the day rail into the site header (#274
 * phase 3).
 *
 * What is only reachable here is the contract a screen reader and a keyboard
 * reader see: the name, the expanded state, and the link to the panel it
 * controls. The geometry — that it is 44px square, that it is reachable from
 * anywhere because the header returns on an upward flick — is a browser-pass
 * property; jsdom computes no layout.
 */

const toggleProps = (over: Partial<HeaderFiltersToggleProps> = {}): HeaderFiltersToggleProps => ({
  open: false,
  onToggle: vi.fn(),
  panelId: 'filter-panel-x',
  toggleRef: vi.fn(),
  hasActiveFilters: false,
  ...over,
});

const mount = (filtersToggle?: HeaderFiltersToggleProps) => {
  installResizeObserverMock();
  return render(
    <Header
      selectedYear={2026}
      availableYears={[2025, 2026]}
      defaultYear={2026}
      onYearChange={vi.fn()}
      filtersToggle={filtersToggle}
    />,
  );
};

describe('Header — the Filters toggle', () => {
  // The control has an accessible name at all, and it is the one readers
  // already know.
  //
  // Two premises were checked by breaking the code, and both of the obvious
  // ones were wrong. `FiltersIcon`'s `aria-hidden` does NOT protect the name:
  // an explicit `aria-label` outranks the button's contents entirely, so
  // giving the funnel SVG a label of its own moved nothing. Nor does the
  // `aria-label` alone: `title="Filters"` is the last resort in the
  // accessible-name computation and silently takes over when the label goes.
  // This fails only when BOTH are dropped — which is the honest claim, since
  // either one alone is enough to keep the announcement right.
  it('is announced as "Filters", not by its icon', () => {
    mount(toggleProps());
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
  });

  // Rendered once, whatever the breakpoint. The header carries two link
  // clusters that swap at `lg`, and putting the funnel inside both would give
  // a screen reader two controls with the same name and give a wide viewport
  // two funnels.
  it('renders exactly one funnel', () => {
    mount(toggleProps());
    expect(screen.getAllByRole('button', { name: 'Filters' })).toHaveLength(1);
  });

  it('reports the panel as collapsed while it is closed', () => {
    mount(toggleProps({ open: false }));
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-expanded'))
      .toBe('false');
  });

  it('reports the panel as expanded while it is open', () => {
    mount(toggleProps({ open: true }));
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-expanded'))
      .toBe('true');
  });

  // Without this the toggle and the panel are two unrelated elements as far
  // as assistive technology is concerned, and "expanded" names nothing.
  it('points at the panel it controls', () => {
    mount(toggleProps({ panelId: 'a-particular-panel' }));
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-controls'))
      .toBe('a-particular-panel');
  });

  it('calls back when pressed', () => {
    const onToggle = vi.fn();
    mount(toggleProps({ onToggle }));

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // The ref is how Escape gets focus back out of the panel and onto this
  // button. A toggle that never publishes its element strands the keyboard
  // reader on `<body>`.
  it('publishes its element to the panel hook', () => {
    const toggleRef = vi.fn();
    mount(toggleProps({ toggleRef }));
    expect(toggleRef).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
  });

  // The dot is the one thing the icon adds over the word it replaced: an icon
  // alone cannot say whether the reader is looking at everything or a slice.
  it('paints the active dot only when filters are actually active', () => {
    const { queryByTestId, rerender } = mount(toggleProps({ hasActiveFilters: false }));
    expect(queryByTestId('filters-active-dot')).toBeNull();

    rerender(
      <Header
        selectedYear={2026}
        availableYears={[2025, 2026]}
        defaultYear={2026}
        onYearChange={vi.fn()}
        filtersToggle={toggleProps({ hasActiveFilters: true })}
      />,
    );

    expect(queryByTestId('filters-active-dot')).toBeTruthy();
  });

  // The optionality is real, not decorative. `page.tsx` is the only caller
  // with a filter panel today; a header that threw or rendered a dead button
  // without one would make every future page invent a panel to have a header.
  it('renders without a filter panel at all', () => {
    mount(undefined);
    expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'CHQ Calendar' })).toBeTruthy();
  });
});
