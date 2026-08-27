import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WeekTheme } from '@/hooks/useWeeklyThemes';
import { useFloatingCoords } from '@/hooks/useViewportClamp';
import { LONG_PRESS_MS } from '@/lib/constants';
import { WeekThemePopover } from '@/components/filters/WeekThemePopover';

/** Everything a week cell has to spread onto its `<button>`. */
export interface WeekCellThemeHandlers {
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchMove: () => void;
  onTouchCancel: () => void;
}

export interface WeekThemePopoverApi {
  /**
   * Whether a theme popover is currently open.
   *
   * Read by a caller that also handles Escape: `WeekThemePopover` listens on
   * `document`, and Preact attaches a cell's own handler to the element, so the
   * caller's handler runs FIRST on the way up. A grid that closed itself on
   * Escape without checking this would dismiss the whole chooser when the
   * reader only meant to close the theme they had just opened.
   */
  isOpen: boolean;
  registerAnchor: (week: number, el: HTMLButtonElement | null) => void;
  handlers: (week: number) => WeekCellThemeHandlers;
  /** The popover's portal, or null. Render it inside the caller's tree. */
  portal: ReturnType<typeof createPortal> | null;
}

/**
 * Long-press, right-click and Shift+F10 open a week's theme.
 *
 * Extracted from the filter panel's old `WeekSelector` so the day rail's week
 * chooser could reuse it. That is what kept week themes reachable when #274
 * phase 4 deleted the week strip and `WeekSelector` with it — the other
 * route, `WeekBadge` on the day header, was untouched throughout.
 *
 * `onActivate` is the plain tap: the caller decides what a tap means (select a
 * week, or navigate to one). The touch path is here rather than in the caller
 * because it is entangled with the long press — a tap is "a touch that ended
 * before the timer fired", which only this hook knows.
 */
export function useWeekThemePopover({ themes, onActivate }: {
  themes?: Record<number, WeekTheme>;
  onActivate: (week: number) => void;
}): WeekThemePopoverApi {
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
    popoverWeek !== null, activeAnchorRef, popoverContentRef, { mode: 'center' },
  );

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
  }, []);

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function openIfThemed(week: number) {
    if (themes && themes[week]) setPopoverWeek(week);
  }

  const popoverTheme = popoverWeek !== null ? themes?.[popoverWeek] : undefined;

  function handlers(week: number): WeekCellThemeHandlers {
    const hasTheme = !!themes?.[week];
    return {
      onContextMenu: (e) => {
        // Only suppress the browser's own menu when there is something to put
        // in its place.
        if (!hasTheme) return;
        e.preventDefault();
        openIfThemed(week);
      },
      onKeyDown: (e) => {
        // ContextMenu key (Windows menu key) and Shift+F10 (the universal
        // keyboard equivalent of right-click). Nothing else is touched here —
        // the caller owns its own arrow-key walk and its own Escape.
        if (hasTheme && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
          e.preventDefault();
          openIfThemed(week);
        }
      },
      onTouchStart: (e) => {
        longPressFiredRef.current = false;
        if (hasTheme) {
          clearLongPress();
          longPressTimer.current = window.setTimeout(() => {
            longPressFiredRef.current = true;
            openIfThemed(week);
          }, LONG_PRESS_MS);
        }
        // Suppresses the emulated click that would otherwise follow touchend
        // and activate the week a second time.
        e.preventDefault();
        if (!hasTheme) onActivate(week);
      },
      onTouchEnd: (e) => {
        clearLongPress();
        if (longPressFiredRef.current) {
          e.preventDefault();
          longPressFiredRef.current = false;
          return;
        }
        if (hasTheme) {
          e.preventDefault();
          onActivate(week);
        }
      },
      onTouchMove: () => clearLongPress(),
      onTouchCancel: () => {
        clearLongPress();
        longPressFiredRef.current = false;
      },
    };
  }

  const portal = popoverWeek !== null && popoverTheme
    ? createPortal(
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
    )
    : null;

  return {
    isOpen: popoverWeek !== null && !!popoverTheme,
    registerAnchor: (week, el) => { buttonRefs.current.set(week, el); },
    handlers,
    portal,
  };
}
