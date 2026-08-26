import { memo } from 'preact/compat';
import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import type { ArticleLink } from '@/hooks/useArticleLinks';
import type { ProgramLink } from '@/hooks/useProgramLinks';
import { downloadICS } from '@/lib/utils/icsHelpers';
import { DAY_SECTION_ATTR, DAY_HEADER_ATTR } from '@/lib/utils/daySections';
import { estimatedDaySectionHeight } from '@/lib/utils/daySectionSize';
import { EventCard } from './EventCard';
import { WeekBadge } from './WeekBadge';
import { dayHeaderTop } from '@/app/filterHeaderLayout';

export interface EventListViewProps {
  groups: DayGroup[];
  expandedDescriptions: Set<string>;
  onToggleDescription: (eventId: string) => void;
  onToggleTag: (tag: string) => void;
  isTagSelected: (tag: string) => boolean;
  favoriteIds: Set<string>;
  onToggleFavorite: (eventId: string) => void;
  weeklyThemes?: Record<number, WeekTheme>;
  articleLinks?: Record<string, ArticleLink[]>;
  programLinks?: Record<string, ProgramLink[]>;
}

/**
 * The day sections themselves — no state, no observers, no scroll.
 *
 * Returned as a fragment rather than a wrapper so each container owns the
 * spacing element its own sentinels and controls live in.
 */
function EventListViewInner({
  groups, expandedDescriptions, onToggleDescription, onToggleTag, isTagSelected,
  favoriteIds, onToggleFavorite, weeklyThemes, articleLinks, programLinks,
}: EventListViewProps) {
  return (
    <>
      {groups.map((dayGroup) => (
        // The day-key attribute is the anchor every scroll consumer resolves
        // against — `useDayAnchor`'s scrollspy and its scroll-to
        // (`scrollToDay`/the settle hold it reasserts), and `useRailHighlight`'s
        // continuous highlight, which resolves against the same sections via
        // `daySectionTop`/`daySectionMetrics`. It is on the section wrapper
        // rather than the sticky header, because a sticky header's rect stops
        // reporting the section's real position the moment it sticks.
        <div
          key={dayGroup.key}
          {...{ [DAY_SECTION_ATTR]: dayGroup.key }}
          // Nothing in the app calls `scrollIntoView` on a day section:
          // `useDayAnchor.scrollToDay` computes its own delta against
          // `stickyOffset()` for the reasons documented there. This property
          // is read only by a native scroll — an anchor jump, a
          // `focus()`-driven scroll, CSS scroll-snap — and is kept because it
          // is load-bearing for any such future path, which would otherwise
          // put the day header exactly at the viewport top, underneath the
          // sticky rail. Expressed as the measured custom property rather
          // than a pixel literal so it stays right at any browser text zoom,
          // targeting the same `--day-rail-h` that `stickyOffset()` reads.
          style={{
            scrollMarginTop: dayHeaderTop(),
            // The browser skips layout and paint for sections that are off
            // screen, which is what makes mounting the whole year affordable
            // — measured on the phase 4 spike as 0 frames over 50ms across a
            // forty-gesture scroll, against 5 without it and 6 for the
            // render-window build it replaces.
            //
            // Off-screen sections are consequently absent from the
            // accessibility tree until they render. That is not a
            // regression against the render window this replaces — those
            // days were not in the DOM at all — but it is the one thing full
            // mount could have bought and this gives back. Recorded as a
            // decision in the spec's addendum, not an oversight.
            contentVisibility: 'auto',
            containIntrinsicSize: `auto ${estimatedDaySectionHeight(dayGroup.events.length)}px`,
          }}
        >
          <div
            {...{ [DAY_HEADER_ATTR]: '' }}
            className="sticky bg-white dark:bg-gray-800 z-10 border-b border-gray-200 dark:border-gray-700 pb-1 sm:pb-2 mb-2 sm:mb-4"
            // `top-0` is dropped from the class list in favour of this: two
            // sticky layers both pinned at 0 overlap, and the header is the
            // one that has to give way. `z-10` keeps it below the rail's
            // `z-20`.
            style={{ top: dayHeaderTop() }}
          >
            <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
              {dayGroup.baseLabel}
              {dayGroup.weekNumbers.length > 0 && (
                <>
                  <span> - </span>
                  <WeekBadge weekNumbers={dayGroup.weekNumbers} themes={weeklyThemes ?? {}} />
                </>
              )}
            </h3>
          </div>
          <div className="space-y-1">
            {dayGroup.events.map((event, index) => (
              <EventCard
                key={event.id}
                event={event}
                index={index}
                isExpanded={expandedDescriptions.has(event.id)}
                onToggleDescription={onToggleDescription}
                onToggleTag={onToggleTag}
                isTagSelected={isTagSelected}
                isFavorite={favoriteIds.has(event.id)}
                onToggleFavorite={onToggleFavorite}
                onDownloadICS={downloadICS}
                articleLinks={articleLinks?.[event.id]}
                programLinks={programLinks?.[event.id]}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Memoized, and that is a performance *contract*, not an optimization.
 *
 * `useDayAnchor` holds the anchored day in `page.tsx`, so every rAF-throttled
 * scroll measurement that moves the anchor re-renders the page — and without
 * this, the whole mounted list with it, each card re-running its `Intl` date
 * formatting. Measured on the phase 4 spike at 4x CPU throttle: a forty-gesture
 * scroll over the full season cost 26,992 card renders unmemoized and 0
 * memoized, taking the 95th-percentile frame from 192ms to 32ms.
 *
 * The props `page.tsx` hands down are already stable across an anchor-only
 * change. **Anything that makes one of them unstable — an inline arrow, a Set
 * rebuilt per render — silently removes the memo without failing a single
 * behavioural test.** `EventListView.memo.test.tsx` is the guard.
 */
export const EventListView = memo(EventListViewInner);
