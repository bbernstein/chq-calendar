import type { SeasonWeek } from '@/lib/types';
import { isWeekInPast } from '@/lib/utils/dateHelpers';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { useWeekThemePopover } from '@/hooks/useWeekThemePopover';
import { buildWeekTitle } from './WeekThemePopover';

interface WeekSelectorProps {
  seasonWeeks: SeasonWeek[];
  selectedWeeks: number[];
  isDragging: boolean;
  isWeekHighlighted: (weekNumber: number, isSelected: boolean) => boolean;
  onMouseDown: (weekNum: number, e: React.MouseEvent) => void;
  onMouseEnter: (weekNum: number) => void;
  onMouseUp: (weekNum: number) => void;
  onTap: (weekNum: number) => void;
  size: 'sm' | 'lg';
  themes?: Record<number, WeekTheme>;
}

export function WeekSelector({
  seasonWeeks, selectedWeeks, isDragging, isWeekHighlighted,
  onMouseDown, onMouseEnter, onMouseUp, onTap, size, themes,
}: WeekSelectorProps) {
  const cellSize = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const themePopover = useWeekThemePopover({ themes, onActivate: onTap });

  return (
    <div className="relative inline-block">
      <div
        className={`flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden select-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-pointer'
        }`}
      >
        {seasonWeeks.map((week) => {
          const isPast = isWeekInPast(week.number, seasonWeeks);
          const isSelected = selectedWeeks.includes(week.number);
          const highlighted = isWeekHighlighted(week.number, isSelected);
          const theme = themes?.[week.number];

          return (
            <button
              type="button"
              key={week.number}
              ref={(el) => themePopover.registerAnchor(week.number, el)}
              className={`${cellSize} flex items-center justify-center cursor-pointer border-r border-gray-300 dark:border-gray-600 last:border-r-0 transition-all text-xs flex-shrink-0 ${
                isPast
                  ? highlighted
                    ? 'bg-gray-400 dark:bg-gray-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  : highlighted
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-700'
              }`}
              onMouseDown={(e) => {
                // Skip non-primary buttons so right-click opens the theme
                // popover without also triggering the drag/selection path.
                if (e.button !== 0) return;
                onMouseDown(week.number, e);
              }}
              onMouseEnter={() => onMouseEnter(week.number)}
              onMouseUp={(e) => {
                if (e.button !== 0) return;
                onMouseUp(week.number);
              }}
              {...themePopover.handlers(week.number)}
              title={buildWeekTitle(week, theme)}
              aria-label={`Week ${week.number}`}
              aria-pressed={isSelected}
            >
              {week.number}
            </button>
          );
        })}
      </div>
      {themePopover.portal}
    </div>
  );
}
