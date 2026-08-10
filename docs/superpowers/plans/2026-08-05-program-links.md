# Digital Program Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match audienceaccess.co/CHQ digital program books to calendar events and surface a "Digital Program" link on the web app and the iOS app (issue #165).

**Architecture:** A slim clone of the chqdaily article-links vertical slice: an hourly `program-ingest` Lambda scrapes two server-rendered HTML listing pages (~240 shows), matches them to the event snapshot by date-gated title similarity, and publishes a `program-links-<year>.json` sidecar to the CDN only when the link set changes. No DynamoDB, no watermark — every run is a full re-scrape and re-match. Web and iOS consume the sidecar exactly like article links.

**Tech Stack:** TypeScript Lambda (Node 24, cheerio, jest), Terraform, Vite+Preact frontend (vitest), SwiftUI iOS app (XCTest).

**Spec:** `docs/superpowers/specs/2026-08-05-program-links-design.md`

## Global Constraints

- All work happens on branch `feat/program-links-165`. Never commit to `main`.
- Backend lint runs with `--max-warnings=0` — any ESLint warning fails the build. Run `npm run validate --workspace=backend` before every backend commit.
- Backend coverage floor is enforced via `.coverage-floor.json`; new backend code must be tested (`npm run test:coverage` in `backend/`).
- Backend tests are **jest** (`cd backend && npm test`); frontend tests are **vitest** (`cd frontend && npm test`).
- Frontend verification: `cd frontend && npm run build` (runs validate + tests).
- iOS tests: `cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO` (swap destination for an installed simulator per `xcrun simctl list devices available`).
- Import hooks from `'react'` in frontend `.tsx` files (aliased to `preact/compat`); this is the repo convention and must not be changed.
- The public sidecar never contains scores/reasons — those live only in the private state file on the private cache bucket.
- One program link per event, maximum.

---

### Task 1: Program types + date-text parser

**Files:**
- Create: `backend/src/types/programs.ts`
- Create: `backend/src/services/programDates.ts`
- Test: `backend/src/__tests__/programDates.test.ts`

**Interfaces:**
- Consumes: nothing (leaf task).
- Produces: all program-domain types (below) used by Tasks 2–6, and `parseProgramDateText(raw: string): { startDate: string; endDate: string } | null` used by Task 2.

- [ ] **Step 1: Create the types file** (no test needed — types only)

```ts
// backend/src/types/programs.ts

/** One digital program book scraped from audienceaccess.co/CHQ. */
export interface Program {
  /** "CHQ-16781" — numeric part is assigned chronologically by the platform. */
  showId: string;
  /** Canonical program URL, e.g. https://audienceaccess.co/show/CHQ-16781 */
  url: string;
  title: string;
  /** Raw date text from the listing (may be a byline or blurb, not a date). */
  dateText: string;
  /** YYYY-MM-DD parsed from dateText, or null when dateText isn't a date. */
  startDate: string | null;
  /** YYYY-MM-DD; equals startDate for single-date programs. */
  endDate: string | null;
  source: 'upcoming' | 'past';
}

/** One entry in the published sidecar. */
export interface PublishedProgramLink {
  title: string;
  url: string;
}

/** Shape of cache/calendar-cache/program-links-<year>.json. */
export interface ProgramLinksFile {
  generatedAt: string;
  matcherVersion: number;
  links: Record<string, PublishedProgramLink[]>;
}

/** One above-threshold (program, event) match kept in private state. */
export interface ProgramMatchRecord {
  eventId: string;
  showId: string;
  score: number;
  reasons: string[];
}

/**
 * Private S3 state. With full recompute each run this exists for debugging
 * (scores/reasons) and change detection, not incremental skipping.
 */
export interface ProgramMatchState {
  matcherVersion: number;
  /** showId -> hash of title|dateText */
  programs: Record<string, string>;
  /** eventId -> hash of title|startDate */
  eventFingerprints: Record<string, string>;
  matches: ProgramMatchRecord[];
}
```

- [ ] **Step 2: Write the failing tests for the date parser**

```ts
// backend/src/__tests__/programDates.test.ts
import { parseProgramDateText } from '../services/programDates';

describe('parseProgramDateText', () => {
  it('parses a single date', () => {
    expect(parseProgramDateText('August 04, 2026')).toEqual({
      startDate: '2026-08-04',
      endDate: '2026-08-04',
    });
  });

  it('parses a same-month range', () => {
    expect(parseProgramDateText('July 18 - 21, 2026')).toEqual({
      startDate: '2026-07-18',
      endDate: '2026-07-21',
    });
  });

  it('parses a cross-month range', () => {
    expect(parseProgramDateText('June 28 - July 26, 2026')).toEqual({
      startDate: '2026-06-28',
      endDate: '2026-07-26',
    });
  });

  it('parses an en-dash range', () => {
    expect(parseProgramDateText('July 18 – 21, 2026')).toEqual({
      startDate: '2026-07-18',
      endDate: '2026-07-21',
    });
  });

  it('collapses whitespace and newlines before parsing', () => {
    expect(parseProgramDateText('  August 04,\n   2026  ')).toEqual({
      startDate: '2026-08-04',
      endDate: '2026-08-04',
    });
  });

  it('returns null for bylines and blurbs', () => {
    expect(parseProgramDateText('by Sharyn Rothstein')).toBeNull();
    expect(
      parseProgramDateText("CTC's 2026 Acting Conservatory Mengwe Wapimewah performance"),
    ).toBeNull();
    expect(parseProgramDateText('')).toBeNull();
  });

  it('returns null for an unknown month name', () => {
    expect(parseProgramDateText('Augtember 04, 2026')).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx jest programDates -v`
Expected: FAIL — cannot find module `../services/programDates`.

- [ ] **Step 4: Implement the parser**

```ts
// backend/src/services/programDates.ts

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Parses the listing-page date text into an inclusive date range. Handles
 * "August 04, 2026", "July 18 - 21, 2026", and "June 28 - July 26, 2026"
 * (hyphen, en- or em-dash). Anything else — theatre bylines, blurbs —
 * returns null, which the matcher treats as "undated", not an error.
 */
export function parseProgramDateText(
  raw: string,
): { startDate: string; endDate: string } | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  const m = /^([A-Za-z]+) (\d{1,2})(?:\s*[-–—]\s*(?:([A-Za-z]+) )?(\d{1,2}))?, (\d{4})$/.exec(text);
  if (!m) return null;
  const [, month1, day1, month2, day2, yearStr] = m;
  const startMonth = MONTHS[month1.toLowerCase()];
  if (!startMonth) return null;
  const year = Number(yearStr);
  const startDate = `${year}-${pad(startMonth)}-${pad(Number(day1))}`;
  if (!day2) return { startDate, endDate: startDate };
  const endMonth = month2 ? MONTHS[month2.toLowerCase()] : startMonth;
  if (!endMonth) return null;
  return { startDate, endDate: `${year}-${pad(endMonth)}-${pad(Number(day2))}` };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest programDates -v`
Expected: PASS (7 tests).

- [ ] **Step 6: Validate and commit**

```bash
cd backend && npm run validate
git add src/types/programs.ts src/services/programDates.ts src/__tests__/programDates.test.ts
git commit -m "feat(programs): program types + listing date-text parser (#165)"
```

---

### Task 2: Listing-page parsers + AudienceAccessClient

**Files:**
- Create: `backend/src/services/audienceAccessClient.ts`
- Create: `backend/src/__tests__/fixtures/audienceaccess-upcoming.html`
- Create: `backend/src/__tests__/fixtures/audienceaccess-past.html`
- Test: `backend/src/__tests__/audienceAccessClient.test.ts`

**Interfaces:**
- Consumes: `Program` from `../types/programs`; `parseProgramDateText` from `./programDates` (Task 1).
- Produces: `parseUpcomingPage(html: string): Program[]`, `parsePastPage(html: string): Program[]`, and `class AudienceAccessClient { constructor(fetchFn?: typeof fetch, baseUrl?: string); fetchPrograms(): Promise<Program[]> }` used by Tasks 5 and 6.

- [ ] **Step 1: Create the HTML fixtures**

These are trimmed from the real pages (structure verified 2026-08-05). Real markup wraps entries in far more chrome; the parser must key off the container classes shown here, which are the real ones.

`backend/src/__tests__/fixtures/audienceaccess-upcoming.html`:

```html
<!DOCTYPE html>
<html lang="en">
<body>
<div id="mobile-master-container">
  <div class="slide" id="0" style="background-image:url(https://audienceaccess.co/storage/213/colored.jpg);">
    <a href="https://audienceaccess.co/show/CHQ-16781">
      <div class="mobile-index-show-slides-target"></div>
    </a>
    <div id="mobile-index-footer">
      <div class="mobile-index-footer-show-details">
        <a href="https://audienceaccess.co/show/CHQ-16781">
          <div class="mobile-index-footer-show-name">
            for colored girls who have considered suicide/when the rainbow is enuf
          </div>
        </a>
        <div class="mobile-index-footer-show-date">
          CTC’s 2026 Acting Conservatory Mengwe Wapimewah performance
        </div>
      </div>
      <div class="mobile-index-footer-show-btns">
        <a href="https://tickets.chq.org/ticketselection.html?perfAk=CHQ.EVN2211.PRF1" target="_blank">
          <div class="mobile-ticket-icon"></div>
        </a>
        <a href="https://audienceaccess.co/show/CHQ-16781">
          <div class="mobile-enter-show-icon"></div>
        </a>
      </div>
    </div>
  </div>
  <div class="slide" id="1" style="background-image:url(https://audienceaccess.co/storage/213/open_recital_2.jpg);">
    <a href="https://audienceaccess.co/show/CHQ-16530">
      <div class="mobile-index-show-slides-target"></div>
    </a>
    <div id="mobile-index-footer">
      <div class="mobile-index-footer-show-details">
        <a href="https://audienceaccess.co/show/CHQ-16530">
          <div class="mobile-index-footer-show-name">
            School of Music: Open Recital #6
          </div>
        </a>
        <div class="mobile-index-footer-show-date">
          August 04, 2026
        </div>
      </div>
    </div>
  </div>
  <div class="slide" id="2">
    <a href="https://audienceaccess.co/show/CHQ-16754">
      <div class="mobile-index-show-slides-target"></div>
    </a>
    <div id="mobile-index-footer">
      <div class="mobile-index-footer-show-details">
        <a href="https://audienceaccess.co/show/CHQ-16754">
          <div class="mobile-index-footer-show-name">
            School of Music: Double Bass Recital
          </div>
        </a>
        <div class="mobile-index-footer-show-date">
          August 05, 2026
        </div>
      </div>
    </div>
  </div>
</div>
</body>
</html>
```

