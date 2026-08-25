import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The half of the reveal (#272) that lives in CSS.
 *
 * jsdom applies no stylesheet, so none of this is reachable from a rendering
 * test — and every rule below has a failure mode that ships silently. This
 * reads the file.
 */
const css = readFileSync(resolve(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');

/** The `@property --site-header-offset { … }` block, whitespace-normalised. */
const registration = css.match(/@property\s+--site-header-offset\s*\{[^}]*\}/)?.[0]
  .replace(/\s+/g, ' ') ?? '';

/**
 * The bodies of every `@media (prefers-reduced-motion: no-preference)` block,
 * matched by counting braces rather than by regex.
 *
 * The naive version of this check — "is the nearest `@media` above the
 * declaration a no-preference one" — passes when the declaration is outside
 * every block, because the filter panel's own no-preference block sits above
 * it in the file. Caught by breaking the code; the guard was worthless until
 * it counted braces.
 */
const noPreferenceBlocks = (): string[] => {
  const opener = '@media (prefers-reduced-motion: no-preference) {';
  const bodies: string[] = [];
  for (let at = css.indexOf(opener); at !== -1; at = css.indexOf(opener, at + 1)) {
    let depth = 0;
    let i = at + opener.length - 1;
    do {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') depth -= 1;
      i += 1;
    } while (depth > 0 && i < css.length);
    bodies.push(css.slice(at + opener.length, i - 1));
  }
  return bodies;
};

describe('globals.css — the site header reveal', () => {
  // Unregistered, a custom property is an untyped token stream and cannot be
  // interpolated: the header would jump between shown and hidden rather than
  // slide, in every browser. Registering it as a length is what makes the one
  // shared value animatable.
  it('registers the offset as a length so it can be animated', () => {
    expect(registration).toContain("syntax: '<length>'");
  });

  it('inherits the offset, since the header and the rail both read it', () => {
    expect(registration).toContain('inherits: true');
  });

  // The hook writes the offset in an effect. Between first paint and that
  // effect there is no value at all — and `top: calc(0px - headerH)` parks the
  // header out of sight. Without this default the site would load with its
  // header already hidden at the top of the document, which no jsdom test can
  // see because jsdom applies no stylesheet.
  it('defaults to shown, so first paint is not a parked header', () => {
    const rootDefault = css.match(/--site-header-offset:\s*([^;]+);/)?.[1];
    expect(rootDefault).toBe('var(--site-header-h, 0px)');
  });

  // Same reasoning, for a browser that drops the `@property` registration:
  // `initial-value: 0px` is the hidden end of the travel, so the fallback must
  // never be the thing that decides the header's resting state.
  it('registers an initial value at the hidden end, and never relies on it', () => {
    expect(registration).toContain('initial-value: 0px');
    expect(css.indexOf('--site-header-offset: var(--site-header-h, 0px)')).toBeGreaterThan(-1);
  });

  // Declared inside the no-preference block rather than declared and then
  // unset, matching the filter panel's exit above it: a reader who asked for
  // reduced motion never has a transition to override in the first place.
  it('animates only when the reader has not asked for reduced motion', () => {
    expect(css).toContain('transition: --site-header-offset');
    expect(noPreferenceBlocks().some((b) => b.includes('transition: --site-header-offset'))).toBe(true);
  });

  // The extractor is only worth anything if it is really finding block
  // bodies. A brace count that ran off the end would return the rest of the
  // file and make the assertion above vacuously true.
  it('reads block bodies rather than the rest of the file', () => {
    const blocks = noPreferenceBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    // The filter panel's exit block is a sibling, not a container.
    expect(blocks.some((b) => b.includes('.filter-panel-exit'))).toBe(true);
    expect(blocks.find((b) => b.includes('.filter-panel-exit')))
      .not.toContain('--site-header-offset');
  });

  // Transitioning `top` instead would also animate the filter header flipping
  // between parked and pinned — that is the panel's own reveal, choreographed
  // separately, and sliding it would be a regression in a different feature.
  it('animates the shared variable, never the sticky tops it feeds', () => {
    expect(css).not.toMatch(/transition:[^;]*\btop\b/);
  });
});
