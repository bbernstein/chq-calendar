/**
 * The rail's shared horizontal metrics.
 *
 * One place, because the band's fill overflow is *derived* from the chip
 * gutter rather than being a second literal that happens to match today: the
 * fill bridges exactly half a gutter on each side, so two bridged neighbours
 * meet with no hairline and no overlap seam. Mirrors iOS's `RailMetrics`.
 *
 * The gutter is applied as an inline `gap` on the rail's two stacked rows
 * rather than as Tailwind's `gap-1`, so the constant the bleed is derived from
 * is the same one the browser lays out with.
 */

/** Space between two day chips. */
export const RAIL_CHIP_GUTTER_PX = 4;

/**
 * How far a bridged band fill overflows its own segment on one side — half the
 * gutter, so two neighbours' overflows meet exactly at the gutter's midpoint.
 */
export const RAIL_BAND_BLEED_PX = RAIL_CHIP_GUTTER_PX / 2;

/**
 * The break between two weeks' runs, drawn through the middle of the boundary
 * Saturday they share.
 *
 * Deliberately *narrower* than a chip gutter: it is the only gap left in the
 * band, so it does not need to shout, and a wider one would start to look like
 * the per-chip gaps this design removes.
 */
export const RAIL_WEEK_SEAM_PX = RAIL_CHIP_GUTTER_PX / 2;

/**
 * The band's height. Published as `--rail-band-h` in `globals.css`, which is
 * what sizes both the band itself and the transparent spacer that keeps the
 * clipped copy row in step with it.
 */
export const RAIL_BAND_HEIGHT_PX = 16;

/**
 * Rounding on a run's outer ends. Small enough to stay a bar rather than a
 * capsule, large enough that a run reads as one closed shape.
 */
export const RAIL_BAND_RADIUS_PX = 3;