`backend/src/__tests__/fixtures/audienceaccess-past.html`:

```html
<!DOCTYPE html>
<html lang="en">
<body>
<div id="mobile-content-wrapper">
  <div class="mobile-past-events-container">
    <div class="mobile-past-events-grid">
      <div class="mobile-past-events-feature-box">
        <a href="https://audienceaccess.co/show/CHQ-16567">
          <div class="mobile-past-events-feature-circle"></div>
        </a>
        <div class="mobile-past-events-feature-text-wrapper">
          <a href="https://audienceaccess.co/show/CHQ-16567">
            <div class="mobile-past-events-feature-title">
              Chautauqua Chamber Music: Ruckus with Keir GoGwilt, violin
            </div>
          </a>
          <div class="mobile-past-events-feature-dates">
            August 03, 2026
          </div>
          <div class="mobile-past-events-feature-status">Past Event</div>
        </div>
      </div>
      <div class="mobile-past-events-feature-box">
        <a href="https://audienceaccess.co/show/CHQ-16426">
          <div class="mobile-past-events-feature-circle"></div>
        </a>
        <div class="mobile-past-events-feature-text-wrapper">
          <a href="https://audienceaccess.co/show/CHQ-16426">
            <div class="mobile-past-events-feature-title">
              Best For Baby
            </div>
          </a>
          <div class="mobile-past-events-feature-dates">
            by Sharyn Rothstein
          </div>
          <div class="mobile-past-events-feature-status">Past Event</div>
        </div>
      </div>
      <div class="mobile-past-events-feature-box">
        <a href="https://audienceaccess.co/show/CHQ-16571">
          <div class="mobile-past-events-feature-circle"></div>
        </a>
        <div class="mobile-past-events-feature-text-wrapper">
          <a href="https://audienceaccess.co/show/CHQ-16571">
            <div class="mobile-past-events-feature-title">
              Chautauqua Opera Conservatory: La Calisto
            </div>
          </a>
          <div class="mobile-past-events-feature-dates">
            July 18 - 21, 2026
          </div>
          <div class="mobile-past-events-feature-status">Past Event</div>
        </div>
      </div>
      <div class="mobile-past-events-feature-box">
        <a href="https://audienceaccess.co/show/CHQ-9999">
          <div class="mobile-past-events-feature-circle"></div>
        </a>
        <div class="mobile-past-events-feature-text-wrapper">
          <a href="https://audienceaccess.co/show/CHQ-9999">
            <div class="mobile-past-events-feature-title">
              An Evening With A 2022 Guest Artist
            </div>
          </a>
          <div class="mobile-past-events-feature-dates">
            a memorable evening
          </div>
          <div class="mobile-past-events-feature-status">Past Event</div>
        </div>
      </div>
    </div>
  </div>
</div>
</body>
</html>
```

- [ ] **Step 2: Write the failing tests**

```ts
// backend/src/__tests__/audienceAccessClient.test.ts
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
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx jest audienceAccessClient -v`
Expected: FAIL — cannot find module `../services/audienceAccessClient`.

- [ ] **Step 4: Implement the client**

```ts
// backend/src/services/audienceAccessClient.ts
import * as cheerio from 'cheerio';
import type { Program } from '../types/programs';
import { parseProgramDateText } from './programDates';

const DEFAULT_BASE_URL = 'https://audienceaccess.co';
const USER_AGENT = 'chqcal.org program-linker (https://www.chqcal.org)';
const REQUEST_TIMEOUT_MS = 10_000;
const SHOW_ID_RE = /\/show\/(CHQ-\d+)/;

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

function buildProgram(
  href: string | undefined,
  title: string,
  dateText: string,
  source: Program['source'],
): Program | null {
  const showId = href ? SHOW_ID_RE.exec(href)?.[1] : undefined;
  if (!showId || !title) return null;
  const parsed = parseProgramDateText(dateText);
  return {
    showId,
    url: `${DEFAULT_BASE_URL}/show/${showId}`,
    title,
    dateText,
    startDate: parsed?.startDate ?? null,
    endDate: parsed?.endDate ?? null,
    source,
  };
}

/** Parses the upcoming-events page (carousel of `.slide` blocks). */
export function parseUpcomingPage(html: string): Program[] {
  const $ = cheerio.load(html);
  const out: Program[] = [];
  $('.slide').each((_, el) => {
    const slide = $(el);
    const program = buildProgram(
      slide.find('a[href*="/show/CHQ-"]').first().attr('href'),
      collapse(slide.find('.mobile-index-footer-show-name').first().text()),
      collapse(slide.find('.mobile-index-footer-show-date').first().text()),
      'upcoming',
    );
    if (program) out.push(program);
  });
  return out;
}

/** Parses the past-events page (grid of `.mobile-past-events-feature-box`). */
export function parsePastPage(html: string): Program[] {
  const $ = cheerio.load(html);
  const out: Program[] = [];
  $('.mobile-past-events-feature-box').each((_, el) => {
    const box = $(el);
    const program = buildProgram(
      box.find('a[href*="/show/CHQ-"]').first().attr('href'),
      collapse(box.find('.mobile-past-events-feature-title').first().text()),
      collapse(box.find('.mobile-past-events-feature-dates').first().text()),
      'past',
    );
    if (program) out.push(program);
  });
  return out;
}

/**
 * Read-only scraper for the audienceaccess.co digital-program listings.
 * Two requests per run; throws on any non-2xx so the caller aborts the run
 * (and keeps the previously published sidecar) instead of publishing from
 * a partial scrape.
 */
export class AudienceAccessClient {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  private async getHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`audienceaccess request failed: ${res.status} ${url}`);
      }
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchPrograms(): Promise<Program[]> {
    const upcomingHtml = await this.getHtml(`${this.baseUrl}/CHQ`);
    const pastHtml = await this.getHtml(`${this.baseUrl}/past/CHQ`);
    const byId = new Map<string, Program>();
    for (const p of parsePastPage(pastHtml)) byId.set(p.showId, p);
    for (const p of parseUpcomingPage(upcomingHtml)) byId.set(p.showId, p);
    return [...byId.values()];
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest audienceAccessClient -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Validate and commit**

```bash
cd backend && npm run validate && npm test
git add src/services/audienceAccessClient.ts src/__tests__/audienceAccessClient.test.ts src/__tests__/fixtures/audienceaccess-upcoming.html src/__tests__/fixtures/audienceaccess-past.html
git commit -m "feat(programs): audienceaccess.co listing scraper (#165)"
```

---

### Task 3: Program matcher

**Files:**
- Create: `backend/src/services/programMatcher.ts`
- Test: `backend/src/__tests__/programMatcher.test.ts`

**Interfaces:**
- Consumes: `normalize` from `./textNormalize`; types from `../types/programs`; `CalendarEventLite` from `../types/articles`.
- Produces (used by Tasks 5–6): `MATCHER_VERSION: number`, `showIdNum(showId: string): number`, `scoreTitles(programTitle, eventTitle)`, `scorePair(program, event, minUndatedShowId)`, and `computeProgramMatchState(input: { programs: Program[]; events: CalendarEventLite[]; year: number; prevState?: ProgramMatchState }): { state: ProgramMatchState; links: Record<string, PublishedProgramLink[]>; linksChanged: boolean; stateChanged: boolean }`.

**Matching rules (from the spec, with real-data calibration):**
- Event `startDate` in the snapshot uses a **space** separator (`"2026-08-06 22:00:00"`); taking `.slice(0, 10)` yields the day for both `'T'` and space forms.
- Dated program: event day must fall inside `[startDate, endDate]` (inclusive), then title Jaccard ≥ 0.6. Real pair that must pass: program "School of Music: Double Bass Recital" vs event "School of Music: Double Bass Concert" (Jaccard 5/7 ≈ 0.71).
- Undated program: numeric show ID must be ≥ the minimum ID among programs dated in the target year (the past page reaches back to 2021); then either normalized containment (shorter side ≥ 10 chars) or Jaccard ≥ 0.8. Real pair that must pass via containment: program "Best For Baby" vs event "Chautauqua Theater Company Presents Best for Baby (Pick-Your-Price)".
- One link per event: best score wins, tie → higher show ID.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/__tests__/programMatcher.test.ts
import type { CalendarEventLite } from '../types/articles';
import type { Program, ProgramMatchState } from '../types/programs';
import {
  MATCHER_VERSION,
  computeProgramMatchState,
  scorePair,
  scoreTitles,
  showIdNum,
} from '../services/programMatcher';

const program = (over: Partial<Program>): Program => ({
  showId: 'CHQ-16530',
  url: 'https://audienceaccess.co/show/CHQ-16530',
  title: 'School of Music: Open Recital #6',
  dateText: 'August 04, 2026',
  startDate: '2026-08-04',
  endDate: '2026-08-04',
  source: 'upcoming',
  ...over,
});

const event = (over: Partial<CalendarEventLite>): CalendarEventLite => ({
  id: 'ev-1',
  title: 'School of Music: Open Recital',
  startDate: '2026-08-04 14:00:00',
  ...over,
});

describe('showIdNum', () => {
  it('extracts the numeric part', () => {
    expect(showIdNum('CHQ-16530')).toBe(16530);
  });
});

describe('scoreTitles', () => {
  it('scores near-identical titles high', () => {
    const { score } = scoreTitles(
      'School of Music: Open Recital #6',
      'School of Music: Open Recital',
    );
    expect(score).toBeGreaterThanOrEqual(0.8);
  });

  it('passes the Recital-vs-Concert real pair at the dated threshold', () => {
    const { score } = scoreTitles(
      'School of Music: Double Bass Recital',
      'School of Music: Double Bass Concert',
    );
    expect(score).toBeGreaterThanOrEqual(0.6);
    expect(score).toBeLessThan(0.8);
  });

  it('detects containment for short program titles inside long event titles', () => {
    const { score, reasons } = scoreTitles(
      'Best For Baby',
      'Chautauqua Theater Company Presents Best for Baby (Pick-Your-Price)',
    );
    expect(reasons).toContain('title-containment');
    expect(score).toBeGreaterThanOrEqual(0.8);
  });

  it('does not count containment for very short titles', () => {
    const { reasons } = scoreTitles('Gala', 'An Evening Gala With Friends');
    expect(reasons).not.toContain('title-containment');
  });

  it('scores unrelated titles low', () => {
    const { score } = scoreTitles(
      'Chautauqua Symphony Orchestra: Beethoven',
      'Morning Devotional Hour',
    );
    expect(score).toBeLessThan(0.2);
  });
});

describe('scorePair', () => {
  it('gates dated programs on the event day', () => {
    expect(scorePair(program({}), event({ startDate: '2026-08-05 14:00:00' }), null)).toBeNull();
    expect(scorePair(program({}), event({}), null)).not.toBeNull();
  });

  it('accepts events anywhere inside a date range', () => {
    const run = program({
      showId: 'CHQ-16571',
      title: 'Chautauqua Opera Conservatory: La Calisto',
      dateText: 'July 18 - 21, 2026',
      startDate: '2026-07-18',
      endDate: '2026-07-21',
    });
    const performance = event({
      title: 'Chautauqua Opera Conservatory: La Calisto',
      startDate: '2026-07-20 19:30:00',
    });
    expect(scorePair(run, performance, null)).not.toBeNull();
  });

  it('rejects undated programs below the show-ID fence', () => {
    const old = program({
      showId: 'CHQ-9999',
      title: 'Best For Baby',
      dateText: 'by Sharyn Rothstein',
      startDate: null,
      endDate: null,
    });
    const perf = event({ title: 'Chautauqua Theater Company Presents Best for Baby' });
    expect(scorePair(old, perf, 16000)).toBeNull();
    expect(scorePair({ ...old, showId: 'CHQ-16426' }, perf, 16000)).not.toBeNull();
  });

  it('rejects every undated program when no fence exists', () => {
    const undated = program({ startDate: null, endDate: null });
    expect(scorePair(undated, event({}), null)).toBeNull();
  });

  it('holds undated programs to the stricter title bar', () => {
    const undated = program({
      showId: 'CHQ-16800',
      title: 'School of Music: Double Bass Recital',
      dateText: 'tba',
      startDate: null,
      endDate: null,
    });
    // Jaccard ≈ 0.71: enough when dated, not enough when undated.
    expect(
      scorePair(undated, event({ title: 'School of Music: Double Bass Concert' }), 16000),
    ).toBeNull();
  });
});

describe('computeProgramMatchState', () => {
  const programs: Program[] = [
    program({}), // dated Aug 04, CHQ-16530
    program({
      // A second dated-in-2026 program with a LOWER id, so the undated fence
      // (min dated id = 16300) sits below CHQ-16426. Without it the fence
      // would wrongly exclude the Best For Baby program from this data set.
      showId: 'CHQ-16300',
      url: 'https://audienceaccess.co/show/CHQ-16300',
      title: 'Chautauqua Opera Conservatory: La Calisto',
      dateText: 'July 18 - 21, 2026',
      startDate: '2026-07-18',
      endDate: '2026-07-21',
      source: 'past',
    }),
    program({
      showId: 'CHQ-16426',
      url: 'https://audienceaccess.co/show/CHQ-16426',
      title: 'Best For Baby',
      dateText: 'by Sharyn Rothstein',
      startDate: null,
      endDate: null,
      source: 'past',
    }),
    program({
      showId: 'CHQ-9999',
      url: 'https://audienceaccess.co/show/CHQ-9999',
      title: 'Best For Baby',
      dateText: 'an old staging',
      startDate: null,
      endDate: null,
      source: 'past',
    }),
  ];
  const events: CalendarEventLite[] = [
    event({}), // matches the recital by date+title
    event({
      id: 'ev-2',
      title: 'Chautauqua Theater Company Presents Best for Baby',
      startDate: '2026-07-19 19:30:00',
    }),
    event({
      id: 'ev-3',
      title: 'Chautauqua Theater Company Presents Best for Baby (Pick-Your-Price)',
      startDate: '2026-07-18 17:00:00',
    }),
    event({ id: 'ev-4', title: 'Morning Devotional Hour', startDate: '2026-08-04 09:15:00' }),
  ];

  it('links a recurring undated program to every performance, one link per event', () => {
    const { links } = computeProgramMatchState({ programs, events, year: 2026 });
    expect(links['ev-2']).toEqual([
      { title: 'Best For Baby', url: 'https://audienceaccess.co/show/CHQ-16426' },
    ]);
    expect(links['ev-3']).toHaveLength(1);
    expect(links['ev-4']).toBeUndefined(); // no confident match → no link
    expect(links['ev-1']).toEqual([
      { title: 'School of Music: Open Recital #6', url: 'https://audienceaccess.co/show/CHQ-16530' },
    ]);
  });

  it('excludes the pre-season duplicate via the fence (CHQ-9999 never linked)', () => {
    const { state } = computeProgramMatchState({ programs, events, year: 2026 });
    expect(state.matches.every(m => m.showId !== 'CHQ-9999')).toBe(true);
  });

  it('reports linksChanged=false for an identical previous state', () => {
    const first = computeProgramMatchState({ programs, events, year: 2026 });
    const second = computeProgramMatchState({
      programs, events, year: 2026, prevState: first.state,
    });
    expect(second.linksChanged).toBe(false);
    expect(second.stateChanged).toBe(false);
  });

  it('forces republish on matcher version bump', () => {
    const first = computeProgramMatchState({ programs, events, year: 2026 });
    const stale: ProgramMatchState = { ...first.state, matcherVersion: MATCHER_VERSION - 1 };
    const second = computeProgramMatchState({
      programs, events, year: 2026, prevState: stale,
    });
    expect(second.linksChanged).toBe(true);
  });

  it('score-only drift does not republish', () => {
    const first = computeProgramMatchState({ programs, events, year: 2026 });
    const drifted: ProgramMatchState = {
      ...first.state,
      matches: first.state.matches.map(m => ({ ...m, score: m.score + 0.01 })),
    };
    const second = computeProgramMatchState({
      programs, events, year: 2026, prevState: drifted,
    });
    expect(second.linksChanged).toBe(false);
    expect(second.stateChanged).toBe(true); // state file still refreshes
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest programMatcher -v`
Expected: FAIL — cannot find module `../services/programMatcher`.

