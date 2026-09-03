import catalog from '../data/catalog-2026.json';
import type { CatalogFile } from '../types/catalog';

/**
 * The catalog is a compiled artifact, not hand-written source, and the tool
 * that compiles it is not in this repository. Nothing else here would notice
 * if it were truncated, regenerated wrong, or hand-edited — so these are the
 * checks that stand in for the compiler's own.
 *
 * They assert invariants a reader would rely on, not the current contents: no
 * count is pinned, because regenerating from a corrected transcription should
 * not require editing a test.
 */
const file = catalog as unknown as CatalogFile;

describe('catalog-2026.json', () => {
  it('declares the season it is for', () => {
    expect(file.season).toBe(2026);
    expect(Number.isNaN(Date.parse(file.generatedAt))).toBe(false);
  });

  it('says where it came from, in prose a human can act on', () => {
    // The compiler lives outside this repo, so provenance travels with the
    // data or not at all.
    expect(file.source.catalog).toMatch(/\S/);
    expect(Number.isNaN(Date.parse(file.source.crawledAt))).toBe(false);
  });

  it('carries classes, each with an id and a title', () => {
    expect(file.classes.length).toBeGreaterThan(0);
    for (const c of file.classes) {
      expect(c.id).toMatch(/\S/);
      expect(c.title).toMatch(/\S/);
    }
  });

  it('gives every class a unique id', () => {
    const ids = file.classes.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never lets two classes claim the same eventAk', () => {
    // The join to the ticket site is one-to-many in one direction only: a
    // class may list several eventAks, but an eventAk names one class. Two
    // classes claiming one would make the runtime lookup order-dependent.
    const owner = new Map<string, string>();
    for (const c of file.classes) {
      for (const ak of c.eventAks) {
        const already = owner.get(ak);
        expect(already === undefined || already === c.id).toBe(true);
        owner.set(ak, c.id);
      }
    }
  });

  it('numbers weeks within the season', () => {
    for (const c of file.classes) {
      for (const w of c.weeks) {
        expect(Number.isInteger(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(1);
        expect(w).toBeLessThanOrEqual(9);
      }
    }
  });

  it('maps every season week to a forward-running date range', () => {
    const keys = Object.keys(file.weeks).map(Number).sort((a, b) => a - b);
    expect(keys).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const [, [start, end]] of Object.entries(file.weeks)) {
      expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(start <= end).toBe(true);
    }
  });

  it('runs its weeks in order, without gaps or overlaps', () => {
    // A week's range is derived, not transcribed, so a bad anchor shows up
    // here rather than as a class quietly filed under the wrong week.
    const ranges = Object.keys(file.weeks)
      .map(Number)
      .sort((a, b) => a - b)
      .map((w) => file.weeks[String(w)]);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i][0] > ranges[i - 1][1]).toBe(true);
    }
  });

  it('keeps age ranges the right way round', () => {
    for (const c of file.classes) {
      const { min, max } = c.ageRange;
      if (min !== null && max !== null) expect(min).toBeLessThanOrEqual(max);
    }
  });

  it('does not list a class as both matched and listed-only', () => {
    const claimed = new Set(file.classes.flatMap((c) => c.eventAks));
    for (const ak of file.listedOnly) expect(claimed.has(ak)).toBe(false);
  });
});
