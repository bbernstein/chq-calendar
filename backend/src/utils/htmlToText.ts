import * as cheerio from 'cheerio';

/**
 * Strip HTML to plain text: tags removed, entities decoded, whitespace
 * collapsed to single spaces. Used on WP `title/excerpt/content.rendered`.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  return $.root().text().replace(/\s+/g, ' ').trim();
}