- [ ] **Step 3: Implement the matcher**

```ts
// backend/src/services/programMatcher.ts
import { createHash } from 'crypto';
import { normalize } from './textNormalize';
import type { CalendarEventLite } from '../types/articles';
import type {
  Program,
  ProgramMatchRecord,
  ProgramMatchState,
  PublishedProgramLink,
} from '../types/programs';

/** Bump to force a full republish (matcher rule changes). */
export const MATCHER_VERSION = 1;
/** Dated programs: title Jaccard floor (date gate already passed). */
export const TITLE_THRESHOLD = 0.6;
/** Undated programs: stricter Jaccard floor (no date evidence). */
export const UNDATED_TITLE_THRESHOLD = 0.8;
/** Containment only counts when the shorter normalized title is this long. */
export const MIN_CONTAINMENT_LENGTH = 10;
const CONTAINMENT_SCORE = 0.9;

const sha16 = (s: string): string =>
  createHash('sha256').update(s).digest('hex').slice(0, 16);

export const computeProgramContentHash = (p: Program): string =>
  sha16(`${p.title}|${p.dateText}`);

export const computeEventFingerprint = (e: CalendarEventLite): string =>
  sha16(`${e.title}|${e.startDate}`);

/** "CHQ-16530" → 16530. IDs are assigned chronologically by the platform. */
export const showIdNum = (showId: string): number =>
  Number(showId.replace(/\D/g, ''));

/** Works for both "2026-08-04T14:00:00" and "2026-08-04 14:00:00". */
const eventDay = (startDate: string): string => startDate.slice(0, 10);

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface TitleScore {
  score: number;
  reasons: string[];
}

export function scoreTitles(programTitle: string, eventTitle: string): TitleScore {
  const np = normalize(programTitle);
  const ne = normalize(eventTitle);
  if (!np || !ne) return { score: 0, reasons: [] };
  const j = jaccard(new Set(np.split(' ')), new Set(ne.split(' ')));
  const shorter = np.length <= ne.length ? np : ne;
  const contained =
    shorter.length >= MIN_CONTAINMENT_LENGTH && (np.includes(ne) || ne.includes(np));
  const score = Math.round(Math.max(j, contained ? CONTAINMENT_SCORE : 0) * 10000) / 10000;
  const reasons = [`title-jaccard:${j.toFixed(2)}`];
  if (contained) reasons.push('title-containment');
  return { score, reasons };
}

/**
 * Scores one (program, event) pair, or null when the pair is ineligible.
 * `minUndatedShowId` is the season fence for undated programs: the smallest
 * numeric show ID among programs dated in the target year, or null when no
 * program is dated in-year (then no undated program is eligible at all).
 */
export function scorePair(
  program: Program,
  event: CalendarEventLite,
  minUndatedShowId: number | null,
): TitleScore | null {
  if (program.startDate && program.endDate) {
    const day = eventDay(event.startDate);
    if (day < program.startDate || day > program.endDate) return null;
    const t = scoreTitles(program.title, event.title);
    if (t.score < TITLE_THRESHOLD) return null;
    return { score: t.score, reasons: ['date-window', ...t.reasons] };
  }
  if (minUndatedShowId == null || showIdNum(program.showId) < minUndatedShowId) return null;
  const t = scoreTitles(program.title, event.title);
  if (!t.reasons.includes('title-containment') && t.score < UNDATED_TITLE_THRESHOLD) {
    return null;
  }
  return { score: t.score, reasons: ['undated', ...t.reasons] };
}

export interface ComputeProgramInput {
  programs: Program[];
  events: CalendarEventLite[];
  year: number;
  prevState?: ProgramMatchState;
}

export interface ComputeProgramResult {
  state: ProgramMatchState;
  links: Record<string, PublishedProgramLink[]>;
  linksChanged: boolean;
  stateChanged: boolean;
}

/** Canonical match identity for republish decisions — scores excluded. */
const canonicalMatches = (ms: ProgramMatchRecord[]): string =>
  ms.map(m => `${m.eventId}:${m.showId}`).sort().join(',');

export function computeProgramMatchState({
  programs,
  events,
  year,
  prevState,
}: ComputeProgramInput): ComputeProgramResult {
  const datedInYear = programs.filter(p => p.startDate?.startsWith(`${year}`));
  const minUndatedShowId = datedInYear.length
    ? Math.min(...datedInYear.map(p => showIdNum(p.showId)))
    : null;
  const byId = new Map(programs.map(p => [p.showId, p]));

  const matches: ProgramMatchRecord[] = [];
  for (const event of events) {
    let best: ProgramMatchRecord | undefined;
    for (const program of programs) {
      const scored = scorePair(program, event, minUndatedShowId);
      if (!scored) continue;
      const better =
        !best ||
        scored.score > best.score ||
        (scored.score === best.score && showIdNum(program.showId) > showIdNum(best.showId));
      if (better) {
        best = {
          eventId: event.id,
          showId: program.showId,
          score: scored.score,
          reasons: scored.reasons,
        };
      }
    }
    if (best) matches.push(best);
  }
  matches.sort((a, b) => a.eventId.localeCompare(b.eventId));

  const links: Record<string, PublishedProgramLink[]> = {};
  for (const m of matches) {
    const p = byId.get(m.showId)!;
    links[m.eventId] = [{ title: p.title, url: p.url }];
  }

  const state: ProgramMatchState = {
    matcherVersion: MATCHER_VERSION,
    programs: Object.fromEntries(
      [...programs]
        .sort((a, b) => showIdNum(a.showId) - showIdNum(b.showId))
        .map(p => [p.showId, computeProgramContentHash(p)]),
    ),
    eventFingerprints: Object.fromEntries(
      [...events]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(e => [e.id, computeEventFingerprint(e)]),
    ),
    matches,
  };

  const linksChanged =
    prevState == null ||
    prevState.matcherVersion !== MATCHER_VERSION ||
    canonicalMatches(prevState.matches) !== canonicalMatches(matches);
  const stateChanged =
    prevState == null || JSON.stringify(prevState) !== JSON.stringify(state);

  return { state, links, linksChanged, stateChanged };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest programMatcher -v`
