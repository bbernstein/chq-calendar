import { useEffect, useRef } from 'react';
import type { SeasonWeek } from '@/lib/types';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';

interface WeekThemePopoverProps {
  themes: WeekTheme[];
  onClose: () => void;
  /**
   * The DOM element that triggered the popover. Clicks/touches inside this
   * element are NOT treated as "outside" — that way a trigger that also
   * handles click-to-toggle (e.g. WeekBadge) can close the popover via its
   * own state instead of fighting the outside-click handler.
   */
  triggerRef?: { current: HTMLElement | null };
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatIsoAsShort(iso: string): string {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  return `${MONTH_ABBR[month - 1]} ${day}`;
}

export function formatThemeDateRange(theme: WeekTheme): string {
  return `${formatIsoAsShort(theme.startDate)}–${formatIsoAsShort(theme.endDate)}`;
}

/**
 * A week cell's `title`, for a sighted mouse user who has no other way to
 * discover the theme. Lives here rather than in either control so the filter
 * strip and the chooser grid cannot title the same week differently.
 */
export function buildWeekTitle(week: SeasonWeek, theme: WeekTheme | undefined): string {
  if (!theme) return week.label;
  return `Week ${week.number} — "${theme.title}" (${formatThemeDateRange(theme)})`;
}

export function WeekThemePopover({ themes, onClose, triggerRef }: WeekThemePopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    function onPointerDownOutside(e: Event) {
      const target = e.target as Node;
      if (ref.current && ref.current.contains(target)) return;
      if (triggerRef?.current && triggerRef.current.contains(target)) return;
      onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('touchstart', onPointerDownOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDownOutside);
      document.removeEventListener('touchstart', onPointerDownOutside);
    };
  }, [onClose, triggerRef]);

  if (themes.length === 0) return null;

  const ariaLabel = themes.length === 1
    ? `Week ${themes[0].number} theme`
    : `Themes for weeks ${themes.map(t => t.number).join(' and ')}`;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={ariaLabel}
      className="w-72 max-w-[90vw] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg p-3 text-left"
    >
      {themes.map((theme, idx) => (
        <div key={theme.number} className={idx > 0 ? 'mt-3 pt-3 border-t border-gray-200 dark:border-gray-700' : ''}>
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Week {theme.number} · {formatThemeDateRange(theme)}
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {theme.title}
          </div>
          {theme.description ? (
            <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">
              {theme.description}
            </div>
          ) : null}
        </div>
      ))}
      <div className="mt-2">
        <a
          href="https://www.chq.org/things-to-do/events/weekly-themes/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 dark:text-blue-400 underline"
        >
          View on chq.org
        </a>
      </div>
    </div>
  );
}
