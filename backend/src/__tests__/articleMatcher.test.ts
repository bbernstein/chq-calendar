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
    ['2026-07-15 14:00:00', '2 p.m.'], // space separator — the production event format (issue #140)
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

  test('category-concept: article tag "cso" matches event "…/Classical Concerts" via concept', () => {
    const a = article({
      title: 'Grgic to perform guitar concerto',
      categories: ['Amphitheater'],
      tags: ['cso'],
      pubDate: '2026-07-16T00:40:00',
      excerptText: 'A Grammy nominee takes the stage.',
      bodyText: 'A Grammy nominee takes the stage beside the orchestra.',
    });
    const e = event({
      id: 'cso-1',
      title: 'Chautauqua Symphony Orchestra with Mak Grgic',
      startDate: '2026-07-16T20:00:00',
      venue: { name: 'Amphitheater' },
      category: undefined,
      categories: [{ name: 'Chautauqua Symphony Orchestra/Classical Concerts' }],
      presenter: 'Mak Grgic',
    });
    const r = scorePair(a, e);
    expect(r).not.toBeNull();
    expect(r!.reasons).toContain('category-concept');
    expect(r!.reasons).not.toContain('category-token');
  });

  test('category-body: no structured concept/token overlap, but body names the program (half credit)', () => {
    const a = article({
      title: 'A night of guitar with Mak Grgic',
      categories: ['Amphitheater'],
      tags: [],
      excerptText: '',
      bodyText: 'Grgic performs beside the Chautauqua Symphony Orchestra in the Amphitheater.',
      pubDate: '2026-07-16T00:40:00',
    });
    const e = event({
      id: 'cso-2',
      title: 'Symphony night with Mak Grgic',
      startDate: '2026-07-16T20:00:00',
      venue: { name: 'Amphitheater' },
      category: undefined,
      categories: [{ name: 'Chautauqua Symphony Orchestra/Classical Concerts' }],
      presenter: 'Mak Grgic',
    });
    const r = scorePair(a, e);
    expect(r).not.toBeNull();
    expect(r!.reasons).toContain('category-body');
    expect(r!.reasons).not.toContain('category-concept');
    expect(r!.reasons).not.toContain('category-token');

    // Prove the body tier applied HALF credit, not full: the same pair with a
    // program TOKEN in a structured category ("Classical" shares the token
    // "classical" with the event's "…/Classical Concerts") fires the token tier
    // (full 0.15) instead of the body tier (half 0.075), with every other signal
    // identical. The score delta therefore equals exactly half the category
    // weight. A token — not concept — sibling is used deliberately so the
    // people+concept corroboration bonus doesn't perturb the delta (both this
    // sibling and `r` have people but neither has category-concept).
    const tokenSibling = scorePair({ ...a, categories: [...a.categories, 'Classical'] }, e);
    expect(tokenSibling).not.toBeNull();
    expect(tokenSibling!.reasons).toContain('category-token');
    expect(tokenSibling!.reasons).not.toContain('category-concept');
    expect(tokenSibling!.score - r!.score).toBeCloseTo(0.075, 4);
  });

  test('people + concept corroboration rescues a venue-changed event (Grgić/CSO regression)', () => {
    // Real case: the CSO concert moved Amphitheater→Norton Hall after the
    // Daily's preview ran, so the article still names the old venue and the
    // venue signal (0.30) is gone. It is also a day-ahead preview (local
    // pubDate the evening before), so time-of-day can't fire either. A
    // performer/title match plus an exact-program (concept) match must still
    // identify it: 0.35 people + 0.15 concept + 0.05 bonus + ~0.086 proximity.
    const a = article({
      title: 'Uplifting the Spirit: Grgic to perform guitar concerto with CSO',
      categories: ['Chautauqua Symphony Orchestra', 'Amphitheater'],
      tags: ['cso'],
      pubDate: '2026-07-15T20:40:03',
      excerptText: 'Mak Grgic takes the stage beside the Chautauqua Symphony Orchestra.',
      bodyText: 'Together they perform a guitar concerto.',
    });
    const e = event({
      id: '98400',
      title: 'Chautauqua Symphony Orchestra with Mak Grgic, guitar',
      startDate: '2026-07-16 20:00:00',
      venue: { name: 'Norton Hall' },
      category: 'Chautauqua Symphony Orchestra/Classical Concerts',
      categories: undefined,
      presenter: undefined,
    });
    const r = scorePair(a, e);
    expect(r).not.toBeNull();
    expect(r!.reasons).toEqual(
      expect.arrayContaining(['people', 'category-concept', 'people-concept-corroboration']),
    );
    expect(r!.reasons).not.toContain('venue-category');
    expect(r!.reasons).not.toContain('venue-body');
  });

  test('concept match without a people match does NOT trigger the corroboration bonus', () => {
    // Only venue + concept + proximity, no performer/title overlap. Must stay
    // below threshold (0.30 + 0.15 + 0.10 = 0.55): the bonus requires BOTH
    // people and concept, so it must not leak in on a concept-only match.
    const a = article({
      title: 'Season concert series announced',
      categories: ['Chautauqua Symphony Orchestra', 'Amphitheater'],
      tags: ['cso'],
      excerptText: '',
      bodyText: 'The orchestra returns this week.',
      pubDate: '2026-07-16T06:00:00',
    });
    const e = event({
      id: 'cso-noppl',
      title: 'Toward a New World',
      startDate: '2026-07-16T20:00:00',
      venue: { name: 'Amphitheater' },
      category: 'Chautauqua Symphony Orchestra/Classical Concerts',
      categories: undefined,
      presenter: undefined,
    });
    expect(scorePair(a, e)).toBeNull();
  });

  test('no category signal when taxonomies and body share no concept or token', () => {
    const a = article({
      title: 'Jane Marlow on democracy',
      categories: ['Movies'],
      tags: ['Jane Marlow'],
      excerptText: 'Jane Marlow speaks at 2 p.m. today in the Hall of Philosophy.',
      bodyText: 'Jane Marlow speaks at 2 p.m. today in the Hall of Philosophy.',
    });
    const e = event({
      title: 'Morning talk',
      startDate: '2026-07-15T14:00:00',
      venue: { name: 'Hall of Philosophy' },
      category: 'Recreation',
      presenter: 'Jane Marlow',
    });
    const r = scorePair(a, e);
    expect(r).not.toBeNull();
    expect(r!.reasons.some(x => x.startsWith('category'))).toBe(false);
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

  test('accented article name matches an ASCII presenter surname (issue #138)', () => {
    // The event feed spells the presenter ASCII ("Grgic"); the Daily writes it
    // accented ("Grgić"). Before diacritic folding these normalized to
    // different tokens (grgic vs grgi), so the surname match silently failed.
    const a = article({
      title: 'Grgić dazzles',
      tags: [],
      categories: ['Amphitheater'],
      excerptText: '',
      bodyText: 'A wonderful recital.',
      pubDate: '2026-07-15T09:00:00',
    });
    const e = event({
      title: 'An Evening Recital', // shares no distinctive tokens with the article title
      startDate: '2026-07-15T14:00:00',
      venue: { name: 'Amphitheater' },
      category: undefined,
      presenter: 'Mak Grgic',
    });
    const r = scorePair(a, e);
    expect(r).not.toBeNull();
    expect(r!.reasons).toContain('people'); // fires only via the surname match
  });

  test('time-of-day fires when the event startDate uses a space separator (issue #140)', () => {
    // Production events store startDate as "YYYY-MM-DD HH:MM:SS" (space), not
    // "…T…". The printed-time signal must still fire.
    const r = scorePair(article(), event({ startDate: '2026-07-15 14:00:00' }));
    expect(r).not.toBeNull();
    expect(r!.reasons).toContain('time-of-day');
  });

  test('same-day morning preview is not mislabeled a recap with a space-separated startDate (issue #140)', () => {
    // Article at 6:30 a.m., event at 2 p.m. the same day. The recap check must
    // compare the T-form pubDate and space-form startDate on a normalized
    // separator, or 'T' > ' ' would flag every same-day article a recap.
    const r = scorePair(article(), event({ startDate: '2026-07-15 14:00:00' }));
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('preview');
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
