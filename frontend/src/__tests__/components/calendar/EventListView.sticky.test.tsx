import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { EventListView } from '@/components/calendar/EventListView';
import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';

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
  // offset is expressed in terms of the measured custom property rather than
  // a hardcoded pixel value. Whether the result actually clears the rail at a
  // given text zoom is a browser question, checked in the phase's manual pass.
  it('offsets the day header by the measured rail height', () => {
    const { container } = renderView();
    const header = container.querySelector<HTMLElement>('.sticky')!;
    expect(header.style.top).toBe('var(--day-rail-h)');
  });

  it('gives the section a scroll margin so a scroll target clears the rail', () => {
    const { container } = renderView();
    const section = container.querySelector<HTMLElement>(`[${DAY_SECTION_ATTR}]`)!;
    expect(section.style.scrollMarginTop).toBe('var(--day-rail-h)');
  });
});
