import * as fs from 'fs';
import * as path from 'path';
import {
  parseAgeRange,
  parseClassDetail,
  parseSearchResults,
} from '../services/classesScraper';

const fix = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

describe('parseSearchResults', () => {
  const rows = parseSearchResults(fix('chq-classes-search.html'));

  it('extracts one row per class with an absolute registration URL', () => {
    expect(rows).toHaveLength(6);

    const beginAgain = rows.find(r => r.id === 'CHQ.EVN1676')!;
    expect(beginAgain).toMatchObject({
      title: 'Begin Again',
      weeksLabel: 'Week 9',
      daysLabel: 'M, W, F',
      location: 'Literary Arts Center at Alumni Hall Poetry Room',
      ageRangeText: 'Ages 18+',
      instructor: "January O'Neil",
      sessionCount: 3,
      priceLabel: 'Sessions: $145.00',
      sourceUrl: 'https://tickets.chq.org/class.html?eventAk=CHQ.EVN1676',
    });
    expect(beginAgain.summary).toMatch(/^Beginning a poem does not require certainty/);
  });

  it('keeps the varied week labels verbatim rather than normalizing them', () => {
    const labels = Object.fromEntries(rows.map(r => [r.id, r.weeksLabel]));
    expect(labels['CHQ.EVN1685']).toBe('Weeks 1, 2, 6, 7, 9');
    expect(labels['CHQ.EVN1672']).toBe('Weeks 4 to 5');
    expect(labels['CHQ.EVN2136']).toBe('Week 1');
  });

  it('locates the age field by prefix, so a multi-word location stays intact', () => {
    const caregiver = rows.find(r => r.id === 'CHQ.EVN1685')!;
    expect(caregiver.location).toBe('Heinz Beach');
    expect(caregiver.ageRangeText).toBe('Ages 12+; 0 - 11 with Caregiver');
    expect(caregiver.ageRange).toEqual({ min: 12, max: null });
  });

  it('ignores rows that carry no class link', () => {
    const html = `<table><tbody>
      <tr><td class="event-cell" data-event-title="No Link">No Link</td><td></td><td></td><td></td></tr>
    </tbody></table>`;
    expect(parseSearchResults(html)).toEqual([]);
  });

  it('reads each class once, from the layout that separates the fields', () => {
    // The fragment repeats two of these classes in a mobile table whose single
    // cell packs every field into labelled divs. Reading those rows too would
    // both duplicate the class and blank the fields the desktop row supplies.
    const ids = rows.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('CHQ.EVN1672');
    expect(rows.find(r => r.id === 'CHQ.EVN1672')!.weeksLabel).toBe('Weeks 4 to 5');
  });
});

describe('parseAgeRange', () => {
  // Every shape observed across the full 466-class catalog on 2026-08-19.
  it.each([
    ['Ages 18+', { min: 18, max: null }],
    ['Ages 14 +', { min: 14, max: null }],
    ['Ages 7-13', { min: 7, max: 13 }],
    ['Ages 0-3 with Caregiver', { min: 0, max: 3 }],
    ['Ages 12+; 0 - 11 with Caregiver', { min: 12, max: null }],
    ['Ages 50 and Up', { min: 50, max: null }],
    ['Ages 50 and under', { min: null, max: 50 }],
    ['Ages All ages', { min: null, max: null }],
    ['Ages Families', { min: null, max: null }],
  ])('parses %s', (text, expected) => {
    expect(parseAgeRange(text)).toEqual(expected);
  });

  it('reports unbounded rather than throwing on an unrecognized label', () => {
    expect(parseAgeRange('Ages: ask the instructor')).toEqual({ min: null, max: null });
    expect(parseAgeRange('')).toEqual({ min: null, max: null });
  });
});

describe('a session with no seats left', () => {
  // Derived from the real detail fixture rather than hand-written markup, so
  // it exercises the same DOM the site actually serves.
  const withSpots = (n: number) =>
    fix('chq-class-detail.html').replace(/Spots remaining:13/, `Spots remaining:${n}`);

  it('is full, not open with zero spots', () => {
    // The site writes "Spots remaining: 0" with no waitlist button. Reported
    // as `open` it rendered "0 spots left" in urgent red beside a Register
    // link, and passed the page's Open-by-default filter.
    const detail = parseClassDetail(withSpots(0), 'CHQ.EVN1687', 2026);
    expect(detail.sessions[0].availability).toBe('full');
    expect(detail.sessions[0].spotsRemaining).toBe(0);
  });

  it('still reads a positive count as open', () => {
    const detail = parseClassDetail(withSpots(1), 'CHQ.EVN1687', 2026);
    expect(detail.sessions[0].availability).toBe('open');
    expect(detail.sessions[0].spotsRemaining).toBe(1);
  });
});

