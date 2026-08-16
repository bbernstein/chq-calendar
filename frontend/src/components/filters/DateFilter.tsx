import type { SeasonWeek } from '@/lib/types';
import type { DateFilter as DateFilterValue } from '@/hooks/useFilterState';
import { WeekSelector } from './WeekSelector';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';

interface DateFilterProps {
  dateFilter: DateFilterValue;
  setDateFilter: (filter: DateFilterValue) => void;
  selectedWeeks: number[];
  setSelectedWeeks: React.Dispatch<React.SetStateAction<number[]>>;
  seasonWeeks: SeasonWeek[];
  weekDrag: {
    isDragging: boolean;
    handleWeekMouseDown: (weekNum: number, e: React.MouseEvent) => void;
    handleWeekMouseEnter: (weekNum: number) => void;
    handleWeekMouseUp: (weekNum: number) => void;
    handleWeekTap: (weekNum: number) => void;
  };
  isWeekHighlighted: (weekNumber: number, isSelected: boolean) => boolean;
  showFavoritesOnly: boolean;
  onToggleFavoritesOnly: () => void;
  favoriteCount: number;
  isCurrentYear: boolean;
  weeklyThemes?: Record<number, WeekTheme>;
}

function DateFilterButton({ label, title, isActive, onClick, ariaLabel }: {
  label: string; title: string; isActive: boolean; onClick: () => void; ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      className={`px-2 py-1 sm:px-4 sm:py-2 rounded-md border transition-all text-xs sm:text-sm whitespace-nowrap ${
        isActive
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The scope row.
 *
 * Four scopes, converged with iOS: Now · Today · All Season · All Year. The
 * first two are time-relative and are hidden on an archived year, where they
 * mean nothing; the last two are absolute and are always offered, so an
 * archived season is never left without a scope control.
 *
 * There is deliberately no "This Week" button. `isThisWeek` and
 * `isInChautauquaWeek` compute identical bounds, so tapping the current week
 * on the strip has always been the same operation — iOS reached this
 * conclusion first and keeps `.thisWeek` out of `visibleScopes`. The
 * `'this-week'` value stays in the `DateFilter` union so a value persisted in
 * localStorage keeps working and renders as the current week highlighted on
 * the strip.
 */
export function DateFilter({
  dateFilter, setDateFilter, selectedWeeks, setSelectedWeeks,
  seasonWeeks, weekDrag, isWeekHighlighted,
  showFavoritesOnly, onToggleFavoritesOnly, favoriteCount,
  isCurrentYear, weeklyThemes,
}: DateFilterProps) {
  // Selecting a scope clears the weeks; re-pressing the active scope returns
  // to All Year. Both halves of the mutual exclusion iOS already enforces in
  // `setWeekSelection` — the other half (selecting weeks forces the scope to
  // 'all') lives in useScrollState.
  const selectScope = (filter: DateFilterValue) => {
    setDateFilter(dateFilter === filter ? 'all' : filter);
    if (dateFilter !== filter) setSelectedWeeks([]);
  };

  // 'all' means "no date narrowing at all", so a week selection contradicts
  // it even though `dateFilter` is still 'all' underneath.
  const isAllYearActive = dateFilter === 'all' && selectedWeeks.length === 0;

  return (
    <div className="mb-2 sm:mb-4">
      {/* Mobile Week Selector */}
      <div className="mb-2 sm:mb-0 block sm:hidden">
        <div className="flex items-center gap-1 sm:gap-2 justify-start">
          <span className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap mr-2">Weeks:</span>
          <WeekSelector
            seasonWeeks={seasonWeeks}
            selectedWeeks={selectedWeeks}
            isDragging={weekDrag.isDragging}
            isWeekHighlighted={isWeekHighlighted}
            onMouseDown={weekDrag.handleWeekMouseDown}
            onMouseEnter={weekDrag.handleWeekMouseEnter}
            onMouseUp={weekDrag.handleWeekMouseUp}
            onTap={weekDrag.handleWeekTap}
            size="sm"
            themes={weeklyThemes}
          />
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
        {isCurrentYear && (
          <>
            <DateFilterButton label="Now" title="Events starting from now, through enough days to be worth reading" isActive={dateFilter === 'next'} onClick={() => selectScope('next')} />
            <DateFilterButton label="Today" title="Everything on today" isActive={dateFilter === 'today'} onClick={() => selectScope('today')} />
          </>
        )}
        <DateFilterButton label="All Season" title="The whole Chautauqua season" isActive={dateFilter === 'season'} onClick={() => selectScope('season')} />
        <DateFilterButton label="All Year" title="Every event in this year, in or out of season" isActive={isAllYearActive} onClick={() => selectScope('all')} />
        <DateFilterButton
          label={`★ ${favoriteCount}`}
          title={favoriteCount > 0 ? 'Show favorited events only' : 'No favorites saved yet'}
          isActive={showFavoritesOnly}
          onClick={onToggleFavoritesOnly}
          ariaLabel={showFavoritesOnly ? 'Stop showing favorites only' : 'Show favorites only'}
        />

        {/* Desktop Week Selector */}
        <div className="hidden sm:flex items-center gap-1 sm:gap-2">
          <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">Weeks:</span>
          <WeekSelector
            seasonWeeks={seasonWeeks}
            selectedWeeks={selectedWeeks}
            isDragging={weekDrag.isDragging}
            isWeekHighlighted={isWeekHighlighted}
            onMouseDown={weekDrag.handleWeekMouseDown}
            onMouseEnter={weekDrag.handleWeekMouseEnter}
            onMouseUp={weekDrag.handleWeekMouseUp}
            onTap={weekDrag.handleWeekTap}
            size="lg"
            themes={weeklyThemes}
          />
        </div>
      </div>
    </div>
  );
}
