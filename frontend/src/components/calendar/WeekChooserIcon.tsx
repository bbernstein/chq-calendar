import { rampBackground } from '@/lib/utils/railBandPalette';

/**
 * The chooser trigger's face: a miniature of the grid it opens, with the
 * current week's cell lit.
 *
 * Position-in-season, spatially. A numeral gives the same fact only once the
 * reader has related it to a nine-week season; the lit cell moving down and
 * across as they scroll gives it without arithmetic.
 *
 * Accepted risk, recorded in the design: a bare 3x3 is also the generic
 * apps/grid icon, so "weeks" comes from context — the lit cell moving as the
 * reader scrolls, the `WEEK n` band immediately beside it, and the grid itself
 * on first tap.
 *
 * Decorative throughout. The trigger button carries the accessible name (see
 * `WeekChooser`), so nothing here may paint into it — the same rule
 * `FiltersIcon` follows, and for the same reason: letting the icon contribute
 * would silently rename a control a screen-reader user has already learned.
 *
 * 3 columns x 4px + 2 gaps x 2px = 16px, matching `FiltersIcon`'s box.
 */
export function WeekChooserIcon({ rows, currentWeek, denominator }: {
  rows: number[][];
  currentWeek: number | null;
  denominator: number;
}) {
  return (
    <span
      aria-hidden="true"
      data-week-chooser-icon
      className="inline-flex flex-col gap-[2px]"
    >
      {rows.map((row, rowIndex) => (
        <span key={rowIndex} className="flex gap-[2px]">
          {row.map(week => {
            const lit = week === currentWeek;
            return (
              <span
                key={week}
                data-week-chooser-cell={week}
                data-lit={lit ? 'true' : undefined}
                className="block h-1 w-1 rounded-[1px]"
                style={lit
                  ? {
                    // The week's own tone, so the icon reads as a legend for
                    // the band beside it — plus a ring, because the tone alone
                    // is ~1.03:1 against this backdrop in dark mode and ~1.5:1
                    // in light. `weekBandContrast.test.ts` pins both numbers;
                    // the ring is the signal, the tone is the annotation.
                    // `boxShadow`, not `border`: a border would change the box
                    // and shift every cell beside it.
                    background: rampBackground((week - 1) / denominator),
                    boxShadow: '0 0 0 1px var(--foreground)',
                  }
                  : { backgroundColor: 'currentColor', opacity: 0.35 }}
              />
            );
          })}
        </span>
      ))}
    </span>
  );
}
