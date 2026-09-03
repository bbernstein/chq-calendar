/**
 * The compiled catalog for a season, bundled with the code.
 *
 * Imported rather than read from disk: esbuild inlines the JSON into the
 * Lambda bundle, so there is no file to ship, no path to resolve and no
 * environment variable to forget. An earlier arrangement read the source
 * spreadsheet at runtime through a relative path that resolved outside the
 * bundle — a catalog the function could never have found.
 *
 * A season with no catalog is a normal state, not an error. 2027's will come
 * from somewhere other than a hand-made spreadsheet, and until it exists the
 * crawl publishes on its own with no descriptions attached.
 */
import type { CatalogFile } from '../types/catalog';
import catalog2026 from '../data/catalog-2026.json';

const BY_SEASON: Record<number, CatalogFile> = {
  // JSON import widens the week tuples to string[], so the assertion goes
  // through unknown. The shape is guaranteed by buildCatalog, which writes it
  // from the typed CatalogFile.
  2026: catalog2026 as unknown as CatalogFile,
};

export function catalogForSeason(year: number): CatalogFile | undefined {
  return BY_SEASON[year];
}
