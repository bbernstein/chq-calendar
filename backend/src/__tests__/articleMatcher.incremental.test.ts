import {
  computeMatchState,
  computeArticleContentHash,
  MATCHER_VERSION,
} from '../services/articleMatcher';
import type { StoredArticle, CalendarEventLite, MatchState } from '../types/articles';

function article(overrides: Partial<StoredArticle> = {}): StoredArticle {
  const base: StoredArticle = {
    wpPostId: 1,
    title: 'Najeeba Syeed speaks from the broken heart of democracy',
    link: 'https://chqdaily.com/a1/',
    pubDate: '2026-07-15T06:30:00',
    modified: '2026-07-15T06:30:00',
    categories: ['Interfaith Lecture', 'Hall of Philosophy'],
    tags: ['Najeeba Syeed'],
    excerptText: '',
    bodyText: 'Najeeba Syeed speaks at 2 p.m. today in the Hall of Philosophy.',
    contentHash: '',
    firstSeenAt: '2026-07-15T07:00:00.000Z',
    ...overrides,
  };
  base.contentHash = computeArticleContentHash(base);
  return base;
}

function event(overrides: Partial<CalendarEventLite> = {}): CalendarEventLite {
  return {
    id: 'e1',
    title: 'Interfaith Lecture: From the Broken Heart of Democracy',
    startDate: '2026-07-15T14:00:00',
    venue: { name: 'Hall of Philosophy' },
    category: 'Interfaith Lecture Series',
    presenter: 'Najeeba Syeed',
    ...overrides,
  };
}

describe('computeMatchState', () => {
  test('first run (no prevState): matches found, links built, both changed flags true', () => {
    const r = computeMatchState({ articles: [article()], events: [event()] });
    expect(r.linksChanged).toBe(true);
    expect(r.stateChanged).toBe(true);
    expect(r.state.matcherVersion).toBe(MATCHER_VERSION);
    expect(r.state.matches).toHaveLength(1);
    expect(r.links['e1']).toHaveLength(1);
    expect(r.links['e1'][0]).toEqual({
      title: 'Najeeba Syeed speaks from the broken heart of democracy',
      url: 'https://chqdaily.com/a1/',
      kind: 'preview',
      pubDate: '2026-07-15',
    });
  });

  test('no-op run: identical inputs against prev state → nothing changed', () => {
    const first = computeMatchState({ articles: [article()], events: [event()] });
    const second = computeMatchState({ articles: [article()], events: [event()], prevState: first.state });
    expect(second.linksChanged).toBe(false);
    expect(second.stateChanged).toBe(false);
    expect(second.state.matches).toEqual(first.state.matches);
  });

  test('retitled article that still matches republishes even when the score is unchanged', () => {
    const v1 = article();
    const first = computeMatchState({ articles: [v1], events: [event()] });
    // Same post id, tags, body, categories → identical score & kind, but a new
    // title (a user-visible field) → contentHash changes, so the published
    // sidecar must be regenerated with the new title.
    const v2 = article({ title: 'Najeeba Syeed reflects on democracy and peace' });
    expect(v2.contentHash).not.toBe(v1.contentHash);
    const second = computeMatchState({ articles: [v2], events: [event()], prevState: first.state });
    expect(second.state.matches).toHaveLength(1);
    expect(second.state.matches[0].score).toBe(first.state.matches[0].score); // score identical
    expect(second.linksChanged).toBe(true); // ...yet links must republish
    expect(second.links['e1'][0].title).toBe('Najeeba Syeed reflects on democracy and peace');
  });

  test('unchanged pairs are carried over without rescoring; changed article is rescored', () => {
    const a1 = article();
    const a2 = article({ wpPostId: 2, link: 'https://chqdaily.com/a2/', title: 'CSO under the stars', tags: [], categories: ['Symphony', 'Amphitheater'], bodyText: 'The CSO performs at 8:15 p.m. tonight in the Amphitheater.' });
    const e1 = event();
    const e2 = event({ id: 'e2', title: 'Chautauqua Symphony Orchestra', startDate: '2026-07-15T20:15:00', venue: { name: 'Amphitheater' }, category: 'Symphony', presenter: undefined });
    const first = computeMatchState({ articles: [a1, a2], events: [e1, e2] });
    expect(Object.keys(first.links).sort()).toEqual(['e1', 'e2']);

    // Edit a2's body so it no longer matches anything
    const a2edited = article({ ...a2, bodyText: 'Rain check: performance moved.', categories: ['News'] });
    const second = computeMatchState({ articles: [a1, a2edited], events: [e1, e2], prevState: first.state });
    expect(second.links['e1']).toEqual(first.links['e1']); // carried over
    expect(second.links['e2']).toBeUndefined();            // rescored away
    expect(second.linksChanged).toBe(true);
  });

  test('changed event fingerprint dirties that event against all articles', () => {
    const first = computeMatchState({ articles: [article()], events: [event()] });
    // Event moved a month out → date gate now excludes the pair
    const moved = event({ startDate: '2026-08-20T14:00:00' });
    const second = computeMatchState({ articles: [article()], events: [moved], prevState: first.state });
    expect(second.links['e1']).toBeUndefined();
    expect(second.linksChanged).toBe(true);
  });

  test('removed article drops out of links and state', () => {
    const first = computeMatchState({ articles: [article()], events: [event()] });
    const second = computeMatchState({ articles: [], events: [event()], prevState: first.state });
    expect(second.state.matches).toHaveLength(0);
    expect(second.linksChanged).toBe(true);
  });

  test('matcherVersion mismatch forces full recompute', () => {
    const first = computeMatchState({ articles: [article()], events: [event()] });
    const staleState: MatchState = { ...first.state, matcherVersion: 0, matches: [] };
    const second = computeMatchState({ articles: [article()], events: [event()], prevState: staleState });
    expect(second.state.matches).toHaveLength(1); // recomputed despite empty prev matches
    expect(second.stateChanged).toBe(true);
  });

  test('links ordering: previews first, then by pubDate; capped at 4 per event', () => {
    const mk = (id: number, pub: string, tags: string[]) =>
      article({ wpPostId: id, link: `https://chqdaily.com/a${id}/`, pubDate: pub, tags: ['Najeeba Syeed', ...tags] });
    // 5 matching articles: 2 recaps (tagged), 3 previews
    const arts = [
      mk(1, '2026-07-16T06:00:00', ['Lecture Recap']),
      mk(2, '2026-07-14T06:00:00', []),
      mk(3, '2026-07-15T06:00:00', []),
      mk(4, '2026-07-17T06:00:00', ['Lecture Recap']),
      mk(5, '2026-07-13T06:00:00', []),
    ];
    const r = computeMatchState({ articles: arts, events: [event()] });
    const links = r.links['e1'];
    expect(links.length).toBeLessThanOrEqual(4);
    // all previews precede all recaps
    const kinds = links.map(l => l.kind);
    const firstRecap = kinds.indexOf('recap');
    const lastPreview = kinds.lastIndexOf('preview');
    expect(firstRecap).toBeGreaterThan(-1);
    expect(lastPreview).toBeLessThan(firstRecap);
    // previews sorted by pubDate ascending
    const previews = links.filter(l => l.kind === 'preview').map(l => l.pubDate);
    expect(previews).toEqual([...previews].sort());
  });
});

