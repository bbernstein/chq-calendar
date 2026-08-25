import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { EventListView } from '@/components/calendar/EventListView';
import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';
import { dayHeaderTop } from '@/app/filterHeaderLayout';

const groups = [
  { key: '2026-07-04', baseLabel: 'Saturday, July 4, 2026', weekNumbers: [2], events: [] },
];

function renderView() {
  return render(
    <EventListView groups={groups as never} expandedDescriptions={new Set()}
      onToggleDescription={() => {}} onToggleTag={() => {}} isTagSelected={() => false}
      favoriteIds={new Set()} onToggleFavorite={() => {}} />
  );
}

describe('EventListView sticky stacking', () => {
  // jsdom computes no layout, so this asserts the *declaration* — that the
  // offset is expressed in terms of the measured custom properties rather than
  // a hardcoded pixel value. Whether the result actually clears the chrome at
  // a given text zoom is a browser question, checked by `verify-rail`'s check
  // 12 at 320px and at 200% zoom.
  //
  // Both terms, not just the rail: while the site header is revealed (#272)
  // the rail sits a header lower, and a title pinned at the bare rail height
  // slides under a rail that outranks it (`z-20` against `z-10`) and vanishes.
  // Measured before it was fixed: rail bottom 112, day header top 64.
  it('offsets the day header by the measured height of everything above it', () => {
    const { container } = renderView();
    const header = container.querySelector<HTMLElement>('.sticky')!;
    expect(header.style.top).toBe(dayHeaderTop());
    expect(dayHeaderTop()).toContain('--day-rail-h');
    expect(dayHeaderTop()).toContain('--site-header-offset');
  });

  it('gives the section a scroll margin so a scroll target clears the chrome', () => {
    const { container } = renderView();
    const section = container.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}]`)!;
    expect(section.style.scrollMarginTop).toBe(dayHeaderTop());
  });
});
