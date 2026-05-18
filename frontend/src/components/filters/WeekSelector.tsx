import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { SeasonWeek } from '@/lib/types';
import { isWeekInPast } from '@/lib/utils/dateHelpers';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { useFloatingCoords } from '@/hooks/useViewportClamp';
import { WeekThemePopover, formatThemeDateRange } from './WeekThemePopover';

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

const LONG_PRESS_MS = 500;

function buildButtonTitle(week: SeasonWeek, theme: WeekTheme | undefined): string {
  if (!theme) return week.label;
  return `Week ${week.number} — "${theme.title}" (${formatThemeDateRange(theme)})`;
}

export function WeekSelector({
  seasonWeeks, selectedWeeks, isDragging, isWeekHighlighted,
  onMouseDown, onMouseEnter, onMouseUp, onTap, size, themes,
}: WeekSelectorProps) {
  const cellSize = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const [popoverWeek, setPopoverWeek] = useState<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const buttonRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());
  const activeAnchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverContentRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    activeAnchorRef.current = popoverWeek !== null
      ? buttonRefs.current.get(popoverWeek) ?? null
      : null;
  }, [popoverWeek]);
  const popoverCoords = useFloatingCoords(
    popoverWeek !== null,
    activeAnchorRef,
    popoverContentRef,
    { mode: 'center' },
  );

  useEffect(() => () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
    }
  }, []);

  function openPopoverIfThemed(weekNum: number) {
    if (themes && themes[weekNum]) {
      setPopoverWeek(weekNum);
    }
  }

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const popoverIdx = popoverWeek !== null
    ? seasonWeeks.findIndex(w => w.number === popoverWeek)
    : -1;
  const popoverTheme = popoverWeek !== null ? themes?.[popoverWeek] : undefined;

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
          const hasTheme = !!theme;

          return (
            <button
              type="button"
              key={week.number}
              ref={(el) => { buttonRefs.current.set(week.number, el); }}
              className={`${cellSize} flex items-center justify-center cursor-pointer border-r border-gray-300 dark:border-gray-600 last:border-r-0 transition-all text-xs flex-shrink-0 ${
                isPast
                  ? highlighted
                    ? 'bg-gray-400 dark:bg-gray-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  : highlighted
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-700'
              }`}
              onMouseDown={(e) => onMouseDown(week.number, e)}
              onMouseEnter={() => onMouseEnter(week.number)}
              onMouseUp={() => onMouseUp(week.number)}
              onContextMenu={(e) => {
                if (hasTheme) {
                  e.preventDefault();
                  openPopoverIfThemed(week.number);
                }
              }}
              onTouchStart={(e) => {
                longPressFiredRef.current = false;
                if (hasTheme) {
                  clearLongPress();
                  longPressTimer.current = window.setTimeout(() => {
                    longPressFiredRef.current = true;
                    openPopoverIfThemed(week.number);
                  }, LONG_PRESS_MS);
                }
                if (!longPressFiredRef.current) {
                  e.preventDefault();
                  if (!hasTheme) onTap(week.number);
                }
              }}
              onTouchEnd={(e) => {
                clearLongPress();
                if (longPressFiredRef.current) {
                  e.preventDefault();
                  longPressFiredRef.current = false;
                  return;
                }
                if (hasTheme) {
                  e.preventDefault();
                  onTap(week.number);
                }
              }}
              onTouchMove={() => clearLongPress()}
              onTouchCancel={() => {
                clearLongPress();
                longPressFiredRef.current = false;
              }}
              title={buildButtonTitle(week, theme)}
              aria-label={`Week ${week.number}`}
              aria-pressed={isSelected}
            >
              {week.number}
            </button>
          );
        })}
      </div>
      {popoverWeek !== null && popoverTheme && popoverIdx >= 0 && createPortal(
        <div
          ref={popoverContentRef}
          className="fixed z-50"
          style={{
            top: popoverCoords ? `${popoverCoords.top}px` : '-9999px',
            left: popoverCoords ? `${popoverCoords.left}px` : '0px',
            visibility: popoverCoords ? 'visible' : 'hidden',
          }}
        >
          <WeekThemePopover themes={[popoverTheme]} onClose={() => setPopoverWeek(null)} />
        </div>,
        document.body,
      )}
    </div>
  );
}
