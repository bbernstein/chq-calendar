import * as fs from 'fs';
import * as path from 'path';
import {
  AudienceAccessClient,
  parsePastPage,
  parseUpcomingPage,
} from '../services/audienceAccessClient';

const fix = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

describe('parseUpcomingPage', () => {
  it('extracts one Program per slide with parsed dates', () => {
    const programs = parseUpcomingPage(fix('audienceaccess-upcoming.html'));
    expect(programs).toHaveLength(3);

    const recital = programs.find(p => p.showId === 'CHQ-16530')!;
    expect(recital).toMatchObject({
      url: 'https://audienceaccess.co/show/CHQ-16530',
      title: 'School of Music: Open Recital #6',
      dateText: 'August 04, 2026',
      startDate: '2026-08-04',
      endDate: '2026-08-04',
      source: 'upcoming',
    });

    const play = programs.find(p => p.showId === 'CHQ-16781')!;
    expect(play.title).toBe(
      'for colored girls who have considered suicide/when the rainbow is enuf',
    );
    expect(play.startDate).toBeNull();
    expect(play.endDate).toBeNull();
  });
});

describe('parsePastPage', () => {
  it('extracts one Program per feature box', () => {
    const programs = parsePastPage(fix('audienceaccess-past.html'));
    expect(programs).toHaveLength(4);

    const opera = programs.find(p => p.showId === 'CHQ-16571')!;
    expect(opera).toMatchObject({
      title: 'Chautauqua Opera Conservatory: La Calisto',
      startDate: '2026-07-18',
      endDate: '2026-07-21',
      source: 'past',
    });

    const play = programs.find(p => p.showId === 'CHQ-16426')!;
    expect(play).toMatchObject({
      title: 'Best For Baby',
      dateText: 'by Sharyn Rothstein',
      startDate: null,
    });
  });
});

describe('AudienceAccessClient.fetchPrograms', () => {
  const fetchFor = (byUrl: Record<string, string>): typeof fetch =>
    (async (url: unknown) => {
      const body = byUrl[String(url)];
      if (body === undefined) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => body };
    }) as unknown as typeof fetch;

  it('merges both pages, upcoming winning on duplicate showId', () => {
    // Same show on both pages: past copy has a parseable date, upcoming
    // doesn't. The merged Program must be the upcoming one.
    const upcoming = fix('audienceaccess-upcoming.html');
    const past = fix('audienceaccess-past.html').replaceAll('CHQ-16567', 'CHQ-16781');
    const client = new AudienceAccessClient(
      fetchFor({ 'https://audienceaccess.co/CHQ': upcoming, 'https://audienceaccess.co/past/CHQ': past }),
    );
    return client.fetchPrograms().then(programs => {
      expect(programs.filter(p => p.showId === 'CHQ-16781')).toHaveLength(1);
      expect(programs.find(p => p.showId === 'CHQ-16781')!.source).toBe('upcoming');
      // 3 upcoming + 4 past − 1 duplicate
      expect(programs).toHaveLength(6);
    });
  });

  it('throws when a page returns non-2xx', async () => {
    const client = new AudienceAccessClient(
      fetchFor({ 'https://audienceaccess.co/CHQ': fix('audienceaccess-upcoming.html') }),
    );
    await expect(client.fetchPrograms()).rejects.toThrow('audienceaccess request failed');
  });

  it('throws when the past page parses to zero programs (markup drift)', async () => {
    // Valid HTML, but none of the boxes match the expected
    // `.mobile-past-events-feature-box` markup — simulates a template
    // rename on the past page specifically.
    const driftedPast = '<html><body><div class="some-other-class">no boxes here</div></body></html>';
    const client = new AudienceAccessClient(
      fetchFor({
        'https://audienceaccess.co/CHQ': fix('audienceaccess-upcoming.html'),
        'https://audienceaccess.co/past/CHQ': driftedPast,
      }),
    );
    await expect(client.fetchPrograms()).rejects.toThrow(
      /past page parsed to zero programs/,
    );
  });

  it('does NOT throw when the upcoming page parses to zero but the past page is fine (legitimate off-season)', async () => {
    // Upcoming page can legitimately be empty off-season; only the past
    // page's zero-programs case is an abort condition.
    const emptyUpcoming = '<html><body><div class="no-slides-here"></div></body></html>';
    const client = new AudienceAccessClient(
      fetchFor({
        'https://audienceaccess.co/CHQ': emptyUpcoming,
        'https://audienceaccess.co/past/CHQ': fix('audienceaccess-past.html'),
      }),
    );
    const programs = await client.fetchPrograms();
    expect(programs).toHaveLength(4);
    expect(programs.every(p => p.source === 'past')).toBe(true);
  });
});
