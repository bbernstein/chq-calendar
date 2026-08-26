/**
 * D5: a funnel icon in place of the word "Filters". Purely presentational —
 * it knows nothing about the panel's open/closed state, only whether to paint
 * the active-filter dot, so it stays testable without a panel harness.
 *
 * It was introduced for the day rail, where horizontal space is scarcest, and
 * moved with the toggle into the site header in #274 phase 3 (see
 * `Header.tsx`; the rail hosts no Filters control at all now). The space
 * argument still holds where it landed — the header's right cluster carries
 * the funnel plus one or three link controls on a phone-width row.
 *
 * Decorative in both parts: the toggle button that renders this carries its
 * own `aria-label="Filters"`, so the funnel SVG and the dot are each marked
 * `aria-hidden="true"` individually. Worth being exact about what that buys,
 * because the obvious reading is wrong and was falsified: an explicit
 * `aria-label` on the button already outranks its contents, so a label on the
 * SVG could not rename the control anyway. What `aria-hidden` prevents is the
 * icon and the dot being announced as content in their own right.
 */
export function FiltersIcon({ active }: { active: boolean }) {
  return (
    <span className="relative inline-flex shrink-0">
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 .8 1.6L12 10.5V16a1 1 0 0 1-1.45.9l-2-1A1 1 0 0 1 8 15v-4.5L3.2 4.6A1 1 0 0 1 3 4Z" />
      </svg>
      {active && (
        // D5 / "Why the dot matters": an icon alone can't tell the reader
        // whether they're looking at everything or a slice, and neither
        // could the word it replaces — this is the one place the change
        // adds something rather than merely preserving it.
        <span
          aria-hidden="true"
          data-testid="filters-active-dot"
          className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 ring-1 ring-blue-50 dark:ring-gray-700"
        />
      )}
    </span>
  );
}
