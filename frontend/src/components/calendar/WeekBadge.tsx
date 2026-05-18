import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { WeekThemePopover, formatThemeDateRange } from '@/components/filters/WeekThemePopover';
import { useFloatingCoords } from '@/hooks/useViewportClamp';
import { LONG_PRESS_MS } from '@/lib/constants';

interface WeekBadgeProps {
  weekNumbers: number[];
  themes: Record<number, WeekTheme>;
}

function buildHoverTitle(weekNumbers: number[], themes: Record<number, WeekTheme>): string {
  const parts = weekNumbers
    .map(n => themes[n])
    .filter((t): t is WeekTheme => !!t)
    .map(t => `Week ${t.number} — "${t.title}" (${formatThemeDateRange(t)})`);
  if (parts.length === 0) {
    return `Week ${weekNumbers.join('/')}`;
  }
  return parts.join('\n');
}

export function WeekBadge({ weekNumbers, themes }: WeekBadgeProps) {
  const [open, setOpen] = useState(false);
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLSpanElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const coords = useFloatingCoords(open, badgeRef, popoverRef);

  useEffect(() => () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
    }
  }, []);

  if (weekNumbers.length === 0) return null;

  const availableThemes = weekNumbers
    .map(n => themes[n])
    .filter((t): t is WeekTheme => !!t);
  const hasAnyTheme = availableThemes.length > 0;
  const label = `Week ${weekNumbers.join('/')}`;

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  return (
    <span className="relative inline-block">
      <span
        ref={badgeRef}
        role={hasAnyTheme ? 'button' : undefined}
        tabIndex={hasAnyTheme ? 0 : undefined}
        aria-haspopup={hasAnyTheme ? 'dialog' : undefined}
        aria-expanded={hasAnyTheme ? open : undefined}
        title={buildHoverTitle(weekNumbers, themes)}
        className={hasAnyTheme ? 'cursor-help underline decoration-dotted underline-offset-2' : ''}
        onContextMenu={(e) => {
          if (hasAnyTheme) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onClick={(e) => {
          if (longPressFiredRef.current) {
            // Synthetic click that immediately follows a long-press touch.
            // Suppress so the popover the long-press just opened doesn't
            // get re-toggled shut.
            longPressFiredRef.current = false;
            e.preventDefault();
            return;
          }
          if (hasAnyTheme) {
            e.preventDefault();
            setOpen(o => !o);
          }
        }}
        onKeyDown={(e) => {
          if (!hasAnyTheme) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(o => !o);
          }
        }}
        onTouchStart={() => {
          longPressFiredRef.current = false;
          if (hasAnyTheme) {
            clearLongPress();
            longPressTimer.current = window.setTimeout(() => {
              longPressFiredRef.current = true;
              setOpen(true);
            }, LONG_PRESS_MS);
          }
        }}
        onTouchEnd={(e) => {
          clearLongPress();
          if (longPressFiredRef.current) {
            e.preventDefault();
            // Leave the flag set briefly so the synthetic click that may
            // follow (despite preventDefault) is also suppressed; auto-clear
            // so we don't swallow a legitimate later click if the synthetic
            // one never arrives.
            window.setTimeout(() => { longPressFiredRef.current = false; }, 50);
            return;
          }
          longPressFiredRef.current = false;
        }}
        onTouchMove={() => clearLongPress()}
        onTouchCancel={() => {
          clearLongPress();
          longPressFiredRef.current = false;
        }}
      >
        {label}
      </span>
      {open && hasAnyTheme && createPortal(
        <span
          ref={popoverRef}
          className="fixed z-50"
          style={{
            top: coords ? `${coords.top}px` : '-9999px',
            left: coords ? `${coords.left}px` : '0px',
            visibility: coords ? 'visible' : 'hidden',
          }}
        >
          <WeekThemePopover themes={availableThemes} onClose={() => setOpen(false)} triggerRef={badgeRef} />
        </span>,
        document.body,
      )}
    </span>
  );
}