describe('parseClassDetail', () => {
  it('extracts each session with its own week, schedule, and spot count', () => {
    const detail = parseClassDetail(fix('chq-class-detail.html'), 'CHQ.EVN1687', 2026);

    expect(detail.title).toBe('If Chocolate Brings You Joy: Wednesday Session');
    expect(detail.instructor).toBe('Jill Sandler');
    expect(detail.sessions).toHaveLength(2);

    expect(detail.sessions[0]).toEqual({
      performanceId: 'CHQ.EVN1687.PRF1',
      week: 8,
      dateRangeLabel: 'Aug 19 - Aug 19',
      startDate: '2026-08-19 16:30:00',
      endDate: '2026-08-19 17:45:00',
      daysOfWeek: ['Wednesday'],
      timeRangeLabel: '4:30 pm - 5:45 pm',
      location: 'Turner Community Center Conference Room',
      spotsRemaining: 13,
      availability: 'open',
    });

    // Same class, different week, independently tracked capacity.
    expect(detail.sessions[1]).toMatchObject({
      performanceId: 'CHQ.EVN1687.PRF2',
      week: 9,
      spotsRemaining: 28,
      availability: 'open',
    });
  });

  it('spans a multi-day session from the first day start to the last day end', () => {
    const detail = parseClassDetail(fix('chq-class-detail-waitlist.html'), 'CHQ.EVN1689', 2026);
    expect(detail.sessions[0]).toMatchObject({
      dateRangeLabel: 'Aug 17 - Aug 21',
      startDate: '2026-08-17 13:00:00',
      endDate: '2026-08-21 15:00:00',
      daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    });
  });

  it('reports a full session as waitlist with no spot count', () => {
    const detail = parseClassDetail(fix('chq-class-detail-waitlist.html'), 'CHQ.EVN1689', 2026);
    expect(detail.sessions).toHaveLength(1);
    expect(detail.sessions[0]).toMatchObject({
      performanceId: 'CHQ.EVN1689.PRF2',
      availability: 'waitlist',
      spotsRemaining: null,
    });
  });

  it('does not mistake the page-wide waitlist modal for a full session', () => {
    // Both fixtures carry the hidden "Join the Waitlist" template and a nav
    // blob containing "SOLD OUT"; only the waitlist fixture has a full session.
    const open = fix('chq-class-detail.html');
    expect(open).toContain('Join the Waitlist');
    expect(open).toContain('SOLD OUT');

    const detail = parseClassDetail(open, 'CHQ.EVN1687', 2026);
    expect(detail.sessions.map(s => s.availability)).toEqual(['open', 'open']);
  });

  it('treats a class whose weeks have all passed as having no sessions', () => {
    const detail = parseClassDetail(fix('chq-class-detail-no-sessions.html'), 'CHQ.EVN1782', 2026);
    expect(detail.title).toBe('Theatre for Youth');
    expect(detail.sessions).toEqual([]);
  });

  it('publishes the description as text, keeping its line structure', () => {
    const detail = parseClassDetail(fix('chq-class-detail-waitlist.html'), 'CHQ.EVN1689', 2026);

    // No markup reaches the client: the web app renders no raw HTML.
    expect(detail.description).not.toMatch(/<[a-z]/i);
    // But a materials list stays a list rather than running together.
    expect(detail.description).toContain('Materials:\n\u2022 Sketchbook');
    expect(detail.description).toMatch(/^This is an introductory level watercolor class/);
  });

  it('marks a session unknown, and still returns it, when the state is unreadable', () => {
    const html = `<div class="js-week-select"><p data-performance="CHQ.EVN1.PRF1">
      <em><span>Week 3 | Jul 13 - Jul 17<br>Monday<br>9:00 am - 10:00 am<br>Hall</span></em>
      <span class="text-center">Enrollment closed</span>
    </p></div>`;
    const detail = parseClassDetail(html, 'CHQ.EVN1', 2026);
    expect(detail.sessions[0]).toMatchObject({
      week: 3,
      availability: 'unknown',
      spotsRemaining: null,
      startDate: '2026-07-13 09:00:00',
    });
  });
});

describe('the same class captured a day apart', () => {
  // chq-class-detail.html (2026-08-19) and chq-class-detail-next-day.html
  // (2026-08-20) are the same class, 24 hours apart. Between them, real
  // enrollment moved and a session aged out — the two kinds of change the
  // published catalog has to track.
  const day1 = parseClassDetail(fix('chq-class-detail.html'), 'CHQ.EVN1687', 2026);
  const day2 = parseClassDetail(fix('chq-class-detail-next-day.html'), 'CHQ.EVN1687', 2026);

  const sessionsById = (d: typeof day1) => new Map(d.sessions.map(s => [s.performanceId, s]));

  it('sees the spots fall as people enroll', () => {
    const before = sessionsById(day1).get('CHQ.EVN1687.PRF2')!;
    const after = sessionsById(day2).get('CHQ.EVN1687.PRF2')!;

    expect(before.spotsRemaining).toBe(28);
    expect(after.spotsRemaining).toBe(26);
    // Everything else about the session is unchanged, so a diff on this
    // class reports the count and nothing else.
    expect({ ...after, spotsRemaining: before.spotsRemaining }).toEqual(before);
  });

  it('sees a session disappear once its date has passed', () => {
    // PRF1 ran on Aug 19 and is simply absent the next day — the site does
    // not mark it finished, it removes it.
    expect(sessionsById(day1).has('CHQ.EVN1687.PRF1')).toBe(true);
    expect(sessionsById(day2).has('CHQ.EVN1687.PRF1')).toBe(false);
    expect(day2.sessions).toHaveLength(1);
  });

  it('keeps the class itself stable across the two captures', () => {
    // A vanished session must not read as a vanished class.
    expect(day2.title).toBe(day1.title);
    expect(day2.instructor).toBe(day1.instructor);
    expect(day2.description).toBe(day1.description);
  });
});
