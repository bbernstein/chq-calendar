/**
 * D4's drawer affordance: a centred downward caret at the panel's bottom
 * edge, closing it on tap. Purely presentational — no knowledge of the
 * panel's open/exit state, which `page.tsx` already owns via
 * `useFilterPanel`; this just renders a full-width button and calls
 * `onClose`.
 *
 * Placement matters as much as the pixels: the caller must mount this
 * INSIDE the panel element that `useFilterPanel`'s `panelRef` points to.
 * `isExempt` (in useFilterPanel.ts) spares any gesture whose target lies
 * inside that element, so a caret rendered there is automatically not
 * treated as a dismissing scroll gesture. Rendered outside it, a tap would
 * become a gesture *and* an explicit close — the double-handling trap this
 * plan already hit once with the rail's own toggle button.
 *
 * Hit area: `h-11 w-full` (44px tall, full panel width) is the class-level
 * pin. jsdom computes no layout, so the actual rendered box cannot be
 * measured here — the Playwright pass measures it at 390x844.
 *
 * `sticky bottom-0` pins it to the bottom edge of the panel's scroll
 * container, so it stays on screen when the panel's contents overflow their
 * cap — search, the favourites toggle, venues, categories and active chips
 * exceed the viewport on a phone, and a drawer handle the reader has to
 * scroll the drawer to find is not a drawer handle. It carries the panel's own
 * background for the reason anything sticky does: without it the content it is
 * pinned over shows through.
 *
 * This is NOT new in #274 phase 3, and a review that flagged it there as a
 * regression had the history backwards — the caret was inside the
 * `max-h-[70vh] overflow-y-auto` element before that phase too (see `page.tsx`
 * on `main`: the caret is a sibling of the padded content div, inside the
 * capped card). It has simply been worth fixing since it was written.
 */
export function FilterPanelCaret({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Hide filters"
      onClick={onClose}
      className="sticky bottom-0 flex h-11 w-full items-center justify-center bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
    >
      <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z" />
      </svg>
    </button>
  );
}
