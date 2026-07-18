/// <reference types="vitest/globals" />
import { buildSitemapXml, PUBLIC_PATHS, SITE_ORIGIN } from '@/lib/sitemap';

describe('buildSitemapXml', () => {
  it('renders each path as an absolute <loc> under the given origin', () => {
    const xml = buildSitemapXml(['/', '/feedback'], 'https://example.org');
    expect(xml).toContain('<loc>https://example.org/</loc>');
    expect(xml).toContain('<loc>https://example.org/feedback</loc>');
  });

  it('emits exactly one <url> element per path', () => {
    const xml = buildSitemapXml(PUBLIC_PATHS);
    const count = (xml.match(/<url>/g) || []).length;
    expect(count).toBe(PUBLIC_PATHS.length);
  });

  it('defaults to the production origin', () => {
    expect(buildSitemapXml(['/'])).toContain(`<loc>${SITE_ORIGIN}/</loc>`);
  });

  it('never lists admin or publish routes', () => {
    const xml = buildSitemapXml(PUBLIC_PATHS);
    expect(xml).not.toContain('/admin');
    expect(xml).not.toContain('/publish');
  });

  it('is well-formed XML with a urlset root', () => {
    const xml = buildSitemapXml(PUBLIC_PATHS);
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
});
