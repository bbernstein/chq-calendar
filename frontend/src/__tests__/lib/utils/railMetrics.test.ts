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
import { describe, expect, it } from 'vitest';
import {
  RAIL_BAND_BLEED_PX, RAIL_BAND_HEIGHT_PX, RAIL_CHIP_GUTTER_PX, RAIL_WEEK_SEAM_PX,
} from '@/lib/utils/railMetrics';

describe('railMetrics', () => {
  it('derives the bleed and the seam from the chip gutter', () => {
    // Two independent 2s would drift the moment the gutter was tuned, and the
    // symptom would be a hairline or an overlap seam between two bridged
    // neighbours — not an error.
    expect(RAIL_BAND_BLEED_PX).toBe(RAIL_CHIP_GUTTER_PX / 2);
    expect(RAIL_WEEK_SEAM_PX).toBe(RAIL_CHIP_GUTTER_PX / 2);
  });

  it('matches the --rail-band-h the stylesheet publishes', () => {
    // The band's box is sized in CSS and its spacer in the clipped copy row is
    // sized from the same token; this pins the TypeScript copy the browser
    // checks are written against.
    const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8');
    expect(css).toContain(`--rail-band-h: ${RAIL_BAND_HEIGHT_PX}px;`);
  });
});
