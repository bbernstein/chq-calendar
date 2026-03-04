import type { SeasonWeek } from '@/lib/types';
import { WeekSelector } from './WeekSelector';

interface DateFilterProps {
  dateFilter: string;
  setDateFilter: (filter: 'all' | 'today' | 'next' | 'this-week') => void;
  selectedWeeks: number[];
  setSelectedWeeks: React.Dispatch<React.SetStateAction<number[]>>;
  currentWeekNumber: number | null;
  seasonWeeks: SeasonWeek[];
  isThisWeekButtonActive: boolean;
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
}

function DateFilterButton({ label, title, isActive, onClick, ariaLabel }: {
  label: string; title: string; isActive: boolean; onClick: () => void; ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
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

function SelectedFilterInfo({ dateFilter, selectedWeeks, currentWeekNumber, seasonWeeks, isCurrentYear }: {
  dateFilter: string; selectedWeeks: number[]; currentWeekNumber: number | null; seasonWeeks: SeasonWeek[]; isCurrentYear: boolean;
}) {
  // Suppress time-relative descriptions for non-current years (buttons are hidden, but
  // dateFilter may briefly be 'next'/'today'/'this-week' before reconciliation clears it)
  const effectiveDateFilter = !isCurrentYear && (dateFilter === 'next' || dateFilter === 'today' || dateFilter === 'this-week') ? 'all' : dateFilter;
  if (selectedWeeks.length === 0 && effectiveDateFilter === 'all') return null;

  const getDescription = () => {
    if (effectiveDateFilter === 'today') {
      const today = new Date();
      const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
      const fullDate = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      return `Today, ${dayName}, ${fullDate}`;
    } else if (effectiveDateFilter === 'next') {
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `Next events after ${timeString}`;
    } else if (effectiveDateFilter === 'this-week') {
      if (currentWeekNumber === null) return 'This Week (Not in season)';
      const currentWeek = seasonWeeks[currentWeekNumber - 1];
      const startStr = currentWeek.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endStr = currentWeek.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `This Week (${startStr} 12pm - ${endStr} 12pm)`;
    } else if (selectedWeeks.length === 1) {
      const weekNum = selectedWeeks[0];
      const week = seasonWeeks[weekNum - 1];
      const startStr = week.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endStr = week.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `Week ${weekNum} (${startStr} - ${endStr})`;
    } else if (selectedWeeks.length > 1) {
      const startWeek = Math.min(...selectedWeeks);
      const endWeek = Math.max(...selectedWeeks);
      const startStr = seasonWeeks[startWeek - 1].start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endStr = seasonWeeks[endWeek - 1].end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `Weeks ${startWeek}-${endWeek} (${startStr} - ${endStr})`;
    }
    return '';
  };

  return (
    <div className="mt-1 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
      Selected: {getDescription()}
    </div>
  );
}

export function DateFilter({
  dateFilter, setDateFilter, selectedWeeks, setSelectedWeeks,
  currentWeekNumber, seasonWeeks, isThisWeekButtonActive,
  weekDrag, isWeekHighlighted,
  showFavoritesOnly, onToggleFavoritesOnly, favoriteCount,
  isCurrentYear,
}: DateFilterProps) {
  const toggleDateFilter = (filter: 'next' | 'today' | 'this-week') => {
    setDateFilter(dateFilter === filter ? 'all' : filter);
    if (dateFilter !== filter) {
      setSelectedWeeks([]);
    }
  };

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
          />
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
        {isCurrentYear && (
          <>
            <DateFilterButton label="Now" title="Show events starting after the current time through the end of this week" isActive={dateFilter === 'next'} onClick={() => toggleDateFilter('next')} />
            <DateFilterButton label="Today" title="Show all events for today" isActive={dateFilter === 'today'} onClick={() => toggleDateFilter('today')} />
            <DateFilterButton label="This Week" title="Show events for this week" isActive={isThisWeekButtonActive} onClick={() => toggleDateFilter('this-week')} />
          </>
        )}
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
          />
        </div>
      </div>

      <SelectedFilterInfo
        dateFilter={dateFilter}
        selectedWeeks={selectedWeeks}
        currentWeekNumber={currentWeekNumber}
        seasonWeeks={seasonWeeks}
        isCurrentYear={isCurrentYear}
      />
    </div>
  );
}
