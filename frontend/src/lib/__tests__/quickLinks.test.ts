import { describe, it, expect } from 'vitest';
import { quickLinks, inAppLinks, externalLinks } from '@/lib/quickLinks';

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

describe('quickLinks grouping', () => {
  // The header renders in-app routes as direct controls and collapses the
  // external Chautauqua destinations into a menu, so the split has to be
  // declared in the data rather than inferred from `webPath`'s absence.
  it('marks exactly the off-site Chautauqua destinations as external', () => {
    expect(externalLinks.map((l) => l.id)).toEqual([
      'programs',
      'questions',
      'captions',
      'bus-tram-tracker',
      'chautauqua-fund',
    ]);
  });

  it('leaves the app\'s own routes in the in-app group', () => {
    expect(inAppLinks.map((l) => l.id)).toEqual(['about', 'feedback']);
  });

  it('splits every quick link into exactly one group', () => {
    expect([...inAppLinks, ...externalLinks].map((l) => l.id).sort()).toEqual(
      quickLinks.map((l) => l.id).sort(),
    );
  });

  it('gives every in-app link a webPath and no external link one', () => {
    // `external` is the discriminator, but the two should not disagree:
    // an in-app route without a webPath would jump to production during
    // local development.
    for (const link of inAppLinks) expect(link.webPath).toBeDefined();
    for (const link of externalLinks) expect(link.webPath).toBeUndefined();
  });
});
