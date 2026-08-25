// @vitest-environment node
//
// The suite's default `jsdom` environment (see vite.config.ts) shadows the
// global `URL` constructor with jsdom's, which resolves a relative URL
// against the document's `http://localhost:3000/` base rather than
// `import.meta.url`'s `file:` base — so `new URL('../../../app/globals.css',
// import.meta.url)` below would silently resolve to the wrong scheme
// entirely. This file has no DOM to test, so it opts back into Node's
// environment, where `URL` resolves relative to the importing file as
// `readFileSync` expects.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RAIL_BACKDROP, RAIL_BAND_LABEL, RAIL_PILL, UNREACHABLE_FILL_OPACITY,
  WEEK_BAND_RAMP, rampHex, rampPercent, rampBackground, type RailTheme,
} from '@/lib/utils/railBandPalette';

/**
 * WCAG 2.1 §1.4.3 and CIE 1976 ΔE*ab, computed here rather than sampled.
 * `theHelpersCanFail` below proves both can detect a known failure before
 * anything relies on them — the same discipline `DayChipContrastTests` and
 * `WeekBandContrastTests` apply on iOS.
 */
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const lab = (hex: string) => {
  const [r, g, b] = rgb(hex).map(linear);
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const [fx, fy, fz] = [f(x / 0.95047), f(y / 1.0), f(z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const deltaE = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
/** How far a colour's most and least intense channels are apart, on 0…255. */
const channelSpread = (hex: string) => Math.max(...rgb(hex)) - Math.min(...rgb(hex));
const toHex = (c: number[]) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** Ordinary source-over alpha compositing in sRGB — what `opacity` on a fill does. */
const composite = (top: string, backdrop: string, alpha: number) =>
  toHex(rgb(top).map((v, i) => v * alpha + rgb(backdrop)[i] * (1 - alpha)));

const THEMES = ['light', 'dark'] as const;
/** Nine weeks, so nine steps. Derived, not a literal 9 in the component. */
const STEPS = Array.from({ length: 9 }, (_, i) => i / 8);
/** WCAG AA for normal-size text. `WEEK n` is 10px — nowhere near "large". */
const AA_NORMAL = 4.5;
/** Between what a re-tint costs and what the neutral palette holds. */
const MIN_SEPARATION = 40;

describe('the helpers can fail', () => {
  it('catches a known WCAG failure', () => {
    // iOS's light endpoint against web's --foreground: 4.497:1, the reason the
    // web light endpoint is #7e858f and not #79808a.
    expect(ratio('#79808a', '#171717')).toBeLessThan(AA_NORMAL);
  });

  it('catches a known perceptual collision', () => {
    // blue-700 beside blue-600: two fills a reader could not tell apart.
    expect(deltaE('#1d4ed8', RAIL_PILL)).toBeLessThan(MIN_SEPARATION);
    expect(deltaE('#1d4ed8', RAIL_PILL)).toBeGreaterThan(0);
  });

  it('catches a re-tint toward the accent', () => {
    // The blue ramp #256 started from, and the endpoint that shipped a 1.196:1
    // collision on iOS. Both are neutral-looking numbers that are not neutral.
    expect(channelSpread('#8fa9c6')).toBeGreaterThan(24);
    expect(channelSpread('#5a7794')).toBeGreaterThan(24);
  });
});

describe('the week band ramp', () => {
  it.each(THEMES)('clears AA against the WEEK n label in %s', theme => {
    for (const step of STEPS) {
      const fill = rampHex(theme, step);
      expect(
        ratio(fill, RAIL_BAND_LABEL[theme]),
        `${fill} at step ${step}`,
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it.each(THEMES)('never collides with the highlight pill in %s', theme => {
    // A band segment sits directly above its own chip, so two fills of the
    // same tone merge into one shape and the highlighted chip grows a flag.
    for (const step of STEPS) {
      expect(deltaE(rampHex(theme, step), RAIL_PILL)).toBeGreaterThanOrEqual(MIN_SEPARATION);
    }
  });

  it.each(THEMES)('stays neutral while the pill stays saturated in %s', theme => {
    // The design rule the whole colour choice rests on, as an assertion rather
    // than a comment: the pill is the only saturated fill on the rail.
    expect(channelSpread(RAIL_PILL)).toBeGreaterThanOrEqual(40);
    for (const step of STEPS) {
      expect(channelSpread(rampHex(theme, step)), `step ${step}`).toBeLessThanOrEqual(24);
    }
  });

  it.each(THEMES)('is monotonic in luminance in %s', theme => {
    // What makes the two endpoints the extremes: a ramp that turned around in
    // the middle would make every check above stop proving anything.
    const lums = STEPS.map(s => luminance(rampHex(theme, s)));
    const rising = lums[lums.length - 1] > lums[0];
    for (let i = 1; i < lums.length; i++) {
      expect(rising ? lums[i] >= lums[i - 1] : lums[i] <= lums[i - 1]).toBe(true);
    }
    expect(lums[0]).not.toBe(lums[lums.length - 1]);
  });

  it.each(THEMES)('fading an unreachable week never costs the label contrast in %s', theme => {
    // Fade the FILL, never the label. Because the ramp sits between the rail's
    // background and the label's colour in both themes, a faded fill
    // composites *toward* the background, away from the label. That is the
    // claim; this checks it rather than trusting it.
    for (const step of STEPS) {
      const fill = rampHex(theme, step);
      const faded = composite(fill, RAIL_BACKDROP[theme], UNREACHABLE_FILL_OPACITY);
      const full = ratio(fill, RAIL_BAND_LABEL[theme]);
      const dimmed = ratio(faded, RAIL_BAND_LABEL[theme]);
      expect(dimmed).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(dimmed, 'fading moved the fill toward the label').toBeGreaterThanOrEqual(full);
    }
  });
});

describe('the CSS tokens and the TypeScript palette', () => {
  // The band paints with `color-mix` on two CSS custom properties; these tests
  // compute against TypeScript constants. Two copies of four hex values is
  // exactly the drift this reads the stylesheet to prevent.
  const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8');
  const block = css.slice(
    css.indexOf('/* week-band-ramp:start */'),
    css.indexOf('/* week-band-ramp:end */'),
  );
  const darkAt = block.indexOf('@media (prefers-color-scheme: dark)');
  const read = (name: string, where: string) =>
    where.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1];

  it('declares the ramp block once, with a dark override inside it', () => {
    expect(block).not.toBe('');
    expect(darkAt).toBeGreaterThan(0);
  });

  it.each(['start', 'end'] as const)('light --rail-band-%s matches the palette', which => {
    expect(read(`rail-band-${which}`, block.slice(0, darkAt))).toBe(WEEK_BAND_RAMP.light[which]);
  });

  it.each(['start', 'end'] as const)('dark --rail-band-%s matches the palette', which => {
    expect(read(`rail-band-${which}`, block.slice(darkAt))).toBe(WEEK_BAND_RAMP.dark[which]);
  });
});

describe('RAIL_BAND_LABEL and the CSS --foreground token', () => {
  // `RAIL_BAND_LABEL` is a hand copy of `--foreground` — `WeekBandCell` paints
  // the `WEEK n` label with the CSS variable directly, but every contrast
  // assertion above computes against this TypeScript constant. Unlike the
  // ramp block, `--foreground` carries no start/end markers of its own, so
  // this slices on `@layer base`'s own boundaries instead — the block that
  // actually declares it, ending at the `body {` rule that consumes it.
  const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8');
  const baseAt = css.indexOf('@layer base');
  const bodyAt = css.indexOf('body {', baseAt);
  const baseBlock = css.slice(baseAt, bodyAt);
  const baseDarkAt = baseBlock.indexOf('@media (prefers-color-scheme: dark)');
  const read = (name: string, where: string) =>
    where.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1];

  it('finds the base layer\'s light and dark declarations', () => {
    expect(baseAt).toBeGreaterThan(0);
    expect(baseDarkAt).toBeGreaterThan(0);
  });

  it('light RAIL_BAND_LABEL matches --foreground', () => {
    expect(read('foreground', baseBlock.slice(0, baseDarkAt))).toBe(RAIL_BAND_LABEL.light);
  });

  it('dark RAIL_BAND_LABEL matches --foreground', () => {
    expect(read('foreground', baseBlock.slice(baseDarkAt))).toBe(RAIL_BAND_LABEL.dark);
  });
});

describe('RAIL_BACKDROP and the rail\'s own background classes', () => {
  // RAIL_BACKDROP is a hand copy of DayRail's `bg-white dark:bg-gray-800` —
  // nothing reads it back either, so a class change on the rail's root could
  // leave the whole contrast suite green against a backdrop it no longer
  // paints. `CLASS_HEX` states what Tailwind actually resolves each class to
  // (not a re-derivation of Tailwind's palette, a fixed fact about it), so
  // this can fail two ways: the class disappearing from DayRail.tsx, or
  // RAIL_BACKDROP drifting from what the class paints.
  const dayRailSrc = readFileSync(
    new URL('../../../components/calendar/DayRail.tsx', import.meta.url), 'utf8',
  );
  const CLASS_HEX: Record<RailTheme, { class: string; hex: string }> = {
    light: { class: 'bg-white', hex: '#ffffff' },
    dark: { class: 'dark:bg-gray-800', hex: '#1f2937' },
  };

  it.each(THEMES)('RAIL_BACKDROP matches what DayRail\'s %s backdrop class paints', theme => {
    const { class: cls, hex } = CLASS_HEX[theme];
    expect(dayRailSrc).toMatch(new RegExp(`\\b${cls.replace(':', '\\:')}\\b`));
    expect(RAIL_BACKDROP[theme]).toBe(hex);
  });
});

describe('rampBackground', () => {
  it('mixes the two tokens by the step, so the painted colour is the tested one', () => {
    expect(rampBackground(0.5))
      .toBe('color-mix(in srgb, var(--rail-band-end) 50%, var(--rail-band-start))');
  });

  it('resolves the endpoints exactly', () => {
    expect(rampHex('light', 0)).toBe(WEEK_BAND_RAMP.light.start);
    expect(rampHex('light', 1)).toBe(WEEK_BAND_RAMP.light.end);
  });

  it('clamps a step outside 0…1 rather than extrapolating off the ramp', () => {
    expect(rampPercent(-3)).toBe(0);
    expect(rampPercent(7)).toBe(100);
    expect(rampPercent(Number.NaN)).toBe(0);
  });
});

describe("the chooser icon's lit cell", () => {
  // AA for non-text: a graphical object needs 3:1 against what is behind it.
  const AA_NON_TEXT = 3;

  it.each(THEMES)('cannot be identified by its tone alone in %s', theme => {
    // THE REASON THE RING EXISTS, as a measurement rather than a comment.
    // The lit cell is painted in its week's ramp tone, on the rail's own
    // backdrop. Early steps of the ramp are nearly the backdrop: ~1.5:1 in
    // light, ~1.03:1 in dark. A future reader who deletes the ring as
    // redundant decoration makes weeks 1-3 unfindable in dark mode.
    const worst = Math.min(...STEPS.map(s => ratio(rampHex(theme, s), RAIL_BACKDROP[theme])));
    expect(worst).toBeLessThan(AA_NON_TEXT);
  });

  it.each(THEMES)('is identified by its ring, which clears AA for a graphic in %s', theme => {
    // The ring is drawn in `--foreground`, which is `RAIL_BAND_LABEL`.
    expect(ratio(RAIL_BAND_LABEL[theme], RAIL_BACKDROP[theme]))
      .toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('draws the ring in a token the stylesheet actually defines', () => {
    // `var(--foreground)` and RAIL_BAND_LABEL are already pinned to each other
    // above; this pins the icon to that variable rather than to a literal.
    const src = readFileSync(
      resolve(__dirname, '../../../components/calendar/WeekChooserIcon.tsx'), 'utf8');
    expect(src).toContain('var(--foreground)');
  });
});

describe("the current week's cell in the chooser grid", () => {
  it("reads white on the pill, the rail's one saturated fill", () => {
    // Same pairing as the rail's highlight: the pill means "you are here", in
    // exactly one place, in exactly one colour.
    expect(ratio('#ffffff', RAIL_PILL)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
