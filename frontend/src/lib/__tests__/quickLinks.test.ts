import { describe, it, expect } from 'vitest';
import { quickLinks } from '@/lib/quickLinks';

describe('quickLinks (shared/links.json)', () => {
  it('includes the Chautauqua Fund link', () => {
    const fund = quickLinks.find((l) => l.id === 'chautauqua-fund');
    expect(fund?.title).toBe('CHQ Fund');
    expect(fund?.url).toBe('https://giving.chq.org/');
  });

  it('includes the captions link', () => {
    const captions = quickLinks.find((l) => l.id === 'captions');
    expect(captions?.title).toBe('Captions');
    expect(captions?.url).toBe('https://captions.chq.org/');
  });

  it('every link has a non-empty id, title, and absolute https url', () => {
    for (const link of quickLinks) {
      expect(link.id).toMatch(/^[a-z0-9-]+$/);
      expect(link.title.trim().length).toBeGreaterThan(0);
      expect(link.url).toMatch(/^https:\/\//);
    }
  });

  it('feedback keeps its relative webPath for same-site navigation', () => {
    expect(quickLinks.find((l) => l.id === 'feedback')?.webPath).toBe('/feedback');
  });

  it('any webPath present is a non-empty root-relative path', () => {
    // The header opens webPath verbatim when set, so an empty or
    // non-relative value would silently break that link.
    for (const link of quickLinks) {
      if (link.webPath !== undefined) {
        expect(link.webPath).toMatch(/^\/\S*$/);
      }
    }
  });

  it('ids are unique', () => {
    expect(new Set(quickLinks.map((l) => l.id)).size).toBe(quickLinks.length);
  });
});
