import { useEffect, useRef } from 'react';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';

interface WeekThemePopoverProps {
  themes: WeekTheme[];
  onClose: () => void;
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

export function WeekThemePopover({ themes, onClose }: WeekThemePopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    function onPointerDownOutside(e: Event) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('touchstart', onPointerDownOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDownOutside);
      document.removeEventListener('touchstart', onPointerDownOutside);
    };
  }, [onClose]);

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
