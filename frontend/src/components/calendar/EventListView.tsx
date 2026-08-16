import type { DayGroup } from '@/lib/utils/eventHelpers';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import type { ArticleLink } from '@/hooks/useArticleLinks';
import type { ProgramLink } from '@/hooks/useProgramLinks';
import { downloadICS } from '@/lib/utils/icsHelpers';
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
        <div key={dayGroup.key}>
          <div className="sticky top-0 bg-white dark:bg-gray-800 z-10 border-b border-gray-200 dark:border-gray-700 pb-1 sm:pb-2 mb-2 sm:mb-4">
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
