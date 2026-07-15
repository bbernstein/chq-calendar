import {
  scorePair,
  computeArticleContentHash,
  computeEventFingerprint,
  formatEventTimeAsPrinted,
  MATCH_THRESHOLD,
} from '../services/articleMatcher';
import type { StoredArticle, CalendarEventLite } from '../types/articles';

function article(overrides: Partial<StoredArticle> = {}): StoredArticle {
  return {
    wpPostId: 1,
    title: 'Najeeba Syeed speaks from the broken heart of democracy',
    link: 'https://chqdaily.com/a1/',
    pubDate: '2026-07-15T06:30:00',
    modified: '2026-07-15T06:30:00',
    categories: ['Interfaith Lecture', 'Hall of Philosophy'],
    tags: ['Najeeba Syeed'],
    excerptText: 'Najeeba Syeed speaks at 2 p.m. today in the Hall of Philosophy.',
    bodyText: 'Najeeba Syeed speaks at 2 p.m. today in the Hall of Philosophy about interfaith peace.',
    contentHash: 'x',
    firstSeenAt: '2026-07-15T07:00:00.000Z',
    ...overrides,
  };
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

describe('formatEventTimeAsPrinted', () => {
  test.each([
    ['2026-07-15T10:45:00', '10:45 a.m.'],
    ['2026-07-15T14:00:00', '2 p.m.'],
    ['2026-07-15T20:15:00', '8:15 p.m.'],
    ['2026-07-15T12:00:00', '12 p.m.'],
    ['2026-07-15T00:30:00', '12:30 a.m.'],
  ])('%s → %s', (iso, printed) => {
    expect(formatEventTimeAsPrinted(iso)).toBe(printed);
  });

  test('returns null for unparseable input', () => {
    expect(formatEventTimeAsPrinted('garbage')).toBeNull();
  });
});

describe('scorePair', () => {
  test('preview with venue + person + same-day printed time scores far above threshold', () => {
    const r = scorePair(article(), event());
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThan(MATCH_THRESHOLD);
    expect(r!.kind).toBe('preview');
    expect(r!.reasons).toEqual(expect.arrayContaining(['venue-category', 'people', 'time-of-day']));
  });

  test('event outside the [-3, +7] day window is gated to null', () => {
    expect(scorePair(article(), event({ startDate: '2026-08-15T14:00:00' }))).toBeNull();
    expect(scorePair(article(), event({ startDate: '2026-07-01T14:00:00' }))).toBeNull();
  });

  test('venue alias: body says "the Amp", event venue is Amphitheater', () => {
    const a = article({
      categories: ['Symphony'],
      tags: [],
      title: 'CSO to perform Beethoven under the stars',
      bodyText: 'The Chautauqua Symphony Orchestra performs at 8:15 p.m. tonight in the Amp.',
      excerptText: '',
    });
    const e = event({
      title: 'Chautauqua Symphony Orchestra: Beethoven',
      startDate: '2026-07-15T20:15:00',
      venue: { name: 'Amphitheater' },
      category: 'Symphony',
      presenter: undefined,
    });
    const r = scorePair(a, e);
    expect(r).not.toBeNull();
    expect(r!.reasons).toEqual(expect.arrayContaining(['venue-body', 'time-of-day']));
  });

  test('recurring-slot disambiguation: same venue+time daily lecture matches the right speaker day', () => {
    const a = article({
      title: 'Jane Marlow to open Week Four lectures',
      tags: ['Jane Marlow'],
      categories: ['Lectures', 'Amphitheater'],
      bodyText: 'Jane Marlow speaks at 10:45 a.m. today in the Amphitheater.',
      excerptText: '',
      pubDate: '2026-07-15T06:00:00',
    });
    const rightDay = event({
      id: 'lecture-wed', title: 'Morning Lecture', startDate: '2026-07-15T10:45:00',
      venue: { name: 'Amphitheater' }, category: 'Morning Lecture', presenter: 'Jane Marlow',
    });
    const wrongDay = event({
      id: 'lecture-thu', title: 'Morning Lecture', startDate: '2026-07-16T10:45:00',
      venue: { name: 'Amphitheater' }, category: 'Morning Lecture', presenter: 'Bob Chen',
    });
    const right = scorePair(a, rightDay);
    const wrong = scorePair(a, wrongDay);
    expect(right).not.toBeNull();
    // Wrong day: venue matches but no person, no same-day time → below threshold
    expect(wrong).toBeNull();
    expect(right!.score).toBeGreaterThan(MATCH_THRESHOLD);
  });

  test('recap: "Lecture Recap" tag or post-event pubDate classifies as recap', () => {
    const tagged = scorePair(article({ tags: ['Najeeba Syeed', 'Lecture Recap'] }), event());
    expect(tagged!.kind).toBe('recap');

    const postEvent = scorePair(
      article({ pubDate: '2026-07-16T06:00:00', bodyText: 'Najeeba Syeed spoke in the Hall of Philosophy.', excerptText: '' }),
      event(),
    );
    expect(postEvent).not.toBeNull();
    expect(postEvent!.kind).toBe('recap');
  });

  test('same-day article published after the event start is a recap', () => {
    // Not Recap-tagged and the same calendar day, but published at 6 p.m. —
    // after the 2 p.m. event. An evening recap of a morning/afternoon event
    // must not be mislabeled a preview (the reason this signal is timestamp-
    // based, not date-based).
    const r = scorePair(article({ pubDate: '2026-07-15T18:00:00' }), event());
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('recap');
  });

  test('same-day article published before the event start stays a preview', () => {
    const r = scorePair(article({ pubDate: '2026-07-15T06:30:00' }), event());
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('preview');
  });

  test('weak signals alone (category + proximity only) stay below threshold', () => {
    const a = article({
      title: 'Around the grounds this week',
      tags: [],
      categories: ['Lectures'],
      bodyText: 'A roundup of happenings.',
      excerptText: '',
    });
    const e = event({ title: 'Morning Lecture', presenter: 'Someone Else', venue: { name: 'Smith Wilkes Hall' }, category: 'Lectures' });
    expect(scorePair(a, e)).toBeNull();
  });
});

describe('hashes and fingerprints', () => {
  test('contentHash changes with body text, stable otherwise', () => {
    const a = article();
    const h1 = computeArticleContentHash(a);
    expect(computeArticleContentHash({ ...a })).toBe(h1);
    expect(computeArticleContentHash({ ...a, bodyText: 'edited' })).not.toBe(h1);
    // modified timestamp alone does NOT change the hash (layout-only edit)
    expect(computeArticleContentHash({ ...a, modified: '2026-07-16T00:00:00' })).toBe(h1);
  });

  test('event fingerprint changes with startDate, stable across irrelevant fields', () => {
    const e = event();
    const f1 = computeEventFingerprint(e);
    expect(computeEventFingerprint({ ...e })).toBe(f1);
    expect(computeEventFingerprint({ ...e, startDate: '2026-07-16T14:00:00' })).not.toBe(f1);
  });
});