Expected: PASS. If the Recital-vs-Concert pair scores below 0.6, the Jaccard denominator is wrong (must be union size, not max size) — fix the implementation, not the test.

- [ ] **Step 5: Validate and commit**

```bash
cd backend && npm run validate && npm test
git add src/services/programMatcher.ts src/__tests__/programMatcher.test.ts
git commit -m "feat(programs): date-gated title matcher with season fence (#165)"
```

---

### Task 4: Program links publisher

**Files:**
- Create: `backend/src/services/programLinksPublisher.ts`
- Test: `backend/src/__tests__/programLinksPublisher.test.ts`

**Interfaces:**
- Consumes: `ProgramLinksFile`, `ProgramMatchState` from `../types/programs`.
- Produces (used by Tasks 5–6): `class ProgramLinksPublisher { constructor(s3: S3Client, bucket: string, publicPrefix: string, statePrefix: string, stateBucket?: string); loadState(year): Promise<ProgramMatchState | undefined>; saveState(year, state): Promise<void>; publishLinks(year, file: ProgramLinksFile): Promise<void> }`.

This is a rename-level clone of `articleLinksPublisher.ts` (same S3 semantics, different keys). Keys: public `${publicPrefix}/program-links-${year}.json`, state `${statePrefix}/program-links-state-${year}.json`.

- [ ] **Step 1: Write the failing tests**

Model on `backend/src/__tests__/articleLinksPublisher.test.ts` — read it first and mirror its S3Client mocking approach exactly (same mock style, same assertion patterns), with these required cases:

```ts
// backend/src/__tests__/programLinksPublisher.test.ts — required cases:
// 1. publishLinks PUTs to `<publicPrefix>/program-links-2026.json` on the
//    public bucket with ContentType application/json and
//    CacheControl 'public, max-age=300'.
// 2. saveState PUTs to `<statePrefix>/program-links-state-2026.json` on the
//    STATE bucket (constructor's 5th arg), not the public bucket.
// 3. loadState returns the parsed state on success.
// 4. loadState returns undefined when S3 throws err.name === 'NoSuchKey'.
// 5. loadState rethrows any other error.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest programLinksPublisher -v`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// backend/src/services/programLinksPublisher.ts
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { ProgramLinksFile, ProgramMatchState } from '../types/programs';

function isNoSuchKey(err: unknown): boolean {
  return (err as { name?: string })?.name === 'NoSuchKey';
}

/**
 * Writes the public program-links sidecar (CloudFront-served, 5-min cache)
 * and round-trips the private match state. Scores/reasons live only in the
 * state object, which goes to the private cache bucket — never the public
 * frontend bucket. Mirrors ArticleLinksPublisher.
 */
export class ProgramLinksPublisher {
  private readonly stateBucket: string;

  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly publicPrefix: string,
    private readonly statePrefix: string,
    stateBucket?: string,
  ) {
    this.stateBucket = stateBucket ?? bucket;
  }

  private publicKey(year: number): string {
    return `${this.publicPrefix}/program-links-${year}.json`;
  }

  private stateKey(year: number): string {
    return `${this.statePrefix}/program-links-state-${year}.json`;
  }

  async loadState(year: number): Promise<ProgramMatchState | undefined> {
    try {
      const out = await this.s3.send(
        new GetObjectCommand({ Bucket: this.stateBucket, Key: this.stateKey(year) }),
      );
      return JSON.parse(await out.Body!.transformToString()) as ProgramMatchState;
    } catch (err) {
      if (isNoSuchKey(err)) return undefined;
      throw err;
    }
  }

  async saveState(year: number, state: ProgramMatchState): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.stateBucket,
        Key: this.stateKey(year),
        Body: JSON.stringify(state),
        ContentType: 'application/json',
      }),
    );
  }

  async publishLinks(year: number, file: ProgramLinksFile): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.publicKey(year),
        Body: JSON.stringify(file),
        ContentType: 'application/json',
        CacheControl: 'public, max-age=300',
      }),
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest programLinksPublisher -v`
Expected: PASS.

- [ ] **Step 5: Validate and commit**

```bash
cd backend && npm run validate && npm test
git add src/services/programLinksPublisher.ts src/__tests__/programLinksPublisher.test.ts
git commit -m "feat(programs): sidecar + private-state publisher (#165)"
```

---

### Task 5: Runner, Lambda handler, esbuild bundle line

**Files:**
- Create: `backend/src/services/programIngestRunner.ts`
- Create: `backend/src/handlers/programIngestHandler.ts`
- Modify: `backend/package.json` (`build:prod` script)
- Test: `backend/src/__tests__/programIngestRunner.test.ts`

**Interfaces:**
- Consumes: `computeProgramMatchState`, `MATCHER_VERSION` (Task 3); `Program`, `ProgramLinksFile`, `ProgramMatchState` (Task 1); `EventSnapshotLoader` (existing, reused as-is); `ProgramLinksPublisher` (Task 4); `AudienceAccessClient` (Task 2).
- Produces: `runProgramIngest(deps: ProgramIngestDeps): Promise<ProgramIngestSummary>` and Lambda entry `dist/programIngestHandler.scheduledHandler` (referenced by Task 7's terraform and deploy steps).

The runner deps are **structural interfaces** (not the concrete classes) so Task 6's local script can pass file-backed stand-ins without casts.

- [ ] **Step 1: Write the failing tests**

```ts
// backend/src/__tests__/programIngestRunner.test.ts
import type { CalendarEventLite } from '../types/articles';
import type { Program, ProgramLinksFile, ProgramMatchState } from '../types/programs';
import { runProgramIngest } from '../services/programIngestRunner';

const program: Program = {
  showId: 'CHQ-16530',
  url: 'https://audienceaccess.co/show/CHQ-16530',
  title: 'School of Music: Open Recital #6',
  dateText: 'August 04, 2026',
  startDate: '2026-08-04',
  endDate: '2026-08-04',
  source: 'upcoming',
};
const event: CalendarEventLite = {
  id: 'ev-1',
  title: 'School of Music: Open Recital',
  startDate: '2026-08-04 14:00:00',
};

function makeDeps(over?: {
  programs?: Program[];
  prevState?: ProgramMatchState;
}) {
  const published: ProgramLinksFile[] = [];
  const savedStates: ProgramMatchState[] = [];
  return {
    deps: {
      client: { fetchPrograms: async () => over?.programs ?? [program] },
      loader: { load: async (_year: number) => [event] },
      publisher: {
        loadState: async () => over?.prevState,
        saveState: async (_y: number, s: ProgramMatchState) => { savedStates.push(s); },
        publishLinks: async (_y: number, f: ProgramLinksFile) => { published.push(f); },
      },
      now: new Date('2026-08-05T12:00:00Z'),
      year: 2026,
    },
    published,
    savedStates,
  };
}

