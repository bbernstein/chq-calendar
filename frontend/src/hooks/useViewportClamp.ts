import { useLayoutEffect, useState } from 'react';

const DEFAULT_MARGIN_PX = 8;

interface FloatingOptions {
  /**
   * How the anchor's horizontal position maps to the popover's natural one:
   * - "left" (default): popover's left edge aligns with the anchor's left.
   * - "center": popover is centered on the anchor's horizontal midpoint.
   */
  mode?: 'left' | 'center';
  marginPx?: number;
  /** Pixels of gap to leave below the anchor. */
  gapPx?: number;
}

export interface FloatingCoords {
  /** Viewport-relative top (for `position: fixed`). */
  top: number;
  /** Viewport-relative left (for `position: fixed`). */
  left: number;
}

/**
 * Returns viewport-relative coordinates for rendering a popover with
 * `position: fixed` underneath `anchorRef`, clamped horizontally to stay
 * within the viewport. Re-runs on open and on resize/scroll while open.
 */
export function useFloatingCoords(
  enabled: boolean,
  anchorRef: { current: HTMLElement | null },
  popoverRef: { current: HTMLElement | null },
  options: FloatingOptions = {},
): FloatingCoords | null {
  const { mode = 'left', marginPx = DEFAULT_MARGIN_PX, gapPx = 8 } = options;
  const [coords, setCoords] = useState<FloatingCoords | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setCoords(null);
      return;
    }
    function reposition() {
      const anchor = anchorRef.current;
      const pop = popoverRef.current;
      if (!anchor || !pop) return;
      const anchorRect = anchor.getBoundingClientRect();
      const popRect = pop.getBoundingClientRect();
      const naturalLeft = mode === 'center'
        ? anchorRect.left + anchorRect.width / 2 - popRect.width / 2
        : anchorRect.left;
      const minLeft = marginPx;
      const maxLeft = window.innerWidth - popRect.width - marginPx;
      const left = Math.max(minLeft, Math.min(naturalLeft, maxLeft));
      const top = anchorRect.bottom + gapPx;
      setCoords({ top, left });
    }
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [enabled, anchorRef, popoverRef, mode, marginPx, gapPx]);

  return coords;
}
