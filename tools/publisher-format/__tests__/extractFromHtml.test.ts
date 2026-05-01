import * as fs from 'fs';
import * as path from 'path';
import { extractFromHtml } from '../src/extractFromHtml';

const html = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

describe('extractFromHtml', () => {
  it('extracts a loose chq-event with a page-level chq-publisher', () => {
    const r = extractFromHtml(html('single-event-page.html'));
    expect(r.errors).toEqual([]);
    expect(r.feed?.events).toHaveLength(1);
    expect(r.feed?.events[0].id).toBe('e1');
    expect(r.feed?.publisher.id).toBe('test-pub');
  });

  it('extracts events from a chq-events feed block', () => {
    const r = extractFromHtml(html('feed-page.html'));
    expect(r.errors).toEqual([]);
    expect(r.feed?.events.length).toBeGreaterThan(0);
  });

  it('combines chq-events and loose chq-event on one page', () => {
    const r = extractFromHtml(html('aggregator-page.html'));
    expect(r.errors).toEqual([]);
    expect(r.feed?.events.length).toBeGreaterThan(1);
  });

  it('rejects pages with multiple distinct publisher ids', () => {
    const r = extractFromHtml(html('multi-publisher-aggregator.html'));
    expect(r.errors.some(e => e.code === 'multi-publisher')).toBe(true);
    expect(r.feed).toBeNull();
  });

  it('errors when chq-event has no chq-publisher fallback', () => {
    const noPublisherHtml = '<html><body><!-- chq-event { "id": "x", "title": "x", "startDate": "2026-07-04T18:00:00-04:00", "endDate": "2026-07-04T19:00:00-04:00", "category": "X", "lastModified": "2026-05-01T12:00:00-04:00" } --></body></html>';
    const r = extractFromHtml(noPublisherHtml);
    expect(r.errors.some(e => e.code === 'missing-page-publisher')).toBe(true);
  });

  it('enforces registeredPublisherId when supplied', () => {
    const r = extractFromHtml(html('single-event-page.html'), { registeredPublisherId: 'someone-else' });
    expect(r.errors.some(e => e.code === 'publisher-id-mismatch')).toBe(true);
  });
});
