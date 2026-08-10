/**
 * Sitemap generation for chqcal.org.
 *
 * Pure and dependency-free so it is unit-testable and can be imported by
 * both the Vite build plugin and tests. Only PUBLIC, indexable routes belong
 * here — admin/publish pages are intentionally excluded and are additionally
 * noindex'd at the page level.
 */
export const SITE_ORIGIN = 'https://www.chqcal.org';

// The only routes we want in the search index for Phase 1.
export const PUBLIC_PATHS = [
  '/', '/about', '/about/iphone', '/about/web', '/feedback', '/privacy', '/support',
] as const;

// Escape the XML-significant characters that are legal in a URL (notably `&`
// in query strings). Harmless for the hardcoded Phase 1 paths, but keeps the
// output well-formed once Phase 2 adds dynamic/query-bearing event URLs.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildSitemapXml(
  paths: readonly string[],
  origin: string = SITE_ORIGIN,
): string {
  const urls = paths
    .map((p) => `  <url>\n    <loc>${escapeXml(`${origin}${p}`)}</loc>\n  </url>`)
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls}\n` +
    '</urlset>\n'
  );
}
