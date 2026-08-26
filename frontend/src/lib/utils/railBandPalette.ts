/**
 * The week band's colour ramp.
 *
 * A **lightness** ramp, not a hue ramp: adjacent weeks always differ, and it
 * survives colour-vision deficiency. Ported from iOS's `WeekBandStart` /
 * `WeekBandEnd` colorsets, with one deliberate change — iOS's light-mode
 * `WeekBandEnd` (`#79808a`) was checked against `UIColor.label`, which is pure
 * black; against web's `--foreground` (`#171717`) it computes 4.497:1 and
 * fails AA. `#7e858f` computes 4.814:1.
 *
 * The endpoints live here as well as in `globals.css` because the CSS is what
 * paints and TypeScript is what `weekBandContrast.test.ts` computes against.
 * That test reads the stylesheet and asserts the two agree, so the duplication
 * cannot drift silently.
 *
 * If a future palette change fails the contrast floor, the fix is to pull the
 * endpoints closer together (less lightness travel, still monotonic) or to
 * demote the fill to a thin rule under a normally-coloured label — never to
 * loosen the floor.
 */
export type RailTheme = 'light' | 'dark';

export const WEEK_BAND_RAMP: Record<RailTheme, { start: string; end: string }> = {
  light: { start: '#cfd4db', end: '#7e858f' },
  dark: { start: '#262b31', end: '#565c64' },
};

/** The colour the `WEEK n` label is drawn in — `--foreground`, per theme. */
export const RAIL_BAND_LABEL: Record<RailTheme, string> = {
  light: '#171717',
  dark: '#ededed',
};

/** The rail's own opaque backdrop — `bg-white dark:bg-gray-800`. */
export const RAIL_BACKDROP: Record<RailTheme, string> = {
  light: '#ffffff',
  dark: '#1f2937',
};

/**
 * The one saturated fill on the rail — the highlight pill, `bg-blue-600`.
 *
 * It means exactly one thing ("you are here"), which is why the band is
 * neutral. Re-tinting the ramp back toward it is the exact change that caused
 * iOS's one real collision, where the band and the selected chip merged into a
 * single shape.
 */
export const RAIL_PILL = '#2563eb';

/**
 * How far an unreachable week's fill is faded.
 *
 * **The fill, never the `WEEK n` label.** A dimming pass over the whole label
 * is what took an empty iOS chip's text to a sampled ~3.7:1. Fading only the
 * fill cannot repeat that: the ramp sits between the rail's background and the
 * label's colour in both themes, so a faded fill composites *toward* the
 * background and can only raise the label's contrast.
 */
export const UNREACHABLE_FILL_OPACITY = 0.3;

/**
 * The step, clamped and rounded to whole percent.
 *
 * Shared by `rampBackground` and `rampHex` so the colour the contrast test
 * computes is byte-for-byte the colour the browser paints, rather than a
 * neighbouring one that rounds differently.
 */
export function rampPercent(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.round(Math.min(1, Math.max(0, step)) * 100);
}

/** What a band bar paints with. `color-mix` in sRGB is a plain linear mix. */
export function rampBackground(step: number): string {
  return `color-mix(in srgb, var(--rail-band-end) ${rampPercent(step)}%, var(--rail-band-start))`;
}

/** The same mix, resolved — for tests, which have no browser to ask. */
export function rampHex(theme: RailTheme, step: number): string {
  const { start, end } = WEEK_BAND_RAMP[theme];
  const t = rampPercent(step) / 100;
  const channels = [1, 3, 5].map(i => {
    const a = parseInt(start.slice(i, i + 2), 16);
    const b = parseInt(end.slice(i, i + 2), 16);
    return Math.round(a + (b - a) * t);
  });
  return `#${channels.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}