describe('recurring-event link pruning', () => {
  const cso: CalendarEventLite = {
    id: 'cso',
    title: 'Chautauqua Symphony Orchestra: An Evening of Brahms',
    startDate: '2026-07-14T20:00:00',
    venue: { name: 'Amphitheater' },
    category: 'Symphony',
    presenter: 'Chautauqua Symphony Orchestra',
  };

  function csoArticle(
    id: number,
    pubDate: string,
    title: string,
    extraTags: string[] = [],
  ): StoredArticle {
    const base: StoredArticle = {
      wpPostId: id,
      title,
      link: `https://chqdaily.com/cso-${id}/`,
      pubDate,
      modified: pubDate,
      categories: ['Amphitheater', 'Music'],
      tags: ['Chautauqua Symphony Orchestra', ...extraTags],
      excerptText: '',
      bodyText: 'The Chautauqua Symphony Orchestra performs in the Amphitheater.',
      contentHash: '',
      firstSeenAt: '2026-07-01T00:00:00.000Z',
    };
    base.contentHash = computeArticleContentHash(base);
    return base;
  }

  test('keeps only the latest preview date, dropping other occurrences that week', () => {
    const arts = [
      csoArticle(1, '2026-07-08T19:00:00', 'Milanov brings The New World, CSO performs Dvorak'),
      csoArticle(2, '2026-07-10T19:00:00', 'Troupe Vertigo, Chautauqua Symphony Orchestra bring cinema'),
      csoArticle(3, '2026-07-13T19:00:00', 'Milanov to lead CSO through Brahms Double Concerto'),
    ];
    const r = computeMatchState({ articles: arts, events: [cso] });
    const links = r.links['cso'] ?? [];
    expect(links.map(l => l.pubDate)).toEqual(['2026-07-13']);
    expect(links[0].kind).toBe('preview');
  });

  test('keeps multiple previews published the same day (program note + piece note)', () => {
    const arts = [
      csoArticle(1, '2026-07-08T19:00:00', 'Milanov brings The New World, CSO performs Dvorak'),
      csoArticle(3, '2026-07-13T19:00:00', 'Milanov to lead CSO through Brahms Double Concerto'),
      csoArticle(4, '2026-07-13T09:00:00', 'The Chautauqua Symphony Orchestra music of Brahms explained'),
    ];
    const r = computeMatchState({ articles: arts, events: [cso] });
    const links = r.links['cso'] ?? [];
    expect(links.every(l => l.pubDate === '2026-07-13')).toBe(true);
    expect(links).toHaveLength(2);
  });

  test('keeps the earliest post-event recap, dropping recap-tagged articles about prior occurrences', () => {
    const arts = [
      // recap-tagged but dated before this concert → about a prior occurrence
      csoArticle(5, '2026-07-10T19:00:00', 'Chautauqua Symphony Orchestra opens week', ['Symphony Recap']),
      // the actual recap of the 7/14 concert, published the next morning
      csoArticle(6, '2026-07-15T08:00:00', 'Chautauqua Symphony Orchestra delivers Brahms', ['Symphony Recap']),
    ];
    const r = computeMatchState({ articles: arts, events: [cso] });
    const links = r.links['cso'] ?? [];
    expect(links.map(l => l.pubDate)).toEqual(['2026-07-15']);
    expect(links[0].kind).toBe('recap');
  });
});
