/**
 * D5: a funnel icon replaces the word "Filters" on the rail, where
 * horizontal space is scarcest. Purely presentational — it knows nothing
 * about the panel's open/closed state, only whether to paint the
 * active-filter dot, so it stays testable without a panel harness.
 *
 * Decorative in both parts: the toggle button that renders this already
 * carries `aria-label="Filters"` (see DayRail.tsx), so the funnel SVG and
 * the dot are each marked `aria-hidden="true"` individually — letting
 * either paint into the accessible name would silently rename the control
 * a screen-reader user has already learned.
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