describe('runProgramIngest', () => {
  it('publishes links and state on first run', async () => {
    const { deps, published, savedStates } = makeDeps();
    const summary = await runProgramIngest(deps);
    expect(published).toHaveLength(1);
    expect(published[0].links['ev-1']).toEqual([
      { title: program.title, url: program.url },
    ]);
    expect(savedStates).toHaveLength(1);
    expect(summary).toMatchObject({
      programs: 1, dated: 1, undated: 0, eventsTotal: 1,
      matchedEvents: 1, linksPublished: true,
    });
  });

  it('skips publish when nothing changed since prevState', async () => {
    const first = makeDeps();
    await runProgramIngest(first.deps);
    const second = makeDeps({ prevState: first.savedStates[0] });
    const summary = await runProgramIngest(second.deps);
    expect(second.published).toHaveLength(0);
    expect(second.savedStates).toHaveLength(0);
    expect(summary.linksPublished).toBe(false);
  });

  it('aborts without publishing when the scrape returns zero programs', async () => {
    const { deps, published, savedStates } = makeDeps({ programs: [] });
    await expect(runProgramIngest(deps)).rejects.toThrow('zero programs');
    expect(published).toHaveLength(0);
    expect(savedStates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest programIngestRunner -v`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the runner**

```ts
// backend/src/services/programIngestRunner.ts
import type { CalendarEventLite } from '../types/articles';
import type { Program, ProgramLinksFile, ProgramMatchState } from '../types/programs';
import { computeProgramMatchState, MATCHER_VERSION } from './programMatcher';

/** Structural deps so the local script can substitute file-backed stand-ins. */
export interface ProgramsSource {
  fetchPrograms(): Promise<Program[]>;
}
export interface ProgramEventsSource {
  load(year: number): Promise<CalendarEventLite[]>;
}
export interface ProgramLinksSink {
  loadState(year: number): Promise<ProgramMatchState | undefined>;
  saveState(year: number, state: ProgramMatchState): Promise<void>;
  publishLinks(year: number, file: ProgramLinksFile): Promise<void>;
}

export interface ProgramIngestDeps {
  client: ProgramsSource;
  loader: ProgramEventsSource;
  publisher: ProgramLinksSink;
  now: Date;
  year: number;
}

export interface ProgramIngestSummary {
  programs: number;
  dated: number;
  undated: number;
  eventsTotal: number;
  matchedEvents: number;
  linksPublished: boolean;
}

/**
 * One ingest cycle: full scrape → full re-match → publish when the link set
 * changed. A zero-program scrape aborts loudly instead of publishing — the
 * previously published sidecar stays live through markup drift or outages.
 */
export async function runProgramIngest(deps: ProgramIngestDeps): Promise<ProgramIngestSummary> {
  const { client, loader, publisher, now, year } = deps;

  const programs = await client.fetchPrograms();
  if (programs.length === 0) {
    throw new Error(
      '[program-ingest] scraped zero programs — refusing to publish (markup drift or fetch failure?)',
    );
  }
  const events = await loader.load(year);
  const prevState = await publisher.loadState(year);
  const { state, links, linksChanged, stateChanged } = computeProgramMatchState({
    programs, events, year, prevState,
  });

  if (linksChanged) {
    await publisher.publishLinks(year, {
      generatedAt: now.toISOString(),
      matcherVersion: MATCHER_VERSION,
      links,
    });
  }
  if (stateChanged) {
    await publisher.saveState(year, state);
  }

  const summary: ProgramIngestSummary = {
    programs: programs.length,
    dated: programs.filter(p => p.startDate != null).length,
    undated: programs.filter(p => p.startDate == null).length,
    eventsTotal: events.length,
    matchedEvents: Object.keys(links).length,
    linksPublished: linksChanged,
  };
  console.log('[program-ingest] summary:', JSON.stringify(summary));
  return summary;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest programIngestRunner -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the handler** (wiring only — covered by the runner tests plus type-check; mirrors `articleIngestHandler.ts`)

```ts
// backend/src/handlers/programIngestHandler.ts
import { S3Client } from '@aws-sdk/client-s3';
import { AudienceAccessClient } from '../services/audienceAccessClient';
import { EventSnapshotLoader } from '../services/eventSnapshotLoader';
import { ProgramLinksPublisher } from '../services/programLinksPublisher';
import { runProgramIngest } from '../services/programIngestRunner';

/**
 * Hourly EventBridge entry point (see infrastructure/program-ingest.tf).
 * Manual invocation supports { year } to target a non-current season.
 */
export async function scheduledHandler(evt?: { year?: number }): Promise<void> {
  const s3 = new S3Client({});
  const now = new Date();
  await runProgramIngest({
    client: new AudienceAccessClient(),
    loader: new EventSnapshotLoader(s3, process.env.CACHE_S3_BUCKET!, process.env.CACHE_S3_KEY_PREFIX!),
    publisher: new ProgramLinksPublisher(
      s3,
      process.env.CACHE_S3_BUCKET!,
      process.env.CACHE_S3_KEY_PREFIX!,
      process.env.STATE_S3_KEY_PREFIX ?? 'internal/program-links',
      process.env.STATE_S3_BUCKET ?? process.env.CACHE_S3_BUCKET!,
    ),
    now,
    year: evt?.year ?? now.getFullYear(),
  });
}
```

- [ ] **Step 6: Add the esbuild line to `build:prod`**

In `backend/package.json`, inside the `build:prod` script, insert immediately after the `articleIngestHandler` esbuild invocation (before `&& cp -r src/services dist/`):

```
&& npx esbuild src/handlers/programIngestHandler.ts --bundle --platform=node --target=node24 --outfile=dist/programIngestHandler.js --external:@aws-sdk/client-s3
```

(cheerio bundles inline, same as article-ingest; only the AWS SDK is external.)

- [ ] **Step 7: Verify the bundle builds and everything validates**

```bash
cd backend && npm run validate && npm test && npm run build:prod
ls dist/programIngestHandler.js   # must exist
```

- [ ] **Step 8: Commit**

```bash
git add src/services/programIngestRunner.ts src/handlers/programIngestHandler.ts src/__tests__/programIngestRunner.test.ts package.json
git commit -m "feat(programs): ingest runner + Lambda handler + bundle (#165)"
```

---

### Task 6: Local dev runner + committed dev sidecar

**Files:**
- Create: `backend/src/scripts/runProgramIngestLocal.ts`
- Modify: `backend/package.json` (add `ingest:programs:local` script)
- Modify: `.gitignore` (allow `frontend/public/data/program-links-*.json`)
- Create (generated): `frontend/public/data/program-links-2026.json`

**Interfaces:**
- Consumes: `AudienceAccessClient` (Task 2), `runProgramIngest` + the structural dep interfaces (Task 5), `CalendarEventLite`, program types (Task 1).
- Produces: `npm run ingest:programs:local [-- <year>]` and a committed dev sidecar the frontend dev server serves (Task 9 relies on it for manual verification).

- [ ] **Step 1: Write the script** (script — no unit test; the runner it drives is tested in Task 5)

```ts
// backend/src/scripts/runProgramIngestLocal.ts
/**
 * Local-only manual trigger for the program-links pipeline.
 *
 * Runs the REAL scraper + matcher (`runProgramIngest`) against:
 *   - the REAL audienceaccess.co listing pages (read-only, public)
 *   - events read from `frontend/public/data/all-events-<year>.json`
 *   - the sidecar written to `frontend/public/data/program-links-<year>.json`
 *     and the private state to a gitignored dotfile alongside it
 *
 * Nothing here touches AWS. After a run, `npm run dev` in frontend/ serves
 * the result; expand a matched event card to see the link.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/runProgramIngestLocal.ts          # current year
 *   npx ts-node src/scripts/runProgramIngestLocal.ts 2026     # explicit year
 */
import * as fs from 'fs';
import * as path from 'path';
import { AudienceAccessClient } from '../services/audienceAccessClient';
import { runProgramIngest } from '../services/programIngestRunner';
import type { CalendarEventLite } from '../types/articles';
import type { ProgramLinksFile, ProgramMatchState } from '../types/programs';

const DATA_DIR = path.resolve(__dirname, '../../../frontend/public/data');

function readJson<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

async function main(): Promise<void> {
  const year = Number(process.argv[2]) || new Date().getFullYear();
  const eventsFile = path.join(DATA_DIR, `all-events-${year}.json`);
  const events = readJson<{ data?: CalendarEventLite[] }>(eventsFile)?.data;
  if (!events?.length) {
    throw new Error(`no events in ${eventsFile} — run the frontend data setup first`);
  }
  const sidecarFile = path.join(DATA_DIR, `program-links-${year}.json`);
  const stateFile = path.join(DATA_DIR, `.program-links-state-${year}.json`);

  const summary = await runProgramIngest({
    client: new AudienceAccessClient(),
    loader: { load: async () => events },
    publisher: {
      loadState: async () => readJson<ProgramMatchState>(stateFile),
      saveState: async (_y, state) => {
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      },
      publishLinks: async (_y, file: ProgramLinksFile) => {
        fs.writeFileSync(sidecarFile, JSON.stringify(file, null, 2));
      },
    },
    now: new Date(),
    year,
  });
  console.log(`wrote ${sidecarFile}`);
  console.log(summary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `backend/package.json` `scripts`, next to `ingest:articles:local`:

```json
"ingest:programs:local": "ts-node src/scripts/runProgramIngestLocal.ts"
```

(Match the exact runner invocation style of the existing `ingest:articles:local` entry — if it uses `npx ts-node` or a different runner, copy that form.)

- [ ] **Step 3: Update `.gitignore`**

In the root `.gitignore`, in the "Test data" block after `!frontend/public/data/article-links-*.json`, add:

```
!frontend/public/data/program-links-*.json
```

(The dotfile state `.program-links-state-*.json` stays ignored via `frontend/public/data/*`.)

- [ ] **Step 4: Run the script for real and inspect**

```bash
cd backend && npm run ingest:programs:local -- 2026
```

Expected: a summary with `programs` ≈ 200–260, nonzero `matchedEvents`, and `frontend/public/data/program-links-2026.json` created. **Manually spot-check 5 entries** in the output file against https://audienceaccess.co/CHQ — titles must correspond to the linked events (this is the calibration gate for the matcher thresholds; if garbage matches appear, fix thresholds in Task 3 before proceeding).

- [ ] **Step 5: Validate and commit**

```bash
cd backend && npm run validate && npm test
git add src/scripts/runProgramIngestLocal.ts package.json ../.gitignore ../frontend/public/data/program-links-2026.json
git commit -m "feat(programs): local dev runner + dev sidecar fixture (#165)"
```

---

### Task 7: Terraform + deploy workflow

**Files:**
- Create: `infrastructure/program-ingest.tf`
- Modify: `infrastructure/github-actions.tf` (add invoke statement after the `LambdaInvokeArticleIngest` statement at ~line 144)
- Modify: `.github/workflows/deploy-production.yml` (two new steps)

**Interfaces:**
- Consumes: `dist/programIngestHandler.scheduledHandler` (Task 5); existing terraform resources `aws_s3_bucket.frontend_bucket`, `aws_s3_bucket.cache_bucket`, `var.app_name`, `var.environment`.
- Produces: Lambda `${var.app_name}-program-ingest` (i.e. `chautauqua-calendar-program-ingest`) on an hourly EventBridge rule; deploy-time code update + post-deploy trigger.

No unit tests — verification is `terraform validate` + YAML lint. **Terraform apply is NOT part of this task**; it happens post-merge (note it in the PR description).

- [ ] **Step 1: Write `infrastructure/program-ingest.tf`**

```hcl
# infrastructure/program-ingest.tf
#
# Digital program-links pipeline (docs/superpowers/specs/
# 2026-08-05-program-links-design.md). Mirrors article-ingest.tf minus
# DynamoDB: hourly EventBridge → Lambda → full scrape of audienceaccess.co
# → sidecar JSON on the frontend bucket's calendar-cache path.

resource "aws_iam_role" "program_ingest_role" {
  name = "${var.app_name}-program-ingest-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect    = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "program_ingest_basic" {
  role       = aws_iam_role.program_ingest_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "program_ingest_scoped" {
  name = "${var.app_name}-program-ingest-scoped"
  role = aws_iam_role.program_ingest_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        # Read the event snapshot (primary + publisher sidecar).
        Effect = "Allow",
        Action = ["s3:GetObject"],
        Resource = [
          "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/all-events-*.json",
          "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/publisher-events-*.json"
        ]
      },
      {
        # Publish the public sidecar (frontend bucket).
        Effect   = "Allow",
        Action   = ["s3:GetObject", "s3:PutObject"],
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/cache/calendar-cache/program-links-*.json"
      },
      {
        # Round-trip the private match state (cache bucket — CloudFront-OAC-
        # only, never world-readable; see aws_s3_bucket.cache_bucket).
        Effect   = "Allow",
        Action   = ["s3:GetObject", "s3:PutObject"],
        Resource = "${aws_s3_bucket.cache_bucket.arn}/internal/program-links/*"
      },
      {
        # S3 GetObject on a missing key returns 403 AccessDenied (not 404
        # NoSuchKey) when the caller lacks s3:ListBucket. loadState() and
        # the optional publisher-sidecar read in EventSnapshotLoader both
        # discriminate "missing" vs "real error" on err.name === 'NoSuchKey',
        # so without this grant a missing key aborts every run forever (the
        # state file can only be created by a successful run). See
        # article-ingest.tf's equivalent grant for the same reason.
        Effect   = "Allow",
        Action   = ["s3:ListBucket"],
        Resource = aws_s3_bucket.frontend_bucket.arn,
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "cache/calendar-cache/all-events-*",
              "cache/calendar-cache/publisher-events-*",
              "cache/calendar-cache/program-links-*"
            ]
          }
        }
      },
      {
        # Same 403-vs-404 fix for the private state object on the cache bucket.
        Effect   = "Allow",
        Action   = ["s3:ListBucket"],
        Resource = aws_s3_bucket.cache_bucket.arn,
        Condition = {
          StringLike = {
            "s3:prefix" = ["internal/program-links/*"]
          }
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "program_ingest" {
  name              = "/aws/lambda/${var.app_name}-program-ingest"
  retention_in_days = 14
}

resource "aws_lambda_function" "program_ingest" {
  filename      = "../backend/lambda-function.zip"
  function_name = "${var.app_name}-program-ingest"
  role          = aws_iam_role.program_ingest_role.arn
  handler       = "dist/programIngestHandler.scheduledHandler"
  runtime       = "nodejs24.x"
  timeout       = 300
  memory_size   = 512

  environment {
    variables = {
      CACHE_S3_BUCKET     = aws_s3_bucket.frontend_bucket.bucket
      CACHE_S3_KEY_PREFIX = "cache/calendar-cache"
      STATE_S3_KEY_PREFIX = "internal/program-links"
      # Private cache bucket (CloudFront-OAC-only) for the match state —
      # scores/reasons must not live on the public-read frontend bucket.
      STATE_S3_BUCKET = aws_s3_bucket.cache_bucket.bucket
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.program_ingest_basic,
    aws_iam_role_policy.program_ingest_scoped,
    aws_cloudwatch_log_group.program_ingest,
  ]

  source_code_hash = filebase64sha256("../backend/lambda-function.zip")
}

resource "aws_cloudwatch_event_rule" "program_ingest_schedule" {
  name                = "${var.app_name}-program-ingest-hourly"
  description         = "Hourly trigger for digital program-links pipeline"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "program_ingest_target" {
  rule      = aws_cloudwatch_event_rule.program_ingest_schedule.name
  target_id = "ProgramIngestTarget"
  arn       = aws_lambda_function.program_ingest.arn
}

resource "aws_lambda_permission" "program_ingest_allow_events" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.program_ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.program_ingest_schedule.arn
}
```

- [ ] **Step 2: Add the CI invoke grant**

In `infrastructure/github-actions.tf`, immediately after the `LambdaInvokeArticleIngest` statement object (ends around line 148), add to the same `Statement` list:

```hcl
      {
        Sid      = "LambdaInvokeProgramIngest"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.program_ingest.arn
      }
```

- [ ] **Step 3: Add the deploy step**

In `.github/workflows/deploy-production.yml`, immediately after the "Deploy article-ingest Lambda" step (ends ~line 407 with `rm -rf package_temp lambda-article-ingest.zip`), add:

```yaml
      - name: Deploy program-ingest Lambda
        working-directory: ./backend
        run: |
          # The program-ingest Lambda is created by `terraform apply`
          # (infrastructure/program-ingest.tf). On the very first deploy —
          # before that apply — the function does not exist yet, so guard the
          # code update and skip cleanly instead of failing the whole deploy.
          FUNC="chautauqua-calendar-program-ingest"
          if aws lambda get-function --function-name "$FUNC" >/dev/null 2>/tmp/gf-program-deploy.err; then
            :
          elif grep -q 'ResourceNotFoundException\|Function not found' /tmp/gf-program-deploy.err; then
            echo "::notice::${FUNC} not created yet — run 'terraform apply' to create it; skipping code deploy this run"
            exit 0
          else
            echo "::error::checking ${FUNC} failed (not a not-found error — likely IAM/API):"
            cat /tmp/gf-program-deploy.err
            exit 1
          fi

          # program-ingest externalizes only @aws-sdk/client-s3; cheerio and
          # everything else are bundled inline by esbuild.
          mkdir -p package_temp/node_modules

          echo "Installing program-ingest handler dependencies..."
          cd package_temp
          cat > package.json << 'EOF'
          {
            "name": "lambda-program-ingest",
            "version": "1.0.0",
            "dependencies": {
              "@aws-sdk/client-s3": "^3.0.0"
            }
          }
          EOF
          npm install --omit=dev
          cd ..

          mkdir -p package_temp/dist
          cp dist/programIngestHandler.js package_temp/dist/

          cd package_temp
          zip -r ../lambda-program-ingest.zip . \
            -x "*.md" "*/test/*" "*/tests/*" "*/examples/*" "README.md" "CHANGELOG.md"
          cd ..

          echo "Deploying program-ingest Lambda..."
          aws lambda update-function-code \
            --function-name "$FUNC" \
            --zip-file fileb://lambda-program-ingest.zip

          echo "Waiting for program-ingest Lambda to finish updating..."
          aws lambda wait function-updated \
            --function-name "$FUNC"

          rm -rf package_temp lambda-program-ingest.zip
```

- [ ] **Step 4: Add the post-deploy trigger step**

Immediately after the "Trigger article-links ingest" step, add:

```yaml
      - name: Trigger program-links ingest
        continue-on-error: true
        run: |
          # Refresh the digital program links right after deploy instead of
          # waiting up to an hour for the EventBridge schedule. Guarded +
          # continue-on-error so a not-yet-created function or a transient
          # error never fails deploy.
          FUNC="chautauqua-calendar-program-ingest"
          if aws lambda get-function --function-name "$FUNC" >/dev/null 2>/tmp/gf-program-trigger.err; then
            :
          elif grep -q 'ResourceNotFoundException\|Function not found' /tmp/gf-program-trigger.err; then
            echo "${FUNC} not created yet — run 'terraform apply' to create it; skipping trigger"
            exit 0
          else
            echo "::error::checking ${FUNC} failed (not a not-found error — likely IAM/API):"
            cat /tmp/gf-program-trigger.err
            exit 1
          fi
          echo "Triggering program-links ingest to refresh links..."
          aws lambda invoke \
            --function-name "$FUNC" \
            --invocation-type Event \
            --cli-binary-format raw-in-base64-out \
            --payload '{}' \
            /tmp/program-ingest-response.json
          echo "Program-links ingest triggered - running in background to refresh the sidecar"
```

- [ ] **Step 5: Validate**

```bash
cd infrastructure && terraform init -backend=false && terraform validate
# YAML sanity:
python3 -c "import yaml; yaml.safe_load(open('../.github/workflows/deploy-production.yml')); print('yaml ok')"
```

Expected: `Success! The configuration is valid.` and `yaml ok`.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/program-ingest.tf infrastructure/github-actions.tf .github/workflows/deploy-production.yml
git commit -m "feat(programs): terraform stack + deploy/trigger workflow steps (#165)"
```

---

### Task 8: Web — generic useSidecarLinks + useProgramLinks

**Files:**
- Create: `frontend/src/hooks/useSidecarLinks.ts`
- Create: `frontend/src/hooks/useProgramLinks.ts`
- Modify: `frontend/src/hooks/useArticleLinks.ts` (becomes a thin wrapper)
- Test: `frontend/src/__tests__/hooks/useProgramLinks.test.ts`
- Existing test must stay green: `frontend/src/__tests__/hooks/useArticleLinks.test.ts`

**Interfaces:**
- Consumes: nothing new (refactors the existing hook internals).
- Produces (used by Task 9): `useProgramLinks(year: number): { links: Record<string, ProgramLink[]>; loading: boolean }`, `interface ProgramLink { title: string; url: string }`, `__resetProgramLinksCacheForTests()`. Unchanged public surface of `useArticleLinks` (`ArticleLink`, `ArticleLinkKind`, `UseArticleLinksResult`, `__resetArticleLinksCacheForTests`).

- [ ] **Step 1: Write the failing test**

Read `frontend/src/__tests__/hooks/useArticleLinks.test.ts` first and mirror its harness (renderHook wrapper, fetch mocking, cache reset in beforeEach) exactly. Required cases:

```ts
// frontend/src/__tests__/hooks/useProgramLinks.test.ts — required cases:
// 1. Successful 200 fetch of /data/program-links-2026.json (DEV base)
//    resolves links keyed by eventId.
// 2. 404 resolves to {} and is cached (second mount does not refetch —
//    assert fetch called once).
// 3. Network error resolves to {} but is NOT cached (second mount refetches).
// 4. The article-links hook and program-links hook do not collide: with both
//    fetches mocked, useArticleLinks(2026) and useProgramLinks(2026) return
//    their own payloads (regression guard for the shared cache keying).
// Use __resetProgramLinksCacheForTests() in beforeEach.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useProgramLinks.test.ts`
Expected: FAIL — cannot resolve `@/hooks/useProgramLinks`.

- [ ] **Step 3: Implement the generic hook**

```ts
// frontend/src/hooks/useSidecarLinks.ts
import { useEffect, useState } from 'react';

interface SidecarLinksFile<T> {
  generatedAt: string;
  matcherVersion: number;
  links: Record<string, T[]>;
}

interface LoadResult<T> {
  links: Record<string, T[]>;
  /** When true the result is durable (200/404) and may be cached forever. */
  cacheable: boolean;
}

const inflight = new Map<string, Promise<LoadResult<unknown>>>();
const resolved = new Map<string, Record<string, unknown[]>>();

async function loadLinks<T>(filePrefix: string, year: number): Promise<LoadResult<T>> {
  const key = `${filePrefix}-${year}`;
  if (resolved.has(key)) {
    return { links: resolved.get(key) as Record<string, T[]>, cacheable: true };
  }
  const existing = inflight.get(key);
  if (existing) return existing as Promise<LoadResult<T>>;

  const promise = (async (): Promise<LoadResult<T>> => {
    try {
      // Same dev/prod split as useEventData: Vite dev serves fixtures from
      // /public/data; production serves the Lambda-published sidecar from
      // the CloudFront calendar-cache path.
      const cacheBase = import.meta.env.DEV ? '/data' : '/cache/calendar-cache';
      const res = await fetch(`${cacheBase}/${key}.json`);
      if (res.status === 404) {
        return { links: {}, cacheable: true };
      }
      if (!res.ok) {
        return { links: {}, cacheable: false };
      }
      const payload = (await res.json()) as SidecarLinksFile<T>;
      return { links: payload.links ?? {}, cacheable: true };
    } catch {
      return { links: {}, cacheable: false };
    }
  })();

  inflight.set(key, promise as Promise<LoadResult<unknown>>);
  const result = await promise;
  if (result.cacheable) {
    resolved.set(key, result.links);
  }
  inflight.delete(key);
  return result;
}

/**
 * Shared loader for eventId-keyed sidecar files
 * (`<filePrefix>-<year>.json` with a `links` map). Module-level caches
 * dedupe concurrent loads across all consumers of the same file.
 */
export function useSidecarLinks<T>(
  filePrefix: string,
  year: number,
): { links: Record<string, T[]>; loading: boolean } {
  const key = `${filePrefix}-${year}`;
  const cached = resolved.get(key) as Record<string, T[]> | undefined;
  const [links, setLinks] = useState<Record<string, T[]>>(cached ?? {});
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    let cancelled = false;
    if (resolved.has(key)) {
      setLinks(resolved.get(key) as Record<string, T[]>);
      setLoading(false);
      return;
    }
    setLinks({});
    setLoading(true);
    loadLinks<T>(filePrefix, year).then((result) => {
      if (cancelled) return;
      setLinks(result.links);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filePrefix, year, key]);

  return { links, loading };
}

/** Test-only: clear the module-level cache so each test starts fresh. */
export function __resetSidecarLinksCacheForTests(): void {
  inflight.clear();
  resolved.clear();
}
```

- [ ] **Step 4: Rewrite `useArticleLinks.ts` as a wrapper** (public surface unchanged)

```ts
// frontend/src/hooks/useArticleLinks.ts
import { useSidecarLinks, __resetSidecarLinksCacheForTests } from './useSidecarLinks';

export type ArticleLinkKind = 'preview' | 'recap';

export interface ArticleLink {
  title: string;
  url: string;
  kind: ArticleLinkKind;
  /** YYYY-MM-DD publication date on chqdaily.com. */
  pubDate: string;
}

export interface UseArticleLinksResult {
  /** eventId → linked Daily articles (previews first, then recaps). */
  links: Record<string, ArticleLink[]>;
  loading: boolean;
}

export function useArticleLinks(year: number): UseArticleLinksResult {
  return useSidecarLinks<ArticleLink>('article-links', year);
}

/**
 * Test-only: clear the module-level cache so each test starts fresh.
 * (Shared with all sidecar-links hooks.)
 */
export function __resetArticleLinksCacheForTests(): void {
  __resetSidecarLinksCacheForTests();
}
```

- [ ] **Step 5: Create `useProgramLinks.ts`**

```ts
// frontend/src/hooks/useProgramLinks.ts
import { useSidecarLinks, __resetSidecarLinksCacheForTests } from './useSidecarLinks';

/** One digital program link from program-links-<year>.json. */
export interface ProgramLink {
  title: string;
  url: string;
}

export interface UseProgramLinksResult {
  /** eventId → digital program link (at most one per event). */
  links: Record<string, ProgramLink[]>;
  loading: boolean;
}

export function useProgramLinks(year: number): UseProgramLinksResult {
  return useSidecarLinks<ProgramLink>('program-links', year);
}

/**
 * Test-only: clear the module-level cache so each test starts fresh.
 * (Shared with all sidecar-links hooks.)
 */
export function __resetProgramLinksCacheForTests(): void {
  __resetSidecarLinksCacheForTests();
}
```

- [ ] **Step 6: Run the full frontend hook tests**

Run: `cd frontend && npx vitest run src/__tests__/hooks/`
Expected: PASS — including the untouched `useArticleLinks.test.ts` (the refactor must not change its behavior; if it fails, fix the generic hook, not the test).

- [ ] **Step 7: Validate and commit**

```bash
cd frontend && npm run build
git add src/hooks/useSidecarLinks.ts src/hooks/useProgramLinks.ts src/hooks/useArticleLinks.ts src/__tests__/hooks/useProgramLinks.test.ts
git commit -m "feat(web): generic sidecar-links hook + useProgramLinks (#165)"
```

---

### Task 9: Web — EventCard/EventList/page wiring

**Files:**
- Modify: `frontend/src/app/page.tsx` (lines ~13, ~46, ~180)
- Modify: `frontend/src/components/calendar/EventList.tsx` (props + pass-through, lines ~5, ~22, ~27, ~104)
- Modify: `frontend/src/components/calendar/EventCard.tsx`
- Test: `frontend/src/__tests__/components/calendar/EventCard.programLinks.test.tsx`

**Interfaces:**
- Consumes: `useProgramLinks`, `ProgramLink` (Task 8).
- Produces: `EventCard` prop `programLinks?: ProgramLink[]`; `EventList` prop `programLinks?: Record<string, ProgramLink[]>`.

- [ ] **Step 1: Write the failing tests**

Read `frontend/src/__tests__/components/calendar/EventCard.articleLinks.test.tsx` first and mirror its render harness and prop factories. Required cases:

```tsx
// EventCard.programLinks.test.tsx — required cases:
// 1. Expanded card with programLinks=[{title,url}] renders a "Digital
//    Program" heading and an <a href={url}> containing the title,
//    with target="_blank" and rel="noopener noreferrer".
// 2. Collapsed card with programLinks shows the 📖 badge on the
//    "Show more" button (title attribute "Digital program").
// 3. An event with NO description, NO categories, NO articleLinks but WITH
//    programLinks still renders the Show more expander.
// 4. Expanded card with BOTH programLinks and articleLinks renders
//    "Digital Program" before "In the Chautauquan Daily" in document order.
// 5. Card without programLinks renders neither heading nor 📖 badge.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/EventCard.programLinks.test.tsx`
Expected: FAIL — unknown prop / missing rendering.

- [ ] **Step 3: Implement**

`page.tsx` — three edits:

```tsx
// with the other hook imports:
import { useProgramLinks } from '@/hooks/useProgramLinks';
// next to the useArticleLinks call (~line 46):
const { links: programLinks } = useProgramLinks(selectedYear);
// in the <EventList ...> JSX (~line 180), add:
programLinks={programLinks}
```

`EventList.tsx` — three edits:

```tsx
import type { ProgramLink } from '@/hooks/useProgramLinks';
// props interface:
programLinks?: Record<string, ProgramLink[]>;
// destructure it in the signature, and where EventCard is rendered (~line 104):
programLinks={programLinks?.[event.id]}
```

`EventCard.tsx` — four edits:

```tsx
import type { ProgramLink } from '@/hooks/useProgramLinks';

// props interface + destructuring:
programLinks?: ProgramLink[];

// expander-forcing condition (line ~134) gains one clause:
{(event.description ||
  (event.categories && event.categories.filter(cat => !cat.name.startsWith('Week ')).length > 0) ||
  (articleLinks && articleLinks.length > 0) ||
  (programLinks && programLinks.length > 0)) && (

// inside the expanded branch, ABOVE the articleLinks block (before line ~175):
{programLinks && programLinks.length > 0 && (
  <div className="mb-2">
    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
      Digital Program
    </div>
    <ul className="space-y-0.5">
      {programLinks.map((link) => (
        <li key={link.url} className="text-sm">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
          >
            📖 {link.title}
          </a>
        </li>
      ))}
    </ul>
  </div>
)}

// collapsed branch: BEFORE the existing 📰 badge span (line ~205), add:
{programLinks && programLinks.length > 0 && (
  <span title="Digital program">📖</span>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/__tests__/components/calendar/`
Expected: PASS — new tests plus the untouched `EventCard.articleLinks.test.tsx`.

- [ ] **Step 5: Manual dev-server check**

```bash
cd frontend && npm run dev
```

Open http://localhost:3000 — using the committed `program-links-2026.json` from Task 6, find a matched event (e.g. a Best for Baby performance or an August recital), expand it, and confirm the 📖 "Digital Program" link renders and opens audienceaccess.co.

- [ ] **Step 6: Validate and commit**

```bash
cd frontend && npm run build
git add src/app/page.tsx src/components/calendar/EventList.tsx src/components/calendar/EventCard.tsx src/__tests__/components/calendar/EventCard.programLinks.test.tsx
git commit -m "feat(web): Digital Program link in event cards (#165)"
```

---

### Task 10: iOS — model + decoding

**Files:**
- Modify: `ios/ChqCalendar/Models/Sidecars.swift`
- Create: `ios/ChqCalendarTests/Fixtures/program-links-sample.json`
- Modify: `ios/ChqCalendarTests/ModelTests.swift` (add decode tests)

**Interfaces:**
- Consumes: `LossyArray<T>` (existing, `ios/ChqCalendar/Models/Event.swift` ~line 169).
- Produces (used by Tasks 11–12): `struct ProgramLink: Decodable, Hashable, Sendable { let title: String; let url: URL }` and `struct ProgramLinksFile: Decodable, Sendable { let links: [String: [ProgramLink]] }`.

- [ ] **Step 1: Create the fixture**

`ios/ChqCalendarTests/Fixtures/program-links-sample.json` (the malformed entry exercises `LossyArray` — no `url` key):

```json
{
  "generatedAt": "2026-08-05T12:00:00Z",
  "matcherVersion": 1,
  "links": {
    "event-1": [
      { "title": "Best For Baby", "url": "https://audienceaccess.co/show/CHQ-16426" }
    ],
    "event-2": [
      { "title": "Missing URL entry" }
    ]
  }
}
```

Add the file to the test target the same way `article-links-sample.json` is registered (check how the project references fixtures — folder reference vs explicit member — and match it).

- [ ] **Step 2: Write the failing tests**

In `ios/ChqCalendarTests/ModelTests.swift`, next to the existing ArticleLinksFile tests:

```swift
func testProgramLinksFileDecodesFixture() throws {
    let data = try fixtureData("program-links-sample.json")
    let file = try JSONDecoder().decode(ProgramLinksFile.self, from: data)
    XCTAssertEqual(file.links["event-1"]?.count, 1)
    XCTAssertEqual(file.links["event-1"]?.first?.title, "Best For Baby")
    XCTAssertEqual(
        file.links["event-1"]?.first?.url.absoluteString,
        "https://audienceaccess.co/show/CHQ-16426"
    )
}

func testProgramLinksFileDropsMalformedEntriesLossily() throws {
    let data = try fixtureData("program-links-sample.json")
    let file = try JSONDecoder().decode(ProgramLinksFile.self, from: data)
    // The url-less entry is dropped, not fatal to the whole file.
    XCTAssertEqual(file.links["event-2"], [])
}
```

(Use the same fixture-loading helper the existing article-links tests use; if it's named differently than `fixtureData`, match it.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO -only-testing:ChqCalendarTests/ModelTests`
Expected: BUILD FAILURE — `ProgramLinksFile` not found.

- [ ] **Step 4: Implement in `Sidecars.swift`** (below the ArticleLinksFile block)

```swift
nonisolated struct ProgramLink: Decodable, Hashable, Sendable {
    let title: String
    let url: URL
}

nonisolated struct ProgramLinksFile: Decodable, Sendable {
    let links: [String: [ProgramLink]]

    private enum CodingKeys: String, CodingKey { case links }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try container.decode([String: LossyArray<ProgramLink>].self, forKey: .links)
        links = raw.mapValues { $0.wrappedValue }
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Same command as Step 3. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ios/ChqCalendar/Models/Sidecars.swift ios/ChqCalendarTests/Fixtures/program-links-sample.json ios/ChqCalendarTests/ModelTests.swift ios/ChqCalendar.xcodeproj
git commit -m "feat(ios): ProgramLink model + lossy sidecar decoding (#165)"
```

---

### Task 11: iOS — fetch plumbing (CalendarAPI, EventRepository, AppModel)

**Files:**
- Modify: `ios/ChqCalendar/Data/CalendarAPI.swift` (RemoteResource enum)
- Modify: `ios/ChqCalendar/Data/EventRepository.swift`
- Modify: `ios/ChqCalendar/App/AppModel.swift` (~line 220)
- Modify tests: `ios/ChqCalendarTests/EventRepositoryTests.swift`, `ios/ChqCalendarTests/AppModelTests.swift`, plus any file that constructs `CalendarSnapshot` (grep `CalendarSnapshot(` across `ios/` and update every construction site).

**Interfaces:**
- Consumes: `ProgramLink`, `ProgramLinksFile` (Task 10).
- Produces (used by Task 12): `CalendarSnapshot.programLinks: [String: [ProgramLink]]` and `AppModel.programLinks(for eventID: String) -> [ProgramLink]`.

- [ ] **Step 1: Write the failing tests**

Mirror the existing article-links cases in `EventRepositoryTests.swift` (fetch-success, fetch-failure-falls-back-to-cache, malformed-payload-falls-back) for the program sidecar, and in `AppModelTests.swift` add:

```swift
func testProgramLinksAccessorReturnsLinksForEvent() { /* snapshot with programLinks -> accessor returns them */ }
func testProgramLinksAccessorEmptyWithoutSnapshot() { /* nil snapshot -> [] */ }
```

Required `EventRepositoryTests` cases (adapt the article-links test names/harness 1:1):
1. `refresh` fetches `/cache/calendar-cache/program-links-2026.json` in parallel and the snapshot carries its links.
2. A program-sidecar fetch failure yields the cached program links (events still succeed).
3. A malformed program payload yields the cached links, and the cache is not overwritten.
4. `cachedSnapshot` includes program links read from disk.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO`
Expected: BUILD FAILURE — `programLinks` not a member.

- [ ] **Step 3: Implement**

`CalendarAPI.swift` — add a case to `RemoteResource`:

```swift
case programLinks(year: Int)
// in `path`:
case .programLinks(let year):
    return "/cache/calendar-cache/program-links-\(year).json"
// in `cacheKey`:
case .programLinks(let year):
    return "program-links-\(year)"
```

`EventRepository.swift`:

```swift
// CalendarSnapshot gains a field (after articleLinks):
let programLinks: [String: [ProgramLink]]

// cachedSnapshot(year:) passes it:
programLinks: cachedProgramLinks(year: year),

// refresh(year:force:) adds a third parallel sidecar fetch:
async let programsResult = fetchSidecarPrograms(year: year)
// and the returned snapshot passes:
programLinks: await programsResult,

// new private helpers, mirroring the article ones exactly:
private func cachedProgramLinks(year: Int) -> [String: [ProgramLink]] {
    guard let entry = cache.read(RemoteResource.programLinks(year: year).cacheKey),
          let file = try? JSONDecoder().decode(ProgramLinksFile.self, from: entry.data)
    else {
        return [:]
    }
    return file.links
}

private func fetchSidecarPrograms(year: Int) async -> [String: [ProgramLink]] {
    let resource = RemoteResource.programLinks(year: year)
    let cachedEntry = cache.read(resource.cacheKey)
    let now = Date()

    guard let result = try? await api.fetch(resource, ifNoneMatch: cachedEntry?.metadata.etag, timeout: sidecarTimeout) else {
        return cachedProgramLinks(year: year)
    }

    switch result {
    case .notModified:
        cache.touch(resource.cacheKey, fetchedAt: now)
        return cachedProgramLinks(year: year)
    case .success(let data, let etag):
        guard let file = try? JSONDecoder().decode(ProgramLinksFile.self, from: data) else {
            return cachedProgramLinks(year: year)
        }
        cache.write(resource.cacheKey, data: data, etag: etag, fetchedAt: now)
        return file.links
    }
}
```

`AppModel.swift` — next to `articleLinks(for:)` (~line 220):

```swift
func programLinks(for eventID: String) -> [ProgramLink] {
    snapshot?.programLinks[eventID] ?? []
}
```

Then `grep -rn "CalendarSnapshot(" ios/` and add `programLinks:` to every construction site (app code and tests) — pass `[:]` where tests don't care.

- [ ] **Step 4: Run the full iOS test suite**

Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ios/
git commit -m "feat(ios): fetch + cache program-links sidecar (#165)"
```

---

### Task 12: iOS — detail section, row badge, screenshots

**Files:**
- Modify: `ios/ChqCalendar/Features/Detail/EventDetailView.swift`
- Modify: `ios/ChqCalendar/Features/Calendar/EventRow.swift`
- Possibly regenerate: `docs/app-store/screenshots.manifest.json`, `docs/app-store/screenshots/review/`

**Interfaces:**
- Consumes: `AppModel.programLinks(for:)` (Task 11).
- Produces: user-visible UI. No new API surface.

- [ ] **Step 1: Implement the detail section**

In `EventDetailView.swift`:

```swift
// computed property near the articleLinks one:
private var programLinks: [ProgramLink] { model.programLinks(for: event.id) }

// in body, ABOVE the articleLinksSection block (~line 79):
if !programLinks.isEmpty {
    programLinksSection
}

// section view, next to articleLinksSection (~line 231):
private var programLinksSection: some View {
    VStack(alignment: .leading, spacing: 8) {
        Text("Digital Program")
            .font(.headline)

        VStack(alignment: .leading, spacing: 12) {
            ForEach(programLinks, id: \.url) { link in
                Link(destination: link.url) {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "book")
                            .foregroundStyle(.secondary)
                            .frame(width: 24)

                        Text(link.title)
                            .font(.body)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)

                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: Implement the row badge**

In `EventRow.swift`:

```swift
// next to hasArticleLinks (line ~11):
private var hasProgramLinks: Bool { !model.programLinks(for: event.id).isEmpty }

// in the caption HStack, BEFORE the newspaper icon block (line ~33):
if hasProgramLinks {
    Image(systemName: "book")
        .font(.caption2)
        .foregroundStyle(.secondary)
}
```

- [ ] **Step 3: Build + full test suite**

Run: `cd ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO`
Expected: PASS.

- [ ] **Step 4: Manual simulator check**

Build and run in the simulator; confirm a matched event (from the live prod sidecar once deployed, or point the app at a local fixture per `ios/README.md` dev-server instructions) shows the book badge in the list and the "Digital Program" section in detail. If no live sidecar exists yet, verify via the fixture-driven repository test plus SwiftUI preview.

- [ ] **Step 5: App Store screenshot rule (required by CLAUDE.md)**

```bash
ios/Scripts/capture-screenshots.sh
python3 ios/Scripts/compose-screenshots.py
git status docs/app-store/
```

- If the manifest changed: commit `docs/app-store/screenshots.manifest.json` + `docs/app-store/screenshots/review/`.
- If the manifest did NOT change (the shot list in `ios/Scripts/screenshot-plan.json` doesn't cover an event with a program link), put `[skip-screenshots: regenerated, no covered shot changed]` in the PR description.
- Re-read `docs/app-store/listing-copy.md` and `docs/app-store/listing-fields.json` — this feature *adds* capability, so nothing should be invalidated, but confirm.

- [ ] **Step 6: Commit**

```bash
git add ios/ docs/app-store/
git commit -m "feat(ios): Digital Program section + row badge (#165)"
```

---

### Task 13: Final verification, runbook note, PR

**Files:**
- Modify: `docs/runbooks/article-links.md` sibling — Create: `docs/runbooks/program-links.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/program-links.md` modeled on `docs/runbooks/article-links.md` (read it first; keep the same section structure), covering: what the pipeline is, the Lambda name (`chautauqua-calendar-program-ingest`), how to invoke manually (`aws lambda invoke --function-name chautauqua-calendar-program-ingest --cli-binary-format raw-in-base64-out --payload '{"year":2026}' /tmp/out.json`), the summary log line to look for (`[program-ingest] summary:`), the zero-programs abort (markup drift symptom + diagnosis: curl the two listing pages, compare against `audienceAccessClient.ts` selectors), the sidecar/state S3 paths, and the local runner (`npm run ingest:programs:local`).

- [ ] **Step 2: Full verification sweep**

```bash
cd frontend && npm run build            # validate + tests + bundle
cd ../backend && npm run validate && npm run build   # lint/type + tests + esbuild
cd ../infrastructure && terraform validate
cd ../ios && xcodebuild test -project ChqCalendar.xcodeproj -scheme ChqCalendar \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.1' CODE_SIGNING_ALLOWED=NO
```

All four must pass. Fix anything red before the PR.

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add docs/runbooks/program-links.md
git commit -m "docs: program-links runbook (#165)"
git push -u origin feat/program-links-165
```

PR body must include:
- `Closes #165`.
- Summary of the pipeline + the two frontends.
- **Post-merge operational steps:** `terraform apply` in `infrastructure/` is required to create the Lambda/schedule/IAM before the deploy workflow's code-update step does anything; the first sidecar publishes on the first successful run.
- The screenshot outcome from Task 12 (committed regeneration, or the `[skip-screenshots: …]` opt-out line).

---

## Self-Review Notes

- **Spec coverage:** scraper (T2), date parsing (T1), matcher incl. fence/thresholds/one-link cap (T3), publisher + two-bucket split (T4), runner abort-on-zero + handler + bundle (T5), local runner + dev fixture (T6), terraform/IAM/EventBridge/deploy/trigger/CI-grant (T7), web hook refactor + UI (T8–9), iOS model/plumbing/UI + screenshot rule (T10–12), runbook + error-handling docs (T13). Out-of-scope items in the spec have no tasks, correctly.
- **Type consistency:** `Program`, `PublishedProgramLink`, `ProgramLinksFile`, `ProgramMatchRecord`, `ProgramMatchState` defined once in T1 and imported everywhere; runner deps are structural interfaces defined in T5 and satisfied by T2/T4 classes and T6's stand-ins; frontend `ProgramLink` defined in T8 and consumed in T9; Swift `ProgramLink`/`ProgramLinksFile` defined in T10 and consumed in T11–12.
- **Known judgment point:** matcher thresholds are calibrated against real 2026 data pairs listed in T3; T6 Step 4's real-scrape spot-check is the gate that catches miscalibration before anything ships.
