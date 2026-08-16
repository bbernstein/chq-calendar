import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import type { ArticleLink } from '@/hooks/useArticleLinks';
import type { ProgramLink } from '@/hooks/useProgramLinks';
import { downloadICS } from '@/lib/utils/icsHelpers';
import { DAY_SECTION_ATTR } from '@/lib/utils/daySections';
import { EventCard } from './EventCard';
import { WeekBadge } from './WeekBadge';

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
export function EventListView({
  groups, expandedDescriptions, onToggleDescription, onToggleTag, isTagSelected,
  favoriteIds, onToggleFavorite, weeklyThemes, articleLinks, programLinks,
}: EventListViewProps) {
  return (
    <>
      {groups.map((dayGroup) => (
        // The day-key attribute is the anchor every scroll consumer resolves
        // against — the prepend correction, the rail's scrollspy, and its
        // scroll-to. It is on the section wrapper rather than the sticky
        // header, because a sticky header's rect stops reporting the
        // section's real position the moment it sticks.
        <div
          key={dayGroup.key}
          {...{ [DAY_SECTION_ATTR]: dayGroup.key }}
          // Without this, `scrollIntoView({ block: 'start' })` puts the day
          // header exactly at the viewport top — underneath the sticky rail.
          // Expressed as the measured custom property rather than a pixel
          // literal so it stays right at any browser text zoom.
          style={{ scrollMarginTop: 'var(--day-rail-h)' }}
        >
          <div
            className="sticky bg-white dark:bg-gray-800 z-10 border-b border-gray-200 dark:border-gray-700 pb-1 sm:pb-2 mb-2 sm:mb-4"
            // `top-0` is dropped from the class list in favour of this: two
            // sticky layers both pinned at 0 overlap, and the header is the
            // one that has to give way. `z-10` keeps it below the rail's
            // `z-20`.
            style={{ top: 'var(--day-rail-h)' }}
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
