// Reusable accessible modal/dialog wrapper for the publisher portal.
//
// Behavior:
//   - role="dialog" aria-modal="true" with aria-labelledby pointing at the
//     caller-supplied titleId.
//   - Esc closes the modal (calls onClose). Disable via closeOnEsc={false}
//     for typed-confirmation gates where accidental dismissal would defeat
//     the gate (DangerZone passes false).
//   - Focus trap: Tab from the last focusable wraps to the first;
//     Shift+Tab from the first wraps to the last. Focusables: a, button,
//     input, textarea, select, [tabindex] — minus [disabled] and
//     tabindex="-1".
//   - Initial focus: first focusable inside the modal on mount. Falls back
//     to the modal container itself (so screen readers still announce the
//     dialog when there are no focusable children — uncommon but possible).
//   - Restore focus: the previously-focused element when the modal opened
//     gets focus again on unmount, so keyboard users return to where they
//     clicked.
//
// Caller convention: render the modal conditionally
//   {open && <Modal onClose={...} titleId="...">...</Modal>}
// rather than passing an `open` prop. Matches the existing
// publisher-portal pattern and avoids paying for the document-level
// listener when the modal isn't shown.

import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  // Custom-tabindex elements: still skip if disabled (e.g. a disabled
  // button with an explicit tabindex). Without the :not([disabled])
  // guard a disabled element could receive initial focus or be a
  // focus-trap boundary, which the trap should not allow.
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(', ');

export interface ModalProps {
  // Called when Esc is pressed (when closeOnEsc is enabled). Callers wire
  // this to the same handler their Cancel button uses.
  onClose: () => void;

  // The id of the heading element inside `children`. Used for
  // aria-labelledby so screen readers announce the dialog correctly.
  titleId: string;

  children: ReactNode;

  // Default true. Pass false for typed-confirmation gates where a stray
  // Esc keypress shouldn't cancel a destructive action the user already
  // committed to typing through.
  closeOnEsc?: boolean;

  // Optional override for the inner card classes. Defaults to a max-w-md
  // panel — matches all current portal modals.
  className?: string;

  // Default false. When true, clicking the backdrop (the area outside the
  // dialog card) calls onClose. Off by default because typed-confirmation
  // gates and forms with unsaved input would lose user work to a stray
  // backdrop click. Opt in only when the modal is showing read-only or
  // already-cancelable content.
  closeOnBackdropClick?: boolean;
}

export function Modal({
  onClose,
  titleId,
  children,
  closeOnEsc = true,
  className = 'bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6',
  closeOnBackdropClick = false,
}: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Captured at mount; restored on unmount. Stored in a ref so the cleanup
  // sees the original element even after re-renders shuffle focus around.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;

    // Focus the first focusable child. If none exist, focus the container
    // itself so the dialog gets keyboard focus (and screen reader virtual
    // cursor moves into it). The container has tabIndex={-1} for that.
    const container = containerRef.current;
    if (container) {
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        container.focus();
      }
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && closeOnEsc) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap. Compute focusables fresh on each Tab so dynamically-
      // disabled buttons (e.g. busy spinners) are accounted for.
      const c = containerRef.current;
      if (!c) return;
      const focusables = Array.from(c.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        // Nothing to cycle to; keep focus on the container.
        e.preventDefault();
        c.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Treat "focus is somewhere outside the modal" the same as being at
      // the boundary in either direction. Otherwise a programmatic focus
      // change that pushes activeElement behind the modal would let the
      // very next Tab move into background DOM instead of cycling within
      // the dialog.
      const outside = !c.contains(active);
      if (e.shiftKey) {
        if (active === first || outside) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || outside) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Best-effort focus restore. If the previous element is gone (e.g.
      // because the parent re-rendered while the modal was open), do
      // nothing — the browser default focus behavior takes over.
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        prev.focus();
      }
    };
    // onClose and closeOnEsc are intentionally stable across the modal
    // lifetime (callers pass inline arrows but the effect re-binds on every
    // render anyway, which is cheap — one document listener swap).
  }, [onClose, closeOnEsc]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={closeOnBackdropClick ? onClose : undefined}
    >
      {/* role/aria/tabIndex live on the focused element (the card), not the
          backdrop, so screen readers announce the dialog title at the same
          time keyboard focus enters the dialog content. */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={className}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
