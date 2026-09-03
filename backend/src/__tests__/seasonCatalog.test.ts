import { catalogForSeason } from '../services/seasonCatalog';

describe('the compiled season catalog', () => {
  it('is bundled with the code, not read from disk', () => {
    // The point of the compile step: no CSV, no path, no env var. If this
    // resolves, the Lambda has it too — esbuild inlines the JSON.
    const catalog = catalogForSeason(2026);
    expect(catalog).toBeDefined();
    expect(catalog!.season).toBe(2026);
    expect(catalog!.classes.length).toBeGreaterThan(400);
  });

  it('carries the join, so no matching happens at runtime', () => {
    const catalog = catalogForSeason(2026)!;
    const joined = catalog.classes.filter((c) => c.eventAks.length > 0);
    expect(joined.length).toBeGreaterThan(400);
    // Every id looks like the ticket site's, and none is claimed twice.
    const all = catalog.classes.flatMap((c) => c.eventAks);
    expect(all.every((ak) => /^CHQ\.EVN\d+$/.test(ak))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it('dates all nine season weeks', () => {
    const { weeks } = catalogForSeason(2026)!;
    expect(Object.keys(weeks).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    for (let w = 1; w <= 9; w++) {
      const [start, end] = weeks[String(w)];
      expect(start <= end).toBe(true);
      // Consecutive: each week begins after the one before it ends.
      if (w > 1) expect(start > weeks[String(w - 1)][1]).toBe(true);
    }
  });

  it('has nothing for a season nobody has compiled', () => {
    // Not an error. 2027's catalog will come from somewhere else, and until
    // it does the crawl publishes on its own.
    expect(catalogForSeason(2027)).toBeUndefined();
  });
});
